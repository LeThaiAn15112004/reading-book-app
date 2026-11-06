/**
 * PDF digital-signature verification (ISO 32000 §12.8).
 *
 * A PDF digital signature is a *signature dictionary* — `/ByteRange [a b c d]` plus a `/Contents`
 * hex string holding a CMS `SignedData` over `file[a, a+b) ++ file[c, c+d)` (everything except the
 * `/Contents` string itself). That is unrelated to highlight / underline / note annotations, which
 * never carry a `/ByteRange`; and unrelated to the book's SHA-256 fingerprint, which nothing signs.
 *
 * The signature dictionary must be a plain (non-compressed) object because its byte offsets are
 * baked into the signature, so a byte scan for `/ByteRange` finds every real signature without a
 * full PDF parser. Document timestamps (`/DocTimeStamp`, RFC 3161) are ignored: they date a file,
 * they are not a signer's signature.
 */

import { verifyDetachedCms, type CmsResult } from './cms.ts'
import { DerError, readNode } from './der.ts'

export type PdfSignatureOutcome =
  | { status: 'unsigned' }
  | { status: 'valid'; signerName?: string; signedAt?: string }
  | { status: 'invalid'; reason: string; signerName?: string; signedAt?: string }
  | { status: 'unsupported'; reason: string }

const BYTE_RANGE = Buffer.from('/ByteRange')
const PDF_HEADER = Buffer.from('%PDF-')
/** Sane ceiling; real documents have a handful of signatures. */
const MAX_SIGNATURES = 64
const SUPPORTED_SUBFILTERS = new Set(['adbe.pkcs7.detached', 'ETSI.CAdES.detached'])

interface Candidate {
  range: [number, number, number, number]
  /** Signature dictionary text outside the `/Contents` string. */
  dictionary: string
  /** `false` when the ByteRange / Contents framing is itself broken. */
  wellFormed: boolean
}

/** Text of the indirect object around `gapStart..gapEnd`, minus the (huge) `/Contents` string. */
function dictionaryText(pdf: Buffer, gapStart: number, gapEnd: number): string {
  const head = pdf.subarray(Math.max(0, gapStart - 8192), gapStart).toString('latin1')
  let from = 0
  for (const m of head.matchAll(/\d+\s+\d+\s+obj\b/g)) from = m.index + m[0].length
  const tailRaw = pdf.subarray(gapEnd, Math.min(pdf.length, gapEnd + 8192)).toString('latin1')
  const end = tailRaw.indexOf('endobj')
  return head.slice(from) + (end === -1 ? tailRaw : tailRaw.slice(0, end))
}

function findCandidates(pdf: Buffer): Candidate[] {
  const out: Candidate[] = []
  let from = 0
  for (;;) {
    const at = pdf.indexOf(BYTE_RANGE, from)
    if (at === -1) break
    from = at + BYTE_RANGE.length
    const probe = pdf.subarray(from, from + 128).toString('latin1')
    const m = /^\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(probe)
    if (!m) continue // `/ByteRange` that is not a literal array — not a signature dictionary
    const [a, b, c, d] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
    const gapStart = a + b
    const framed =
      a === 0 &&
      b > 0 &&
      c > gapStart &&
      c + d <= pdf.length &&
      pdf[gapStart] === 0x3c /* < */ &&
      pdf[c - 1] === 0x3e /* > */
    out.push({
      range: [a, b, c, d],
      dictionary: framed ? dictionaryText(pdf, gapStart, c) : '',
      wellFormed: framed,
    })
    if (out.length >= MAX_SIGNATURES) break
  }
  return out
}

/** `/M (D:YYYYMMDDHHmmSS…)` — the signing time recorded in the dictionary (fallback only). */
function dictionaryDate(dictionary: string): string | undefined {
  const m = /\/M\s*\(D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(dictionary)
  if (!m) return undefined
  const date = new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2] ?? 1) - 1,
      Number(m[3] ?? 1),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
    ),
  )
  // The zone offset is intentionally ignored: this is only a display fallback.
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function trailingBytesAreBlank(pdf: Buffer, from: number): boolean {
  for (let i = from; i < pdf.length; i++) {
    const byte = pdf[i]
    if (byte !== 0x0a && byte !== 0x0d && byte !== 0x20) return false
  }
  return true
}

interface Checked {
  /** Offset one past the last byte the signature covers. */
  coveredEnd: number
  result: CmsResult
  signedAt?: string
}

function checkSignature(pdf: Buffer, candidate: Candidate): Checked {
  const [a, b, c, d] = candidate.range
  const coveredEnd = c + d
  if (!candidate.wellFormed) {
    return { coveredEnd, result: { kind: 'invalid', reason: 'signature byte range is malformed' } }
  }

  const subFilter = /\/SubFilter\s*\/([^\s/<>[\]()]+)/.exec(candidate.dictionary)?.[1]
  if (!subFilter || !SUPPORTED_SUBFILTERS.has(subFilter)) {
    return {
      coveredEnd,
      result: { kind: 'unsupported', reason: `signature format ${subFilter ?? '(none)'}` },
    }
  }

  const hex = pdf.subarray(b, c).toString('latin1').slice(1, -1).replace(/\s+/g, '')
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return { coveredEnd, result: { kind: 'invalid', reason: 'signature contents are not valid hex' } }
  }
  const contents = Buffer.from(hex, 'hex')
  let cms: Buffer
  try {
    // The value is zero-padded to the reserved size; the DER length says where it really ends.
    cms = contents.subarray(0, readNode(contents, 0).end)
  } catch (err) {
    if (err instanceof DerError) {
      return { coveredEnd, result: { kind: 'invalid', reason: 'signature contents are empty or malformed' } }
    }
    throw err
  }

  const result = verifyDetachedCms(cms, [pdf.subarray(a, a + b), pdf.subarray(c, c + d)])
  const signedAt =
    result.kind === 'valid' || result.kind === 'invalid'
      ? (result.signedAt ?? dictionaryDate(candidate.dictionary))
      : undefined
  return { coveredEnd, result, signedAt }
}

/**
 * Verify every digital signature in a PDF.
 *
 * - no signature dictionary                       → `unsigned`
 * - any signature that fails                      → `invalid`
 * - else any signature we cannot evaluate         → `unsupported`
 * - else all intact, and the *last* signature reaches the end of the file → `valid`
 *   (a valid signature followed by more bytes means the file was changed after signing → `invalid`)
 */
export function verifyPdfSignatures(pdf: Buffer): PdfSignatureOutcome {
  if (pdf.subarray(0, 1024).indexOf(PDF_HEADER) === -1) {
    return { status: 'unsupported', reason: 'not a readable PDF file' }
  }

  const candidates = findCandidates(pdf).filter(
    (candidate) =>
      !/\/Type\s*\/DocTimeStamp\b/.test(candidate.dictionary) &&
      !/\/SubFilter\s*\/ETSI\.RFC3161\b/.test(candidate.dictionary),
  )
  if (candidates.length === 0) return { status: 'unsigned' }

  const checked = candidates
    .map((candidate) => checkSignature(pdf, candidate))
    .sort((x, y) => x.coveredEnd - y.coveredEnd)

  for (const item of checked) {
    if (item.result.kind === 'invalid') {
      return {
        status: 'invalid',
        reason: item.result.reason,
        signerName: item.result.signerName,
        signedAt: item.signedAt,
      }
    }
  }
  for (const item of checked) {
    if (item.result.kind === 'unsupported') {
      return { status: 'unsupported', reason: item.result.reason }
    }
  }

  const last = checked[checked.length - 1]
  if (last.coveredEnd > pdf.length || !trailingBytesAreBlank(pdf, last.coveredEnd)) {
    return { status: 'invalid', reason: 'the file was modified after it was signed' }
  }
  return {
    status: 'valid',
    signerName: last.result.kind === 'valid' ? last.result.signerName : undefined,
    signedAt: last.signedAt,
  }
}

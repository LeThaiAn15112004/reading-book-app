/**
 * Verification of a *detached* CMS / PKCS#7 `SignedData` (RFC 5652) over caller-supplied content —
 * the signature container used by PDF (`adbe.pkcs7.detached`, `ETSI.CAdES.detached`).
 *
 * This checks cryptographic integrity only: that the content hashes to the signed `messageDigest`
 * and that the signature over the signed attributes verifies with the public key of the signer
 * certificate embedded in the message. It does NOT build or validate the certificate chain, check
 * expiry or revocation, or evaluate timestamps — the app has no trust store, so a result of
 * `valid` means "untampered and signed by the embedded certificate's key", not "signer is trusted".
 *
 * Built on `node:crypto` (hashing, X.509 parsing, signature verification); the ASN.1 walking is the
 * small reader in `der.ts`. No cryptography is implemented here.
 */

import { X509Certificate, createHash, createVerify, timingSafeEqual } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import {
  DerError,
  TAG,
  children,
  contentOf,
  decodeOid,
  decodeTime,
  encodingOf,
  readNode,
  type DerNode,
} from './der.ts'

export type CmsResult =
  | { kind: 'valid'; signerName?: string; signedAt?: string }
  /** A signature is present but does not verify. */
  | { kind: 'invalid'; reason: string; signerName?: string; signedAt?: string }
  /** A signature is present but uses something this verifier does not implement. */
  | { kind: 'unsupported'; reason: string }

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
} as const

/** Digest algorithm OID → node:crypto hash name. MD5 and friends are deliberately absent. */
const DIGESTS: Record<string, string> = {
  '1.3.14.3.2.26': 'sha1',
  '2.16.840.1.101.3.4.2.4': 'sha224',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
}

/**
 * Signature algorithm OID → hash it pins (or `null` = "the SignerInfo digest algorithm decides").
 * Only key types whose `crypto.createVerify` default padding / encoding matches CMS are listed:
 * RSA PKCS#1 v1.5 and DER-encoded ECDSA. RSASSA-PSS, EdDSA etc. fall through to "unsupported".
 */
const SIGNATURE_ALGORITHMS: Record<string, string | null> = {
  '1.2.840.113549.1.1.1': null, // rsaEncryption
  '1.2.840.113549.1.1.5': 'sha1',
  '1.2.840.113549.1.1.14': 'sha224',
  '1.2.840.113549.1.1.11': 'sha256',
  '1.2.840.113549.1.1.12': 'sha384',
  '1.2.840.113549.1.1.13': 'sha512',
  '1.2.840.10045.2.1': null, // id-ecPublicKey
  '1.2.840.10045.4.1': 'sha1',
  '1.2.840.10045.4.3.1': 'sha224',
  '1.2.840.10045.4.3.2': 'sha256',
  '1.2.840.10045.4.3.3': 'sha384',
  '1.2.840.10045.4.3.4': 'sha512',
}

interface Certificate {
  der: Buffer
  issuer: Buffer
  serial: Buffer
}

function algorithmOid(node: DerNode): string {
  return decodeOid(children(node)[0])
}

function parseCertificate(node: DerNode): Certificate | undefined {
  if (node.tag !== TAG.sequence) return undefined
  const tbs = children(children(node)[0])
  // [0] EXPLICIT version is optional; serialNumber follows it.
  const base = tbs[0].tag === TAG.ctx0 ? 1 : 0
  const serial = tbs[base]
  const issuer = tbs[base + 2]
  if (serial?.tag !== TAG.integer || issuer?.tag !== TAG.sequence) return undefined
  return { der: encodingOf(node), issuer: encodingOf(issuer), serial: contentOf(serial) }
}

/** `CN=` of a node:crypto subject string (newline-separated `KEY=value` lines). */
function commonName(subject: string): string | undefined {
  const lines = subject.split('\n')
  const pick = (key: string): string | undefined =>
    lines.find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1).trim() || undefined
  return pick('CN') ?? pick('O') ?? pick('E')
}

function equalBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

function hashParts(algorithm: string, parts: readonly Buffer[]): Buffer {
  const hash = createHash(algorithm)
  for (const part of parts) hash.update(part)
  return hash.digest()
}

/** Signed-attribute values, keyed by attribute OID (first value of each). */
function readAttributes(attrs: DerNode): Map<string, DerNode> {
  const out = new Map<string, DerNode>()
  for (const attr of children(attrs)) {
    const [oid, values] = children(attr)
    const first = children(values)[0]
    if (first) out.set(decodeOid(oid), first)
  }
  return out
}

function verifyKey(
  key: KeyObject,
  hashName: string,
  signedBytes: readonly Buffer[],
  signature: Buffer,
): boolean {
  try {
    const verifier = createVerify(hashName)
    for (const part of signedBytes) verifier.update(part)
    return verifier.verify(key, signature)
  } catch {
    return false
  }
}

function verifySignerInfo(
  signerInfo: DerNode,
  certificates: readonly Certificate[],
  content: readonly Buffer[],
): CmsResult {
  const parts = children(signerInfo)
  // version, sid, digestAlgorithm, [0] signedAttrs?, signatureAlgorithm, signature, [1] unsignedAttrs?
  const sid = parts[1]
  let index = 2
  const digestOid = algorithmOid(parts[index++])
  const digestName = DIGESTS[digestOid]
  if (!digestName) return { kind: 'unsupported', reason: `digest algorithm ${digestOid}` }

  const signedAttrs = parts[index]?.tag === TAG.ctx0 ? parts[index++] : undefined
  const sigOid = algorithmOid(parts[index++])
  const signature = parts[index++]
  if (signature?.tag !== TAG.octetString) return { kind: 'invalid', reason: 'malformed SignerInfo' }
  if (!(sigOid in SIGNATURE_ALGORITHMS)) {
    return { kind: 'unsupported', reason: `signature algorithm ${sigOid}` }
  }
  const hashName = SIGNATURE_ALGORITHMS[sigOid] ?? digestName

  let signedAt: string | undefined
  let signedBytes: readonly Buffer[]
  if (signedAttrs) {
    const attrs = readAttributes(signedAttrs)
    const messageDigest = attrs.get(OID.messageDigest)
    if (messageDigest?.tag !== TAG.octetString) {
      return { kind: 'invalid', reason: 'signed attributes carry no messageDigest' }
    }
    if (!equalBytes(contentOf(messageDigest), hashParts(digestName, content))) {
      return { kind: 'invalid', reason: 'document content does not match the signed digest' }
    }
    const time = attrs.get(OID.signingTime)
    if (time) signedAt = decodeTime(time)
    // The signature covers the attributes re-tagged from [0] IMPLICIT to a universal SET.
    const setEncoding = Buffer.from(encodingOf(signedAttrs))
    setEncoding[0] = TAG.set
    signedBytes = [setEncoding]
  } else {
    signedBytes = content
  }

  // Candidate signer certificates: the one the SignerInfo names, else every embedded one.
  let candidates = certificates
  if (sid.tag === TAG.sequence) {
    const [issuer, serial] = children(sid)
    const named = certificates.filter(
      (cert) =>
        equalBytes(cert.issuer, encodingOf(issuer)) && equalBytes(cert.serial, contentOf(serial)),
    )
    if (named.length > 0) candidates = named
  }
  if (candidates.length === 0) {
    return { kind: 'unsupported', reason: 'no signer certificate embedded in the signature' }
  }

  for (const cert of candidates) {
    let x509: X509Certificate
    try {
      x509 = new X509Certificate(cert.der)
    } catch {
      continue
    }
    if (verifyKey(x509.publicKey, hashName, signedBytes, contentOf(signature))) {
      return { kind: 'valid', signerName: commonName(x509.subject), signedAt }
    }
  }
  return { kind: 'invalid', reason: 'signature does not match the signer certificate', signedAt }
}

/**
 * Verify a detached CMS `SignedData` (DER or BER) against `content` (the bytes it was computed
 * over, possibly split in several parts — a PDF's two `ByteRange` segments).
 */
export function verifyDetachedCms(cms: Buffer, content: readonly Buffer[]): CmsResult {
  try {
    const contentInfo = readNode(cms, 0)
    const [typeNode, wrapper] = children(contentInfo)
    if (decodeOid(typeNode) !== OID.signedData || wrapper?.tag !== TAG.ctx0) {
      return { kind: 'invalid', reason: 'not a CMS SignedData' }
    }
    const signedData = children(wrapper)[0]
    const fields = children(signedData)
    // version, digestAlgorithms, encapContentInfo, [0] certificates?, [1] crls?, signerInfos
    const encapsulated = children(fields[2])
    if (encapsulated.length > 1) {
      return { kind: 'unsupported', reason: 'signature embeds its content (not detached)' }
    }
    const certNode = fields.find((field, i) => i > 2 && field.tag === TAG.ctx0)
    const certificates = certNode
      ? children(certNode)
          .map((node) => parseCertificate(node))
          .filter((cert): cert is Certificate => cert !== undefined)
      : []
    const signerInfos = children(fields[fields.length - 1])
    if (fields[fields.length - 1].tag !== TAG.set || signerInfos.length === 0) {
      return { kind: 'invalid', reason: 'signature has no signer' }
    }

    let result: CmsResult = { kind: 'valid' }
    for (const signerInfo of signerInfos) {
      const one = verifySignerInfo(signerInfo, certificates, content)
      if (one.kind === 'invalid') return one
      if (one.kind === 'unsupported') result = one
      else if (result.kind === 'valid') result = one
    }
    return result
  } catch (err) {
    if (err instanceof DerError || err instanceof TypeError || err instanceof RangeError) {
      return { kind: 'invalid', reason: 'malformed signature data' }
    }
    throw err
  }
}

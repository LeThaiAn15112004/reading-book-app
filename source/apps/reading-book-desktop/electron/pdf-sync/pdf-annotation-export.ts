/**
 * Export a PDF with Readmate's annotations into a NEW file (phase 2,
 * docs/implementation_plan/pdf_annotation_export.md). Never writes the book's own file. Pure Node
 * with injected I/O (dialog, worker, signature check), so the spikes drive it without Electron.
 */
import { createHash, randomBytes } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { EmbeddedAnnotationLedgerEntry, ExportableHighlight } from '@reading-book/book-reader-sdk'
import type { PdfAnnotationWriteInput, PdfAnnotationWriteOutput, PdfAnnotationWriteSummary } from './pdf-annotation-write'
import { sameSignature, statSignature } from './stable-file-watcher'

export type ExportErrorCode =
  | 'cancelled'
  | 'not_found'
  | 'encrypted'
  | 'signed_needs_confirmation'
  | 'unsupported_pdf'
  | 'verify_failed'
  | 'same_as_source'
  | 'source_changed'
  | 'no_space'
  | 'permission_denied'
  | 'busy'
  | 'write_failed'

export type ExportResult =
  | { ok: true; fileName: string; summary: PdfAnnotationWriteSummary }
  | { ok: false; errorCode: ExportErrorCode; message?: string; signatureStatus?: string; signerName?: string }

export type ExportDeps = {
  /** Validated path of the book's PDF (resolveBookFile), or null. */
  resolveSource: () => Promise<string | null>
  ledger: () => EmbeddedAnnotationLedgerEntry[]
  rows: () => Promise<ExportableHighlight[]>
  /** Signature verdict of the source bytes (`verifyPdf`). */
  verifySignature: (bytes: Buffer) => { status: string; signerName?: string }
  /** Ask for the target (native save dialog); null when cancelled. */
  chooseTarget: () => Promise<string | null>
  /** Paths the export must never write to (the app's data folder…). */
  isForbiddenTarget: (target: string) => boolean
  write: (input: PdfAnnotationWriteInput) => Promise<PdfAnnotationWriteOutput>
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

function samePath(a: string, b: string): boolean {
  const na = path.resolve(a)
  const nb = path.resolve(b)
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

function errnoCode(err: unknown): string {
  return err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
}

function writeErrorCode(err: unknown): ExportErrorCode {
  const code = errnoCode(err)
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'no_space'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'permission_denied'
  if (code === 'EBUSY') return 'busy'
  return 'write_failed'
}

/**
 * Write `bytes` to `target` without ever leaving a half-written target: a temp file next to it
 * (same volume), flushed, then renamed over it. The temp file is removed on any failure.
 */
export async function writeFileSafely(target: string, bytes: Uint8Array): Promise<void> {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.readmate-${randomBytes(6).toString('hex')}.tmp`)
  let handle: Awaited<ReturnType<typeof fsp.open>> | null = null
  try {
    handle = await fsp.open(temp, 'wx')
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = null
    await fsp.rename(temp, target)
  } catch (err) {
    await handle?.close().catch(() => {})
    await fsp.rm(temp, { force: true }).catch(() => {})
    throw err
  }
}

export async function exportAnnotatedPdf(deps: ExportDeps, options: { acknowledgeSignature?: boolean } = {}): Promise<ExportResult> {
  const source = await deps.resolveSource()
  if (!source) return { ok: false, errorCode: 'not_found' }

  const before = await statSignature(source)
  let bytes: Buffer
  try {
    bytes = await fsp.readFile(source)
  } catch {
    return { ok: false, errorCode: 'not_found' }
  }
  if (!sameSignature(before, await statSignature(source))) return { ok: false, errorCode: 'source_changed', message: 'The book file changed while it was being read.' }
  const sourceSha = sha256(bytes)

  const signature = deps.verifySignature(bytes)
  if (signature.status !== 'unsigned' && !options.acknowledgeSignature) {
    return { ok: false, errorCode: 'signed_needs_confirmation', signatureStatus: signature.status, signerName: signature.signerName }
  }

  const target = await deps.chooseTarget()
  if (!target) return { ok: false, errorCode: 'cancelled' }
  if (samePath(target, source)) return { ok: false, errorCode: 'same_as_source', message: 'Choose a different file than the book itself.' }
  if (deps.isForbiddenTarget(target)) return { ok: false, errorCode: 'permission_denied', message: 'Choose a folder outside the app’s own data folder.' }

  let written: PdfAnnotationWriteOutput
  try {
    written = await deps.write({ bytes: new Uint8Array(bytes), ledger: deps.ledger(), rows: await deps.rows() })
  } catch (err) {
    const code = (err as { code?: string }).code
    const known: ExportErrorCode[] = ['encrypted', 'unsupported_pdf', 'verify_failed']
    return { ok: false, errorCode: known.includes(code as ExportErrorCode) ? (code as ExportErrorCode) : 'unsupported_pdf', message: err instanceof Error ? err.message : String(err) }
  }

  // The output must be the untouched source plus the update, and the source must still be what we read.
  const prefix = Buffer.from(written.output.buffer, written.output.byteOffset, bytes.length)
  if (!prefix.equals(bytes)) return { ok: false, errorCode: 'verify_failed', message: 'The output does not start with the source bytes.' }
  try {
    if (sha256(await fsp.readFile(source)) !== sourceSha) return { ok: false, errorCode: 'source_changed', message: 'The book file changed during the export.' }
  } catch {
    return { ok: false, errorCode: 'source_changed' }
  }

  try {
    await writeFileSafely(target, written.output)
  } catch (err) {
    return { ok: false, errorCode: writeErrorCode(err), message: err instanceof Error ? err.message : String(err) }
  }
  return { ok: true, fileName: path.basename(target), summary: written.summary }
}

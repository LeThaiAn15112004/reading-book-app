import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'

/**
 * Spec 017 (US3, R6): read a validated book file once for the Reader — no Electron, no database, so the spike
 * `spike:open:content` runs it on temp files.
 *
 * - The SHA-256 of the served bytes is kept for PDF ONLY: the embedded-annotation live sync compares it with the file
 *   it scans (pdf_embedded_annotation_live_sync.md §2). No other format needs a whole-file fingerprint to open.
 * - The `Buffer`'s own `ArrayBuffer` is sent when it is not a pooled slice, else one copy (FR-016).
 * - One consistent version: only a SIZE change between `stat` and the read means the file was being rewritten
 *   (`file_changed`, retried once by the Reader); an mtime change alone (a sync program touching it) is never an error.
 */

/** SHA-256 of the PDF bytes last served per book. */
const servedSha256 = new Map<string, string>()

export function servedBookSha256(bookId: string): string | undefined {
  return servedSha256.get(bookId)
}

/** Read errors that may pass — the Reader retries them once by itself (R3). */
const PASSING_READ_ERRORS = new Set(['EBUSY', 'EAGAIN', 'EIO', 'EMFILE', 'ENFILE'])

/**
 * A cloud-drive placeholder (OneDrive / Google Drive / Dropbox "online-only" file) that cannot be read now.
 * Windows reports `ERROR_CLOUD_FILE_*` (Win32 362–400), which libuv surfaces as `UNKNOWN` with a "cloud" message.
 */
export function isCloudPlaceholderError(error: unknown): boolean {
  const e = error as { code?: unknown; errno?: unknown; message?: unknown } | null
  if (!e) return false
  const message = typeof e.message === 'string' ? e.message : ''
  if (/cloud (file|provider|operation)/i.test(message)) return true
  return e.code === 'UNKNOWN' && typeof e.errno === 'number' && Math.abs(e.errno) >= 362 && Math.abs(e.errno) <= 400
}

export type ReadFailureCode = 'read_failed' | 'not_available_offline' | 'file_changed' | 'too_large'

export type ReadBookBytesResult =
  | { ok: true; data: ArrayBuffer; byteLength: number }
  | { ok: false; code: ReadFailureCode; retryable: boolean }

export function readFailureOf(error: unknown): { ok: false; code: ReadFailureCode; retryable: boolean } {
  if (isCloudPlaceholderError(error)) return { ok: false, code: 'not_available_offline', retryable: false }
  const code = (error as { code?: unknown } | null)?.code
  return { ok: false, code: 'read_failed', retryable: typeof code === 'string' && PASSING_READ_ERRORS.has(code) }
}

/** The buffer's own `ArrayBuffer` when it spans it exactly (not a pooled slice), else one standalone copy. */
export function ownArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const backing = buf.buffer
  if (backing instanceof ArrayBuffer && buf.byteOffset === 0 && buf.byteLength === backing.byteLength) return backing
  const copy = new Uint8Array(buf.byteLength)
  copy.set(buf)
  return copy.buffer
}

export async function readBookBytes(input: {
  bookId: string
  path: string
  format: string
  /** Refuses a file above a limit before AND after reading it (Markdown is rendered whole). */
  sizeAllowed?: (bytes: number) => boolean
  /** Test hook: the reader of the file (defaults to `fs.promises.readFile`). */
  readFile?: (path: string) => Promise<Buffer>
}): Promise<ReadBookBytesResult> {
  const { bookId, path, format } = input
  let sizeBefore: number
  try {
    sizeBefore = (await fsp.stat(path)).size
  } catch (error) {
    return readFailureOf(error)
  }
  // FR-007: the instant checks come before any read, so their error is immediate.
  if (input.sizeAllowed && !input.sizeAllowed(sizeBefore)) return { ok: false, code: 'too_large', retryable: false }
  let buf: Buffer
  try {
    buf = await (input.readFile ?? fsp.readFile)(path)
  } catch (error) {
    return readFailureOf(error)
  }
  if (buf.byteLength !== sizeBefore) return { ok: false, code: 'file_changed', retryable: true }
  if (input.sizeAllowed && !input.sizeAllowed(buf.byteLength)) return { ok: false, code: 'too_large', retryable: false }
  if (format === 'pdf') servedSha256.set(bookId, createHash('sha256').update(buf).digest('hex'))
  else servedSha256.delete(bookId)
  const data = ownArrayBuffer(buf)
  return { ok: true, data, byteLength: data.byteLength }
}

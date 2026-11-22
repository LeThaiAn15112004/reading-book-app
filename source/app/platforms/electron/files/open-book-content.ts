import { createHash } from 'node:crypto'
import { mainTimer, isTimingEnabled } from '../perf/timing-log'
import fsp from 'node:fs/promises'
import { checkMdFileSize, describeMdTooLarge, isAudioFormat } from '@core'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import type {
  DocumentFormatDto,
  OpenBookContentResult,
} from '../ipc/api-types'
import { resolveBookFile } from './sandbox'
import { tMain } from '../i18n/main-translate'

/**
 * SHA-256 of the bytes last served per book — lets the embedded-annotation sync tell whether the
 * file it scanned is the very one the reader displays (pdf_embedded_annotation_live_sync.md §2).
 */
const servedSha256 = new Map<string, string>()

export function servedBookSha256(bookId: string): string | undefined {
  return servedSha256.get(bookId)
}

/** Spec 017 (R3): read errors that may pass — the Reader retries them once by itself. */
const PASSING_READ_ERRORS = new Set(['EBUSY', 'EAGAIN', 'EIO', 'EMFILE', 'ENFILE'])

/**
 * Spec 017: a cloud-drive placeholder (OneDrive / Google Drive / Dropbox "online-only" file) that cannot be read now.
 * Windows reports `ERROR_CLOUD_FILE_*` (Win32 362–400), which libuv surfaces as `UNKNOWN` with a "cloud" message.
 */
export function isCloudPlaceholderError(error: unknown): boolean {
  const e = error as { code?: unknown; errno?: unknown; message?: unknown } | null
  if (!e) return false
  const message = typeof e.message === 'string' ? e.message : ''
  if (/cloud (file|provider|operation)/i.test(message)) return true
  return e.code === 'UNKNOWN' && typeof e.errno === 'number' && Math.abs(e.errno) >= 362 && Math.abs(e.errno) <= 400
}

function readFailure(id: string, error: unknown): OpenBookContentResult {
  if (isCloudPlaceholderError(error)) {
    return { ...fail(id, 'not_available_offline', tMain('main.messages.common.readFailed')), retryable: false }
  }
  const code = (error as { code?: unknown } | null)?.code
  const retryable = typeof code === 'string' && PASSING_READ_ERRORS.has(code)
  return { ...fail(id, 'read_failed', tMain('main.messages.common.readFailed')), retryable }
}

/** Copy into a standalone ArrayBuffer (avoid Node Buffer pool / IPC edge cases). */
function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buf.byteLength)
  copy.set(buf)
  return copy.buffer
}

function fail(
  bookId: string,
  errorCode: NonNullable<OpenBookContentResult['errorCode']>,
  errorMessage: string,
): OpenBookContentResult {
  return { ok: false, bookId, errorCode, errorMessage }
}

/**
 * Resolve a library book by id, validate its registered path, and return file bytes.
 * The file is either an app-owned sandbox copy or the user's own file (reference-based library);
 * the book stays in the library either way if the file can't be found.
 * Never exposes absolute filesystem paths to the caller (T3.4 / SDS §2.10.1).
 */
export async function openBookContent(bookId: string): Promise<OpenBookContentResult> {
  const id = bookId.trim()
  if (!id) {
    return fail('', 'not_found', tMain('main.messages.common.bookNotFound'))
  }

  const book = await getLibraryStore().findById(id)
  if (!book) {
    return fail(id, 'not_found', tMain('main.messages.common.bookNotFound'))
  }

  const file = await resolveBookFile(book)
  if (!file.ok) {
    switch (file.code) {
      case 'path_denied':
        return fail(id, 'path_denied', tMain('main.messages.common.locationInvalid'))
      case 'missing_file':
        return fail(
          id,
          'missing_file',
          tMain('main.messages.common.bookFileMissing'),
        )
      default:
        return fail(id, 'read_failed', tMain('main.messages.common.readFailed'))
    }
  }

  // TXT is read through txt:open (decoded, and the edited copy when there is one); the path above
  // was only validated. Nothing is read here — a multi-megabyte buffer would cross IPC for nothing.
  if (book.format === 'txt') {
    return { ok: true, bookId: id, format: 'txt', data: new ArrayBuffer(0), byteLength: 0 }
  }

  // Audio is never read here: it is streamed by the `rb-audio` protocol (Range requests, no whole-file
  // buffer, no IPC payload). The path check above doubles as the player's "can this be opened?"
  // preflight, so a moved / unreadable file gets a specific error instead of a generic media error.
  if (isAudioFormat(book.format)) {
    return { ok: true, bookId: id, format: book.format as DocumentFormatDto, data: new ArrayBuffer(0), byteLength: 0 }
  }

  // Markdown is rendered whole in the renderer: refuse a file above the limit BEFORE reading it,
  // so an oversized file is never loaded into memory or sent over IPC.
  // Spec 017 (FR-007): the instant checks (path above, size here) come before any read, so their error is immediate.
  let sizeBefore: number
  try {
    sizeBefore = (await fsp.stat(file.path)).size
  } catch (error) {
    return readFailure(id, error)
  }
  if (book.format === 'md' && !checkMdFileSize(sizeBefore).ok) return fail(id, 'too_large', describeMdTooLarge())

  try {
    // Spec 016: `open-read` = read + fingerprint + copy before the bytes go to the renderer (timing on only).
    const openStartedAt = isTimingEnabled() ? Date.now() : 0
    const buf = await fsp.readFile(file.path)
    // Spec 017: one consistent version. Only a SIZE change means the file was being rewritten while read; an mtime
    // change alone (a sync program touching the file, FR-021) is never an error — the bytes read are used.
    if (buf.byteLength !== sizeBefore) {
      return { ...fail(id, 'file_changed', tMain('main.messages.common.readFailed')), retryable: true }
    }
    // The file may have grown between stat and read.
    if (book.format === 'md' && !checkMdFileSize(buf.byteLength).ok) {
      return fail(id, 'too_large', describeMdTooLarge())
    }
    servedSha256.set(id, createHash('sha256').update(buf).digest('hex'))
    const data = bufferToArrayBuffer(buf)
    if (openStartedAt) {
      mainTimer().record('open', 'open-read', { format: book.format, sizeBytes: buf.byteLength }, Date.now() - openStartedAt)
    }
    return {
      ok: true,
      bookId: id,
      format: book.format as DocumentFormatDto,
      data,
      byteLength: data.byteLength,
    }
  } catch (error) {
    return readFailure(id, error)
  }
}

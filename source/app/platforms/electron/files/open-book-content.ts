import { mainTimer, isTimingEnabled } from '../perf/timing-log'
import { checkMdFileSize, describeMdTooLarge, isAudioFormat } from '@core'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import type {
  DocumentFormatDto,
  OpenBookContentResult,
} from '../ipc/api-types'
import { resolveBookFile } from './sandbox'
import { tMain } from '../i18n/main-translate'
import { readBookBytes } from './read-book-bytes'

// The SHA-256 of the served PDF bytes (live sync) and the cloud-placeholder test live with the read itself.
export { isCloudPlaceholderError, servedBookSha256 } from './read-book-bytes'

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

  // Markdown is rendered whole in the renderer: refuse a file above the limit BEFORE reading it (and again after),
  // so an oversized file is never loaded into memory or sent over IPC.
  // Spec 016: `open-read` = read (+ PDF fingerprint) before the bytes go to the renderer (timing on only).
  const openStartedAt = isTimingEnabled() ? Date.now() : 0
  const read = await readBookBytes({
    bookId: id,
    path: file.path,
    format: book.format,
    sizeAllowed: book.format === 'md' ? (bytes) => checkMdFileSize(bytes).ok : undefined,
  })
  if (!read.ok) {
    if (read.code === 'too_large') return fail(id, 'too_large', describeMdTooLarge())
    return { ...fail(id, read.code, tMain('main.messages.common.readFailed')), retryable: read.retryable }
  }
  if (openStartedAt) {
    mainTimer().record('open', 'open-read', { format: book.format, sizeBytes: read.byteLength }, Date.now() - openStartedAt)
  }
  return {
    ok: true,
    bookId: id,
    format: book.format as DocumentFormatDto,
    data: read.data,
    byteLength: read.byteLength,
  }
}

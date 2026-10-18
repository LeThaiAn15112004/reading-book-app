import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import type {
  DocumentFormatDto,
  OpenBookContentResult,
} from '../ipc/api-types'
import { resolveBookFile } from './sandbox'

/**
 * SHA-256 of the bytes last served per book — lets the embedded-annotation sync tell whether the
 * file it scanned is the very one the reader displays (pdf_embedded_annotation_live_sync.md §2).
 */
const servedSha256 = new Map<string, string>()

export function servedBookSha256(bookId: string): string | undefined {
  return servedSha256.get(bookId)
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
    return fail('', 'not_found', 'Book not found.')
  }

  const book = await getLibraryStore().findById(id)
  if (!book) {
    return fail(id, 'not_found', 'Book not found.')
  }

  const file = await resolveBookFile(book)
  if (!file.ok) {
    switch (file.code) {
      case 'path_denied':
        return fail(id, 'path_denied', 'This book’s file location is not valid.')
      case 'missing_file':
        return fail(
          id,
          'missing_file',
          'The book file could not be found. It may have been moved, renamed, or deleted.',
        )
      default:
        return fail(id, 'read_failed', 'Could not read the book file.')
    }
  }

  // TXT is read through txt:open (decoded, and the edited copy when there is one); the path above
  // was only validated. Nothing is read here — a multi-megabyte buffer would cross IPC for nothing.
  if (book.format === 'txt') {
    return { ok: true, bookId: id, format: 'txt', data: new ArrayBuffer(0), byteLength: 0 }
  }

  try {
    const buf = await fsp.readFile(file.path)
    servedSha256.set(id, createHash('sha256').update(buf).digest('hex'))
    const data = bufferToArrayBuffer(buf)
    return {
      ok: true,
      bookId: id,
      format: book.format as DocumentFormatDto,
      data,
      byteLength: data.byteLength,
    }
  } catch {
    return fail(id, 'read_failed', 'Could not read the book file.')
  }
}

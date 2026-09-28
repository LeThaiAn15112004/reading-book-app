import fsp from 'node:fs/promises'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import type {
  DocumentFormatDto,
  OpenBookContentResult,
} from '../ipc/api-types'
import { resolveBookFile } from './sandbox'

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

  try {
    const buf = await fsp.readFile(file.path)
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

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import type {
  DocumentFormatDto,
  OpenBookContentResult,
} from '../ipc/api-types'
import { assertPathAllowed } from './sandbox'

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
 * Resolve a library book by id, enforce sandbox allowlist, and return file bytes.
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

  let resolved: string
  try {
    resolved = assertPathAllowed(book.filePath)
  } catch {
    return fail(id, 'path_denied', 'Book file is outside the allowed sandbox.')
  }

  try {
    await fsp.access(resolved, fs.constants.R_OK)
  } catch {
    return fail(id, 'missing_file', 'Book file is missing from the library sandbox.')
  }

  try {
    const buf = await fsp.readFile(resolved)
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

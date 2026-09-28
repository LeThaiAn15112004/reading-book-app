import { resolveFormatFromExtension } from '@reading-book/config'
import path from 'node:path'
import type { RelinkBookResult } from '../ipc/api-types'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { hashFile } from './file-hash'
import { isPathInsideUserData } from './sandbox'

function fail(
  errorCode: NonNullable<RelinkBookResult['errorCode']>,
  errorMessage: string,
): RelinkBookResult {
  return { ok: false, errorCode, errorMessage }
}

/**
 * Re-attach a library book to a file the user picked ("Locate file"), if — and only if — it is the
 * same file: its SHA-256 must equal the one recorded when the book was imported. That is what stops
 * an unrelated book from being attached to this book's annotations, progress and search index.
 *
 * Only `books.file_path` (+ `updated_at`) changes. The book id, and everything keyed by it, stays
 * put; because the hash is unchanged the derived `book_chunks` / FTS rows are still valid too.
 */
export async function relinkBookToFile(
  bookId: string,
  chosenPath: string,
): Promise<RelinkBookResult> {
  const store = getLibraryStore()
  const book = await store.findById(bookId)
  if (!book) return fail('not_found', 'Book not found.')

  const resolved = path.resolve(chosenPath)
  if (isPathInsideUserData(resolved)) {
    return fail('wrong_file', 'Choose a file outside the app’s own data folder.')
  }
  if (resolveFormatFromExtension(path.extname(resolved).toLowerCase()) !== book.format) {
    return fail('wrong_file', `That file is not a ${book.format.toUpperCase()} book.`)
  }

  let sha256: string
  try {
    sha256 = (await hashFile(resolved)).sha256
  } catch {
    return fail('read_failed', 'Could not read the selected file.')
  }
  if (sha256 !== book.sha256) {
    return fail(
      'hash_mismatch',
      'That file is not the same book as this library entry, so it was not linked.',
    )
  }

  store.updateFilePath(book.id, resolved)
  return { ok: true }
}

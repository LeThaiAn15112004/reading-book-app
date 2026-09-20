import { DocumentFormat } from '@reading-book/book-reader-sdk'
import fsp from 'node:fs/promises'
import { readEpubLibraryMetadata } from '../adapters/epub.adapter'
import { getLibraryStore } from './sqlite-library-store'

/**
 * Re-read sandbox EPUB files and fill missing Library metadata.
 *
 * Needed after migration 007 accidentally cascaded `book_authors` (FK pragma
 * was a no-op inside a transaction), and for books imported before
 * description / page_count / genres were persisted.
 */
export async function backfillLibraryMetadataFromFiles(): Promise<void> {
  const store = getLibraryStore()
  const rows = await store.listAll()

  for (const { book, authorNames, genreNames } of rows) {
    store.ensureReadingSession(book.id)

    if (book.format !== DocumentFormat.Epub) continue

    const needsAuthors = !authorNames.trim()
    const needsGenres = genreNames.length === 0
    const needsDescription = !book.description?.trim()
    const needsPages = book.pageCount == null || book.pageCount <= 0
    if (!needsAuthors && !needsGenres && !needsDescription && !needsPages) {
      continue
    }

    try {
      await fsp.access(book.filePath)
    } catch {
      continue
    }

    try {
      const meta = await readEpubLibraryMetadata(book.filePath)
      if (needsAuthors && meta.authors.length > 0) {
        store.replaceAuthorsByName(book.id, meta.authors)
      }
      if (needsGenres && meta.genreNames.length > 0) {
        store.replaceGenresByName(book.id, meta.genreNames)
      }
      if (needsDescription || needsPages) {
        store.updateLibraryMetadata(book.id, {
          description: needsDescription
            ? meta.description ?? null
            : undefined,
          pageCount: needsPages ? meta.pageCount ?? null : undefined,
          title: meta.title,
        })
      }
    } catch {
      // Skip corrupt / unreadable EPUB; do not fail app boot.
    }
  }
}

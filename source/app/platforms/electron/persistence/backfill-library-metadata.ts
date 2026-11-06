import { DocumentFormat } from '@reading-book/book-reader-sdk'
import { readEpubLibraryMetadata } from '../adapters/epub.adapter'
import { resolveBookFile } from '../files/sandbox'
import { getLibraryStore } from './sqlite-library-store'

/**
 * Re-read registered EPUB files (sandbox copies or the user's own files) and fill missing Library
 * metadata. Read-only: it never writes next to the book — covers are not extracted here.
 *
 * Needed after migration 007 accidentally cascaded `book_authors` (FK pragma
 * was a no-op inside a transaction), and for books imported before
 * description / page_count / genres were persisted.
 */
export async function backfillLibraryMetadataFromFiles(): Promise<void> {
  const store = getLibraryStore()
  const rows = await store.listAll()

  for (const { book, authorNames, genreNames } of rows) {
    if (book.format !== DocumentFormat.Epub) continue

    const needsAuthors = !authorNames.trim()
    const needsGenres = genreNames.length === 0
    const needsDescription = !book.description?.trim()
    const needsPages = book.pageCount == null || book.pageCount <= 0
    if (!needsAuthors && !needsGenres && !needsDescription && !needsPages) {
      continue
    }

    // A moved / deleted / unreadable file is skipped, never an error at boot.
    const file = await resolveBookFile(book)
    if (!file.ok) continue

    try {
      const meta = await readEpubLibraryMetadata(file.path)
      if (needsAuthors && meta.authors.length > 0) {
        store.replaceAuthorsByName(book.id, meta.authors)
      }
      if (needsGenres && meta.genreNames.length > 0) {
        store.setGenres(book.id, meta.genreNames)
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

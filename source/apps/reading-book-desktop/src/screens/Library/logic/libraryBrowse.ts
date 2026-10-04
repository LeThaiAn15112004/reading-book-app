import { filterByNav, type LibraryBook } from '@reading-book/book-reader-sdk'

/** Library sidebar destinations (status filters + favorites). Collections live in the top nav. */
export type LibraryBrowseFilter = 'all' | 'reading' | 'not-started' | 'completed' | 'favorites'

export type LibrarySortId = 'recently-added' | 'recently-read' | 'title' | 'author'

/** Grid = covers (reading); Table = dense rows + detail panel (managing many documents). */
export type LibraryLayout = 'grid' | 'table'

export const LIBRARY_BROWSE_FILTERS: readonly { id: LibraryBrowseFilter; label: string }[] = [
  { id: 'all', label: 'All books' },
  { id: 'reading', label: 'Reading' },
  { id: 'not-started', label: 'Not started' },
  { id: 'completed', label: 'Completed' },
  { id: 'favorites', label: 'Favorites' },
]

export const LIBRARY_SORTS: readonly { id: LibrarySortId; label: string }[] = [
  { id: 'recently-added', label: 'Recently added' },
  { id: 'recently-read', label: 'Recently read' },
  { id: 'title', label: 'Title' },
  { id: 'author', label: 'Author' },
]

/** Empty-state copy per filter. */
export const LIBRARY_FILTER_EMPTY: Record<LibraryBrowseFilter, string> = {
  all: 'No books yet.',
  reading: 'No books in progress. Open a book to start reading.',
  'not-started': 'Every book has been opened at least once.',
  completed: 'No completed books yet. Mark a book completed from its menu.',
  favorites: 'No favorites yet. Add one from a book’s menu.',
}

/** Books matching one sidebar filter — reuses the SDK nav filters. */
export function filterLibraryBooks(books: LibraryBook[], filter: LibraryBrowseFilter): LibraryBook[] {
  switch (filter) {
    case 'all':
      return books
    case 'not-started':
      return filterByNav(books, 'to-read')
    default:
      return filterByNav(books, filter)
  }
}

export function countLibraryFilters(books: LibraryBook[]): Record<LibraryBrowseFilter, number> {
  return {
    all: books.length,
    reading: filterLibraryBooks(books, 'reading').length,
    'not-started': filterLibraryBooks(books, 'not-started').length,
    completed: filterLibraryBooks(books, 'completed').length,
    favorites: filterLibraryBooks(books, 'favorites').length,
  }
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Missing values (no author "—", never read, unknown add time) always sort last. */
function hasAuthor(book: LibraryBook): boolean {
  return Boolean(book.author) && book.author !== '—'
}

function byDateDesc(a: string | undefined, b: string | undefined): number {
  if (a && b) return b.localeCompare(a)
  if (a) return -1
  if (b) return 1
  return 0
}

/** Stable sort; ties fall back to title. Input order (newest import first from Main) is kept otherwise. */
export function sortLibraryBooks(books: LibraryBook[], sort: LibrarySortId): LibraryBook[] {
  const byTitle = (a: LibraryBook, b: LibraryBook) => collator.compare(a.title, b.title)
  const sorted = [...books]
  switch (sort) {
    case 'recently-added':
      return sorted.sort((a, b) => byDateDesc(a.addedAt, b.addedAt))
    case 'recently-read':
      return sorted.sort((a, b) => byDateDesc(a.lastReadAt, b.lastReadAt) || byTitle(a, b))
    case 'title':
      return sorted.sort(byTitle)
    case 'author':
      return sorted.sort((a, b) => {
        if (hasAuthor(a) !== hasAuthor(b)) return hasAuthor(a) ? -1 : 1
        return collator.compare(a.author, b.author) || byTitle(a, b)
      })
  }
}

/**
 * Continue Reading: books in progress with a resumable location, most recent first (same rule as
 * the SDK's `pickContinueReading`, which returns only the single most recent one).
 */
export function pickContinueReadingBooks(books: LibraryBook[], limit = 3): LibraryBook[] {
  return books
    .filter((book) => book.status === 'reading' && Boolean(book.lastReadLocation))
    .sort((a, b) => byDateDesc(a.lastReadAt, b.lastReadAt))
    .slice(0, limit)
}

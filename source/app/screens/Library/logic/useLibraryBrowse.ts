import { useMemo } from 'react'
import { matchesSearch, pickPhoneContinueReading, type LibraryBook } from '@core'
import {
  countLibraryFilters,
  filterLibraryBooks,
  pickContinueReadingBooks,
  sortLibraryBooks,
} from './libraryBrowse'
import { useLibraryBrowseStore } from './libraryBrowseStore'

/**
 * Derived lists for the Library browse area: search → sidebar filter → sort. Pure derivation over
 * `books`; view state lives in `useLibraryBrowseStore`.
 */
export function useLibraryBrowse(books: LibraryBook[], searchQuery: string) {
  const filter = useLibraryBrowseStore((s) => s.filter)
  const sort = useLibraryBrowseStore((s) => s.sort)
  const layout = useLibraryBrowseStore((s) => s.layout)
  const selectedBookId = useLibraryBrowseStore((s) => s.selectedBookId)

  const searchActive = searchQuery.trim().length > 0

  return useMemo(() => {
    const searched = searchActive ? books.filter((b) => matchesSearch(b, searchQuery)) : books
    const filtered = filterLibraryBooks(searched, filter)
    // `recent` has its own order (most recently read first) whatever the chosen sort (spec 013 FR-032).
    const visibleBooks = filter === 'recent' ? filtered : sortLibraryBooks(filtered, sort)
    const selectedBook =
      layout === 'table' && selectedBookId
        ? (visibleBooks.find((b) => b.id === selectedBookId) ?? null)
        : null
    return {
      filter,
      sort,
      layout,
      searchActive,
      /** Sidebar badges follow the search so counts match what each filter would show. */
      counts: countLibraryFilters(searched),
      visibleBooks,
      /** Only on All books without a search — the strip is a shortcut, not a filter result. */
      continueBooks: filter === 'all' && !searchActive ? pickContinueReadingBooks(books) : [],
      /** Phone carousel (spec 013): started books incl. completed ones, at most 10, newest first. */
      phoneContinueBooks: filter === 'all' && !searchActive ? pickPhoneContinueReading(books, 10) : [],
      selectedBook,
    }
  }, [books, searchQuery, searchActive, filter, sort, layout, selectedBookId])
}

import type { LibraryBook } from '@reading-book/book-reader-sdk'
import {
  BootErrorBanner,
  ContinueReading,
  LibraryBookDetailPanel,
  LibraryBookGrid,
  LibraryBookTable,
  LibraryBrowseToolbar,
  LibraryEmptyState,
  LibrarySidebar,
  LibraryTopBar,
  type BookMenuPoint,
} from './components'
import {
  LIBRARY_BROWSE_FILTERS,
  LIBRARY_FILTER_EMPTY,
  useLibraryBrowse,
  useLibraryBrowseStore,
} from './logic'

export type LibraryHubProps = {
  /** null while the first load is in flight. */
  books: LibraryBook[] | null
  searchQuery: string
  onSearchChange: (value: string) => void
  onFromDevice: () => void
  onFromUrl: () => void
  bootError?: string
  onRetryBoot: () => void
  onOpenBook: (bookId: string) => void
  onBookMenu: (bookId: string, point: BookMenuPoint) => void
  onToggleFavorite: (book: LibraryBook) => void
}

/**
 * SCR-01 Library home (layout A + B + D): sidebar filters | top bar · Continue Reading (All
 * books only) · toolbar · Grid or Table — and, in Table, a detail panel for the selected row.
 */
export function LibraryHub({
  books,
  searchQuery,
  onSearchChange,
  onFromDevice,
  onFromUrl,
  bootError,
  onRetryBoot,
  onOpenBook,
  onBookMenu,
  onToggleFavorite,
}: LibraryHubProps) {
  const bookList = books ?? []
  const { filter, sort, layout, searchActive, counts, visibleBooks, continueBooks, selectedBook } =
    useLibraryBrowse(bookList, searchQuery)
  const setFilter = useLibraryBrowseStore((s) => s.setFilter)
  const setSort = useLibraryBrowseStore((s) => s.setSort)
  const setLayout = useLibraryBrowseStore((s) => s.setLayout)
  const selectBook = useLibraryBrowseStore((s) => s.selectBook)

  const isEmpty = books !== null && books.length === 0
  const filterLabel = LIBRARY_BROWSE_FILTERS.find((f) => f.id === filter)?.label ?? 'All books'

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <LibrarySidebar active={filter} counts={counts} onSelect={setFilter} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <LibraryTopBar
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onFromDevice={onFromDevice}
          onFromUrl={onFromUrl}
        />

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto py-6">
            <div className="mx-auto w-full max-w-[1400px] px-6">
              {bootError ? <BootErrorBanner message={bootError} onRetry={onRetryBoot} /> : null}

              {isEmpty ? (
                <LibraryEmptyState onFromDevice={onFromDevice} onFromUrl={onFromUrl} />
              ) : books !== null ? (
                <>
                  {continueBooks.length > 0 ? (
                    <ContinueReading books={continueBooks} onResume={onOpenBook} onBookMenu={onBookMenu} />
                  ) : null}

                  <LibraryBrowseToolbar
                    title={searchActive ? `${filterLabel} · “${searchQuery.trim()}”` : filterLabel}
                    count={visibleBooks.length}
                    sort={sort}
                    onSortChange={setSort}
                    layout={layout}
                    onLayoutChange={setLayout}
                  />

                  {visibleBooks.length === 0 ? (
                    <p className="mt-10 text-center text-sm text-lib-faint" role="status">
                      {searchActive ? 'No matching books found.' : LIBRARY_FILTER_EMPTY[filter]}
                    </p>
                  ) : layout === 'table' ? (
                    <LibraryBookTable
                      books={visibleBooks}
                      selectedBookId={selectedBook?.id ?? null}
                      onSelect={selectBook}
                      onOpen={onOpenBook}
                      onBookMenu={onBookMenu}
                    />
                  ) : (
                    <LibraryBookGrid books={visibleBooks} onOpen={onOpenBook} onBookMenu={onBookMenu} />
                  )}
                </>
              ) : null}
            </div>
          </div>

          {layout === 'table' && selectedBook ? (
            <LibraryBookDetailPanel
              book={selectedBook}
              onClose={() => selectBook(null)}
              onOpen={onOpenBook}
              onToggleFavorite={onToggleFavorite}
              onBookMenu={onBookMenu}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

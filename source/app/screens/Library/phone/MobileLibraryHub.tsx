import { useMemo, type ReactNode } from 'react'
import { useT } from '../../../i18n'
import { ImportAddedNote, ImportPlaceholderItems } from '../../../components/import/LibraryImportPlaceholders'
import { useImportSlot } from '../../../components/import/useImportSlot'
import { BootErrorBanner, LibraryBookGrid } from '../components'
import type { LibraryHubProps } from '../LibraryHub'
import { LIBRARY_FILTER_EMPTY, useLibraryBrowse, useLibraryBrowseStore } from '../logic'
import { MobileLibraryEmptyState } from './MobileLibraryEmptyState'
import { MobileBookList } from './MobileBookList'
import { MobileLibraryHeader } from './MobileLibraryHeader'
import { PhoneBrowseToolbar } from './PhoneBrowseToolbar'
import { PhoneFilterChips } from './PhoneFilterChips'
import { PhoneContinueCarousel } from './PhoneContinueCarousel'
import { AdSlot } from './AdSlot'

export type MobileLibraryHubProps = LibraryHubProps & {
  /** "Read again" on a finished book (spec 013 US1): restart it at the beginning, then open it. */
  onReadAgain: (bookId: string) => void
}

/**
 * Phone Library home (spec 013, `contracts/phone-library-ui.md`), shown instead of `LibraryHub` on the Mobile host
 * only and loaded as its own chunk. Same props and the same stores / hooks as the desktop hub; only the layout
 * differs:
 *
 * - a top region that does not scroll (header, then the filter chips);
 * - ONE vertical scroll container (Continue Reading carousel, toolbar, Grid or List), which ends above the banner
 *   slot and the bottom tab bar, so the last row is never covered (FR-024).
 */
export default function MobileLibraryHub({
  books,
  searchQuery,
  onSearchChange,
  onFromDevice,
  bootError,
  onRetryBoot,
  onOpenBook,
  onReadAgain,
  onBookMenu,
}: MobileLibraryHubProps) {
  const t = useT()
  const bookList = books ?? []
  const { filter, sort, layout, searchActive, visibleBooks, phoneContinueBooks } = useLibraryBrowse(bookList, searchQuery)
  const setFilter = useLibraryBrowseStore((s) => s.setFilter)
  const setSort = useLibraryBrowseStore((s) => s.setSort)
  const setLayout = useLibraryBrowseStore((s) => s.setLayout)

  // First launch (no book at all): only the header and the empty state — no chips, carousel or toolbar (US2).
  const isEmpty = books !== null && books.length === 0

  function clearSearchAndFilter() {
    onSearchChange('')
    setFilter('all')
  }

  // Spec 016 (FR-010): coming books in the same grid / list as the books, "All books" only.
  const visibleIds = useMemo(() => visibleBooks.map((b) => b.id), [visibleBooks])
  const slot = useImportSlot(visibleIds, sort, filter === 'all' && !searchActive)
  let collection: ReactNode = null
  if (books !== null && !isEmpty) {
    collection =
      visibleBooks.length === 0 && slot.placeholders.length === 0 ? (
        // Books exist but the chip / search match none: a small message with a way out, never the first-launch
        // empty state (FR-009).
        <div className="mt-12 flex flex-col items-center gap-4 text-center" role="status">
          <p className="m-0 max-w-xs text-sm text-lib-faint">
            {searchActive ? t('library.filterEmpty.noMatch') : t(LIBRARY_FILTER_EMPTY[filter])}
          </p>
          {searchActive || filter !== 'all' ? (
            <button
              type="button"
              className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-sm font-medium text-lib-text-strong active:bg-lib-chip"
              onClick={clearSearchAndFilter}
            >
              {t('library.phone.noMatch.clear')}
            </button>
          ) : null}
        </div>
      ) : layout === 'table' ? (
        // The stored `table` layout is the phone List; the desktop table and its detail panel never render here (FR-013).
        <>
          <ImportAddedNote slot={slot} />
          <MobileBookList
            books={visibleBooks}
            onOpen={onOpenBook}
            onBookMenu={onBookMenu}
            leadCount={slot.leadCount}
            inserted={<ImportPlaceholderItems placeholders={slot.placeholders} as="li" />}
          />
        </>
      ) : (
        <>
          <ImportAddedNote slot={slot} />
          <LibraryBookGrid
            books={visibleBooks}
            onOpen={onOpenBook}
            onBookMenu={onBookMenu}
            className="phone-grid"
            leadCount={slot.leadCount}
            inserted={<ImportPlaceholderItems placeholders={slot.placeholders} as="tile" />}
          />
        </>
      )
  }

  return (
    <div className="phone-library flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Top region (does not scroll): header, then the filter chips (US3). */}
      <div className="shrink-0 pt-3 pb-3">
        <MobileLibraryHeader searchQuery={searchQuery} onSearchChange={onSearchChange} onFromDevice={onFromDevice} />
        {isEmpty ? null : (
          <div className="mt-2">
            <PhoneFilterChips filter={filter} onChange={setFilter} />
          </div>
        )}
      </div>

      {/* The one vertical scroll container: carousel (US1), toolbar + Grid / List (US3). */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-4">
        {bootError ? <BootErrorBanner message={bootError} onRetry={onRetryBoot} /> : null}
        {isEmpty ? (
          <MobileLibraryEmptyState onFromDevice={onFromDevice} />
        ) : (
          <>
            {/* Only on All without a search (phoneContinueBooks is [] otherwise): a shortcut, not a filter result. */}
            <PhoneContinueCarousel
              books={phoneContinueBooks}
              onResume={onOpenBook}
              onReadAgain={onReadAgain}
              onBookMenu={onBookMenu}
            />
            {books !== null ? (
              <PhoneBrowseToolbar
                count={visibleBooks.length}
                sort={sort}
                onSortChange={setSort}
                layout={layout}
                onLayoutChange={setLayout}
                sortHidden={filter === 'recent'}
              />
            ) : null}
            {collection}
          </>
        )}
      </div>

      {/* Banner slot (US5): outside the scroll container, so it never scrolls and the list ends above it (FR-024). */}
      <AdSlot />
    </div>
  )
}

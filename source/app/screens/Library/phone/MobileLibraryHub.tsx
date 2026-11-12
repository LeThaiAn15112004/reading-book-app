import type { ReactNode } from 'react'
import { useT } from '../../../i18n'
import { BootErrorBanner, LibraryBookGrid } from '../components'
import type { LibraryHubProps } from '../LibraryHub'
import { LIBRARY_FILTER_EMPTY, useLibraryBrowse, useLibraryBrowseStore } from '../logic'
import { MobileLibraryEmptyState } from './MobileLibraryEmptyState'
import { MobileLibraryHeader } from './MobileLibraryHeader'

export type MobileLibraryHubProps = LibraryHubProps & {
  /**
   * "Read again" on a finished book (spec 013 US1): restart it at the beginning, then open it. Optional until the
   * carousel and the sheet use it (tasks T019–T021, T028).
   */
  onReadAgain?: (bookId: string) => void
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
  onBookMenu,
}: MobileLibraryHubProps) {
  const t = useT()
  const bookList = books ?? []
  const { filter, searchActive, visibleBooks } = useLibraryBrowse(bookList, searchQuery)
  const setFilter = useLibraryBrowseStore((s) => s.setFilter)

  // First launch (no book at all): only the header and the empty state — no chips, carousel or toolbar (US2).
  const isEmpty = books !== null && books.length === 0

  function clearSearchAndFilter() {
    onSearchChange('')
    setFilter('all')
  }

  let collection: ReactNode = null
  if (books !== null && !isEmpty) {
    collection =
      visibleBooks.length === 0 ? (
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
      ) : (
        <LibraryBookGrid books={visibleBooks} onOpen={onOpenBook} onBookMenu={onBookMenu} />
      )
  }

  return (
    <div className="phone-library flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Top region (does not scroll): header, then the filter chips (US3). */}
      <div className="shrink-0 pt-3 pb-3">
        <MobileLibraryHeader searchQuery={searchQuery} onSearchChange={onSearchChange} onFromDevice={onFromDevice} />
      </div>

      {/* The one vertical scroll container: carousel (US1), toolbar + Grid / List (US3). */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-4">
        {bootError ? <BootErrorBanner message={bootError} onRetry={onRetryBoot} /> : null}
        {isEmpty ? <MobileLibraryEmptyState onFromDevice={onFromDevice} /> : collection}
      </div>

      {/* Banner slot (US5) goes here, outside the scroll container. */}
    </div>
  )
}

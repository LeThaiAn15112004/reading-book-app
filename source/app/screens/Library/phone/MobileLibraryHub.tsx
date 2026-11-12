import type { ReactNode } from 'react'
import { useSearchHistoryStore } from '../../../hooks/library/index.js'
import { useT } from '../../../i18n'
import { BootErrorBanner, LibraryBookGrid, LibraryEmptyState, LibrarySearchBox } from '../components'
import type { LibraryHubProps } from '../LibraryHub'
import { LIBRARY_FILTER_EMPTY, useLibraryBrowse } from '../logic'

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
 *
 * Phase 2 shell: search + empty state + grid, so the phone Library stays usable while the story phases fill the
 * regions in.
 */
export default function MobileLibraryHub({
  books,
  searchQuery,
  onSearchChange,
  onFromDevice,
  onFromUrl,
  bootError,
  onRetryBoot,
  onOpenBook,
  onBookMenu,
}: MobileLibraryHubProps) {
  const t = useT()
  const bookList = books ?? []
  const { filter, searchActive, visibleBooks } = useLibraryBrowse(bookList, searchQuery)
  const historyEnabled = useSearchHistoryStore((s) => s.enabled)
  const historyEntries = useSearchHistoryStore((s) => s.entries)
  const recordSearch = useSearchHistoryStore((s) => s.record)
  const removeRecentSearch = useSearchHistoryStore((s) => s.remove)

  const isEmpty = books !== null && books.length === 0

  let collection: ReactNode = null
  if (isEmpty) {
    collection = <LibraryEmptyState onFromDevice={onFromDevice} onFromUrl={onFromUrl} />
  } else if (books !== null) {
    collection =
      visibleBooks.length === 0 ? (
        <p className="mt-10 text-center text-sm text-lib-faint" role="status">
          {searchActive ? t('library.filterEmpty.noMatch') : t(LIBRARY_FILTER_EMPTY[filter])}
        </p>
      ) : (
        <LibraryBookGrid books={visibleBooks} onOpen={onOpenBook} onBookMenu={onBookMenu} />
      )
  }

  return (
    <div className="phone-library flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Top region (does not scroll): header, then the filter chips (US2, US3). */}
      <div className="shrink-0 pt-3 pb-2">
        <LibrarySearchBox
          value={searchQuery}
          onChange={onSearchChange}
          recentSearches={historyEnabled ? historyEntries : []}
          onCommit={recordSearch}
          onRemoveRecent={removeRecentSearch}
        />
      </div>

      {/* The one vertical scroll container: carousel (US1), toolbar + Grid / List (US3). */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-4">
        {bootError ? <BootErrorBanner message={bootError} onRetry={onRetryBoot} /> : null}
        {collection}
      </div>

      {/* Banner slot (US5) goes here, outside the scroll container. */}
    </div>
  )
}

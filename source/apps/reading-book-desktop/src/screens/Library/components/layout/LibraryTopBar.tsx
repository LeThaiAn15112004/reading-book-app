import { ImportMenu } from '../../../../components/import'
import { LibrarySearchBox } from './LibrarySearchBox'

type LibraryTopBarProps = {
  searchQuery: string
  onSearchChange: (value: string) => void
  /** Recent queries for the search dropdown ([] when search history is off). */
  recentSearches: readonly string[]
  onCommitSearch: (query: string) => void
  onRemoveRecentSearch: (query: string) => void
  onFromDevice: () => void
  onFromUrl: () => void
}

/** SCR-01 top bar: search (with recent searches) + UX-IMP entry (Add file / Import URL). */
export function LibraryTopBar({
  searchQuery,
  onSearchChange,
  recentSearches,
  onCommitSearch,
  onRemoveRecentSearch,
  onFromDevice,
  onFromUrl,
}: LibraryTopBarProps) {
  return (
    <header className="app-titlebar relative z-[35] flex h-16 shrink-0 items-center gap-2 border-b border-lib-border-soft bg-lib-topbar px-4 backdrop-blur-sm sm:gap-3 sm:pl-7">
      <LibrarySearchBox
        value={searchQuery}
        onChange={onSearchChange}
        recentSearches={recentSearches}
        onCommit={onCommitSearch}
        onRemoveRecent={onRemoveRecentSearch}
      />

      <ImportMenu
        size="md"
        onFromDevice={onFromDevice}
        onFromUrl={onFromUrl}
      />
    </header>
  )
}

import { useSearchHistoryStore } from '../../../hooks/library/index.js'
import { useT } from '../../../i18n'
import { LibrarySearchBox } from '../components'

export type MobileLibraryHeaderProps = {
  searchQuery: string
  onSearchChange: (value: string) => void
  /** The phone has only "Add file": "+" opens the system file picker directly (FR-033). */
  onFromDevice: () => void
}

/**
 * Phone Library header (spec 013, contracts/phone-library-ui.md region 1): the search box (recent searches kept, as on
 * Desktop) and a 44 × 44 "+" import button.
 */
export function MobileLibraryHeader({ searchQuery, onSearchChange, onFromDevice }: MobileLibraryHeaderProps) {
  const t = useT()
  const historyEnabled = useSearchHistoryStore((s) => s.enabled)
  const historyEntries = useSearchHistoryStore((s) => s.entries)
  const recordSearch = useSearchHistoryStore((s) => s.record)
  const removeRecentSearch = useSearchHistoryStore((s) => s.remove)

  return (
    <div className="flex items-center gap-3">
      <LibrarySearchBox
        value={searchQuery}
        onChange={onSearchChange}
        recentSearches={historyEnabled ? historyEntries : []}
        onCommit={recordSearch}
        onRemoveRecent={removeRecentSearch}
        placeholder={t('library.phone.searchPlaceholder')}
        className="flex-1"
        inputHeight={44}
      />
      <button
        type="button"
        className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border-none bg-lib-accent text-lib-on-accent transition-colors active:bg-lib-accent-hover"
        aria-label={t('library.phone.add')}
        title={t('library.phone.add')}
        onClick={onFromDevice}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.2}
          stroke="currentColor"
          className="size-6"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </button>
    </div>
  )
}

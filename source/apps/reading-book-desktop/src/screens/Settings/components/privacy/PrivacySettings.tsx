import { useState } from 'react'
import { useSearchHistoryStore } from '../../../../hooks/library/index.js'
import { SettingsCard } from '../layout/SettingsCard'
import { SettingsSwitch } from '../layout/SettingsSwitch'
import { ClearDataDialog, type ClearDataOption } from './ClearDataDialog'

/**
 * SCR-06 Settings → Privacy: history Readmate Reader creates about your use (not book data).
 * Today the only such history is Library search history; Reading history / recently opened books
 * are not stored separately (they would be reading progress), so they are not offered here.
 */
export function PrivacySettings() {
  const enabled = useSearchHistoryStore((s) => s.enabled)
  const entries = useSearchHistoryStore((s) => s.entries)
  const setEnabled = useSearchHistoryStore((s) => s.setEnabled)
  const clear = useSearchHistoryStore((s) => s.clear)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const savedLabel =
    entries.length === 0
      ? 'No saved searches.'
      : entries.length === 1
        ? '1 saved search.'
        : `${entries.length} saved searches.`

  const options: ClearDataOption[] = [
    {
      id: 'search-history',
      label: 'Search History',
      detail: savedLabel,
      empty: entries.length === 0,
    },
  ]

  return (
    <div className="flex flex-col gap-[var(--ui-density-gap)]">
      {notice ? (
        <p
          role="status"
          className="m-0 rounded-lg border border-lib-accent-ring bg-lib-accent-soft px-3 py-2 text-[13px] text-lib-text-strong"
        >
          {notice}
        </p>
      ) : null}

      <SettingsCard title="Search History">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p id="privacy-search-history-label" className="m-0 text-[13px] text-lib-text-strong">
              Save your recent Library searches for quicker access.
            </p>
            <p id="privacy-search-history-desc" className="m-0 mt-1 text-[12px] text-lib-faint">
              Turning this off stops saving new searches and hides suggestions. It does not delete
              existing history — use Clear Data for that. {savedLabel}
            </p>
          </div>
          <SettingsSwitch
            checked={enabled}
            onChange={(next) => {
              setEnabled(next)
              setNotice(null)
            }}
            labelledBy="privacy-search-history-label"
            describedBy="privacy-search-history-desc"
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Clear Data"
        description="Remove history Readmate Reader has saved. Your books, annotations, collections, reading progress, search index and translation models are never affected."
      >
        <button
          type="button"
          className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors hover:border-red-400 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent"
          onClick={() => {
            setNotice(null)
            setDialogOpen(true)
          }}
        >
          Clear Data…
        </button>
      </SettingsCard>

      {dialogOpen ? (
        <ClearDataDialog
          options={options}
          onCancel={() => setDialogOpen(false)}
          onClear={(ids) => {
            if (ids.includes('search-history')) clear()
            setDialogOpen(false)
            setNotice('Search history cleared.')
          }}
        />
      ) : null}
    </div>
  )
}

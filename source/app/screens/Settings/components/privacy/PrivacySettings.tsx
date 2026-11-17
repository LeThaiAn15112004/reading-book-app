import { useT } from '../../../../i18n'
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
  const t = useT()
  const enabled = useSearchHistoryStore((s) => s.enabled)
  const entries = useSearchHistoryStore((s) => s.entries)
  const setEnabled = useSearchHistoryStore((s) => s.setEnabled)
  const clear = useSearchHistoryStore((s) => s.clear)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [cleared, setCleared] = useState(false)

  const savedLabel =
    entries.length === 0 ? t('settings.privacy.savedNone') : t('settings.privacy.saved', { count: entries.length })

  const options: ClearDataOption[] = [
    {
      id: 'search-history',
      label: t('settings.privacy.searchHistory'),
      detail: savedLabel,
      empty: entries.length === 0,
    },
  ]

  return (
    <div className="flex flex-col gap-[var(--ui-density-gap)]">
      {cleared ? (
        <p
          role="status"
          className="m-0 rounded-lg border border-lib-accent-ring bg-lib-accent-soft px-3 py-2 text-[13px] text-lib-text-strong"
        >
          {t('settings.privacy.cleared')}
        </p>
      ) : null}

      <SettingsCard title={t('settings.privacy.searchHistory')}>
        <div className="settings-switch-row flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p id="privacy-search-history-label" className="m-0 text-[13px] text-lib-text-strong">
              {t('settings.privacy.searchHistoryLabel')}
            </p>
            <p id="privacy-search-history-desc" className="m-0 mt-1 text-[12px] text-lib-faint">
              {t('settings.privacy.searchHistoryDescription')} {savedLabel}
            </p>
          </div>
          <SettingsSwitch
            checked={enabled}
            onChange={(next) => {
              setEnabled(next)
              setCleared(false)
            }}
            labelledBy="privacy-search-history-label"
            describedBy="privacy-search-history-desc"
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('settings.privacy.clearData')}
        description={t('settings.privacy.clearDataDescription')}
      >
        <button
          type="button"
          data-tone="danger"
          className="settings-action inline-flex h-9 cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors hover:border-red-400 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent"
          onClick={() => {
            setCleared(false)
            setDialogOpen(true)
          }}
        >
          {t('settings.privacy.clearDataButton')}
        </button>
      </SettingsCard>

      {dialogOpen ? (
        <ClearDataDialog
          options={options}
          onCancel={() => setDialogOpen(false)}
          onClear={(ids) => {
            if (ids.includes('search-history')) clear()
            setDialogOpen(false)
            setCleared(true)
          }}
        />
      ) : null}
    </div>
  )
}

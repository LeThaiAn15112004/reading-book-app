import type { MessageKey } from '@core'
import { useT } from '../../../../i18n'
import { SettingsCard } from '../layout/SettingsCard'

/** Official product name shown on the About page. */
const ABOUT_APP_NAME = 'Readmate Reader'

/**
 * Displayed version. Fixed on purpose: the renderer has no version source yet (no IPC exposes
 * `app.getVersion()` for display), so this is not read from package.json / Electron.
 */
const ABOUT_APP_VERSION = '0.0.0'

/**
 * One About row. `destination` stays null until there is a real, official target (URL, screen,
 * email…). No placeholder URLs: a row without a destination renders disabled.
 */
type AboutLinkItem = {
  id: string
  labelKey: MessageKey
  destination: null
}

const LEGAL_ITEMS: readonly AboutLinkItem[] = [
  { id: 'privacy-policy', labelKey: 'settings.about.items.privacyPolicy', destination: null },
  { id: 'terms-of-service', labelKey: 'settings.about.items.termsOfService', destination: null },
  { id: 'open-source-licenses', labelKey: 'settings.about.items.openSourceLicenses', destination: null },
  { id: 'third-party-notices', labelKey: 'settings.about.items.thirdPartyNotices', destination: null },
]

const SUPPORT_ITEMS: readonly AboutLinkItem[] = [
  { id: 'help', labelKey: 'settings.about.items.help', destination: null },
  { id: 'report-problem', labelKey: 'settings.about.items.reportProblem', destination: null },
  { id: 'contact-support', labelKey: 'settings.about.items.contactSupport', destination: null },
]

const LINK_ITEMS: readonly AboutLinkItem[] = [
  { id: 'website', labelKey: 'settings.about.items.website', destination: null },
  { id: 'store-page', labelKey: 'settings.about.items.storePage', destination: null },
]

function ChevronRightIcon() {
  return (
    <svg
      className="size-4 shrink-0"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  )
}

function NotAvailableBadge() {
  const t = useT()
  return (
    <span className="shrink-0 rounded-full bg-lib-chip px-2 py-0.5 text-[10px] font-semibold tracking-wide text-lib-faint uppercase">
      {t('settings.about.notAvailable')}
    </span>
  )
}

/**
 * Settings-style list of navigation rows (label + chevron). Every row is currently disabled
 * because none has an official destination yet; it is still a real `<button>` so it is announced
 * (and becomes clickable once a destination exists).
 */
function AboutLinkList({ items, label }: { items: readonly AboutLinkItem[]; label: string }) {
  const t = useT()
  return (
    <ul
      className="m-0 list-none divide-y divide-lib-border-soft overflow-hidden rounded-lg border border-lib-border-soft p-0"
      aria-label={label}
    >
      {items.map((item) => {
        const available = item.destination !== null
        const itemLabel = t(item.labelKey)
        return (
          <li key={item.id}>
            <button
              type="button"
              disabled={!available}
              aria-disabled={!available}
              title={available ? undefined : t('settings.about.notAvailableTitle', { label: itemLabel })}
              className="flex h-[var(--ui-density-row)] w-full items-center justify-between gap-3 border-none bg-transparent px-3 text-left text-[13px] font-medium text-lib-text-strong transition-colors enabled:cursor-pointer enabled:hover:bg-lib-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-not-allowed disabled:text-lib-muted"
            >
              <span className="min-w-0 truncate">{itemLabel}</span>
              <span className="flex shrink-0 items-center gap-2 text-lib-faint">
                {available ? null : <NotAvailableBadge />}
                <ChevronRightIcon />
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** SCR-06 Settings → About: app information, updates, legal, support and links. */
export function AboutSettings() {
  const t = useT()
  return (
    <div className="flex flex-col gap-[var(--ui-density-gap)]">
      <SettingsCard title={t('settings.about.appInfo')}>
        <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[13px]">
          <dt className="text-lib-muted">{t('settings.about.appName')}</dt>
          <dd className="m-0 font-semibold text-lib-text-strong">{ABOUT_APP_NAME}</dd>
          <dt className="text-lib-muted">{t('settings.about.version')}</dt>
          <dd className="m-0 font-semibold text-lib-text-strong tabular-nums">
            {ABOUT_APP_VERSION}
          </dd>
        </dl>
      </SettingsCard>

      <SettingsCard title={t('settings.advanced.updates')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[13px] text-lib-muted">{t('settings.advanced.currentVersion')}</p>
            <p className="m-0 mt-0.5 text-[15px] font-semibold text-lib-text-strong tabular-nums">
              {ABOUT_APP_VERSION}
            </p>
          </div>
          <button
            type="button"
            disabled
            aria-describedby="about-updates-note"
            className="inline-flex h-9 shrink-0 items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('settings.advanced.checkForUpdates')}
          </button>
        </div>
        <p id="about-updates-note" className="m-0 mt-3 text-[12px] text-lib-faint">
          {t('settings.about.updatesNote')}
        </p>
      </SettingsCard>

      <SettingsCard title={t('settings.about.legal')}>
        <AboutLinkList items={LEGAL_ITEMS} label={t('settings.about.legal')} />
      </SettingsCard>

      <SettingsCard title={t('settings.about.support')}>
        <AboutLinkList items={SUPPORT_ITEMS} label={t('settings.about.support')} />
      </SettingsCard>

      <SettingsCard title={t('settings.about.links')}>
        <AboutLinkList items={LINK_ITEMS} label={t('settings.about.links')} />
      </SettingsCard>
    </div>
  )
}

import { useEffect } from 'react'
import type { MessageKey } from '@core'
import { PRIVACY_POLICY_URL, storePageUrl } from '@core/config'
import { appApi } from '../../../../bridge'
import { useT } from '../../../../i18n'
import { isMobileHost } from '../../../../platforms/host'
import { useUpdatesStore } from '../../logic/updatesStore'
import { SettingsCard } from '../layout/SettingsCard'

/** Official product name shown on the About page. */
const ABOUT_APP_NAME = 'Readmate Reader'

/**
 * One About row. A row is shown only once it has a real, official destination (spec 014 FR-020): no placeholder URLs
 * and no disabled rows. There is no Store page row: on the phone the Updates card already opens the store (FR-021), and
 * Desktop has no store page.
 */
type AboutLinkItem = {
  id: string
  labelKey: MessageKey
  destination: (platform: string | null | undefined) => string | null
}

const NONE = () => null

const LEGAL_ITEMS: readonly AboutLinkItem[] = [
  { id: 'privacy-policy', labelKey: 'settings.about.items.privacyPolicy', destination: () => PRIVACY_POLICY_URL },
  { id: 'terms-of-service', labelKey: 'settings.about.items.termsOfService', destination: NONE },
  { id: 'open-source-licenses', labelKey: 'settings.about.items.openSourceLicenses', destination: NONE },
  { id: 'third-party-notices', labelKey: 'settings.about.items.thirdPartyNotices', destination: NONE },
]

const SUPPORT_ITEMS: readonly AboutLinkItem[] = [
  { id: 'help', labelKey: 'settings.about.items.help', destination: NONE },
  { id: 'report-problem', labelKey: 'settings.about.items.reportProblem', destination: NONE },
  { id: 'contact-support', labelKey: 'settings.about.items.contactSupport', destination: NONE },
]

const LINK_ITEMS: readonly AboutLinkItem[] = [
  { id: 'website', labelKey: 'settings.about.items.website', destination: NONE },
]

/** Every About row opens outside the app (browser / store), so the row ends with "opens outside", not a chevron. */
function ExternalLinkIcon() {
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
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  )
}

function openLink(url: string) {
  // The host opens it outside the app (Desktop: the default browser; phone: the store app or the browser).
  void appApi.openExternalLink(url).catch(() => undefined)
}

/** The rows of a group that have a destination on this platform. */
function availableLinks(items: readonly AboutLinkItem[], platform: string | null | undefined) {
  return items.flatMap((item) => {
    const url = item.destination(platform)
    return url ? [{ ...item, url }] : []
  })
}

/** A group of link rows (label + "opens outside" icon). Renders nothing when no row has a destination (FR-020). */
function AboutLinkGroup({
  title,
  items,
  platform,
}: {
  title: string
  items: readonly AboutLinkItem[]
  platform: string | null | undefined
}) {
  const t = useT()
  const links = availableLinks(items, platform)
  if (links.length === 0) return null
  return (
    <SettingsCard title={title}>
      <ul
        className="m-0 list-none divide-y divide-lib-border-soft overflow-hidden rounded-lg border border-lib-border-soft p-0"
        aria-label={title}
      >
        {links.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="flex h-[var(--ui-density-row)] w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-3 text-left text-[13px] font-medium text-lib-text-strong transition-colors hover:bg-lib-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent active:bg-lib-surface-hover"
              onClick={() => openLink(item.url)}
            >
              <span className="min-w-0 truncate">{t(item.labelKey)}</span>
              <span className="flex shrink-0 items-center text-lib-faint">
                <ExternalLinkIcon />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </SettingsCard>
  )
}

/** SCR-06 Settings → About: app information, updates, legal, support and links. */
export function AboutSettings() {
  const t = useT()
  const version = useUpdatesStore((s) => s.version)
  const platform = useUpdatesStore((s) => s.platform)
  const loadVersion = useUpdatesStore((s) => s.loadVersion)
  const phone = isMobileHost()
  const storeUrl = storePageUrl(platform)

  useEffect(() => {
    void loadVersion()
  }, [loadVersion])

  // The installed app's own version, as on the Advanced page (FR-019) — never a fixed value.
  const versionText =
    version === null ? t('settings.loading') : version === undefined ? t('settings.advanced.unknown') : version

  return (
    <div className="flex flex-col gap-[var(--ui-density-gap)]">
      <SettingsCard title={t('settings.about.appInfo')}>
        <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[13px]">
          <dt className="text-lib-muted">{t('settings.about.appName')}</dt>
          <dd className="m-0 font-semibold text-lib-text-strong">{ABOUT_APP_NAME}</dd>
          <dt className="text-lib-muted">{t('settings.about.version')}</dt>
          <dd className="m-0 font-semibold text-lib-text-strong tabular-nums select-text">{versionText}</dd>
        </dl>
      </SettingsCard>

      <SettingsCard title={t('settings.advanced.updates')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {phone ? (
            // The version is already in App Information just above; the phone says where updates come from.
            <p className="m-0 min-w-0 flex-1 text-[13px] text-lib-muted">{t('settings.about.storeUpdatesNote')}</p>
          ) : (
            <div className="min-w-0">
              <p className="m-0 text-[13px] text-lib-muted">{t('settings.advanced.currentVersion')}</p>
              <p className="m-0 mt-0.5 text-[15px] font-semibold text-lib-text-strong tabular-nums select-text">
                {versionText}
              </p>
            </div>
          )}
          {phone ? (
            // Phone (FR-021): the store updates the app, so the button opens its store page.
            storeUrl ? (
              <button
                type="button"
                className="settings-action inline-flex h-9 shrink-0 cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent active:bg-lib-accent-soft"
                onClick={() => openLink(storeUrl)}
              >
                {t('settings.about.openInStore')}
              </button>
            ) : null
          ) : (
            <button
              type="button"
              disabled
              aria-describedby="about-updates-note"
              className="inline-flex h-9 shrink-0 items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('settings.advanced.checkForUpdates')}
            </button>
          )}
        </div>
        {phone ? null : (
          <p id="about-updates-note" className="m-0 mt-3 text-[12px] text-lib-faint">
            {t('settings.about.updatesNote')}
          </p>
        )}
      </SettingsCard>

      <AboutLinkGroup title={t('settings.about.legal')} items={LEGAL_ITEMS} platform={platform} />
      <AboutLinkGroup title={t('settings.about.support')} items={SUPPORT_ITEMS} platform={platform} />
      <AboutLinkGroup title={t('settings.about.links')} items={LINK_ITEMS} platform={platform} />
    </div>
  )
}

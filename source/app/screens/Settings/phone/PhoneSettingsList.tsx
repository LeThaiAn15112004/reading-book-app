import type { MessageKey } from '@core'
import { useT } from '../../../i18n'
import { SettingsSectionIcon } from '../components/layout/SettingsSectionIcon'
import type { SettingsSectionId } from '../logic/settingsNavStore'

const DESCRIPTIONS: Record<SettingsSectionId, MessageKey> = {
  appearance: 'settings.sectionDescriptions.appearance',
  storage: 'settings.sectionDescriptions.storage',
  notifications: 'settings.sectionDescriptions.notifications',
  keyboard: 'settings.sectionDescriptions.keyboard',
  privacy: 'settings.sectionDescriptions.privacy',
  advanced: 'settings.sectionDescriptions.advanced',
  about: 'settings.sectionDescriptions.about',
}

function ChevronRightIcon() {
  return (
    <svg className="size-5 shrink-0 text-lib-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  )
}

export type PhoneSettingsListProps = {
  sections: readonly { id: SettingsSectionId; labelKey: MessageKey }[]
  onOpen: (section: SettingsSectionId) => void
}

/**
 * The phone's section list (spec 014 FR-001, FR-002): one grouped card, one full-width row per visible section with its
 * icon, name, description (wraps, at most two lines) and a forward chevron; the whole row is the 48 dp target.
 */
export function PhoneSettingsList({ sections, onOpen }: PhoneSettingsListProps) {
  const t = useT()
  return (
    <ul
      className="m-0 list-none divide-y divide-lib-border-soft overflow-hidden rounded-xl border border-lib-border-soft bg-lib-surface-strong/60 p-0"
      aria-label={t('settings.phone.listAria')}
    >
      {sections.map((section) => (
        <li key={section.id}>
          <button
            type="button"
            className="flex min-h-12 w-full cursor-pointer items-center gap-3 border-none bg-transparent px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent active:bg-lib-surface-hover"
            onClick={() => onOpen(section.id)}
          >
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-lib-accent-soft text-lib-accent">
              <SettingsSectionIcon section={section.id} className="size-5 shrink-0" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-lib-text-strong">{t(section.labelKey)}</span>
              <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-lib-muted">
                {t(DESCRIPTIONS[section.id])}
              </span>
            </span>
            <ChevronRightIcon />
          </button>
        </li>
      ))}
    </ul>
  )
}

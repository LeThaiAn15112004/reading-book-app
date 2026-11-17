import { Suspense, lazy } from 'react'
import type { MessageKey } from '@core'
import { useT } from '../../i18n'
import { isMobileHost } from '../../platforms/host'
import {
  AboutSettings,
  AdvancedSettings,
  AppearanceSettings,
  KeyboardShortcutsSettings,
  NotificationsSettings,
  PrivacySettings,
  SettingsPlaceholder,
  SettingsSidebar,
  StorageSettings,
} from './components'
import {
  useSettingsNavStore,
  visibleSettingsSections,
  type SettingsSectionId,
} from './logic/settingsNavStore'

const SECTION_DESCRIPTIONS: Partial<Record<SettingsSectionId, MessageKey>> = {
  appearance: 'settings.sectionDescriptions.appearance',
  keyboard: 'settings.sectionDescriptions.keyboard',
  notifications: 'settings.sectionDescriptions.notifications',
  storage: 'settings.sectionDescriptions.storage',
  privacy: 'settings.sectionDescriptions.privacy',
  advanced: 'settings.sectionDescriptions.advanced',
  about: 'settings.sectionDescriptions.about',
}

/**
 * The phone "More" screen (spec 014): section list ⇄ section page. A separate chunk: `isMobileHost()` is false in
 * Electron, so `lazy` never starts loading it on Desktop.
 */
const MobileSettingsScreen = lazy(() => import('./phone/MobileSettingsScreen'))

/** SCR-06 — App Settings: section sidebar (collapsible) + content panel; on the phone, the More screen (spec 014). */
export function SettingsScreen() {
  if (isMobileHost()) {
    return (
      <div className="lib-chrome flex h-full w-full select-none overflow-hidden font-[system-ui,'Segoe_UI',sans-serif] text-lib-text antialiased">
        <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
          <MobileSettingsScreen />
        </Suspense>
      </div>
    )
  }
  return <DesktopSettingsScreen />
}

function DesktopSettingsScreen() {
  const t = useT()
  const activeSection = useSettingsNavStore((s) => s.activeSection)
  const sections = visibleSettingsSections()
  const section = sections.find((s) => s.id === activeSection) ?? sections[0]!
  const description = SECTION_DESCRIPTIONS[section.id]

  return (
    <div className="lib-chrome flex h-full w-full select-none overflow-hidden font-[system-ui,'Segoe_UI',sans-serif] text-lib-text antialiased">
      <SettingsSidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden" aria-labelledby="settings-section-title">
        <header className="app-titlebar flex h-16 shrink-0 items-center border-b border-lib-border-soft bg-lib-topbar px-[var(--ui-density-content-x)] backdrop-blur-sm">
          <div className="min-w-0">
            <h2
              id="settings-section-title"
              className="m-0 truncate text-lg font-semibold tracking-tight text-lib-text-strong"
            >
              {t(section.labelKey)}
            </h2>
            {description ? (
              <p className="m-0 mt-0.5 truncate text-xs text-lib-faint">{t(description)}</p>
            ) : null}
          </div>
        </header>
        <div className="app-scroll flex-1 overflow-x-hidden overflow-y-auto px-[var(--ui-density-content-x)] py-[var(--ui-density-content-y)]">
          <div className="mx-auto w-full max-w-3xl">
            {section.id === 'appearance' ? (
              <AppearanceSettings />
            ) : section.id === 'storage' ? (
              <StorageSettings />
            ) : section.id === 'notifications' ? (
              <NotificationsSettings />
            ) : section.id === 'keyboard' ? (
              <KeyboardShortcutsSettings />
            ) : section.id === 'privacy' ? (
              <PrivacySettings />
            ) : section.id === 'advanced' ? (
              <AdvancedSettings />
            ) : section.id === 'about' ? (
              <AboutSettings />
            ) : (
              <SettingsPlaceholder />
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

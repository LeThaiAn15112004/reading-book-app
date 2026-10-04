import {
  AboutSettings,
  AdvancedSettings,
  AppearanceSettings,
  PrivacySettings,
  SettingsPlaceholder,
  SettingsSidebar,
  StorageSettings,
} from './components'
import {
  SETTINGS_SECTIONS,
  useSettingsNavStore,
  type SettingsSectionId,
} from './logic/settingsNavStore'

const SECTION_DESCRIPTIONS: Partial<Record<SettingsSectionId, string>> = {
  appearance: 'Theme, accent color, density and language for the whole app.',
  storage: 'Where Readmate Reader keeps its data and how much space it uses.',
  privacy: 'History Readmate Reader saves about your use — not your books.',
  advanced: 'Updates for Readmate Reader.',
  about: 'Information about Readmate Reader.',
}

/** SCR-06 — App Settings: section sidebar (collapsible) + content panel. */
export function SettingsScreen() {
  const activeSection = useSettingsNavStore((s) => s.activeSection)
  const section = SETTINGS_SECTIONS.find((s) => s.id === activeSection) ?? SETTINGS_SECTIONS[0]
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
              {section.label}
            </h2>
            {description ? (
              <p className="m-0 mt-0.5 truncate text-xs text-lib-faint">{description}</p>
            ) : null}
          </div>
        </header>
        <div className="app-scroll flex-1 overflow-x-hidden overflow-y-auto px-[var(--ui-density-content-x)] py-[var(--ui-density-content-y)]">
          <div className="mx-auto w-full max-w-3xl">
            {section.id === 'appearance' ? (
              <AppearanceSettings />
            ) : section.id === 'storage' ? (
              <StorageSettings />
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

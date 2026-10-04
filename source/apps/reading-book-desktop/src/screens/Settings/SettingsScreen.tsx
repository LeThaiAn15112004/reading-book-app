import { AppearanceSettings, SettingsPlaceholder, SettingsSidebar } from './components'
import {
  SETTINGS_SECTIONS,
  useSettingsNavStore,
  type SettingsSectionId,
} from './logic/settingsNavStore'

const SECTION_DESCRIPTIONS: Partial<Record<SettingsSectionId, string>> = {
  appearance: 'Theme, accent color, density and language for the whole app.',
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
            {section.id === 'appearance' ? <AppearanceSettings /> : <SettingsPlaceholder />}
          </div>
        </div>
      </main>
    </div>
  )
}

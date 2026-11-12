import type { MessageKey } from '@core'
import { create } from 'zustand'
import { isFeatureAvailable, type AppFeature } from '../../../platforms/host'

/**
 * Settings sidebar sections, in display order. App Language lives inside Appearance; Library view
 * preferences (sort, Grid ⇄ Table) live on the Library screen itself — no Language / Library sections.
 */
export type SettingsSectionId =
  | 'appearance'
  | 'storage'
  | 'notifications'
  | 'keyboard'
  | 'privacy'
  | 'advanced'
  | 'about'

export const SETTINGS_SECTIONS: readonly { id: SettingsSectionId; labelKey: MessageKey; feature?: AppFeature }[] = [
  { id: 'appearance', labelKey: 'settings.sections.appearance' },
  { id: 'storage', labelKey: 'settings.sections.storage', feature: 'storageSettings' },
  { id: 'notifications', labelKey: 'settings.sections.notifications', feature: 'notificationSettings' },
  { id: 'keyboard', labelKey: 'settings.sections.keyboard', feature: 'keyboardShortcuts' },
  { id: 'privacy', labelKey: 'settings.sections.privacy' },
  { id: 'advanced', labelKey: 'settings.sections.advanced' },
  { id: 'about', labelKey: 'settings.sections.about' },
]

/** The sections shown on this platform: every one in Electron; hidden, never disabled, on the Mobile host (spec 008). */
export function visibleSettingsSections(): readonly { id: SettingsSectionId; labelKey: MessageKey }[] {
  return SETTINGS_SECTIONS.filter((s) => s.feature === undefined || isFeatureAvailable(s.feature))
}

const COLLAPSED_STORAGE_KEY = 'reading-book.settings.sidebar-collapsed'

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0')
  } catch {
    // ignore quota / private mode
  }
}

type SettingsNavState = {
  activeSection: SettingsSectionId
  /** Icon-only sidebar; persisted like other Library/Reader panel preferences. */
  collapsed: boolean
  setActiveSection: (section: SettingsSectionId) => void
  toggleCollapsed: () => void
}

export const useSettingsNavStore = create<SettingsNavState>()((set, get) => ({
  activeSection: 'appearance',
  collapsed: loadCollapsed(),
  setActiveSection: (activeSection) => set({ activeSection }),
  toggleCollapsed: () => {
    const collapsed = !get().collapsed
    saveCollapsed(collapsed)
    set({ collapsed })
  },
}))

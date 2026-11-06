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

export const SETTINGS_SECTIONS: readonly { id: SettingsSectionId; label: string; feature?: AppFeature }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'storage', label: 'Storage', feature: 'storageSettings' },
  { id: 'notifications', label: 'Notifications', feature: 'notificationSettings' },
  { id: 'keyboard', label: 'Keyboard Shortcuts', feature: 'keyboardShortcuts' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'about', label: 'About' },
]

/** The sections shown on this platform: every one in Electron; hidden, never disabled, on the Mobile host (spec 008). */
export function visibleSettingsSections(): readonly { id: SettingsSectionId; label: string }[] {
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

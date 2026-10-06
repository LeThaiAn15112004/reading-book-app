import { create } from 'zustand'

/**
 * Settings sidebar sections, in display order. App Language lives inside Appearance; Library view
 * preferences (sort, Grid ⇄ Table) live on the Library screen itself — no Language / Library sections.
 */
export type SettingsSectionId =
  | 'appearance'
  | 'storage'
  | 'notifications'
  | 'background'
  | 'keyboard'
  | 'privacy'
  | 'advanced'
  | 'about'

export const SETTINGS_SECTIONS: readonly { id: SettingsSectionId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'storage', label: 'Storage' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'background', label: 'Background & System Tray' },
  { id: 'keyboard', label: 'Keyboard Shortcuts' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'about', label: 'About' },
]

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

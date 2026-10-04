import { create } from 'zustand'
import {
  GLOBAL_READING_PREFS_STORAGE_KEY,
  parseGlobalReadingPrefsJson,
} from '@reading-book/book-reader-sdk'
import {
  applyAppearanceAttributes,
  loadAppAppearance,
  saveAppAppearance,
  type AccentColorId,
  type AppAppearance,
  type AppThemeMode,
  type UiDensity,
} from './appAppearance'

type AppAppearanceState = AppAppearance & {
  setThemeMode: (themeMode: AppThemeMode) => void
  setAccent: (accent: AccentColorId) => void
  setDensity: (density: UiDensity) => void
}

function initialAppearance(): AppAppearance {
  try {
    const legacyTheme = parseGlobalReadingPrefsJson(
      localStorage.getItem(GLOBAL_READING_PREFS_STORAGE_KEY),
    ).theme
    return loadAppAppearance(legacyTheme)
  } catch {
    return loadAppAppearance()
  }
}

/**
 * Global app appearance (theme mode, accent, density), persisted in localStorage. The resolved
 * theme is pushed into the shared GlobalReadingPrefs by `AppAppearanceBridge`, which keeps using
 * the existing `html[data-theme]` theme engine.
 */
export const useAppAppearanceStore = create<AppAppearanceState>()((set, get) => {
  const commit = (patch: Partial<AppAppearance>) => {
    set(patch)
    const { themeMode, accent, density } = get()
    saveAppAppearance({ themeMode, accent, density })
    applyAppearanceAttributes({ accent, density })
  }

  return {
    ...initialAppearance(),
    setThemeMode: (themeMode) => commit({ themeMode }),
    setAccent: (accent) => commit({ accent }),
    setDensity: (density) => commit({ density }),
  }
})

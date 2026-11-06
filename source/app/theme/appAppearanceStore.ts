import { create } from 'zustand'
import {
  GLOBAL_READING_PREFS_STORAGE_KEY,
  parseGlobalReadingPrefsJson,
} from '@reading-book/book-reader-sdk'
import {
  applyAppearanceAttributes,
  DEFAULT_APP_APPEARANCE,
  loadAppAppearance,
  saveAppAppearance,
  type AppAccent,
  type AppAppearance,
  type AppLanguage,
  type AppThemeMode,
  type UiDensity,
} from './appAppearance'

type AppAppearanceState = AppAppearance & {
  setThemeMode: (themeMode: AppThemeMode) => void
  setAccent: (accent: AppAccent) => void
  /** Select Custom with this hex (`#rrggbb`). */
  setCustomAccent: (hex: string) => void
  setDensity: (density: UiDensity) => void
  setLanguage: (language: AppLanguage) => void
  /**
   * Settings → Advanced → Reset App Settings: back to `DEFAULT_APP_APPEARANCE`. Writes the defaults
   * rather than removing the key — a missing key falls back to the legacy reading-prefs theme.
   * Returns false when the write failed (state is still reset for this session).
   */
  reset: () => boolean
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
 * Global app appearance (theme mode, accent, density, UI language), persisted in localStorage. The resolved
 * theme is pushed into the shared GlobalReadingPrefs by `AppAppearanceBridge`, which keeps using
 * the existing `html[data-theme]` theme engine.
 */
export const useAppAppearanceStore = create<AppAppearanceState>()((set, get) => {
  const commit = (patch: Partial<AppAppearance>): boolean => {
    set(patch)
    const { themeMode, accent, customAccent, density, language } = get()
    const saved = saveAppAppearance({ themeMode, accent, customAccent, density, language })
    applyAppearanceAttributes({ accent, customAccent, density, language })
    return saved
  }

  return {
    ...initialAppearance(),
    setThemeMode: (themeMode) => commit({ themeMode }),
    setAccent: (accent) => commit({ accent }),
    setCustomAccent: (customAccent) => commit({ accent: 'custom', customAccent }),
    setDensity: (density) => commit({ density }),
    setLanguage: (language) => commit({ language }),
    reset: () => commit(DEFAULT_APP_APPEARANCE),
  }
})

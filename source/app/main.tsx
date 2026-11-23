import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import {
  DEFAULT_GLOBAL_READING_PREFS,
  GLOBAL_READING_PREFS_STORAGE_KEY,
  parseGlobalReadingPrefsJson,
  toAppThemeAttr,
} from '@core'
import {
  applyAppearanceAttributes,
  loadAppAppearance,
  resolveThemeMode,
  systemPrefersDark,
} from './theme/appAppearance'
import { applyTheme } from './theme/applyTheme'
import { startWindowSync } from './platforms/window'
import { installOpeningStoreDomSources } from './hooks/reader/readerOpeningStore'
import { isMiniPlayerWindow } from './platforms/miniPlayerWindow'
import { MiniPlayerWindowRoot } from './screens/MiniPlayerWindow/MiniPlayerWindowRoot'

/**
 * Spec 018 (research R4): the floating mini player window loads this same bundle with `?window=mini-player`. It mounts
 * only its own root — nothing of the main window (App, providers, window sync) runs there, and it has no `window.api`.
 */
const floatingMiniPlayer = isMiniPlayerWindow()

/** Boot theme / accent / density from stored prefs before React mounts (avoid flash). */
if (floatingMiniPlayer) {
  // Its theme arrives with the first state; until then the stored theme, without touching the window chrome.
  try {
    const appearance = loadAppAppearance(
      parseGlobalReadingPrefsJson(localStorage.getItem(GLOBAL_READING_PREFS_STORAGE_KEY)).theme,
    )
    document.documentElement.dataset.theme = toAppThemeAttr(resolveThemeMode(appearance.themeMode, systemPrefersDark()))
  } catch {
    // The first state sets it.
  }
} else try {
  const appearance = loadAppAppearance(
    parseGlobalReadingPrefsJson(
      localStorage.getItem(GLOBAL_READING_PREFS_STORAGE_KEY),
    ).theme,
  )
  applyTheme(resolveThemeMode(appearance.themeMode, systemPrefersDark()))
  applyAppearanceAttributes(appearance)
} catch {
  applyTheme(DEFAULT_GLOBAL_READING_PREFS.theme)
}
if (!floatingMiniPlayer) {
  startWindowSync()
  // Spec 017: opening time limits count foreground time only (visibility + the phone host's AppState).
  installOpeningStoreDomSources()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{floatingMiniPlayer ? <MiniPlayerWindowRoot /> : <App />}</React.StrictMode>,
)

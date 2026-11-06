import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import {
  DEFAULT_GLOBAL_READING_PREFS,
  GLOBAL_READING_PREFS_STORAGE_KEY,
  parseGlobalReadingPrefsJson,
} from '@core'
import {
  applyAppearanceAttributes,
  loadAppAppearance,
  resolveThemeMode,
  systemPrefersDark,
} from './theme/appAppearance'
import { applyTheme } from './theme/applyTheme'
import { startWindowSync } from './platforms/window'

/** Boot theme / accent / density from stored prefs before React mounts (avoid flash). */
try {
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
startWindowSync()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

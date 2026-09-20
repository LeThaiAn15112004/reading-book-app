import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import {
  DEFAULT_GLOBAL_READING_PREFS,
  GLOBAL_READING_PREFS_STORAGE_KEY,
  parseGlobalReadingPrefsJson,
} from '@reading-book/book-reader-sdk'
import { applyTheme } from './theme/applyTheme'
import { syncWindowControlsInset } from './theme/syncWindowControlsInset'

/** Boot theme from stored prefs before React mounts (avoid flash). */
try {
  applyTheme(
    parseGlobalReadingPrefsJson(
      localStorage.getItem(GLOBAL_READING_PREFS_STORAGE_KEY),
    ).theme,
  )
} catch {
  applyTheme(DEFAULT_GLOBAL_READING_PREFS.theme)
}
syncWindowControlsInset()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

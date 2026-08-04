import { type ReactNode, useMemo } from 'react'
import {
  DEFAULT_GLOBAL_READING_PREFS,
  GLOBAL_READING_PREFS_STORAGE_KEY,
  READER_THEME_COLORS,
  fontFamilyCss,
  parseGlobalReadingPrefsJson,
  type FontFamily,
  type FontWeight,
  type GlobalReadingPrefs,
  type ReaderTheme,
  type TextAlign,
} from '@reading-book/shared/models'
import {
  GlobalReadingPrefsProvider as SharedGlobalReadingPrefsProvider,
  useGlobalReadingPrefs,
  type GlobalReadingPrefsStorage,
} from '@reading-book/shared/hooks/app'
import { applyTheme } from '../theme/applyTheme'

export type {
  FontFamily,
  FontWeight,
  GlobalReadingPrefs,
  ReaderTheme,
  TextAlign,
}
export {
  DEFAULT_GLOBAL_READING_PREFS,
  READER_THEME_COLORS,
  fontFamilyCss,
  useGlobalReadingPrefs,
}

const desktopStorage: GlobalReadingPrefsStorage = {
  load: () => {
    try {
      return parseGlobalReadingPrefsJson(
        localStorage.getItem(GLOBAL_READING_PREFS_STORAGE_KEY),
      )
    } catch {
      return DEFAULT_GLOBAL_READING_PREFS
    }
  },
  save: (prefs) => {
    localStorage.setItem(
      GLOBAL_READING_PREFS_STORAGE_KEY,
      JSON.stringify(prefs),
    )
  },
}

/** Desktop: localStorage + html/Electron theme into shared GlobalReadingPrefs. */
export function GlobalReadingPrefsProvider({
  children,
}: {
  children: ReactNode
}) {
  const onThemeChange = useMemo(
    () => (theme: ReaderTheme) => {
      applyTheme(theme)
    },
    [],
  )

  return (
    <SharedGlobalReadingPrefsProvider
      storage={desktopStorage}
      onThemeChange={onThemeChange}
    >
      {children}
    </SharedGlobalReadingPrefsProvider>
  )
}

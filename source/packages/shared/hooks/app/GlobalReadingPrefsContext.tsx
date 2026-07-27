import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_GLOBAL_READING_PREFS,
  normalizeGlobalReadingPrefs,
  type GlobalReadingPrefs,
  type ReaderTheme,
} from '../../models/reading-prefs.js'

export type GlobalReadingPrefsStorage = {
  load: () => GlobalReadingPrefs
  save: (prefs: GlobalReadingPrefs) => void
}

type GlobalReadingPrefsContextValue = {
  prefs: GlobalReadingPrefs
  setPrefs: (patch: Partial<GlobalReadingPrefs>) => void
}

const GlobalReadingPrefsContext =
  createContext<GlobalReadingPrefsContextValue | null>(null)

export type GlobalReadingPrefsProviderProps = {
  children: ReactNode
  /** Injected by host (desktop: localStorage; mobile: MMKV / AsyncStorage). */
  storage: GlobalReadingPrefsStorage
  /** Optional host theme application (desktop: html[data-theme] + Electron chrome). */
  onThemeChange?: (theme: ReaderTheme) => void
}

export function GlobalReadingPrefsProvider({
  children,
  storage,
  onThemeChange,
}: GlobalReadingPrefsProviderProps) {
  const [prefs, setPrefsState] = useState<GlobalReadingPrefs>(() => {
    try {
      return storage.load()
    } catch {
      return DEFAULT_GLOBAL_READING_PREFS
    }
  })

  useEffect(() => {
    onThemeChange?.(prefs.theme)
  }, [prefs.theme, onThemeChange])

  useEffect(() => {
    try {
      storage.save(prefs)
    } catch {
      // ignore quota / private mode
    }
  }, [prefs, storage])

  const setPrefs = useCallback((patch: Partial<GlobalReadingPrefs>) => {
    setPrefsState((prev) => normalizeGlobalReadingPrefs({ ...prev, ...patch }))
  }, [])

  const value = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs])

  return (
    <GlobalReadingPrefsContext.Provider value={value}>
      {children}
    </GlobalReadingPrefsContext.Provider>
  )
}

export function useGlobalReadingPrefs(): GlobalReadingPrefsContextValue {
  const ctx = useContext(GlobalReadingPrefsContext)
  if (!ctx) {
    throw new Error(
      'useGlobalReadingPrefs must be used within GlobalReadingPrefsProvider',
    )
  }
  return ctx
}

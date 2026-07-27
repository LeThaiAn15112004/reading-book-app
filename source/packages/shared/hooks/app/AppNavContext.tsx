import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/** SDS SCR-01 nav ids (no global Notes). */
export type AppNavId =
  | 'library'
  | 'favorites'
  | 'completed'
  | 'to-read'
  | 'collections'
  | 'reading'
  | 'cloud-sources'
  | 'settings'
  | 'faq'
  | 'support'
  | 'about'
  | 'privacy'

export type AppStubNavId = Exclude<
  AppNavId,
  'library' | 'settings' | 'reading'
>

export type LibraryNavRegistration = {
  activeId: AppNavId
  onStubNav: (id: AppStubNavId) => void
  onLibraryNav: () => void
}

type AppNavContextValue = {
  libraryNav: LibraryNavRegistration | null
  registerLibraryNav: (reg: LibraryNavRegistration | null) => void
}

const AppNavContext = createContext<AppNavContextValue | null>(null)

export function AppNavProvider({ children }: { children: ReactNode }) {
  const [libraryNav, setLibraryNav] = useState<LibraryNavRegistration | null>(
    null,
  )

  const registerLibraryNav = useCallback((reg: LibraryNavRegistration | null) => {
    setLibraryNav(reg)
  }, [])

  const value = useMemo(
    () => ({ libraryNav, registerLibraryNav }),
    [libraryNav, registerLibraryNav],
  )

  return (
    <AppNavContext.Provider value={value}>{children}</AppNavContext.Provider>
  )
}

export function useAppNav(): AppNavContextValue {
  const ctx = useContext(AppNavContext)
  if (!ctx) {
    throw new Error('useAppNav must be used within AppNavProvider')
  }
  return ctx
}

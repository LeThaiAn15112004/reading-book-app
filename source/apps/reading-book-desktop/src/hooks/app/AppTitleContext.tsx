import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export const APP_DISPLAY_NAME = 'Readmate'

type AppTitleContextValue = {
  isReaderRoute: boolean
  documentSubtitle: string | null
  setDocumentSubtitle: (title: string | null) => void
  readerSearchQuery: string
  setReaderSearchQuery: (query: string) => void
  /** Bumps when the user submits the titlebar search (Enter). */
  readerSearchRequestId: number
  requestReaderSearch: () => void
}

const AppTitleContext = createContext<AppTitleContextValue | null>(null)

export type AppTitleProviderProps = {
  children: ReactNode
  /** Injected by host (desktop: pathname.startsWith('/reader')). */
  isReaderRoute: boolean
  /**
   * Optional host side-effect (desktop: `document.title`).
   * Omit on mobile if the OS title is unused.
   */
  setDocumentTitle?: (title: string) => void
}

export function AppTitleProvider({
  children,
  isReaderRoute,
  setDocumentTitle,
}: AppTitleProviderProps) {
  const [documentSubtitle, setDocumentSubtitle] = useState<string | null>(null)
  const [readerSearchQuery, setReaderSearchQuery] = useState('')
  const [readerSearchRequestId, setReaderSearchRequestId] = useState(0)

  useEffect(() => {
    if (!isReaderRoute) {
      setDocumentSubtitle(null)
      setReaderSearchQuery('')
    }
  }, [isReaderRoute])

  useEffect(() => {
    if (!setDocumentTitle) return
    setDocumentTitle(
      documentSubtitle
        ? `${documentSubtitle} — ${APP_DISPLAY_NAME}`
        : APP_DISPLAY_NAME,
    )
  }, [documentSubtitle, setDocumentTitle])

  return (
    <AppTitleContext.Provider
      value={{
        isReaderRoute,
        documentSubtitle,
        setDocumentSubtitle,
        readerSearchQuery,
        setReaderSearchQuery,
        readerSearchRequestId,
        requestReaderSearch: () => setReaderSearchRequestId((n) => n + 1),
      }}
    >
      {children}
    </AppTitleContext.Provider>
  )
}

export function useAppTitle(): AppTitleContextValue {
  const ctx = useContext(AppTitleContext)
  if (!ctx) {
    throw new Error('useAppTitle must be used within AppTitleProvider')
  }
  return ctx
}

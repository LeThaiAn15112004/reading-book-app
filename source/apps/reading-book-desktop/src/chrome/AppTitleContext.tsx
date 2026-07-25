import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'

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

export function AppTitleProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const isReaderRoute = location.pathname.startsWith('/reader')
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
    document.title = documentSubtitle
      ? `${documentSubtitle} — ${APP_DISPLAY_NAME}`
      : APP_DISPLAY_NAME
  }, [documentSubtitle])

  return (
    <AppTitleContext.Provider
      value={{
        isReaderRoute,
        documentSubtitle,
        setDocumentSubtitle,
        readerSearchQuery,
        setReaderSearchQuery,
        readerSearchRequestId,
        requestReaderSearch: () =>
          setReaderSearchRequestId((n) => n + 1),
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

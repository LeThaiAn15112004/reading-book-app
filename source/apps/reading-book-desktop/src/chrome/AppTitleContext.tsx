import { type ReactNode, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import {
  APP_DISPLAY_NAME,
  AppTitleProvider as SharedAppTitleProvider,
  useAppTitle,
} from '@reading-book/shared/hooks/app'

export { APP_DISPLAY_NAME, useAppTitle }

/** Desktop: wire react-router + `document.title` into shared AppTitle. */
export function AppTitleProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const isReaderRoute = location.pathname.startsWith('/reader')
  const setDocumentTitle = useCallback((title: string) => {
    document.title = title
  }, [])

  return (
    <SharedAppTitleProvider
      isReaderRoute={isReaderRoute}
      setDocumentTitle={setDocumentTitle}
    >
      {children}
    </SharedAppTitleProvider>
  )
}

import { type ReactNode, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  OpenReadingProvider as SharedOpenReadingProvider,
  useOpenReading,
  type OpenReadingTab,
} from '@reading-book/shared/hooks/app'

export { useOpenReading }
export type { OpenReadingTab }

/** Desktop: wire react-router into shared OpenReading. */
export function OpenReadingProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const navigation = useMemo(
    () => ({
      pathname: location.pathname,
      navigate: (to: string) => {
        void navigate(to)
      },
    }),
    [location.pathname, navigate],
  )

  return (
    <SharedOpenReadingProvider navigation={navigation}>
      {children}
    </SharedOpenReadingProvider>
  )
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { appApi } from '../bridge'
import { useShortcutAction } from '../shortcuts/shortcutActions'

type ImmersiveReadingContextValue = {
  /** OS window is fullscreen. */
  fullscreen: boolean
  /** Fullscreen while on the Reader route — distraction-free reading. */
  immersive: boolean
  toggleFullscreen: () => void
  exitFullscreen: () => void
}

const ImmersiveReadingContext =
  createContext<ImmersiveReadingContextValue | null>(null)

export function ImmersiveReadingProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [fullscreen, setFullscreen] = useState(false)
  const onReader = location.pathname.startsWith('/reader')
  const immersive = fullscreen && onReader

  useEffect(() => {
    let cancelled = false
    void appApi.getFullscreen().then((value) => {
      if (!cancelled) setFullscreen(value)
    })
    const unsubscribe = appApi.onFullscreenChanged((value) => {
      setFullscreen(value)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  // Leaving Reader while still OS-fullscreen should drop immersive chrome.
  // Keep the OS fullscreen flag; App chrome returns when not on /reader.

  const toggleFullscreen = useCallback(() => {
    void appApi.toggleFullscreen().then((result) => {
      if (result.ok) setFullscreen(result.fullscreen)
    })
  }, [])

  const exitFullscreen = useCallback(() => {
    void appApi.setFullscreen(false).then((result) => {
      if (result.ok) setFullscreen(result.fullscreen)
    })
  }, [])

  // Toggle Fullscreen shortcut (Settings → Keyboard Shortcuts → View, F11 by default). The Main
  // process used to toggle on F11 itself; it now only handles Esc, so this is the single F11 path.
  useShortcutAction('view.toggleFullscreen', toggleFullscreen)

  const value = useMemo(
    () => ({
      fullscreen,
      immersive,
      toggleFullscreen,
      exitFullscreen,
    }),
    [exitFullscreen, fullscreen, immersive, toggleFullscreen],
  )

  return (
    <ImmersiveReadingContext.Provider value={value}>
      {children}
    </ImmersiveReadingContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useImmersiveReading(): ImmersiveReadingContextValue {
  const context = useContext(ImmersiveReadingContext)
  if (!context) {
    throw new Error(
      'useImmersiveReading must be used within ImmersiveReadingProvider',
    )
  }
  return context
}

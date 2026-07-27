import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type OpenReadingTab = {
  bookId: string
  title: string
}

/** Host navigation — desktop: react-router; mobile: React Navigation / expo-router. */
export type OpenReadingNavigation = {
  pathname: string
  navigate: (to: string) => void
}

type OpenReadingContextValue = {
  tabs: OpenReadingTab[]
  /** Book id from the current `/reader/:bookId` route, if any. */
  activeBookId: string | null
  /** Add (or focus) a book tab and navigate to Reader. */
  openBook: (bookId: string, title?: string) => void
  /** Ensure a tab exists without forcing navigation (e.g. deep-link). */
  ensureTab: (bookId: string, title?: string) => void
  updateBookTitle: (bookId: string, title: string) => void
  focusBook: (bookId: string) => void
  closeBook: (bookId: string) => void
  /** Reorder open tabs (Chrome-style drag). */
  reorderTabs: (fromIndex: number, toIndex: number) => void
  /** Focus the active open book, or the last tab; no-op if empty. */
  goReading: () => void
}

const OpenReadingContext = createContext<OpenReadingContextValue | null>(null)

export function readerBookIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/reader\/([^/]+)/)
  return m?.[1] ? decodeURIComponent(m[1]) : null
}

export type OpenReadingProviderProps = {
  children: ReactNode
  navigation: OpenReadingNavigation
}

export function OpenReadingProvider({
  children,
  navigation,
}: OpenReadingProviderProps) {
  const { pathname, navigate } = navigation
  const [tabs, setTabs] = useState<OpenReadingTab[]>([])
  const activeBookId = readerBookIdFromPath(pathname)

  const ensureTab = useCallback((bookId: string, title?: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.bookId === bookId)
      if (existing) {
        if (!title || title === existing.title) return prev
        return prev.map((t) =>
          t.bookId === bookId ? { ...t, title } : t,
        )
      }
      return [...prev, { bookId, title: title?.trim() || 'Untitled' }]
    })
  }, [])

  const updateBookTitle = useCallback((bookId: string, title: string) => {
    const next = title.trim() || 'Untitled'
    setTabs((prev) => {
      const existing = prev.find((t) => t.bookId === bookId)
      if (!existing || existing.title === next) return prev
      return prev.map((t) => (t.bookId === bookId ? { ...t, title: next } : t))
    })
  }, [])

  const openBook = useCallback(
    (bookId: string, title?: string) => {
      ensureTab(bookId, title)
      navigate(`/reader/${bookId}`)
    },
    [ensureTab, navigate],
  )

  const focusBook = useCallback(
    (bookId: string) => {
      navigate(`/reader/${bookId}`)
    },
    [navigate],
  )

  const closeBook = useCallback(
    (bookId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.bookId === bookId)
        if (idx < 0) return prev
        const next = prev.filter((t) => t.bookId !== bookId)
        const closingActive = readerBookIdFromPath(pathname) === bookId

        if (closingActive) {
          const fallback = next[Math.min(idx, next.length - 1)]
          queueMicrotask(() => {
            if (fallback) navigate(`/reader/${fallback.bookId}`)
            else navigate('/library')
          })
        }
        return next
      })
    },
    [pathname, navigate],
  )

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs((prev) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length
      ) {
        return prev
      }
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  const goReading = useCallback(() => {
    setTabs((prev) => {
      if (prev.length === 0) {
        queueMicrotask(() => navigate('/library'))
        return prev
      }
      const current = readerBookIdFromPath(pathname)
      const target =
        (current && prev.find((t) => t.bookId === current)) ||
        prev[prev.length - 1]
      if (!target) {
        queueMicrotask(() => navigate('/library'))
        return prev
      }
      queueMicrotask(() => navigate(`/reader/${target.bookId}`))
      return prev
    })
  }, [pathname, navigate])

  const value = useMemo(
    () => ({
      tabs,
      activeBookId,
      openBook,
      ensureTab,
      updateBookTitle,
      focusBook,
      closeBook,
      reorderTabs,
      goReading,
    }),
    [
      tabs,
      activeBookId,
      openBook,
      ensureTab,
      updateBookTitle,
      focusBook,
      closeBook,
      reorderTabs,
      goReading,
    ],
  )

  return (
    <OpenReadingContext.Provider value={value}>
      {children}
    </OpenReadingContext.Provider>
  )
}

export function useOpenReading(): OpenReadingContextValue {
  const ctx = useContext(OpenReadingContext)
  if (!ctx) {
    throw new Error('useOpenReading must be used within OpenReadingProvider')
  }
  return ctx
}

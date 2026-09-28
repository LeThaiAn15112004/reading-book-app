import { useEffect, type MutableRefObject } from 'react'
import type { EpubRendererApi } from '../../../../reader/renderers/epub'
import { readAloudSupported, useReadAloudStore } from '../readAloud/readAloudStore'

type UseReadAloudOptions = {
  bookId: string | undefined
  isEpubSurface: boolean
  epubApiRef: MutableRefObject<EpubRendererApi | null>
  setToast: (message: string | null) => void
}

/**
 * React-lifecycle adapter over `useReadAloudStore` (all state + logic live there): syncs the
 * screen's context in, and stops reading when the book changes or the Reader unmounts.
 */
export function useReadAloud({ bookId, isEpubSurface, epubApiRef, setToast }: UseReadAloudOptions) {
  const menuOpen = useReadAloudStore((s) => s.menuOpen)
  const status = useReadAloudStore((s) => s.status)
  const rate = useReadAloudStore((s) => s.rate)
  const volume = useReadAloudStore((s) => s.volume)
  const setContext = useReadAloudStore((s) => s.setContext)
  const openMenu = useReadAloudStore((s) => s.openMenu)
  const closeMenu = useReadAloudStore((s) => s.closeMenu)
  const readViewport = useReadAloudStore((s) => s.readViewport)
  const readFromPosition = useReadAloudStore((s) => s.readFromPosition)
  const togglePlayPause = useReadAloudStore((s) => s.togglePlayPause)
  const stop = useReadAloudStore((s) => s.stop)
  const setRate = useReadAloudStore((s) => s.setRate)
  const setVolume = useReadAloudStore((s) => s.setVolume)

  useEffect(() => {
    setContext({ isEpubSurface, epubApiRef, setToast })
  }, [setContext, isEpubSurface, epubApiRef, setToast])

  useEffect(() => {
    return () => {
      stop()
      closeMenu()
    }
  }, [bookId, stop, closeMenu])

  useEffect(() => {
    if (!isEpubSurface) stop()
  }, [isEpubSurface, stop])

  return {
    menuOpen,
    status,
    rate,
    volume,
    active: menuOpen || status !== 'idle',
    available: isEpubSurface && readAloudSupported,
    openMenu,
    closeMenu,
    readViewport,
    readFromPosition,
    togglePlayPause,
    stop,
    setRate,
    setVolume,
  }
}

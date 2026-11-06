import { useEffect, useRef } from 'react'
import { usePdfSelectionMenuStore } from '../pdfSelection/pdfSelectionMenuStore'

type UsePdfSelectionMenuOptions = {
  bookId: string | undefined
  isPdfSurface: boolean
  /** The PDF's scroll container — a scroll moves the selection away from the fixed menu. */
  getScrollRoot: () => HTMLElement | null
  zoom: number
}

/**
 * React-lifecycle adapter over `usePdfSelectionMenuStore`: closes the menu when the book changes,
 * the Reader unmounts, the surface stops being a PDF, the zoom changes or the pages scroll (the
 * menu is `position: fixed` at the click point, so it would otherwise float away from the text).
 */
export function usePdfSelectionMenu({
  bookId,
  isPdfSurface,
  getScrollRoot,
  zoom,
}: UsePdfSelectionMenuOptions) {
  const menu = usePdfSelectionMenuStore((s) => s.menu)
  const open = usePdfSelectionMenuStore((s) => s.open)
  const close = usePdfSelectionMenuStore((s) => s.close)

  useEffect(() => {
    close()
    return close
  }, [bookId, isPdfSurface, zoom, close])

  // `getScrollRoot` is a fresh closure every render; the element it returns is stable.
  const getScrollRootRef = useRef(getScrollRoot)
  getScrollRootRef.current = getScrollRoot
  const menuOpen = menu !== null
  useEffect(() => {
    if (!menuOpen) return
    const root = getScrollRootRef.current()
    if (!root) return
    root.addEventListener('scroll', close, { passive: true })
    return () => root.removeEventListener('scroll', close)
  }, [menuOpen, close])

  return { menu, open, close }
}

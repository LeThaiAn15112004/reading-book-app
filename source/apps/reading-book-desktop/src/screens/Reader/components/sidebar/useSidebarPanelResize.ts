import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  SIDEBAR_PANEL_WIDTH_PX,
  clampSidebarPanelWidth,
} from './sidebarTabs'

const LEFT_STORAGE_KEY = 'reading-book.sidebarPanelWidth'
const RIGHT_STORAGE_KEY = 'reading-book.rightSidebarPanelWidth'

export type SidebarResizeEdge = 'left' | 'right'

function storageKeyFor(edge: SidebarResizeEdge): string {
  return edge === 'right' ? RIGHT_STORAGE_KEY : LEFT_STORAGE_KEY
}

function readStoredPanelWidth(edge: SidebarResizeEdge): number {
  try {
    const raw = localStorage.getItem(storageKeyFor(edge))
    if (!raw) return SIDEBAR_PANEL_WIDTH_PX
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return SIDEBAR_PANEL_WIDTH_PX
    return clampSidebarPanelWidth(parsed)
  } catch {
    return SIDEBAR_PANEL_WIDTH_PX
  }
}

export function useSidebarPanelResize(edge: SidebarResizeEdge = 'left') {
  const [panelWidth, setPanelWidth] = useState(() => readStoredPanelWidth(edge))
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(storageKeyFor(edge), String(panelWidth))
    } catch {
      /* ignore quota / private mode */
    }
  }, [edge, panelWidth])

  useEffect(() => {
    function onWindowResize() {
      setPanelWidth((current) => clampSidebarPanelWidth(current))
    }
    window.addEventListener('resize', onWindowResize)
    return () => window.removeEventListener('resize', onWindowResize)
  }, [])

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      const handle = event.currentTarget
      const pointerId = event.pointerId
      const startX = event.clientX
      const startWidth = panelWidth
      setIsResizing(true)

      // Capture so move/up still reach us when the pointer is over the EPUB iframe.
      try {
        handle.setPointerCapture(pointerId)
      } catch {
        /* ignore — older hosts / already captured */
      }

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        const delta =
          edge === 'right'
            ? startX - moveEvent.clientX
            : moveEvent.clientX - startX
        setPanelWidth(clampSidebarPanelWidth(startWidth + delta))
      }

      let cleaned = false
      const endResize = () => {
        if (cleaned) return
        cleaned = true
        setIsResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.removeEventListener('pointercancel', onUp)
        handle.removeEventListener('lostpointercapture', onLostCapture)
        if (handle.hasPointerCapture?.(pointerId)) {
          try {
            handle.releasePointerCapture(pointerId)
          } catch {
            /* ignore */
          }
        }
      }

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return
        endResize()
      }

      const onLostCapture = (lostEvent: Event) => {
        const pe = lostEvent as PointerEvent
        if (typeof pe.pointerId === 'number' && pe.pointerId !== pointerId) return
        endResize()
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onUp)
      handle.addEventListener('lostpointercapture', onLostCapture)
    },
    [edge, panelWidth],
  )

  return {
    panelWidth,
    isResizing,
    onResizePointerDown,
  }
}

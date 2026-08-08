import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  SIDEBAR_PANEL_WIDTH_PX,
  clampSidebarPanelWidth,
} from './sidebarTabs'

const STORAGE_KEY = 'reading-book.sidebarPanelWidth'

function readStoredPanelWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return SIDEBAR_PANEL_WIDTH_PX
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return SIDEBAR_PANEL_WIDTH_PX
    return clampSidebarPanelWidth(parsed)
  } catch {
    return SIDEBAR_PANEL_WIDTH_PX
  }
}

export function useSidebarPanelResize() {
  const [panelWidth, setPanelWidth] = useState(readStoredPanelWidth)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(panelWidth))
    } catch {
      /* ignore quota / private mode */
    }
  }, [panelWidth])

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

      const startX = event.clientX
      const startWidth = panelWidth
      setIsResizing(true)

      const onMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX
        setPanelWidth(clampSidebarPanelWidth(startWidth + delta))
      }

      const onUp = () => {
        setIsResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.removeEventListener('pointercancel', onUp)
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onUp)
    },
    [panelWidth],
  )

  return {
    panelWidth,
    isResizing,
    onResizePointerDown,
  }
}

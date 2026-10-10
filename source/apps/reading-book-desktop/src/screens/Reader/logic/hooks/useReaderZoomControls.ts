import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useShortcutAction } from '../../../../shortcuts'
import type { InteractionTool } from '@reading-book/book-reader-sdk'
import type { ReaderZoomViewportHandle } from '../../components'
import {
  ZOOM_DEFAULT,
  clampZoom,
  stepZoom,
  zoomForLayoutPreset,
  zoomFactorFromWheelDelta,
  type ZoomLayoutPreset,
} from '../zoom/readerZoom'

type UseReaderZoomControlsOptions = {
  bookId: string | undefined
  activeToolRef: RefObject<InteractionTool>
}

export function useReaderZoomControls({
  bookId,
  activeToolRef,
}: UseReaderZoomControlsOptions) {
  const zoomViewportRef = useRef<ReaderZoomViewportHandle | null>(null)
  const [viewZoom, setViewZoom] = useState(ZOOM_DEFAULT)
  const viewZoomRef = useRef(viewZoom)
  viewZoomRef.current = viewZoom

  useEffect(() => {
    setViewZoom(ZOOM_DEFAULT)
  }, [bookId])

  function setViewZoomCentered(next: number) {
    const clamped = clampZoom(next)
    setViewZoom(clamped)
    requestAnimationFrame(() => {
      const el = zoomViewportRef.current?.getElement()
      if (!el) return
      el.scrollLeft = 0
      el.scrollTop = 0
    })
  }

  const handleZoomStep = useCallback((direction: 1 | -1) => {
    const viewport = zoomViewportRef.current
    const el = viewport?.getElement()
    if (!viewport || !el) {
      setViewZoom((z) => stepZoom(z, direction))
      return
    }
    const focal = {
      offsetX: el.clientWidth / 2,
      offsetY: el.clientHeight / 2,
    }
    viewport.applyFocalZoom(stepZoom(viewZoomRef.current, direction), focal)
  }, [])

  const handleZoomChange = useCallback((scale: number) => {
    const viewport = zoomViewportRef.current
    const el = viewport?.getElement()
    if (!viewport || !el) {
      setViewZoomCentered(scale)
      return
    }
    const focal = {
      offsetX: el.clientWidth / 2,
      offsetY: el.clientHeight / 2,
    }
    viewport.applyFocalZoom(clampZoom(scale), focal)
  }, [])

  const handleZoomLayoutPreset = useCallback((preset: ZoomLayoutPreset) => {
    const metrics = zoomViewportRef.current?.getFitMetrics()
    const next = metrics
      ? zoomForLayoutPreset(preset, metrics)
      : ZOOM_DEFAULT
    setViewZoomCentered(next)
  }, [])

  const handleHandPanBy = useCallback((dx: number, dy: number) => {
    const el = zoomViewportRef.current?.getElement()
    if (!el) return
    el.scrollLeft -= dx
    el.scrollTop -= dy
  }, [])

  const handleFocusZoomWheel = useCallback(
    (detail: {
      clientX: number
      clientY: number
      deltaY: number
    }): boolean => {
      if (activeToolRef.current !== 'hand') return false
      const viewport = zoomViewportRef.current
      if (!viewport) return false
      const focal = viewport.focalFromClient(detail.clientX, detail.clientY)
      if (!focal) return false
      const factor = zoomFactorFromWheelDelta(detail.deltaY)
      viewport.applyFocalZoom(viewZoomRef.current * factor, focal)
      return true
    },
    [activeToolRef],
  )

  // View zoom keys (Settings → Keyboard Shortcuts → View; Ctrl/Cmd + = / - / 0 by default). The
  // central `ShortcutsBridge` dispatches them — there is no window keydown listener here any more.
  // Aa font-size stays on the settings panel.
  useShortcutAction('view.zoomIn', () => handleZoomStep(1))
  useShortcutAction('view.zoomOut', () => handleZoomStep(-1))
  useShortcutAction('view.resetZoom', () => setViewZoomCentered(ZOOM_DEFAULT))

  return {
    zoomViewportRef,
    viewZoom,
    setViewZoom,
    handleZoomStep,
    handleZoomChange,
    handleZoomLayoutPreset,
    handleHandPanBy,
    handleFocusZoomWheel,
  }
}

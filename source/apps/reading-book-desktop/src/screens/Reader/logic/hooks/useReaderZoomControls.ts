import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
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

  // View zoom: Ctrl/Cmd + / − / 0 (Aa font-size stays on the settings panel).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return
      }
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        handleZoomStep(1)
        return
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        handleZoomStep(-1)
        return
      }
      if (e.key === '0') {
        e.preventDefault()
        setViewZoomCentered(ZOOM_DEFAULT)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleZoomStep])

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

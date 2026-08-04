import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react'
import {
  clampZoom,
  scrollAfterFocalZoom,
  zoomFactorFromWheelDelta,
  type FitMetrics,
  type ZoomFocalPoint,
} from '../../readerZoom'

export type ReaderZoomViewportHandle = {
  getElement: () => HTMLDivElement | null
  getFitMetrics: () => FitMetrics | null
  applyFocalZoom: (nextZoom: number, focal: ZoomFocalPoint) => void
  focalFromClient: (clientX: number, clientY: number) => ZoomFocalPoint | null
}

type ReaderZoomViewportProps = {
  zoom: number
  onZoomChange: (scale: number) => void
  /** When true, Ctrl/Meta + wheel zooms toward the cursor. */
  focusZoomEnabled: boolean
  children: ReactNode
  className?: string
}

export const ReaderZoomViewport = forwardRef<
  ReaderZoomViewportHandle,
  ReaderZoomViewportProps
>(function ReaderZoomViewport(
  { zoom, onZoomChange, focusZoomEnabled, children, className },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const focusZoomEnabledRef = useRef(focusZoomEnabled)
  focusZoomEnabledRef.current = focusZoomEnabled
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange
  const pendingRef = useRef<{
    focal: ZoomFocalPoint
    oldZoom: number
  } | null>(null)

  const getFitMetrics = useCallback((): FitMetrics | null => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return null
    const vw = viewport.clientWidth
    const vh = viewport.clientHeight
    const cw = content.offsetWidth || vw
    const ch = content.offsetHeight || vh
    if (vw <= 0 || vh <= 0 || cw <= 0 || ch <= 0) return null
    return {
      viewportWidth: vw,
      viewportHeight: vh,
      contentWidth: cw,
      contentHeight: ch,
    }
  }, [])

  const focalFromClient = useCallback(
    (clientX: number, clientY: number): ZoomFocalPoint | null => {
      const viewport = viewportRef.current
      if (!viewport) return null
      const rect = viewport.getBoundingClientRect()
      return {
        offsetX: clientX - rect.left,
        offsetY: clientY - rect.top,
      }
    },
    [],
  )

  const applyFocalZoom = useCallback(
    (nextZoom: number, focal: ZoomFocalPoint) => {
      const oldZoom = zoomRef.current
      const clamped = clampZoom(nextZoom)
      if (Math.abs(clamped - oldZoom) < 1e-6) return
      pendingRef.current = { focal, oldZoom }
      onZoomChangeRef.current(clamped)
    },
    [],
  )

  useImperativeHandle(
    ref,
    () => ({
      getElement: () => viewportRef.current,
      getFitMetrics,
      applyFocalZoom,
      focalFromClient,
    }),
    [applyFocalZoom, focalFromClient, getFitMetrics],
  )

  useEffect(() => {
    const viewport = viewportRef.current
    const pending = pendingRef.current
    if (!viewport || !pending) return
    pendingRef.current = null
    scrollAfterFocalZoom(viewport, pending.oldZoom, zoom, pending.focal)
  }, [zoom])

  const runFocusZoom = useCallback(
    (clientX: number, clientY: number, deltaY: number) => {
      if (!focusZoomEnabledRef.current) return false
      const focal = focalFromClient(clientX, clientY)
      if (!focal) return false
      const factor = zoomFactorFromWheelDelta(deltaY)
      applyFocalZoom(zoomRef.current * factor, focal)
      return true
    },
    [applyFocalZoom, focalFromClient],
  )

  // Non-passive capture so Ctrl+scroll isn't claimed by browser page-zoom.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    function onWheelCapture(event: WheelEvent) {
      if (!(event.ctrlKey || event.metaKey)) return
      if (!focusZoomEnabledRef.current) return
      event.preventDefault()
      event.stopPropagation()
      runFocusZoom(event.clientX, event.clientY, event.deltaY)
    }
    viewport.addEventListener('wheel', onWheelCapture, {
      capture: true,
      passive: false,
    })
    return () => {
      viewport.removeEventListener('wheel', onWheelCapture, true)
    }
  }, [runFocusZoom])

  const z = clampZoom(zoom)

  return (
    <div
      ref={viewportRef}
      className={`relative min-h-0 flex-1 overflow-auto overscroll-contain ${className ?? ''}`}
      data-reader-zoom-viewport=""
    >
      <div
        className="relative"
        style={{
          width: `${z * 100}%`,
          height: `${z * 100}%`,
          minWidth: '100%',
          minHeight: '100%',
        }}
      >
        <div
          ref={contentRef}
          className="flex h-full min-h-0 w-full min-w-0 flex-col"
          style={{
            width: `${100 / z}%`,
            height: `${100 / z}%`,
            transform: `scale(${z})`,
            transformOrigin: '0 0',
            willChange: 'transform',
          }}
          data-reader-zoom-content=""
        >
          {children}
        </div>
      </div>
    </div>
  )
})

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react'
import {
  clampZoom,
  nearestZoomAnchorIndex,
  scrollAfterFocalZoom,
  scrollToHoldZoomAnchor,
  zoomAnchorAt,
  zoomFactorFromWheelDelta,
  type FitMetrics,
  type ZoomAnchor,
  type ZoomFocalPoint,
} from '../../logic'

/**
 * Native-mode surfaces mark their stacked boxes (PDF page slots) with this attribute, top to bottom
 * in document order. A focal zoom anchors to the box under the focal point instead of assuming the
 * content grows exactly in proportion to the zoom (it doesn't: per-page pixel rounding, centring).
 */
const ZOOM_ANCHOR_ATTR = 'data-zoom-anchor'

/** Native mode: the document point under the focal (page-relative) and that focal in client px. */
type PendingAnchor = { at: ZoomAnchor; clientX: number; clientY: number }

/**
 * - `transform` (default): the surface fills the viewport and is scaled with a CSS transform; the
 *   viewport only scrolls once zoomed past 100%.
 * - `native`: the surface (PDF) lays itself out at the zoom it is given, so the viewport is its one
 *   scroll container — no transform, no nested scroller, crisp re-rendering at every zoom.
 */
export type ReaderZoomMode = 'transform' | 'native'

export type ReaderZoomViewportHandle = {
  getElement: () => HTMLDivElement | null
  getMode: () => ReaderZoomMode
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
  mode?: ReaderZoomMode
}

export const ReaderZoomViewport = forwardRef<
  ReaderZoomViewportHandle,
  ReaderZoomViewportProps
>(function ReaderZoomViewport(
  { zoom, onZoomChange, focusZoomEnabled, children, className, mode = 'transform' },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const modeRef = useRef(mode)
  modeRef.current = mode
  const focusZoomEnabledRef = useRef(focusZoomEnabled)
  focusZoomEnabledRef.current = focusZoomEnabled
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange
  /**
   * Focal zoom requested but not yet committed. Captured against the layout on screen at request
   * time; restored in a layout effect right after the new zoom is laid out (before paint).
   */
  const pendingRef = useRef<{
    focal: ZoomFocalPoint
    oldZoom: number
    /** Zoom requested — the base for the next wheel tick if this one isn't rendered yet. */
    zoom: number
    anchor: PendingAnchor | null
  } | null>(null)

  const anchorElements = useCallback((): HTMLElement[] => {
    const content = contentRef.current
    if (!content) return []
    return [...content.querySelectorAll<HTMLElement>(`[${ZOOM_ANCHOR_ATTR}]`)]
  }, [])

  const captureAnchor = useCallback(
    (focal: ZoomFocalPoint): PendingAnchor | null => {
      const viewport = viewportRef.current
      if (!viewport || modeRef.current !== 'native') return null
      const boxes = anchorElements()
      const rect = viewport.getBoundingClientRect()
      const clientX = rect.left + focal.offsetX
      const clientY = rect.top + focal.offsetY
      const index = nearestZoomAnchorIndex(
        boxes.length,
        (i) => boxes[i]!.getBoundingClientRect(),
        clientY,
      )
      if (index < 0) return null
      const box = boxes[index]!.getBoundingClientRect()
      return { at: zoomAnchorAt(index, box, clientX, clientY), clientX, clientY }
    },
    [anchorElements],
  )

  const getFitMetrics = useCallback((): FitMetrics | null => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return null
    const vw = viewport.clientWidth
    const vh = viewport.clientHeight
    // Native content is already laid out at the current zoom — report its 100% size.
    const unzoom = modeRef.current === 'native' ? zoomRef.current : 1
    const cw = content.offsetWidth / unzoom || vw
    const ch = content.offsetHeight / unzoom || vh
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

  /** The zoom the next step builds on: a requested-but-unrendered zoom, else the one on screen. */
  const latestZoom = useCallback(() => pendingRef.current?.zoom ?? zoomRef.current, [])

  const applyFocalZoom = useCallback(
    (nextZoom: number, focal: ZoomFocalPoint) => {
      const clamped = clampZoom(nextZoom)
      if (Math.abs(clamped - latestZoom()) < 1e-6) return
      // `zoomRef` is the zoom laid out on screen (React renders and commits a zoom change in one
      // task), so this capture matches the DOM; a newer request simply replaces an older one.
      const oldZoom = zoomRef.current
      pendingRef.current =
        Math.abs(clamped - oldZoom) < 1e-6
          ? null // back to the zoom on screen before the pending one rendered: nothing moves
          : { focal, oldZoom, zoom: clamped, anchor: captureAnchor(focal) }
      onZoomChangeRef.current(clamped)
    },
    [captureAnchor, latestZoom],
  )

  useImperativeHandle(
    ref,
    () => ({
      getElement: () => viewportRef.current,
      getMode: () => modeRef.current,
      getFitMetrics,
      applyFocalZoom,
      focalFromClient,
    }),
    [applyFocalZoom, focalFromClient, getFitMetrics],
  )

  // Layout effect: runs once the surface has re-laid out at `zoom` (children commit first) and
  // before paint, so no frame shows the stale scroll position.
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const pending = pendingRef.current
    if (!viewport || !pending) return
    pendingRef.current = null
    const anchor = pending.anchor
    const box = anchor ? anchorElements()[anchor.at.index] : undefined
    if (anchor && box) {
      const next = scrollToHoldZoomAnchor(
        { left: viewport.scrollLeft, top: viewport.scrollTop },
        box.getBoundingClientRect(),
        anchor.at,
        anchor.clientX,
        anchor.clientY,
      )
      viewport.scrollLeft = next.left
      viewport.scrollTop = next.top
      return
    }
    scrollAfterFocalZoom(viewport, pending.oldZoom, zoom, pending.focal)
  }, [zoom, anchorElements])

  const runFocusZoom = useCallback(
    (clientX: number, clientY: number, deltaY: number) => {
      if (!focusZoomEnabledRef.current) return false
      const focal = focalFromClient(clientX, clientY)
      if (!focal) return false
      const factor = zoomFactorFromWheelDelta(deltaY)
      applyFocalZoom(latestZoom() * factor, focal)
      return true
    },
    [applyFocalZoom, focalFromClient, latestZoom],
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
    // `mode` swaps the viewport element.
  }, [runFocusZoom, mode])

  const z = clampZoom(zoom)

  if (mode === 'native') {
    return (
      <div
        ref={viewportRef}
        className={`relative min-h-0 flex-1 overflow-auto overscroll-contain ${className ?? ''}`}
        data-reader-zoom-viewport=""
      >
        <div
          ref={contentRef}
          className="min-h-full w-max min-w-full"
          data-reader-zoom-content=""
        >
          {children}
        </div>
      </div>
    )
  }

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

/**
 * Phone page gestures (spec 019, FR-003 – FR-008, FR-013b; research R2 – R4): feeds the core classifier
 * (`classifyGesture`) from two sources — touches on the page in the main document (PDF Page view, the EPUB synthetic
 * cover) and the pointer stream EPUB forwards from its section frames (`EpubRenderer.onPagePointer`) — and turns its
 * answers into page turns and chrome events.
 *
 *   - swipe-next / swipe-prev → the page slides with the finger (Page view, transform only, one write per frame),
 *     then `turn()`; a cancelled or impossible turn springs back. Reduced motion: no slide.
 *   - taps are only REMEMBERED on release; the renderer's own "blank click" (`onSurfaceClick` / `onBlankClick`), which
 *     fires only when the tap was not on a mark or a link, consumes them (`consumeTap`). So a tap on a mark opens it
 *     and never also turns the page.
 *
 * Tracking lives in a plain closure object, not React state: it changes on every pointer move and never renders.
 */
import { useCallback, useEffect, useRef } from 'react'
import {
  TAP_MAX_MS,
  classifyGesture,
  isSwipeCandidate,
  type GestureKind,
  type GesturePoint,
  type GestureView,
  type ZoomEdge,
} from '@core'
import type { EpubPagePointerEvent } from '../../../../components/reader/renderers/epub'

const SLIDE_MS = 180
const LINK_SELECTOR = 'a[href], button, input, textarea, select, [role="button"], [role="link"]'

export interface PhonePageGesturesOptions {
  view: GestureView
  /** Swipes / edge taps are allowed (no layer, no opening screen). Read at gesture time. */
  allowed: () => boolean
  /** The element moved with the finger (wraps the renderer, outside any iframe). */
  moverRef: React.RefObject<HTMLElement | null>
  /** The element whose width is the page width. */
  pageRef: React.RefObject<HTMLElement | null>
  /** Turn the page; returns false when there is no page that way (first / last page → spring back). */
  turn: (direction: 'next' | 'prev') => boolean
  /** PDF Page view zoomed: which edges show right now; null when not zoomed. */
  zoomEdge?: () => ZoomEdge | null
  /** A mark under this outer point (EPUB). */
  isMarkAt?: (x: number, y: number) => boolean
  /** A tap the renderer confirmed was on blank page. */
  onTap: (kind: Extract<GestureKind, 'tap-prev' | 'tap-next' | 'tap-middle'>) => void
  /** Any touch on the page (restarts the bars' idle countdown). */
  onActivity?: () => void
}

interface Tracking {
  start: GesturePoint
  last: GesturePoint
  early: { dx: number; dy: number }
  startedOnMarkOrLink: boolean
  selectionSeen: boolean
  layersOpen: boolean
  zoomEdge: ZoomEdge | null
  following: boolean
  doc: Document
}

function hasSelection(doc: Document): boolean {
  const selection = doc.getSelection()
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim())
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function usePhonePageGestures(options: PhonePageGesturesOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options

  const trackRef = useRef<Tracking | null>(null)
  const pendingTapRef = useRef<{ kind: GestureKind; at: number } | null>(null)
  const frameRef = useRef<number | null>(null)
  const dxRef = useRef(0)

  const setTransform = useCallback((dx: number, animate: boolean) => {
    const mover = optionsRef.current.moverRef.current
    if (!mover) return
    mover.style.transition = animate ? `transform ${SLIDE_MS}ms ease-out` : 'none'
    mover.style.transform = dx === 0 ? '' : `translate3d(${dx}px, 0, 0)`
  }, [])

  const scheduleFollow = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      setTransform(dxRef.current, false)
    })
  }, [setTransform])

  const begin = useCallback((point: GesturePoint, target: EventTarget | null, doc: Document) => {
    const o = optionsRef.current
    o.onActivity?.()
    const element = target instanceof (doc.defaultView ?? window).Element ? (target as Element) : null
    trackRef.current = {
      start: point,
      last: point,
      early: { dx: 0, dy: 0 },
      startedOnMarkOrLink: Boolean(element?.closest(LINK_SELECTOR)) || Boolean(o.isMarkAt?.(point.x, point.y)),
      selectionSeen: hasSelection(doc),
      layersOpen: !o.allowed(),
      zoomEdge: o.view === 'page' ? (o.zoomEdge?.() ?? null) : null,
      following: false,
      doc,
    }
    pendingTapRef.current = null
  }, [])

  const move = useCallback(
    (point: GesturePoint) => {
      const track = trackRef.current
      if (!track) return
      track.last = point
      const dx = point.x - track.start.x
      const dy = point.y - track.start.y
      if (point.t - track.start.t <= TAP_MAX_MS && Math.hypot(dx, dy) > Math.hypot(track.early.dx, track.early.dy)) {
        track.early = { dx, dy }
      }
      if (!track.selectionSeen && hasSelection(track.doc)) track.selectionSeen = true
      const o = optionsRef.current
      const candidate = isSwipeCandidate({
        view: o.view,
        dx,
        dy,
        maxMoveBeforeMs350: track.early,
        startedOnMarkOrLink: track.startedOnMarkOrLink,
        selectionSeen: track.selectionSeen,
        layersOpen: track.layersOpen,
        zoomEdge: track.zoomEdge,
      })
      if (candidate && !reducedMotion()) {
        track.following = true
        dxRef.current = dx
        scheduleFollow()
      } else if (track.following) {
        track.following = false
        dxRef.current = 0
        setTransform(0, true)
      }
    },
    [scheduleFollow, setTransform],
  )

  const end = useCallback(
    (point: GesturePoint | null) => {
      const track = trackRef.current
      trackRef.current = null
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      if (!track) return
      const o = optionsRef.current
      if (point) {
        track.last = point
        if (!track.selectionSeen && hasSelection(track.doc)) track.selectionSeen = true
      }
      const width = o.pageRef.current?.clientWidth ?? 0
      const result = point
        ? classifyGesture({
            view: o.view,
            start: track.start,
            end: track.last,
            maxMoveBeforeMs350: track.early,
            width,
            startedOnMarkOrLink: track.startedOnMarkOrLink,
            selectionSeen: track.selectionSeen,
            layersOpen: track.layersOpen,
            zoomEdge: track.zoomEdge,
          })
        : { kind: 'none' as const }

      if (result.kind === 'swipe-next' || result.kind === 'swipe-prev') {
        const direction = result.kind === 'swipe-next' ? 'next' : 'prev'
        const turned = o.turn(direction)
        if (turned && track.following && !reducedMotion()) {
          // The new page slides in from the side the finger came from.
          const from = direction === 'next' ? width * 0.3 : -width * 0.3
          setTransform(from, false)
          requestAnimationFrame(() => setTransform(0, true))
        } else {
          setTransform(0, track.following && !reducedMotion())
        }
        dxRef.current = 0
        return
      }
      if (track.following) setTransform(0, !reducedMotion())
      dxRef.current = 0
      if (result.kind === 'tap-prev' || result.kind === 'tap-next' || result.kind === 'tap-middle') {
        pendingTapRef.current = { kind: result.kind, at: performance.now() }
      }
    },
    [setTransform],
  )

  /** The renderer saw a blank click: act on the tap just classified (if any). */
  const consumeTap = useCallback(() => {
    const pending = pendingTapRef.current
    pendingTapRef.current = null
    // A click follows its pointerup within a frame or two; an old one is not this click's.
    if (!pending || performance.now() - pending.at > 600) {
      return
    }
    if (pending.kind === 'tap-prev' || pending.kind === 'tap-next' || pending.kind === 'tap-middle') {
      optionsRef.current.onTap(pending.kind)
    }
  }, [])

  // Main-document touches on the page (PDF, the EPUB cover). Touch events keep coming while the browser pans a zoomed
  // page, unlike pointer events (which are cancelled), so a swipe from the edge is still seen (FR-013b).
  const rootCleanupRef = useRef<(() => void) | null>(null)
  const bindRoot = useCallback(
    (element: HTMLElement | null) => {
      rootCleanupRef.current?.()
      rootCleanupRef.current = null
      if (!element) return
      const pointOf = (touch: Touch): GesturePoint => ({ x: touch.clientX, y: touch.clientY, t: performance.now() })
      const onStart = (event: TouchEvent) => {
        if (event.touches.length !== 1) {
          // A second finger (pinch zoom): not a page gesture.
          if (trackRef.current?.following) setTransform(0, false)
          trackRef.current = null
          return
        }
        begin(pointOf(event.touches[0]!), event.target, document)
      }
      const onMove = (event: TouchEvent) => {
        if (event.touches.length !== 1) return
        move(pointOf(event.touches[0]!))
      }
      const onEnd = (event: TouchEvent) => {
        const touch = event.changedTouches[0]
        end(touch ? pointOf(touch) : null)
      }
      const onCancel = () => end(null)
      element.addEventListener('touchstart', onStart, { passive: true })
      element.addEventListener('touchmove', onMove, { passive: true })
      element.addEventListener('touchend', onEnd, { passive: true })
      element.addEventListener('touchcancel', onCancel, { passive: true })
      rootCleanupRef.current = () => {
        element.removeEventListener('touchstart', onStart)
        element.removeEventListener('touchmove', onMove)
        element.removeEventListener('touchend', onEnd)
        element.removeEventListener('touchcancel', onCancel)
      }
    },
    [begin, move, end, setTransform],
  )

  useEffect(
    () => () => {
      rootCleanupRef.current?.()
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  /** EPUB section frames: their pointer stream, already in outer coordinates. */
  const onEpubPointer = useCallback(
    (event: EpubPagePointerEvent) => {
      const point = { x: event.x, y: event.y, t: event.t }
      if (event.phase === 'down') begin(point, event.target, event.doc)
      else if (event.phase === 'move') move(point)
      else if (event.phase === 'up') end(point)
      else end(null)
    },
    [begin, move, end],
  )

  return { bindRoot, onEpubPointer, consumeTap }
}

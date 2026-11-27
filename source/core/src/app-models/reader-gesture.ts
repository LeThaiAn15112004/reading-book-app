/**
 * Telling a page-turn swipe from a tap, a text selection and a pan (spec 019, FR-003 – FR-006, FR-013b, research R2).
 * One pure classifier fed by pointer positions from the page, shared by the EPUB and PDF Page views on the phone.
 *
 * The 350 ms window is what keeps a long press (text selection, ~500 ms on Android) from ever being read as a swipe:
 * a swipe must START moving inside it.
 */

export const SWIPE_MIN_PX = 48
/** |dx| must be at least this many times |dy|. */
export const SWIPE_RATIO = 1.5
/** Released past this share of the page width, a swipe turns the page… */
export const SWIPE_COMMIT_SHARE = 0.25
/** …or released at this speed (px / ms). */
export const SWIPE_COMMIT_VELOCITY = 0.4
export const TAP_MAX_PX = 10
export const TAP_MAX_MS = 350
/** Width of each edge tap zone (Page view), as a share of the page width. */
export const EDGE_SHARE = 0.2

export type GestureView = 'page' | 'scroll'

export interface GesturePoint {
  x: number
  y: number
  /** ms */
  t: number
}

/** PDF Page view, zoomed: which page edges were ALREADY reached when the finger went down. */
export interface ZoomEdge {
  left: boolean
  right: boolean
}

export interface GestureInput {
  view: GestureView
  start: GesturePoint
  end: GesturePoint
  /** Largest movement from `start` seen inside the first `TAP_MAX_MS`. */
  maxMoveBeforeMs350: { dx: number; dy: number }
  /** Page width, CSS px. */
  width: number
  startedOnMarkOrLink: boolean
  /** A non-collapsed text selection existed at any point of the gesture. */
  selectionSeen: boolean
  layersOpen: boolean
  zoomEdge: ZoomEdge | null
}

export type GestureKind = 'swipe-next' | 'swipe-prev' | 'tap-prev' | 'tap-next' | 'tap-middle' | 'none'

export interface GestureResult {
  kind: GestureKind
}

const none: GestureResult = { kind: 'none' }

export interface SwipeCandidateInput {
  view: GestureView
  dx: number
  dy: number
  maxMoveBeforeMs350: { dx: number; dy: number }
  startedOnMarkOrLink: boolean
  selectionSeen: boolean
  layersOpen: boolean
  zoomEdge: ZoomEdge | null
}

function startedEarly(early: { dx: number; dy: number }): boolean {
  return Math.hypot(early.dx, early.dy) >= TAP_MAX_PX
}

/** The edge in the swipe's direction was reached before it began (FR-013b); no zoom = always allowed. */
function edgeAllows(dx: number, zoomEdge: ZoomEdge | null): boolean {
  if (!zoomEdge) return true
  // Finger to the left (dx < 0) = next page: the page's RIGHT edge must already show.
  return dx < 0 ? zoomEdge.right : zoomEdge.left
}

/**
 * While the finger moves: should the page follow it? True once the move is a clear, early, mostly horizontal one that
 * may still become a page turn.
 */
export function isSwipeCandidate(input: SwipeCandidateInput): boolean {
  if (input.view !== 'page') return false
  if (input.layersOpen || input.selectionSeen || input.startedOnMarkOrLink) return false
  if (!startedEarly(input.maxMoveBeforeMs350)) return false
  const ax = Math.abs(input.dx)
  if (ax < TAP_MAX_PX || ax < SWIPE_RATIO * Math.abs(input.dy)) return false
  return edgeAllows(input.dx, input.zoomEdge)
}

export type TapKind = Extract<GestureKind, 'tap-prev' | 'tap-next' | 'tap-middle'>
export type SwipeKind = Extract<GestureKind, 'swipe-next' | 'swipe-prev'>

/**
 * Single tap, on its own (no swipe rule here): a short, still press. The ONE tap rule of the phone page — the
 * renderers' own "blank click" thresholds (e.g. PDF's 4 px mouse drag threshold) never decide a phone tap.
 * Null = not a tap. A tap that started on a mark / link or with text selected is not the page's: the renderer or the
 * browser owns it.
 */
export function recognizeTap(input: GestureInput): TapKind | null {
  const ax = Math.abs(input.end.x - input.start.x)
  const ay = Math.abs(input.end.y - input.start.y)
  const dt = input.end.t - input.start.t
  if (ax >= TAP_MAX_PX || ay >= TAP_MAX_PX || dt >= TAP_MAX_MS) return null
  if (input.startedOnMarkOrLink || input.selectionSeen) return null
  // With a layer open a tap on the page only closes it (the reducer's `tap-middle`), it never turns.
  if (input.layersOpen || input.view === 'scroll' || input.width <= 0) return 'tap-middle'
  const share = input.start.x / input.width
  if (share < EDGE_SHARE) return 'tap-prev'
  if (share > 1 - EDGE_SHARE) return 'tap-next'
  return 'tap-middle'
}

/** Horizontal page-turn swipe, on its own (no tap rule here). Page view only. Null = not a swipe. */
export function recognizeSwipe(input: GestureInput): SwipeKind | null {
  if (input.view !== 'page') return null
  if (input.layersOpen || input.selectionSeen || input.startedOnMarkOrLink) return null
  if (!startedEarly(input.maxMoveBeforeMs350)) return null
  const dx = input.end.x - input.start.x
  const ax = Math.abs(dx)
  const ay = Math.abs(input.end.y - input.start.y)
  const dt = Math.max(1, input.end.t - input.start.t)
  if (ax < SWIPE_MIN_PX || ax < SWIPE_RATIO * ay) return null
  if (!edgeAllows(dx, input.zoomEdge)) return null
  const farEnough = input.width > 0 && ax >= SWIPE_COMMIT_SHARE * input.width
  const fastEnough = ax / dt >= SWIPE_COMMIT_VELOCITY
  if (!farEnough && !fastEnough) return null
  return dx < 0 ? 'swipe-next' : 'swipe-prev'
}

/**
 * What a finished touch means: the one place that ranks the recognizers (a swipe wins over a tap; the two cannot both
 * match, a swipe moves ≥ 48 px and a tap < 10 px). Anything else is `none`: the browser keeps it.
 */
export function classifyGesture(input: GestureInput): GestureResult {
  const swipe = recognizeSwipe(input)
  if (swipe) return { kind: swipe }
  const tap = recognizeTap(input)
  if (tap) return { kind: tap }
  return none
}

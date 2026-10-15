/** Viewport zoom math for the reader surface (independent of Aa font-size). No DOM. */

export const ZOOM_MIN = 0.01
export const ZOOM_MAX = 64
export const ZOOM_DEFAULT = 1
/** Multiplicative step for − / + toolbar buttons. */
export const ZOOM_STEP_FACTOR = 1.25

export const ZOOM_PERCENT_PRESETS = [
  1, 8.33, 12.5, 25, 33.33, 50, 66.67, 75, 100, 125, 150, 200, 400, 600, 800,
  1600, 3200, 6400,
] as const

export type ZoomLayoutPreset =
  | 'actual-size'
  | 'fit-page'
  | 'fit-width'
  | 'fit-visible'

export const ZOOM_LAYOUT_PRESETS: ReadonlyArray<{
  id: ZoomLayoutPreset
  label: string
}> = [
  { id: 'actual-size', label: 'Actual Size' },
  { id: 'fit-page', label: 'Fit Page' },
  { id: 'fit-width', label: 'Fit Width' },
  { id: 'fit-visible', label: 'Fit Visible' },
]

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return ZOOM_DEFAULT
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))
}

export function zoomFromPercent(percent: number): number {
  return clampZoom(percent / 100)
}

export function zoomToPercent(scale: number): number {
  return clampZoom(scale) * 100
}

/** Display string for the zoom input (e.g. "100", "33.33"). */
export function formatZoomPercent(scale: number): string {
  const pct = zoomToPercent(scale)
  if (Math.abs(pct - Math.round(pct)) < 0.05) return String(Math.round(pct))
  const fixed = pct.toFixed(2).replace(/\.?0+$/, '')
  return fixed
}

export function parseZoomPercentInput(raw: string): number | null {
  const trimmed = raw.trim().replace(/%/g, '')
  if (!trimmed) return null
  const n = Number.parseFloat(trimmed)
  if (!Number.isFinite(n) || n <= 0) return null
  return zoomFromPercent(n)
}

export function stepZoom(scale: number, direction: 1 | -1): number {
  const next =
    direction > 0 ? scale * ZOOM_STEP_FACTOR : scale / ZOOM_STEP_FACTOR
  return clampZoom(next)
}

export type ZoomFocalPoint = {
  /** Cursor X relative to the viewport element. */
  offsetX: number
  /** Cursor Y relative to the viewport element. */
  offsetY: number
}

export type ScrollOffset = {
  left: number
  top: number
}

/**
 * Scroll offset that keeps the document point under the focal point (cursor / pinch center)
 * fixed while changing scale, for an overflow viewport whose content grows with zoom.
 * Pure math — the host applies the result (DOM `scrollLeft/Top`, RN `ScrollView.scrollTo`).
 */
export function focalZoomScroll(
  scroll: ScrollOffset,
  oldZoom: number,
  newZoom: number,
  focal: ZoomFocalPoint,
): ScrollOffset {
  const z0 = oldZoom > 0 ? oldZoom : ZOOM_DEFAULT
  const z1 = clampZoom(newZoom)
  const contentX = (scroll.left + focal.offsetX) / z0
  const contentY = (scroll.top + focal.offsetY) / z0
  return {
    left: contentX * z1 - focal.offsetX,
    top: contentY * z1 - focal.offsetY,
  }
}

/** A laid-out box (e.g. one PDF page) in client coordinates. */
export type ZoomAnchorBox = {
  left: number
  top: number
  width: number
  height: number
}

/**
 * A document point as a position inside one laid-out box: box `index` and the point's fraction of
 * that box's width / height (may fall outside 0..1 for a point in the gap beside the box).
 * Unlike a raw content offset it survives a relayout that is not exactly proportional to the zoom
 * (per-box pixel rounding, centred columns, gaps rounded separately).
 */
export type ZoomAnchor = {
  index: number
  fx: number
  fy: number
}

/**
 * Index of the box (of `count`, stacked top to bottom in document order) that holds client `y`,
 * or the nearest one when `y` lies in a gap or beyond the ends. `edgesAt(i)` reads box i's
 * vertical edges; only O(log n) boxes are read. -1 when there are no boxes.
 */
export function nearestZoomAnchorIndex(
  count: number,
  edgesAt: (index: number) => { top: number; bottom: number },
  y: number,
): number {
  if (count <= 0) return -1
  // First box whose bottom edge is below y.
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (edgesAt(mid).bottom <= y) lo = mid + 1
    else hi = mid
  }
  if (lo === 0) return 0
  const box = edgesAt(lo)
  if (y >= box.top) return lo
  // In the gap above box `lo` (or below the last box): the closer of the two neighbours.
  const above = edgesAt(lo - 1)
  return y - above.bottom <= box.top - y ? lo - 1 : lo
}

/** The document point at client (`x`, `y`), expressed against box `index` laid out at `box`. */
export function zoomAnchorAt(index: number, box: ZoomAnchorBox, x: number, y: number): ZoomAnchor {
  return {
    index,
    fx: box.width > 0 ? (x - box.left) / box.width : 0,
    fy: box.height > 0 ? (y - box.top) / box.height : 0,
  }
}

/**
 * Scroll offset that brings `anchor` back under client point (`x`, `y`), given the anchor box's
 * client rect `box` measured at the current `scroll` (i.e. after the relayout). The host clamps
 * by assigning it to its scroll container.
 */
export function scrollToHoldZoomAnchor(
  scroll: ScrollOffset,
  box: ZoomAnchorBox,
  anchor: ZoomAnchor,
  x: number,
  y: number,
): ScrollOffset {
  return {
    left: scroll.left + box.left + anchor.fx * box.width - x,
    top: scroll.top + box.top + anchor.fy * box.height - y,
  }
}

export type FitMetrics = {
  viewportWidth: number
  viewportHeight: number
  /** Unscaled content width (natural page width). */
  contentWidth: number
  /** Unscaled content height (natural page height). */
  contentHeight: number
}

export function zoomForLayoutPreset(
  preset: ZoomLayoutPreset,
  metrics: FitMetrics,
): number {
  const { viewportWidth: vw, viewportHeight: vh, contentWidth: cw, contentHeight: ch } =
    metrics
  if (vw <= 0 || vh <= 0 || cw <= 0 || ch <= 0) return ZOOM_DEFAULT

  switch (preset) {
    case 'actual-size':
      return ZOOM_DEFAULT
    case 'fit-width':
      return clampZoom(vw / cw)
    case 'fit-page':
      return clampZoom(Math.min(vw / cw, vh / ch))
    case 'fit-visible':
      // Slightly larger than Fit Page so edges sit near the viewport (Adobe-style).
      return clampZoom(Math.min(vw / cw, vh / ch) * 1.04)
    default:
      return ZOOM_DEFAULT
  }
}

/** Wheel delta → multiplicative zoom factor (smooth, direction-aware). */
export function zoomFactorFromWheelDelta(deltaY: number): number {
  const direction = deltaY > 0 ? -1 : 1
  // ~10% per notch; clamp extreme trackpad deltas.
  const magnitude = Math.min(Math.abs(deltaY), 120) / 120
  const step = 1 + 0.1 * magnitude
  return direction > 0 ? step : 1 / step
}

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

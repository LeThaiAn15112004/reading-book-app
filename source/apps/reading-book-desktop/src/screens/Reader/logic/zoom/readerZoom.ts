/** Viewport zoom for the reader surface (independent of Aa font-size). Math lives in the SDK. */
import { focalZoomScroll, type ZoomFocalPoint } from '@reading-book/book-reader-sdk'

export {
  ZOOM_DEFAULT,
  ZOOM_LAYOUT_PRESETS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PERCENT_PRESETS,
  ZOOM_STEP_FACTOR,
  clampZoom,
  formatZoomPercent,
  parseZoomPercentInput,
  stepZoom,
  zoomFactorFromWheelDelta,
  zoomForLayoutPreset,
  zoomFromPercent,
  zoomToPercent,
  type FitMetrics,
  type ZoomFocalPoint,
  type ZoomLayoutPreset,
} from '@reading-book/book-reader-sdk'

/**
 * Keep the document point under the cursor fixed while changing scale.
 * Uses scrollLeft/scrollTop on an overflow viewport (scaler grows with zoom).
 */
export function scrollAfterFocalZoom(
  viewport: HTMLElement,
  oldZoom: number,
  newZoom: number,
  focal: ZoomFocalPoint,
): void {
  const next = focalZoomScroll(
    { left: viewport.scrollLeft, top: viewport.scrollTop },
    oldZoom,
    newZoom,
    focal,
  )
  viewport.scrollLeft = next.left
  viewport.scrollTop = next.top
}

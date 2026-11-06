/** PDF points → CSS px (72 → 96 dpi), so zoom 100% is the page's real size. */
export const PDF_TO_CSS = 96 / 72
/** Space between pages (and above the page `goToPage` scrolls to), at zoom 100%. */
export const PAGE_GAP_PX = 12
/** Padding around the page column, at zoom 100%. */
export const PAD_PX = 16

/** A page's size in CSS px at zoom 100% (`PdfRendererApi.measurePage`). */
export type PdfPageCssSize = { width: number; height: number }

/**
 * Zoom at which one page fills the reading viewport: the page plus its side padding fits the width,
 * and the page plus the gap `goToPage` leaves above it (and the same below) fits the height.
 * Padding and gap scale with zoom like the page does, so they join the page in the divisor.
 * Floored to 0.1% so pixel rounding never leaves a sliver of scroll. Null for unusable input.
 */
export function pdfFitPageZoom(
  page: PdfPageCssSize,
  viewportWidth: number,
  viewportHeight: number,
): number | null {
  if (!(page.width > 0 && page.height > 0 && viewportWidth > 0 && viewportHeight > 0)) return null
  const zoom = Math.min(
    viewportWidth / (page.width + 2 * PAD_PX),
    viewportHeight / (page.height + 2 * PAGE_GAP_PX),
  )
  return Math.floor(zoom * 1000) / 1000
}

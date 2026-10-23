/**
 * Where, between two glyphs of a PDF page, a click means "insert text here" (Inserted Text tool).
 *
 * PDF.js gives no per-character geometry, only the text layer: one absolutely-positioned span per
 * glyph run, each holding a single text node. The insertion point is therefore found in two steps —
 * the run under the pointer (or the nearest run when the click lands in a gap), then the character
 * boundary of that run closest to the pointer, measured with a `Range`. The result is normalized to
 * the page slot, so it survives zoom and window resizes (docs/implementation_plan/pdf_inserted_text.md).
 */

/** A click farther than this from any glyph run (px) is not an insertion point. */
const MAX_DISTANCE_PX = 48

export type PdfInsertionPoint = {
  /** 1-based page. */
  page: number
  /** Insertion x as a fraction of the page width. */
  x: number
  /** Bottom edge of the glyph run as a fraction of the page height. */
  lineBottom: number
  /** Height of the glyph run as a fraction of the page height. */
  lineHeight: number
  /** Page width / height of the displayed page box. */
  aspect: number
  /** The same point on screen — only to anchor the editor next to it. */
  client: { x: number; bottom: number }
}

function textNodeOf(span: Element): Text | null {
  for (const child of span.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && (child.textContent?.length ?? 0) > 0) return child as Text
  }
  return null
}

/** Distance (px) from a point to a box; 0 inside it. Vertical misses weigh double: lines are the unit. */
function distanceToBox(rect: DOMRect, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right)
  const dy = Math.max(rect.top - y, 0, y - rect.bottom)
  return dx + dy * 2
}

/** The glyph run (with text) the point is in, else the nearest one on the page within reach. */
function runAt(slot: HTMLElement, x: number, y: number): { span: HTMLElement; text: Text; rect: DOMRect } | null {
  const layer = slot.querySelector('.textLayer')
  if (!layer) return null
  let best: { span: HTMLElement; text: Text; rect: DOMRect; distance: number } | null = null
  for (const span of layer.querySelectorAll<HTMLElement>('span')) {
    const text = textNodeOf(span)
    if (!text) continue
    const rect = span.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    const distance = distanceToBox(rect, x, y)
    if (!best || distance < best.distance) best = { span, text, rect, distance }
    if (distance === 0) break
  }
  return best && best.distance <= MAX_DISTANCE_PX ? best : null
}

/** Client x of the boundary BEFORE character `offset` (`text.length` = the end of the run). */
function boundaryX(range: Range, text: Text, offset: number): number | null {
  const length = text.length
  const index = Math.min(offset, length - 1)
  range.setStart(text, index)
  range.setEnd(text, index + 1)
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  if (!rect || (rect.width === 0 && rect.height === 0)) return null
  return offset >= length ? rect.right : rect.left
}

/** The boundary of `text` nearest to client `x`. */
function nearestBoundaryX(text: Text, x: number): number | null {
  const range = document.createRange()
  try {
    let best: number | null = null
    for (let offset = 0; offset <= text.length; offset++) {
      const bx = boundaryX(range, text, offset)
      if (bx === null) continue
      if (best === null || Math.abs(bx - x) < Math.abs(best - x)) best = bx
    }
    return best
  } finally {
    range.detach()
  }
}

/** The insertion point under client (`x`, `y`) inside `root`, or null when no text is near enough. */
export function readPdfInsertionPoint(root: HTMLElement, x: number, y: number): PdfInsertionPoint | null {
  const slot = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-page-number]')
  if (!slot || !root.contains(slot)) return null
  const page = Number(slot.dataset.pageNumber)
  const box = slot.getBoundingClientRect()
  if (!Number.isFinite(page) || box.width <= 0 || box.height <= 0) return null

  const run = runAt(slot, x, y)
  if (!run) return null
  const caretX = nearestBoundaryX(run.text, x)
  if (caretX === null) return null

  return {
    page,
    x: (caretX - box.left) / box.width,
    lineBottom: (run.rect.bottom - box.top) / box.height,
    lineHeight: run.rect.height / box.height,
    aspect: box.width / box.height,
    client: { x: caretX, bottom: run.rect.bottom },
  }
}

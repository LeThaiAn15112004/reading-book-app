/**
 * Where a text offset is on screen, measured on the TXT surface's backdrop layer.
 *
 * The backdrop is a normal block of selectable-looking text laid out exactly like the text box on
 * top of it (same box, font and wrapping — see txt.css), made of one `<span data-start data-end>`
 * per segment. A `<textarea>` has no DOM text nodes to measure, so every offset ↔ pixel question
 * (scroll position, popup anchors, "scroll this annotation into view") is answered here.
 */

export type ClientBox = { top: number; left: number; right: number; bottom: number; width: number; height: number }

function segmentSpans(backdrop: HTMLElement): HTMLElement[] {
  return Array.from(backdrop.children) as HTMLElement[]
}

/** The text node and local offset of `offset` (the last segment that still contains it). */
function pointFor(backdrop: HTMLElement, offset: number): { node: Text; offset: number } | null {
  const spans = segmentSpans(backdrop)
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!
    const start = Number(span.dataset.start)
    const end = Number(span.dataset.end)
    if (offset < start || offset > end) continue
    // A boundary belongs to the next segment unless this is the last one.
    if (offset === end && i < spans.length - 1) continue
    const node = span.firstChild
    if (node && node.nodeType === Node.TEXT_NODE) return { node: node as Text, offset: offset - start }
  }
  return null
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/** A range covering `[start, end)` of the canonical text, or null while the backdrop is empty. */
export function rangeForOffsets(backdrop: HTMLElement, start: number, end: number, text: string): Range | null {
  const a = pointFor(backdrop, start)
  const b = pointFor(backdrop, end)
  if (!a || !b) return null
  void text
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  return range
}

/** Client-space rects of `[start, end)` (one per line box). */
export function rectsForOffsets(backdrop: HTMLElement, start: number, end: number, text: string): DOMRect[] {
  const range = rangeForOffsets(backdrop, start, end, text)
  return range ? Array.from(range.getClientRects()) : []
}

/** Union of the rects of `[start, end)`, or null. */
export function boxForOffsets(backdrop: HTMLElement, start: number, end: number, text: string): ClientBox | null {
  const rects = rectsForOffsets(backdrop, start, end, text).filter((r) => r.width > 0 || r.height > 0)
  if (rects.length === 0) return null
  const top = Math.min(...rects.map((r) => r.top))
  const left = Math.min(...rects.map((r) => r.left))
  const right = Math.max(...rects.map((r) => r.right))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  return { top, left, right, bottom, width: right - left, height: bottom - top }
}

/** Top (client px) of the line holding the character at `offset`; null when it can't be measured. */
export function lineTopAt(backdrop: HTMLElement, offset: number, text: string): number | null {
  if (text.length === 0) return backdrop.getBoundingClientRect().top
  const at = Math.min(Math.max(offset, 0), text.length - 1)
  const width = isHighSurrogate(text.charCodeAt(at)) && at + 2 <= text.length ? 2 : 1
  const range = rangeForOffsets(backdrop, at, at + width, text)
  const rect = range?.getClientRects()[0] ?? range?.getBoundingClientRect()
  return rect ? rect.top : null
}

/**
 * First character whose line starts at or below `clientY` — the offset the saved reading position
 * points at. Binary search over offsets: line tops never decrease along the text.
 */
export function offsetAtClientY(backdrop: HTMLElement, clientY: number, text: string): number {
  if (text.length === 0) return 0
  let low = 0
  let high = text.length - 1
  let answer = text.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const top = lineTopAt(backdrop, mid, text)
    if (top === null) return 0
    if (top >= clientY - 0.5) {
      answer = mid
      high = mid - 1
    } else {
      low = mid + 1
    }
  }
  // Snap back to the start of that line so the saved offset is stable between scroll positions.
  let start = answer
  const lineTop = lineTopAt(backdrop, answer, text)
  while (start > 0 && lineTop !== null) {
    const previous = lineTopAt(backdrop, start - 1, text)
    if (previous === null || Math.abs(previous - lineTop) > 0.5) break
    start -= 1
    if (answer - start > 400) break
  }
  return start
}

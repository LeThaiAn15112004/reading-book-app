/**
 * EPUB Page view: selecting text across pages (spec 019).
 *
 * epub.js lays a section out as CSS columns in a box with `overflow: hidden`; a "page" is only `scrollLeft`, a multiple
 * of the page step. Dragging a selection to an edge made the browser scroll a box by however far the finger pushed, so
 * the page stopped half-way between two pages — and epub.js turns by adding one step to the current `scrollLeft`, so
 * the offset stayed on every later page.
 *
 * Rule, while a selection is live:
 *   1. The browser never moves the page: any scroll it makes is put back (`alignedPageScrollLeft`).
 *   2. The app turns instead: when the selection's moving end (its focus) has reached the END of the page (the last
 *      lines, or past the page) — or the START of the page when selecting backwards — and stays there for
 *      `SELECTION_EDGE_DWELL_MS`, ONE whole page turns in that direction (`selectionEdgeAt`).
 * Pure: the caller measures the DOM, runs the timer and applies the turn.
 */

/** The selection's end must stay at a page edge this long before the page turns. */
export const SELECTION_EDGE_DWELL_MS = 500
/** "The last lines": the focus line's bottom within this many line heights of the page's text bottom (top for back). */
export const SELECTION_EDGE_LINES = 1.5
/** Sub-pixel rounding of `scrollLeft` is not a drift. */
export const PAGE_ALIGN_EPSILON_PX = 1

export type SelectionEdge = 'next' | 'prev'

/** All in the same (outer, CSS px) coordinates. */
export interface SelectionEdgeInput {
  /** The focus (moving end) of the selection: a caret box. */
  focus: { left: number; top: number; bottom: number }
  /** True when the focus is after the anchor (selecting forwards). */
  forward: boolean
  /** What the reader sees of the section: the paginated box. */
  visible: { left: number; right: number }
  /** Top / bottom of the page's text (inside the page margins). */
  text: { top: number; bottom: number }
  /** One column (one page of a spread). */
  columnWidth: number
  /** Line height at the focus. */
  lineHeight: number
}

/**
 * Has the selection's moving end reached the edge it is moving towards? Forwards: past the page on the right, or on the
 * last lines of the last column shown. Backwards: past the page on the left, or on the first lines of the first column
 * shown. Only the direction the selection grows in counts, so the focus left behind on the previous page after a turn
 * never turns back.
 */
export function selectionEdgeAt(input: SelectionEdgeInput): SelectionEdge | null {
  const { focus, visible, text } = input
  const zone = Math.max(0, input.lineHeight) * SELECTION_EDGE_LINES
  const column = input.columnWidth > 0 ? input.columnWidth : visible.right - visible.left
  if (input.forward) {
    if (focus.left >= visible.right - PAGE_ALIGN_EPSILON_PX) return 'next'
    const inLastColumn = focus.left >= visible.right - column && focus.left >= visible.left
    return inLastColumn && focus.bottom >= text.bottom - zone ? 'next' : null
  }
  if (focus.left < visible.left - PAGE_ALIGN_EPSILON_PX) return 'prev'
  const inFirstColumn = focus.left < visible.left + column && focus.left < visible.right
  return inFirstColumn && focus.top <= text.top + zone ? 'prev' : null
}

/** Index (0-based, within the section) of the page `scrollLeft` is on or closest to. */
export function pageIndexAt(scrollLeft: number, pageStep: number, maxScrollLeft: number): number {
  if (!(pageStep > 0)) return 0
  const lastPage = Math.max(0, Math.ceil((Math.max(0, maxScrollLeft) - PAGE_ALIGN_EPSILON_PX) / pageStep))
  return Math.min(lastPage, Math.max(0, Math.round(scrollLeft / pageStep)))
}

/** `scrollLeft` of 0-based `page` (the last page may end short of a full step). */
export function pageScrollLeft(page: number, pageStep: number, maxScrollLeft: number): number {
  return Math.max(0, Math.min(page * pageStep, Math.max(0, maxScrollLeft)))
}

/** `scrollLeft` of the page after / before `page`, clamped to the section; null when there is none that way. */
export function turnedPageScrollLeft(
  page: number,
  direction: SelectionEdge,
  pageStep: number,
  maxScrollLeft: number,
): number | null {
  if (!(pageStep > 0)) return null
  const lastPage = pageIndexAt(Number.MAX_SAFE_INTEGER, pageStep, maxScrollLeft)
  const target = page + (direction === 'next' ? 1 : -1)
  if (target < 0 || target > lastPage) return null
  return pageScrollLeft(target, pageStep, maxScrollLeft)
}

/** Is `scrollLeft` on a page boundary? */
export function isPageAligned(scrollLeft: number, pageStep: number, maxScrollLeft: number): boolean {
  if (!(pageStep > 0)) return true
  const page = pageIndexAt(scrollLeft, pageStep, maxScrollLeft)
  return Math.abs(scrollLeft - pageScrollLeft(page, pageStep, maxScrollLeft)) <= PAGE_ALIGN_EPSILON_PX
}

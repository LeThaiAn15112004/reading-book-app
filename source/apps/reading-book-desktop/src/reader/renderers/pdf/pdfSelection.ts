/**
 * Text selection on the PDF surface (the PDF.js text layer), read for the selection context menu.
 *
 * PDF has no CFI: a selection is anchored by its 1-based page(s) plus page-relative rectangles
 * (fractions of the page slot, so they survive zoom and scroll). The text layer lives in the
 * Reader's own document (no iframe, no CSS transform — `ReaderZoomViewport mode="native"`), so the
 * rects a Range reports are already outer-window client coordinates.
 */

const TEXT_NODE = 3
/** Slack around a glyph run when hit-testing a right-click against the selection. */
const HIT_SLOP_PX = 2

/** A selection rect on one page, as fractions (0–1) of that page's width / height. */
export type PdfSelectionPageRect = {
  /** 1-based page number. */
  page: number
  x: number
  y: number
  width: number
  height: number
}

export type PdfSelectionInfo = {
  text: string
  /** 1-based first / last page the selection touches (equal for a single-page selection). */
  pageStart: number
  pageEnd: number
  /** Page-relative rectangles of the selected glyph runs — the PDF anchor (never a CFI). */
  rects: PdfSelectionPageRect[]
  /** No language metadata is read from the PDF; the translation flow falls back to detection. */
  lang: string
}

type ClientRect = { left: number; top: number; right: number; bottom: number }

/** The page slot (`data-page-number`) a node sits in, or null outside the pages. */
function pageSlotOf(node: Node | null): HTMLElement | null {
  const el = node?.nodeType === TEXT_NODE ? node.parentElement : (node as Element | null)
  return el?.closest<HTMLElement>('[data-page-number]') ?? null
}

/**
 * Client rects of the selected *text* only. `Range.getClientRects()` also returns the boxes of
 * whole elements inside the range (PDF.js's `.endOfContent` filler, the text layer div itself),
 * which would make a right-click on empty page area count as "inside the selection".
 */
function selectedTextRects(range: Range, root: HTMLElement): DOMRect[] {
  const rects: DOMRect[] = []
  const container = range.commonAncestorContainer
  const scope = container.nodeType === TEXT_NODE ? container.parentNode : container
  if (!scope) return rects
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
  const piece = document.createRange()
  for (let node = walker.currentNode; node; node = walker.nextNode() as Node) {
    if (node.nodeType !== TEXT_NODE || !range.intersectsNode(node) || !root.contains(node)) continue
    const text = node as Text
    if (!text.parentElement?.closest('.textLayer')) continue
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : text.length
    if (end <= start) continue
    piece.setStart(text, start)
    piece.setEnd(text, end)
    for (const rect of piece.getClientRects()) {
      if (rect.width > 0.5 && rect.height > 0.5) rects.push(rect)
    }
  }
  piece.detach()
  return rects
}

/** The live selection's Range when it is a non-empty text selection inside `root`. */
function liveRange(root: HTMLElement): Range | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  if (selection.toString().trim() === '') return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  return range
}

function contains(rect: ClientRect, x: number, y: number): boolean {
  return (
    x >= rect.left - HIT_SLOP_PX &&
    x <= rect.right + HIT_SLOP_PX &&
    y >= rect.top - HIT_SLOP_PX &&
    y <= rect.bottom + HIT_SLOP_PX
  )
}

/**
 * The selection under a right-click at client (`x`, `y`): null when there is no text selection in
 * the PDF, or the point is outside every selected glyph run.
 */
export function readPdfSelectionAt(root: HTMLElement, x: number, y: number): PdfSelectionInfo | null {
  const range = liveRange(root)
  if (!range) return null
  const rects = selectedTextRects(range, root)
  if (!rects.some((rect) => contains(rect, x, y))) return null

  const startSlot = pageSlotOf(range.startContainer)
  const endSlot = pageSlotOf(range.endContainer)
  const pageStart = Number(startSlot?.dataset.pageNumber)
  const pageEnd = Number(endSlot?.dataset.pageNumber)
  if (!Number.isFinite(pageStart) || !Number.isFinite(pageEnd)) return null

  const pageRects: PdfSelectionPageRect[] = []
  const slots = root.querySelectorAll<HTMLElement>('[data-page-number]')
  for (const slot of slots) {
    const page = Number(slot.dataset.pageNumber)
    if (page < pageStart || page > pageEnd) continue
    const box = slot.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) continue
    for (const rect of rects) {
      const cx = (rect.left + rect.right) / 2
      const cy = (rect.top + rect.bottom) / 2
      if (cx < box.left || cx > box.right || cy < box.top || cy > box.bottom) continue
      pageRects.push({
        page,
        x: (rect.left - box.left) / box.width,
        y: (rect.top - box.top) / box.height,
        width: rect.width / box.width,
        height: rect.height / box.height,
      })
    }
  }

  return {
    text: range.toString().trim(),
    pageStart,
    pageEnd,
    rects: pageRects,
    lang: '',
  }
}

/** "p. 12" / "pp. 12–13" — the PDF location used in a citation. */
export function pdfSelectionPageLabel(selection: Pick<PdfSelectionInfo, 'pageStart' | 'pageEnd'>): string {
  return selection.pageStart === selection.pageEnd
    ? `p. ${selection.pageStart}`
    : `pp. ${selection.pageStart}–${selection.pageEnd}`
}

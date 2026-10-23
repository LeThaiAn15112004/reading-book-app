/**
 * DOM side of Markdown annotations (docs/implementation_plan/markdown_reader.md §5): turning a live
 * selection / click into a layout-independent anchor, turning an anchor back into a `Range`, and painting
 * the marks with the CSS Custom Highlight API (nothing is inserted into the rendered text).
 *
 * Anchor rule (see `MdAnnotation` in the SDK): the document is rendered in pieces, each wrapped in an
 * element with `data-md-seg="<index>"`; a point is `(piece, offset)` where `offset` is the UTF-16 length
 * of the text from the start of that piece to the point (`Range#toString`, i.e. the piece's text nodes
 * in document order). Font, width, theme and zoom never change it.
 */
import { compareMdPoints, mdQuoteMatches, type HighlightStyleKind, type MdPoint } from '@reading-book/book-reader-sdk'

/** Attribute on each rendered piece. */
export const MD_SEG_ATTR = 'data-md-seg'

/** What a mark needs to be located and drawn (a `MdReaderHighlight` fits). */
export type MdMark = {
  id: string
  styleKind: HighlightStyleKind
  colorHex: string
  startSegment: number
  startOffset: number
  endSegment: number
  endOffset: number
  caret?: true
  /** The quote the mark was made on — a mark whose text no longer matches is not drawn. */
  selectionText?: { highlight?: string }
}

export type MdClientBox = { top: number; left: number; right: number; bottom: number; width: number; height: number }

/** A finished text selection inside the Markdown surface. */
export type MdSelectionInfo = {
  start: MdPoint
  end: MdPoint
  text: string
  /** Text just before / after the selection (for the stored quote context). */
  before: string
  after: string
  box: MdClientBox | null
}

/** An insertion point (Inserted Text): where a click landed between two characters. */
export type MdInsertionInfo = {
  point: MdPoint
  before: string
  after: string
  /** Screen position of the point: x, the line's top / bottom — to place the editor and the caret. */
  client: { x: number; top: number; bottom: number }
}

function toBox(r: DOMRect): MdClientBox {
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
}

export function segmentElementOf(node: Node | null): HTMLElement | null {
  const el = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node?.parentElement ?? null)
  return el?.closest<HTMLElement>(`[${MD_SEG_ATTR}]`) ?? null
}

/** The anchor point of a DOM boundary (`container`, `offset`), or null outside every piece. */
export function pointFromBoundary(container: Node, offset: number): MdPoint | null {
  const seg = segmentElementOf(container)
  if (!seg) return null
  const range = document.createRange()
  try {
    range.setStart(seg, 0)
    range.setEnd(container, offset)
  } catch {
    return null
  }
  const segment = Number(seg.getAttribute(MD_SEG_ATTR))
  return Number.isInteger(segment) ? { segment, offset: range.toString().length } : null
}

function segmentText(seg: HTMLElement): string {
  const range = document.createRange()
  range.selectNodeContents(seg)
  return range.toString()
}

type DomPoint = { node: Node; offset: number }

/**
 * The DOM boundary of text offset `offset` inside `seg`. At the seam between two text nodes a range
 * START takes the next node's first position, an END the previous node's last.
 */
function domPointFor(seg: HTMLElement, offset: number, bias: 'start' | 'end'): DomPoint | null {
  const walker = document.createTreeWalker(seg, NodeFilter.SHOW_TEXT)
  let seen = 0
  let last: Text | null = null
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const length = node.data.length
    if (offset < seen + length || (offset === seen + length && bias === 'end')) {
      return { node, offset: offset - seen }
    }
    seen += length
    last = node
  }
  return last ? { node: last, offset: last.data.length } : null
}

function segmentMap(article: HTMLElement): Map<number, HTMLElement> {
  const map = new Map<number, HTMLElement>()
  for (const el of article.querySelectorAll<HTMLElement>(`[${MD_SEG_ATTR}]`)) {
    map.set(Number(el.getAttribute(MD_SEG_ATTR)), el)
  }
  return map
}

function rangeFromMap(
  segments: Map<number, HTMLElement>,
  start: MdPoint,
  end: MdPoint,
): Range | null {
  const startSeg = segments.get(start.segment)
  const endSeg = segments.get(end.segment)
  if (!startSeg || !endSeg) return null
  const from = domPointFor(startSeg, start.offset, 'start')
  const to = domPointFor(endSeg, end.offset, 'end')
  if (!from || !to) return null
  const range = document.createRange()
  try {
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
  } catch {
    return null
  }
  return range
}

/** The `Range` of an anchor, or null while its piece is not mounted yet. */
export function rangeForAnchor(article: HTMLElement, start: MdPoint, end: MdPoint): Range | null {
  return rangeFromMap(segmentMap(article), start, end)
}

/** The current selection, when it is a non-empty text selection inside `article`. */
export function readMdSelection(article: HTMLElement): MdSelectionInfo | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!article.contains(range.startContainer) || !article.contains(range.endContainer)) return null
  const text = range.toString()
  if (text.trim() === '') return null
  const start = pointFromBoundary(range.startContainer, range.startOffset)
  const end = pointFromBoundary(range.endContainer, range.endOffset)
  if (!start || !end || compareMdPoints(start, end) >= 0) return null
  const startSeg = segmentElementOf(range.startContainer)!
  const endSeg = segmentElementOf(range.endContainer)!
  return {
    start,
    end,
    text,
    before: segmentText(startSeg).slice(Math.max(0, start.offset - 32), start.offset),
    after: segmentText(endSeg).slice(end.offset, end.offset + 32),
    box: toBox(range.getBoundingClientRect()),
  }
}

type CaretHit = { node: Node; offset: number }

function caretAtPoint(x: number, y: number): CaretHit | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const pos = doc.caretPositionFromPoint?.(x, y)
  if (pos) return { node: pos.offsetNode, offset: pos.offset }
  const range = doc.caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : null
}

/** Box of the line the point sits on: a collapsed range, else the neighbouring character. */
function lineBoxAt(node: Node, offset: number): DOMRect | null {
  const range = document.createRange()
  try {
    range.setStart(node, offset)
    range.collapse(true)
    const rect = range.getClientRects()[0]
    if (rect && rect.height > 0) return rect
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node as Text).data.length
      if (length === 0) return null
      const from = Math.min(offset, length - 1)
      range.setStart(node, from)
      range.setEnd(node, from + 1)
      const rect2 = range.getClientRects()[0]
      if (rect2 && rect2.height > 0) return rect2
    }
  } catch {
    return null
  }
  return null
}

/** The insertion point under client (`x`, `y`) inside `article` (text only), or null. */
export function insertionPointAt(article: HTMLElement, x: number, y: number): MdInsertionInfo | null {
  const hit = caretAtPoint(x, y)
  if (!hit || !article.contains(hit.node)) return null
  if (hit.node.nodeType !== Node.TEXT_NODE) return null
  const point = pointFromBoundary(hit.node, hit.offset)
  const seg = segmentElementOf(hit.node)
  if (!point || !seg) return null
  const line = lineBoxAt(hit.node, hit.offset)
  if (!line) return null
  // A click far from the line it landed on (blank space below the text) is not an insertion point.
  if (y < line.top - 24 || y > line.bottom + 24) return null
  const text = segmentText(seg)
  return {
    point,
    before: text.slice(Math.max(0, point.offset - 32), point.offset),
    after: text.slice(point.offset, point.offset + 32),
    client: { x: line.left, top: line.top, bottom: line.bottom },
  }
}

/**
 * The text point at the top of the reading area: where `article` is cut by `y` (client px). A line of
 * margin or an image there has no text, so a few rows further down are tried.
 */
export function pointAtTop(article: HTMLElement, x: number, top: number): MdPoint | null {
  for (const dy of [24, 48, 72, 104, 140]) {
    const hit = caretAtPoint(x, top + dy)
    if (!hit || !article.contains(hit.node) || hit.node.nodeType !== Node.TEXT_NODE) continue
    const point = pointFromBoundary(hit.node, hit.offset)
    if (point) return point
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------------

const STYLE_ID = 'md-annotation-styles'
const NAME_PREFIX = 'md-a-'

type HighlightRegistry = {
  set(name: string, value: unknown): unknown
  delete(name: string): boolean
}
type HighlightCtor = new (...ranges: Range[]) => { priority: number }

function highlightHost(): { registry: HighlightRegistry; Highlight: HighlightCtor } | null {
  const win = window as unknown as { CSS?: { highlights?: HighlightRegistry }; Highlight?: HighlightCtor }
  const registry = win.CSS?.highlights
  if (!registry || !win.Highlight) return null
  return { registry, Highlight: win.Highlight }
}

/** A color that is safe to put in a stylesheet: `#rgb[a]` / `#rrggbb[aa]` only. */
function safeColor(hex: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(hex.trim()) ? hex.trim() : '#ffeb3b'
}

function ruleFor(mark: MdMark): string {
  const c = safeColor(mark.colorHex)
  switch (mark.styleKind) {
    case 'highlight':
      return `background-color: color-mix(in srgb, ${c} 46%, transparent);`
    case 'underline':
      return `text-decoration: underline solid ${c} 2px;`
    case 'strikethrough':
      return `text-decoration: line-through solid ${c} 2px;`
    case 'squiggly':
      return `text-decoration: underline wavy ${c} 2px;`
    case 'replace':
      return `text-decoration: line-through dashed ${c} 2px;`
    case 'insert':
      return `text-decoration: underline dashed ${c} 2px;`
    case 'textbox':
      return `background-color: color-mix(in srgb, ${c} 22%, transparent); text-decoration: underline dotted ${c} 2px;`
  }
}

/** Names registered by the last paint — cleared before the next one (and when the surface goes away). */
let paintedNames: string[] = []

export type MdPainted = {
  /** Range of every drawn text mark (an insertion point has none). */
  ranges: Map<string, Range>
  /** Insertion points: their ids with the collapsed range they sit at. */
  carets: { id: string; range: Range }[]
  /** Marks left out because their text no longer matches (file changed) or their piece is not mounted. */
  hidden: Set<string>
}

/**
 * Paint `marks` over `article` and report where they are. Marks whose piece is not mounted yet are
 * skipped (they appear once it mounts); marks whose quote no longer matches the text are hidden, never
 * moved to look-alike text.
 */
export function paintMdMarks(article: HTMLElement, marks: readonly MdMark[]): MdPainted {
  const segments = segmentMap(article)
  const ranges = new Map<string, Range>()
  const carets: { id: string; range: Range }[] = []
  const hidden = new Set<string>()
  const css: string[] = []
  const host = highlightHost()
  clearMdMarkPaint()

  marks.forEach((mark, index) => {
    const start = { segment: mark.startSegment, offset: mark.startOffset }
    const end = { segment: mark.endSegment, offset: mark.endOffset }
    const range = rangeFromMap(segments, start, end)
    if (!range) return
    if (mark.caret) {
      carets.push({ id: mark.id, range })
      return
    }
    if (!mdQuoteMatches(range.toString(), mark.selectionText?.highlight)) {
      hidden.add(mark.id)
      return
    }
    ranges.set(mark.id, range)
    if (!host) return
    const name = `${NAME_PREFIX}${index}`
    const highlight = new host.Highlight(range)
    highlight.priority = index
    host.registry.set(name, highlight)
    paintedNames.push(name)
    css.push(`::highlight(${name}) { ${ruleFor(mark)} }`)
  })

  if (css.length > 0) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = css.join('\n')
    document.head.appendChild(style)
  }
  return { ranges, carets, hidden }
}

/** Remove every mark this module painted. */
export function clearMdMarkPaint(): void {
  document.getElementById(STYLE_ID)?.remove()
  const host = highlightHost()
  if (host) for (const name of paintedNames) host.registry.delete(name)
  paintedNames = []
}

/** The topmost drawn mark whose painted text is under client (`x`, `y`). */
export function markAtPoint(ranges: ReadonlyMap<string, Range>, order: readonly string[], x: number, y: number): string | null {
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!
    const range = ranges.get(id)
    if (!range) continue
    for (const r of range.getClientRects()) {
      if (r.width > 0 && x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1) return id
    }
  }
  return null
}

/** Union client box of a range (for anchoring an editor to a mark). */
export function boxOfRange(range: Range): MdClientBox | null {
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0)
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((r) => r.left))
  const top = Math.min(...rects.map((r) => r.top))
  const right = Math.max(...rects.map((r) => r.right))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  return { top, left, right, bottom, width: right - left, height: bottom - top }
}

/** The line box of a collapsed insertion range (for placing its caret). */
export function lineBoxOfCollapsed(range: Range): DOMRect | null {
  return lineBoxAt(range.startContainer, range.startOffset)
}

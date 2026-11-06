import { segmentSectionText, type ReadAloudSegment } from '@reading-book/book-reader-sdk'
import { buildSectionTextIndex, rangeForMatch, type SectionTextIndex } from '../search/epubSearchDom'

/**
 * Read-aloud text for the EPUB surface: a section's DOM text (same walk as search) split into
 * sentence-sized segments by the SDK's `segmentSectionText`, plus the "sentence being read"
 * highlight painted with the CSS Custom Highlight API — no DOM mutation, so CFIs and user
 * highlights are untouched.
 */

export type SectionReadAloudData = {
  index: SectionTextIndex
  segments: ReadAloudSegment[]
}

const CURRENT = 'rb-tts-current'
const STYLE_ID = 'rb-tts-highlight-style'
const HIGHLIGHT_CSS = `::highlight(${CURRENT}) { background-color: rgba(80, 150, 255, 0.35); }`

const cache = new WeakMap<Document, SectionReadAloudData>()

/** Deterministic per document, so a re-rendered section yields the same segment indices. */
export function readAloudDataFor(doc: Document, lang: string): SectionReadAloudData {
  const cached = cache.get(doc)
  if (cached) return cached
  const index = buildSectionTextIndex(doc)
  const data = { index, segments: segmentSectionText(index.text, lang) }
  cache.set(doc, data)
  return data
}

export function rangeForSegment(doc: Document, data: SectionReadAloudData, i: number): Range | null {
  const segment = data.segments[i]
  return segment ? rangeForMatch(doc, data.index, segment) : null
}

/** Offset in `index.text` of a DOM boundary point (first indexed character at or after it). */
export function textOffsetOfBoundary(
  doc: Document,
  index: SectionTextIndex,
  node: Node,
  offset: number,
): number {
  if (node.nodeType === Node.TEXT_NODE) {
    const i = index.nodes.indexOf(node as Text)
    if (i >= 0) return (index.starts[i] ?? 0) + Math.min(offset, (node as Text).length)
  }
  const point = doc.createRange()
  try {
    point.setStart(node, offset)
  } catch {
    return 0
  }
  let lo = 0
  let hi = index.nodes.length - 1
  let found = index.nodes.length
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const candidate = index.nodes[mid]
    // comparePoint: 1 = the text node starts after the boundary.
    if (candidate && point.comparePoint(candidate, 0) >= 0) {
      found = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }
  return found < index.nodes.length ? (index.starts[found] ?? 0) : index.text.length
}

type HighlightHost = {
  CSS?: { highlights?: { set(name: string, value: unknown): unknown; delete(name: string): boolean } }
  Highlight?: new (...ranges: Range[]) => { priority: number }
}

export function paintReadAloudHighlight(doc: Document, range: Range | null): void {
  const host = doc.defaultView as (Window & HighlightHost) | null
  const registry = host?.CSS?.highlights
  const HighlightCtor = host?.Highlight
  if (!registry || !HighlightCtor) return
  if (!range) {
    registry.delete(CURRENT)
    return
  }
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style')
    style.id = STYLE_ID
    style.textContent = HIGHLIGHT_CSS
    ;(doc.head ?? doc.documentElement).appendChild(style)
  }
  const highlight = new HighlightCtor(range)
  highlight.priority = 2
  registry.set(CURRENT, highlight)
}

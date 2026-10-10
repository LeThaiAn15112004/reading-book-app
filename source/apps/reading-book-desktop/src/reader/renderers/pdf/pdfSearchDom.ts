import type { TextMatcher } from '@reading-book/book-reader-sdk'
import { rangeForMatch, type SectionTextIndex } from '../epub/search/epubSearchDom'

/**
 * In-page search for the PDF surface.
 *
 * Main counts matches over the text `electron/chunking/pdf-text.ts` (`pdfPageText`) built from each
 * page's PDF.js text content: every item's `str` in order, plus a line break after `hasEOL` items.
 * The PDF.js `TextLayer` renders exactly that — one span per non-empty item, a `<br>` after each
 * `hasEOL` item — so rebuilding the text from the layer's DOM gives the same string, the same
 * matcher hits and the same "occurrence k of page n" as Main.
 *
 * Hits are painted with the CSS Custom Highlight API (like EPUB): nothing is inserted into the text
 * layer, nothing is persisted, and search hits can never be confused with user annotations.
 */

const ELEMENT_NODE = 1
const TEXT_NODE = 3

const ALL_HITS = 'rb-pdf-search-hit'
const CURRENT_HIT = 'rb-pdf-search-current'
const STYLE_ID = 'rb-pdf-search-highlight-style'
/** Background only — the text layer's glyphs are transparent over the canvas. */
const HIGHLIGHT_CSS = `
::highlight(${ALL_HITS}) { background-color: rgba(255, 196, 0, 0.4); }
::highlight(${CURRENT_HIT}) { background-color: rgba(255, 128, 0, 0.6); }
`

/** Page text as Main saw it, from a rendered PDF.js text layer. */
export function buildPdfTextLayerIndex(layer: HTMLElement): SectionTextIndex {
  const parts: string[] = []
  const nodes: Text[] = []
  const starts: number[] = []
  let length = 0

  const walk = (parent: Node) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === TEXT_NODE) {
        const node = child as Text
        if (node.length === 0) continue
        nodes.push(node)
        starts.push(length)
        parts.push(node.data)
        length += node.length
      } else if (child.nodeType === ELEMENT_NODE) {
        if ((child as Element).localName === 'br') {
          parts.push('\n')
          length += 1
          continue
        }
        // Marked-content wrappers (`span.markedContent`) and text spans alike.
        walk(child)
      }
    }
  }

  walk(layer)
  return { text: parts.join(''), nodes, starts }
}

/** Every hit of `matcher` in one page's text layer, as DOM Ranges in reading order. */
export function pdfPageSearchRanges(layer: HTMLElement, matcher: TextMatcher): Range[] {
  const index = buildPdfTextLayerIndex(layer)
  const ranges: Range[] = []
  for (const match of matcher.find(index.text)) {
    const range = rangeForMatch(layer.ownerDocument, index, match)
    if (range) ranges.push(range)
  }
  return ranges
}

type HighlightRegistry = {
  set(name: string, value: unknown): unknown
  delete(name: string): boolean
}
type HighlightCtor = new (...ranges: Range[]) => { priority: number }

function highlightHost(doc: Document): { registry: HighlightRegistry; Highlight: HighlightCtor } | null {
  const win = doc.defaultView as unknown as {
    CSS?: { highlights?: HighlightRegistry }
    Highlight?: HighlightCtor
  } | null
  const registry = win?.CSS?.highlights
  if (!registry || !win?.Highlight) return null
  return { registry, Highlight: win.Highlight }
}

function ensureHighlightStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = HIGHLIGHT_CSS
  doc.head.appendChild(style)
}

/** Paint all hits, `current` on top. False when the engine has no CSS Custom Highlight API. */
export function paintPdfSearchHighlights(doc: Document, ranges: Range[], current: Range | null): boolean {
  const host = highlightHost(doc)
  if (!host) return false
  ensureHighlightStyle(doc)
  host.registry.set(ALL_HITS, new host.Highlight(...ranges))
  if (current) {
    const highlight = new host.Highlight(current)
    highlight.priority = 1
    host.registry.set(CURRENT_HIT, highlight)
  } else {
    host.registry.delete(CURRENT_HIT)
  }
  return true
}

export function clearPdfSearchHighlights(doc: Document): void {
  const host = highlightHost(doc)
  host?.registry.delete(ALL_HITS)
  host?.registry.delete(CURRENT_HIT)
}

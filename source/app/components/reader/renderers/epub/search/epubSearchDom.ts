import type { TextMatch, TextMatcher } from '@reading-book/book-reader-sdk'

/**
 * In-section search for the EPUB surface.
 *
 * Main counts matches over the text electron/chunking extracted from each spine document
 * (`html-to-text.ts`). To land on "occurrence N of this chapter", the renderer rebuilds the SAME
 * text from the section's DOM — same skipped elements, same block boundaries — runs the same SDK
 * matcher on it, and maps the chosen match back to a DOM Range.
 *
 * Matches are painted with the CSS Custom Highlight API: a registry of Ranges styled through
 * `::highlight()`. Nothing is inserted into the book's DOM (CFIs stay valid) and nothing goes
 * through epub.js annotations, so a search hit can never collide with a user highlight that
 * covers the very same range.
 */

const ELEMENT_NODE = 1
const TEXT_NODE = 3

/** Mirrors html-to-text.ts: these never reach the chunk text. */
const SKIPPED_TAGS = new Set(['head', 'script', 'style', 'svg'])

/** Mirrors html-to-text.ts BLOCK_TAGS: a paragraph break before and after. */
const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'tr', 'table', 'blockquote',
  'section', 'article', 'aside', 'header', 'footer', 'nav', 'pre', 'hr', 'figure', 'figcaption',
  'dt', 'dd', 'dl', 'body',
])

const ALL_HITS = 'rb-search-hit'
const CURRENT_HIT = 'rb-search-current'
const STYLE_ID = 'rb-search-highlight-style'
/** Amber for every hit on the page, strong orange + dark text for the current one (any theme). */
const HIGHLIGHT_CSS = `
::highlight(${ALL_HITS}) { background-color: rgba(255, 196, 0, 0.4); }
::highlight(${CURRENT_HIT}) { background-color: rgba(255, 128, 0, 0.9); color: #111; }
`

export type SectionTextIndex = {
  /** Section text as the chunker saw it (block boundaries become line breaks). */
  text: string
  /** Non-empty text nodes in document order… */
  nodes: Text[]
  /** …and the offset of each one's first character in `text`. */
  starts: number[]
}

export function buildSectionTextIndex(doc: Document): SectionTextIndex {
  const parts: string[] = []
  const nodes: Text[] = []
  const starts: number[] = []
  let length = 0
  const append = (text: string) => {
    parts.push(text)
    length += text.length
  }

  const walk = (parent: Node) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === TEXT_NODE) {
        const node = child as Text
        if (node.length === 0) continue
        nodes.push(node)
        starts.push(length)
        append(node.data)
      } else if (child.nodeType === ELEMENT_NODE) {
        const tag = (child as Element).localName.toLowerCase()
        if (SKIPPED_TAGS.has(tag)) continue
        if (tag === 'br') {
          append(' ')
          continue
        }
        const block = BLOCK_TAGS.has(tag)
        if (block) append('\n')
        walk(child)
        if (block) append('\n')
      }
    }
  }

  walk(doc.documentElement)
  return { text: parts.join(''), nodes, starts }
}

/** Text node + offset holding `text[offset]`, or null when it falls on a synthetic break. */
function locate(index: SectionTextIndex, offset: number): { node: Text; offset: number } | null {
  let lo = 0
  let hi = index.starts.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((index.starts[mid] ?? 0) <= offset) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  const node = index.nodes[found]
  if (!node) return null
  const local = offset - (index.starts[found] ?? 0)
  return local < node.length ? { node, offset: local } : null
}

/** DOM Range for a match found in `index.text`. Matches start and end on word characters. */
export function rangeForMatch(doc: Document, index: SectionTextIndex, match: TextMatch): Range | null {
  const start = locate(index, match.start)
  const last = locate(index, match.end - 1)
  if (!start || !last) return null
  try {
    const range = doc.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(last.node, last.offset + 1)
    return range
  } catch {
    return null
  }
}

export function findSectionMatches(
  doc: Document,
  matcher: TextMatcher,
): { index: SectionTextIndex; matches: TextMatch[] } {
  const index = buildSectionTextIndex(doc)
  return { index, matches: matcher.find(index.text) }
}

/**
 * Which DOM match is Main's `occurrence`-th of `count`. When both sides counted the same number
 * (the normal case) the rank is exact; otherwise (an entity the extractor didn't decode, markup
 * it split differently…) fall back to the same relative position in the section.
 */
export function pickSectionMatch(
  matches: TextMatch[],
  occurrence: number,
  count: number,
): TextMatch | null {
  if (matches.length === 0) return null
  if (matches.length === count) return matches[occurrence] ?? null
  const scaled = count > 0 ? Math.round((occurrence * matches.length) / count) : 0
  return matches[Math.min(Math.max(scaled, 0), matches.length - 1)] ?? null
}

type HighlightHost = {
  CSS?: { highlights?: { set(name: string, value: unknown): unknown; delete(name: string): boolean } }
  Highlight?: new (...ranges: Range[]) => { priority: number }
}

function ensureHighlightStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style')
  style.id = STYLE_ID
  style.textContent = HIGHLIGHT_CSS
  ;(doc.head ?? doc.documentElement).appendChild(style)
}

/**
 * Paint `ranges` as search hits in `doc` (its own window's highlight registry), `current` on
 * top. Returns false when the engine has no CSS Custom Highlight API.
 */
export function paintSearchHighlights(doc: Document, ranges: Range[], current: Range | null): boolean {
  const host = doc.defaultView as (Window & HighlightHost) | null
  const registry = host?.CSS?.highlights
  const HighlightCtor = host?.Highlight
  if (!registry || !HighlightCtor) return false
  ensureHighlightStyle(doc)
  registry.set(ALL_HITS, new HighlightCtor(...ranges))
  if (current) {
    const highlight = new HighlightCtor(current)
    highlight.priority = 1
    registry.set(CURRENT_HIT, highlight)
  } else {
    registry.delete(CURRENT_HIT)
  }
  return true
}

export function clearSearchHighlights(doc: Document): void {
  const registry = (doc.defaultView as (Window & HighlightHost) | null)?.CSS?.highlights
  registry?.delete(ALL_HITS)
  registry?.delete(CURRENT_HIT)
}

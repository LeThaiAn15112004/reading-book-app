/**
 * Tolerant CFI → DOM resolution for overlay paint (T5.3).
 *
 * epubjs `Contents.range()` gives up on CFIs whose character offset overflows
 * the text node they address. That is the normal shape on verse markup: `<br>`
 * splits a paragraph into several text nodes, epubjs writes the selection end
 * offset against the first chunk only, and its own recovery path then calls
 * `setEnd` on an element with an out-of-bounds child index and throws.
 *
 * Here CFI steps are walked directly, an overflowing offset spills into the
 * following text nodes, and a mark can be re-anchored by its captured text.
 */

const TEXT_NODE = 3
const ELEMENT_NODE = 1

const SKIPPED_TAGS = new Set([
  'HEAD',
  'NOSCRIPT',
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'TITLE',
])

export type CfiDomOptions = {
  /** App-injected elements (overlay layers) — invisible to CFI indexing. */
  isIgnoredElement?: (el: Element) => boolean
}

/** A DOM boundary point, as accepted by `Range.setStart` / `setEnd`. */
export type CfiBoundary = {
  node: Node
  offset: number
}

type CfiStep = {
  /** 0-based index among element children (element step) or text children (text step). */
  index: number
  isText: boolean
  id: string | null
}

type CfiSegment = {
  steps: CfiStep[]
  offset: number | null
}

type ParsedCfi = {
  /** Steps inside the content document, shared by both range ends. */
  path: CfiSegment
  start: CfiSegment | null
  end: CfiSegment | null
}

/** Split `epubcfi(a,b,c)` into top-level components; `[...]` assertions are opaque. */
export function splitCfiComponents(cfi: string): string[] {
  const trimmed = cfi.trim()
  if (!trimmed.startsWith('epubcfi(') || !trimmed.endsWith(')')) return []
  const inner = trimmed.slice('epubcfi('.length, -1)

  const parts: string[] = []
  let current = ''
  let depth = 0
  for (const ch of inner) {
    if (ch === '[') depth += 1
    else if (ch === ']') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)

  return parts.map((p) => p.trim()).filter(Boolean)
}

export { cfiChapterSignature } from '@reading-book/book-reader-sdk'

function parseCfiStep(token: string): CfiStep | null {
  const num = Number.parseInt(token, 10)
  if (!Number.isFinite(num) || num < 1) return null
  const assertion = token.match(/\[(.*)\]/)
  const id = assertion?.[1] ? assertion[1] : null
  return num % 2 === 0
    ? { index: num / 2 - 1, isText: false, id }
    : { index: (num - 1) / 2, isText: true, id }
}

function parseCfiSegment(component: string): CfiSegment | null {
  let depth = 0
  let colon = -1
  for (let i = 0; i < component.length; i += 1) {
    const ch = component[i]
    if (ch === '[') depth += 1
    else if (ch === ']') depth = Math.max(0, depth - 1)
    else if (ch === ':' && depth === 0) colon = i
  }

  const stepsPart = colon >= 0 ? component.slice(0, colon) : component
  const steps: CfiStep[] = []
  for (const token of stepsPart.split('/')) {
    if (!token) continue
    const step = parseCfiStep(token)
    if (!step) return null
    steps.push(step)
  }

  const offset = colon >= 0 ? Number.parseInt(component.slice(colon + 1), 10) : NaN
  return {
    steps,
    offset: Number.isFinite(offset) && offset >= 0 ? offset : null,
  }
}

/**
 * Parse a CFI into content-document steps.
 * Accepts range form `epubcfi(base!path,start,end)` and the point form
 * `epubcfi(base!path,local)` that `splitCfiRange` emits — epubjs drops the
 * trailing component of the latter, this parser keeps it.
 */
export function parseCfi(cfi: string): ParsedCfi | null {
  const parts = splitCfiComponents(cfi)
  if (parts.length === 0) return null

  const bang = parts[0].lastIndexOf('!')
  if (bang < 0) return null

  const path = parseCfiSegment(parts[0].slice(bang + 1))
  if (!path || path.steps.length === 0) return null

  if (parts.length >= 3) {
    const start = parseCfiSegment(parts[1])
    const end = parseCfiSegment(parts[parts.length - 1])
    if (start && end) return { path, start, end }
    return null
  }

  if (parts.length === 2) {
    const tail = parseCfiSegment(parts[1])
    if (!tail) return null
    return {
      path: { steps: [...path.steps, ...tail.steps], offset: tail.offset },
      start: null,
      end: null,
    }
  }

  return { path, start: null, end: null }
}

/**
 * True for shallow "start of spine document" point CFIs such as
 * `epubcfi(/6/2!/4/1:0)`. epubjs often cannot resolve the synthetic `/1` text
 * step when `<body>` has only element children, and logs
 * `No startContainer found` without throwing. Callers should navigate by spine
 * index instead of asking epubjs to materialize a Range.
 */
export function isTrivialSectionStartCfi(cfi: string): boolean {
  const parsed = parseCfi(cfi)
  if (!parsed || parsed.start || parsed.end) return false
  const { steps, offset } = parsed.path
  if (offset != null && offset !== 0) return false
  return steps.length <= 2
}

function isStartContainerLog(args: unknown[]): boolean {
  return (
    typeof args[0] === 'string' &&
    args[0].startsWith('No startContainer found')
  )
}

let startContainerLogFilterInstalled = false

/**
 * epubjs `toRange` often logs after `display()` resolves (iframe load /
 * relocated). A process-wide filter is the only reliable mute.
 */
export function installEpubjsStartContainerLogFilter(): void {
  if (startContainerLogFilterInstalled) return
  startContainerLogFilterInstalled = true
  const original = console.log.bind(console)
  console.log = (...args: unknown[]) => {
    if (isStartContainerLog(args)) return
    original(...(args as Parameters<typeof console.log>))
  }
}

function muteEpubjsStartContainerLog(): () => void {
  const original = console.log
  console.log = (...args: unknown[]) => {
    if (isStartContainerLog(args)) return
    original.apply(console, args as Parameters<typeof console.log>)
  }
  return () => {
    console.log = original
  }
}

/**
 * epubjs `EpubCFI.toRange` logs (does not throw) when a CFI cannot be resolved.
 * Mute only that message around sync calls into `contents.range`.
 */
export function withEpubjsStartContainerLogMuted<T>(fn: () => T): T {
  const restore = muteEpubjsStartContainerLog()
  try {
    return fn()
  } finally {
    restore()
  }
}

/** Same mute for async `rendition.display(cfi)` (toRange runs after await). */
export async function withEpubjsStartContainerLogMutedAsync<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const restore = muteEpubjsStartContainerLog()
  try {
    return await fn()
  } finally {
    restore()
  }
}

function elementChildren(parent: Node, options: CfiDomOptions): Element[] {
  const children = (parent as Element).children
  if (!children) return []
  const ignored = options.isIgnoredElement
  const list = Array.from(children)
  return ignored ? list.filter((el) => !ignored(el)) : list
}

/** Direct child text nodes — the list CFI text steps index into. */
function directTextNodes(parent: Node): Text[] {
  const out: Text[] = []
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === TEXT_NODE) out.push(child as Text)
  }
  return out
}

function collectTextNodes(root: Node, options: CfiDomOptions, out: Text[]): void {
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === TEXT_NODE) {
      out.push(child as Text)
      continue
    }
    if (child.nodeType !== ELEMENT_NODE) continue
    const el = child as Element
    if (SKIPPED_TAGS.has(el.tagName) || options.isIgnoredElement?.(el)) continue
    collectTextNodes(el, options, out)
  }
}

/** All text nodes under `root` in document order, skipping overlay artifacts. */
function descendantTextNodes(root: Node, options: CfiDomOptions): Text[] {
  const out: Text[] = []
  collectTextNodes(root, options, out)
  return out
}

/**
 * Walk CFI steps from the document element.
 * A missing *final* text step is tolerated: epubjs appends a synthetic `/1` when
 * a selection boundary lands on an element, so the parent plus a character
 * offset still describes the boundary.
 */
function resolveSteps(
  doc: Document,
  steps: CfiStep[],
  options: CfiDomOptions,
): Node | null {
  let node: Node = doc.documentElement
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]
    let next: Node | null = null
    if (step.isText) {
      next = directTextNodes(node)[step.index] ?? null
    } else {
      if (step.id) next = doc.getElementById(step.id)
      if (!next) next = elementChildren(node, options)[step.index] ?? null
    }
    if (!next) {
      const isLastStep = i === steps.length - 1
      return isLastStep && step.isText ? node : null
    }
    node = next
  }
  return node
}

/** Map a character offset onto the text nodes under `root`, clamping at the end. */
function charOffsetBoundary(
  root: Node,
  offset: number,
  options: CfiDomOptions,
): CfiBoundary | null {
  const nodes = descendantTextNodes(root, options)
  if (nodes.length === 0) return null
  let remaining = offset
  for (const node of nodes) {
    if (remaining <= node.length) return { node, offset: remaining }
    remaining -= node.length
  }
  const last = nodes[nodes.length - 1]
  return { node: last, offset: last.length }
}

/** First / last text position inside `root`. */
function textEdgeBoundary(
  root: Node,
  atEnd: boolean,
  options: CfiDomOptions,
): CfiBoundary | null {
  const nodes = descendantTextNodes(root, options)
  if (nodes.length === 0) return null
  const node = atEnd ? nodes[nodes.length - 1] : nodes[0]
  return { node, offset: atEnd ? node.length : 0 }
}

/**
 * Continue an overflowing offset into text nodes after `from`.
 *
 * epubjs often writes a large end offset (`/1:742`) against the first text
 * chunk even when the selection continues into later `<p>` / `<span>` /
 * `<br>` siblings. Walk wider ancestors until the offset is consumed so we
 * do not clamp to a single short line.
 */
function spillForward(
  from: Text,
  remaining: number,
  options: CfiDomOptions,
): CfiBoundary | null {
  if (remaining <= 0) {
    return { node: from, offset: from.length }
  }

  const doc = from.ownerDocument
  let scope: Element | null = from.parentElement
  let lastClamp: CfiBoundary | null = null

  while (scope) {
    const nodes = descendantTextNodes(scope, options)
    const index = nodes.indexOf(from)
    if (index >= 0) {
      let rest = remaining
      for (let i = index + 1; i < nodes.length; i += 1) {
        const node = nodes[i]
        if (rest <= node.length) return { node, offset: rest }
        rest -= node.length
      }
      const last = nodes[nodes.length - 1]
      lastClamp = { node: last, offset: last.length }
      if (rest <= 0) return lastClamp
    }

    if (scope === doc?.body || scope === doc?.documentElement) break
    scope = scope.parentElement
  }

  return lastClamp
}

function boundaryFromSegment(
  doc: Document,
  segment: CfiSegment,
  options: CfiDomOptions,
  preferEnd: boolean,
): CfiBoundary | null {
  const node = resolveSteps(doc, segment.steps, options)
  if (!node) return null
  const offset = segment.offset

  if (node.nodeType === TEXT_NODE) {
    const text = node as Text
    if (offset == null) return { node: text, offset: preferEnd ? text.length : 0 }
    if (offset <= text.length) return { node: text, offset }
    return (
      spillForward(text, offset - text.length, options) ?? {
        node: text,
        offset: text.length,
      }
    )
  }

  if (node.nodeType === ELEMENT_NODE) {
    if (offset == null) return textEdgeBoundary(node, preferEnd, options)
    return (
      charOffsetBoundary(node, offset, options) ??
      textEdgeBoundary(node, preferEnd, options)
    )
  }

  return { node, offset: offset ?? 0 }
}

function tryRange(
  doc: Document,
  start: CfiBoundary,
  end: CfiBoundary,
): Range | null {
  try {
    const range = doc.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    return range
  } catch {
    return null
  }
}

/** Build a Range from two boundaries, tolerating reversed selection direction. */
export function rangeBetweenBoundaries(
  doc: Document,
  a: CfiBoundary,
  b: CfiBoundary,
): Range | null {
  const direct = tryRange(doc, a, b)
  if (direct && !direct.collapsed) return direct
  const swapped = tryRange(doc, b, a)
  if (swapped && !swapped.collapsed) return swapped
  return direct ?? swapped
}

/**
 * Hit-test a document-local point to a collapsed Range boundary — Chromium's
 * `caretRangeFromPoint`, with `caretPositionFromPoint` as a fallback for engines that only
 * implement the standardized name. Used to translate a drag pointer's live position into a DOM
 * boundary while resizing a highlight's range.
 */
export function caretRangeAtPoint(doc: Document, x: number, y: number): Range | null {
  const extended = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  try {
    if (extended.caretRangeFromPoint) return extended.caretRangeFromPoint(x, y)
    const pos = extended.caretPositionFromPoint?.(x, y)
    if (!pos) return null
    const range = doc.createRange()
    range.setStart(pos.offsetNode, pos.offset)
    range.collapse(true)
    return range
  } catch {
    return null
  }
}

/** Resolve one point CFI to a DOM boundary. */
export function resolveCfiBoundary(
  doc: Document,
  cfi: string,
  options: CfiDomOptions = {},
  preferEnd = false,
): CfiBoundary | null {
  const parsed = parseCfi(cfi)
  if (!parsed) return null
  const segment = parsed.start
    ? {
        steps: [
          ...parsed.path.steps,
          ...(preferEnd ? parsed.end?.steps ?? [] : parsed.start.steps),
        ],
        offset: preferEnd ? parsed.end?.offset ?? null : parsed.start.offset,
      }
    : parsed.path
  return boundaryFromSegment(doc, segment, options, preferEnd)
}

/** Resolve a range CFI to a DOM Range without epubjs' offset assumptions. */
export function resolveCfiRange(
  doc: Document,
  cfi: string,
  options: CfiDomOptions = {},
): Range | null {
  const parsed = parseCfi(cfi)
  if (!parsed) return null

  if (parsed.start && parsed.end) {
    const start = boundaryFromSegment(
      doc,
      { steps: [...parsed.path.steps, ...parsed.start.steps], offset: parsed.start.offset },
      options,
      false,
    )
    const end = boundaryFromSegment(
      doc,
      { steps: [...parsed.path.steps, ...parsed.end.steps], offset: parsed.end.offset },
      options,
      true,
    )
    if (!start || !end) return null
    return rangeBetweenBoundaries(doc, start, end)
  }

  const point = boundaryFromSegment(doc, parsed.path, options, false)
  if (!point) return null
  return tryRange(doc, point, point)
}

/** Deepest element addressed by a CFI — search scope for text re-anchoring. */
export function elementFromCfi(
  doc: Document,
  cfi: string,
  options: CfiDomOptions = {},
): Element | null {
  const parsed = parseCfi(cfi)
  if (!parsed) return null
  const node = resolveSteps(doc, parsed.path.steps, options)
  if (!node) return null
  const el = node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement
  return el ?? null
}

/** Whitespace-free form: `<br>` and source indentation must not affect matching. */
function squashWhitespace(text: string): string {
  return text.replace(/\s+/g, '')
}

/**
 * Normalize punctuation so smart quotes / dashes from the browser selection
 * still match EPUB source text (and vice versa).
 * Length-preserving for single code points (ellipsis stays one char) so the
 * squashed index stays 1:1 with DOM offsets.
 */
function normalizeForMatch(text: string): string {
  return squashWhitespace(
    text
      .normalize('NFKC')
      .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
      .replace(/[\u2018\u2019\u201A\uFF07]/g, "'")
      .replace(/[\u201C\u201D\u201E\uFF02]/g, '"'),
  )
}

type SquashedIndex = {
  text: string
  /** `positions[i]` is the DOM boundary of `text[i]`. */
  positions: CfiBoundary[]
}

function buildSquashedIndex(nodes: Text[]): SquashedIndex {
  let text = ''
  const positions: CfiBoundary[] = []
  for (const node of nodes) {
    const raw = node.data
    for (let i = 0; i < raw.length; i += 1) {
      if (/\s/.test(raw[i])) continue
      // Keep 1:1 with needle from normalizeForMatch (dashes / quotes).
      const normalized = normalizeForMatch(raw[i])
      if (!normalized) continue
      text += normalized
      positions.push({ node, offset: i })
    }
  }
  return { text, positions }
}

/**
 * Re-anchor a mark by the text it captured. Last-resort strategy for marks whose
 * stored CFI no longer resolves; ignores whitespace so verse line breaks match.
 *
 * When `hint` is set, prefer the occurrence whose start is closest to the hint
 * start (CFI often lands on the correct opening words but truncates the end).
 */
export function findRangeByText(
  doc: Document,
  scope: Node | null,
  text: string,
  options: CfiDomOptions = {},
  hint?: Range | null,
): Range | null {
  const needle = normalizeForMatch(text)
  if (!needle) return null

  const hintAncestor =
    hint && !hint.collapsed
      ? hint.commonAncestorContainer.nodeType === ELEMENT_NODE
        ? hint.commonAncestorContainer
        : hint.commonAncestorContainer.parentNode
      : null

  const roots = [scope, hintAncestor, doc.body, doc.documentElement].filter(
    (root, index, list): root is Node =>
      !!root && list.indexOf(root) === index,
  )

  let best: Range | null = null
  let bestDist = Number.POSITIVE_INFINITY

  for (const root of roots) {
    const index = buildSquashedIndex(descendantTextNodes(root, options))
    // Search every occurrence in this root; pick closest to hint when present.
    let from = 0
    while (from <= index.text.length) {
      const at = index.text.indexOf(needle, from)
      if (at < 0) break
      const start = index.positions[at]
      const lastChar = index.positions[at + needle.length - 1]
      from = at + 1
      if (!start || !lastChar) continue
      const range = tryRange(doc, start, {
        node: lastChar.node,
        offset: lastChar.offset + 1,
      })
      if (!range || range.collapsed) continue

      if (!hint || hint.collapsed) return range

      try {
        const dist =
          Math.abs(
            range.compareBoundaryPoints(Range.START_TO_START, hint),
          ) === 0
            ? 0
            : (() => {
                const a = hint.getBoundingClientRect()
                const b = range.getBoundingClientRect()
                return Math.hypot(a.top - b.top, a.left - b.left)
              })()
        if (dist < bestDist) {
          bestDist = dist
          best = range
          if (dist === 0) return range
        }
      } catch {
        best ??= range
      }
    }
    if (best && !hint) return best
  }

  return best
}

/** All text nodes under `root` in document order, skipping overlay artifacts. */
export function collectDescendantTextNodes(
  root: Node,
  options: CfiDomOptions = {},
): Text[] {
  return descendantTextNodes(root, options)
}

/** Total character length of visible text under `root`. */
export function documentTextLength(
  doc: Document,
  options: CfiDomOptions = {},
): number {
  const root = doc.body ?? doc.documentElement
  return collectDescendantTextNodes(root, options).reduce(
    (sum, node) => sum + node.length,
    0,
  )
}

/** 0-based character offset of a point CFI within `doc`, or null when unresolved. */
export function cfiCharacterOffset(
  doc: Document,
  cfi: string,
  options: CfiDomOptions = {},
): number | null {
  const boundary = resolveCfiBoundary(doc, cfi, options)
  if (!boundary) return null
  const root = doc.body ?? doc.documentElement
  const nodes = collectDescendantTextNodes(root, options)
  if (nodes.length === 0) return 0

  let offset = 0
  for (const node of nodes) {
    if (node === boundary.node) {
      return Math.min(offset + boundary.offset, offset + node.length)
    }
    offset += node.length
  }

  const last = nodes[nodes.length - 1]
  if (boundary.node === last) {
    return offset - last.length + boundary.offset
  }
  return null
}

/** Map a 0-based character offset back to a DOM boundary under `root`. */
export function characterOffsetToBoundary(
  root: Node,
  offset: number,
  options: CfiDomOptions = {},
): CfiBoundary | null {
  const clamped = Math.max(0, Math.floor(offset))
  return charOffsetBoundary(root, clamped, options)
}

/** True when a Range covers the same characters as the mark's captured text. */
export function rangeMatchesText(range: Range, text: string): boolean {
  const expected = normalizeForMatch(text)
  if (!expected) return false
  try {
    return normalizeForMatch(range.toString()) === expected
  } catch {
    return false
  }
}

/**
 * How much of `text` a range covers (0 = unrelated). Exact match scores highest.
 * Used to prefer a longer CFI resolve over a truncated first-line clamp.
 */
export function rangeTextCoverage(range: Range, text: string): number {
  const expected = normalizeForMatch(text)
  if (!expected) return 0
  try {
    const got = normalizeForMatch(range.toString())
    if (!got) return 0
    if (got === expected) return expected.length * 2
    if (expected.startsWith(got) || got.startsWith(expected)) {
      return Math.min(got.length, expected.length)
    }
    if (expected.includes(got)) return got.length
    return 0
  } catch {
    return 0
  }
}

import { splitCfiRange, splitTopLevelCommas, unwrapCfi, isWrappedCfi } from './cfi-string.js'

/**
 * Structural CFI parsing (steps / offsets), ported from the desktop renderer's
 * `cfi-dom-range.ts` minus the DOM walking — the parse is pure and reusable by any platform's
 * renderer; resolving the steps against a document stays platform-side.
 */

export interface CfiStep {
  /** 0-based index among element children (element step) or text children (text step). */
  index: number
  /** Odd CFI step numbers address text/character-data positions. */
  isText: boolean
  /** `[id]` assertion, if any. */
  id: string | null
}

export interface CfiSegment {
  steps: CfiStep[]
  /** Character offset after `:`, when present. */
  offset: number | null
}

export interface ParsedCfi {
  /** Steps inside the content document (after `!`), shared by both range ends. */
  path: CfiSegment
  start: CfiSegment | null
  end: CfiSegment | null
}

function parseCfiStep(token: string): CfiStep | null {
  const num = Number.parseInt(token, 10)
  if (!Number.isFinite(num) || num < 1) return null
  const assertion = /\[(.*)\]/.exec(token)
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

  const offset = colon >= 0 ? Number.parseInt(component.slice(colon + 1), 10) : Number.NaN
  return { steps, offset: Number.isFinite(offset) && offset >= 0 ? offset : null }
}

/**
 * Parse `epubcfi(base!path,start,end)` (range) or `epubcfi(base!path,local)` (the point form
 * `splitCfiRange` emits — epub.js drops its trailing component, this keeps it).
 */
export function parseCfi(cfi: string): ParsedCfi | null {
  if (!isWrappedCfi(cfi)) return null
  const parts = splitTopLevelCommas(unwrapCfi(cfi))
  const head = parts[0]
  if (head === undefined) return null

  const bang = head.lastIndexOf('!')
  if (bang < 0) return null

  const path = parseCfiSegment(head.slice(bang + 1))
  if (!path || path.steps.length === 0) return null

  if (parts.length >= 3) {
    const start = parseCfiSegment(parts[1] ?? '')
    const end = parseCfiSegment(parts[parts.length - 1] ?? '')
    return start && end ? { path, start, end } : null
  }

  if (parts.length === 2) {
    const tail = parseCfiSegment(parts[1] ?? '')
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
 * True for shallow "start of spine document" point CFIs such as `epubcfi(/6/2!/4/1:0)`. epub.js
 * often cannot resolve the synthetic `/1` step when `<body>` has only element children, so
 * renderers should navigate by spine index for these instead.
 */
export function isTrivialSectionStartCfi(cfi: string): boolean {
  const parsed = parseCfi(cfi)
  if (!parsed || parsed.start || parsed.end) return false
  const { steps, offset } = parsed.path
  if (offset != null && offset !== 0) return false
  return steps.length <= 2
}

/**
 * Numeric sort key for a point CFI: every step number across package + content document, then
 * the character offset. Temporal (`~`) / spatial (`@`) offsets and assertions are ignored.
 */
function cfiSortKey(pointCfi: string): number[] {
  const inner = unwrapCfi(pointCfi).replace(/\[[^\]]*\]/g, '')
  const key: number[] = []
  for (const component of splitTopLevelCommas(inner)) {
    for (const segment of component.split('!')) {
      const [stepsPart = '', offsetPart] = segment.split(':')
      for (const token of stepsPart.split('/')) {
        if (!token) continue
        const n = Number.parseInt(token, 10)
        if (Number.isFinite(n)) key.push(n)
      }
      if (offsetPart !== undefined) {
        const offset = Number.parseInt(offsetPart, 10)
        if (Number.isFinite(offset)) key.push(offset)
      }
    }
  }
  return key
}

/**
 * Document-order comparison of two CFIs (point or range; ranges compare by their start).
 * Returns < 0, 0, > 0 like `Array.prototype.sort` expects. Well-formed CFIs from the same
 * package compare correctly; a shorter key that is a prefix of a longer one sorts first.
 */
export function compareCfi(a: string, b: string): number {
  const ka = cfiSortKey(splitCfiRange(a).locationStart)
  const kb = cfiSortKey(splitCfiRange(b).locationStart)
  const len = Math.min(ka.length, kb.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (ka[i] ?? 0) - (kb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return ka.length - kb.length
}

/**
 * Pure EPUB CFI string helpers — no DOM, no epub.js runtime. Ported from
 * `packages/shared/utils/epub-cfi.ts`, behavior unchanged.
 *
 * Anything that has to resolve a CFI against a live document (`Range`, text nodes) belongs to
 * the renderer on each platform, not here.
 */

export interface SplitCfiRange {
  locationStart: string
  locationEnd: string
}

const PREFIX = 'epubcfi('

export function isWrappedCfi(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith(PREFIX) && trimmed.endsWith(')')
}

/** Inner text of `epubcfi(...)`, or the trimmed input when it is not wrapped. */
export function unwrapCfi(value: string): string {
  const trimmed = value.trim()
  return isWrappedCfi(trimmed) ? trimmed.slice(PREFIX.length, -1) : trimmed
}

export function wrapCfi(inner: string): string {
  return isWrappedCfi(inner) ? inner.trim() : `${PREFIX}${inner.trim()})`
}

/** Split on commas that are not inside `[...]` assertions. Empty parts are dropped. */
export function splitTopLevelCommas(inner: string): string[] {
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
  if (current) parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** True for `epubcfi(base,start,end)`. */
export function isRangeCfi(cfi: string): boolean {
  return isWrappedCfi(cfi) && splitTopLevelCommas(unwrapCfi(cfi)).length >= 3
}

/** Build `epubcfi(base,startLocal,endLocal)` from its three components. */
export function buildCfiRange(base: string, startLocal: string, endLocal: string): string {
  return `${PREFIX}${unwrapCfi(base)},${startLocal.trim()},${endLocal.trim()})`
}

/**
 * Numeric spine signature of a CFI, ignoring id assertions.
 * `epubcfi(/6/60[ch5]!/4/2,/1:0,/1:9)` and epub.js' bare `cfiBase` `/6/60` both reduce to
 * `/6/60`, so a mark can be matched against the rendered section.
 */
export function cfiChapterSignature(cfi: string): string | null {
  const inner = unwrapCfi(cfi)
  if (!inner) return null
  const beforeBang = inner.split('!')[0] ?? ''
  const beforeComma = beforeBang.split(',')[0] ?? ''
  const steps = beforeComma
    .replace(/\[[^\]]*\]/g, '')
    .split('/')
    .filter(Boolean)
  return steps.length > 0 ? `/${steps.join('/')}` : null
}

/**
 * Spine item index from the package path `/6/N!` (N even) — `/6/2` → 0, `/6/4` → 1.
 * Used as the chapter fallback when an annotation lacks a reliable `chapterIndex`.
 */
export function spineIndexFromCfi(cfi: string): number | undefined {
  const sig = cfiChapterSignature(cfi)
  if (!sig) return undefined
  const parts = sig.split('/').filter(Boolean)
  if (parts.length < 2) return undefined
  const last = Number.parseInt(parts[parts.length - 1] ?? '', 10)
  if (!Number.isFinite(last) || last < 2 || last % 2 !== 0) return undefined
  return last / 2 - 1
}

/** Inverse of `spineIndexFromCfi` for the standard `/6` spine step: 0 → `/6/2`. */
export function cfiBaseForSpineIndex(spineIndex: number, spineStep = 6): string {
  return `/${spineStep}/${(Math.max(0, Math.floor(spineIndex)) + 1) * 2}`
}

/**
 * Split an epub.js `cfiRange` into start/end point CFIs. Falls back to using the whole input
 * for both ends when the shape is unrecognized.
 */
export function splitCfiRange(cfiRange: string): SplitCfiRange {
  const trimmed = cfiRange.trim()
  if (!trimmed) return { locationStart: '', locationEnd: '' }
  if (!isWrappedCfi(trimmed)) return { locationStart: trimmed, locationEnd: trimmed }

  const parts = splitTopLevelCommas(unwrapCfi(trimmed))

  if (parts.length >= 3) {
    const base = parts[0] ?? ''
    const startLocal = parts[1] ?? ''
    const endLocal = parts[parts.length - 1] ?? ''
    return {
      locationStart: `${PREFIX}${base},${startLocal})`,
      locationEnd: `${PREFIX}${base},${endLocal})`,
    }
  }

  if (parts.length === 2) {
    const a = parts[0] ?? ''
    const b = parts[1] ?? ''
    return {
      locationStart: a.startsWith(PREFIX) ? a : `${PREFIX}${a})`,
      locationEnd: b.startsWith(PREFIX) ? b : `${PREFIX}${b})`,
    }
  }

  return { locationStart: trimmed, locationEnd: trimmed }
}

/**
 * Heuristic overlap for EPUB CFIs without an EpubCFI runtime: exact match, shared endpoints, or
 * one local path containing the other. For precise ordering use `compareCfi`.
 */
export function cfiRangesOverlap(a: string, b: string): boolean {
  const left = a.trim()
  const right = b.trim()
  if (!left || !right) return false
  if (left === right) return true

  const splitA = splitCfiRange(left)
  const splitB = splitCfiRange(right)
  if (
    splitA.locationStart === splitB.locationStart ||
    splitA.locationEnd === splitB.locationEnd ||
    splitA.locationStart === splitB.locationEnd ||
    splitA.locationEnd === splitB.locationStart
  ) {
    return true
  }

  const la = unwrapCfi(left)
  const lb = unwrapCfi(right)
  return la.includes(lb) || lb.includes(la)
}

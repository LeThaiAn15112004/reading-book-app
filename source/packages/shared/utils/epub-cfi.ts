/**
 * Pure EPUB CFI string helpers (no DOM / epubjs runtime).
 * Shared by persistence mappers and desktop overlay paint.
 */

export type SplitCfiRange = {
  locationStart: string
  locationEnd: string
}

/** Split on commas that are not inside [...] assertions. */
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

/**
 * Numeric spine signature of a CFI, ignoring id assertions.
 * `epubcfi(/6/60[ch5]!/4/2,/1:0,/1:9)` and epubjs' bare `cfiBase` `/6/60` both
 * reduce to `/6/60`, so a mark can be matched against the rendered section.
 */
export function cfiChapterSignature(cfi: string): string | null {
  const trimmed = cfi.trim()
  if (!trimmed) return null
  const inner =
    trimmed.startsWith('epubcfi(') && trimmed.endsWith(')')
      ? trimmed.slice('epubcfi('.length, -1)
      : trimmed
  const beforeBang = inner.split('!')[0] ?? ''
  const beforeComma = beforeBang.split(',')[0] ?? ''
  const steps = beforeComma
    .replace(/\[[^\]]*\]/g, '')
    .split('/')
    .filter(Boolean)
  return steps.length > 0 ? `/${steps.join('/')}` : null
}

/**
 * Split an epubjs `cfiRange` string into start/end CFIs suitable for domain Location.
 * Falls back to using the whole range for both ends when shape is unrecognized.
 */
export function splitCfiRange(cfiRange: string): SplitCfiRange {
  const trimmed = cfiRange.trim()
  if (!trimmed) {
    return { locationStart: '', locationEnd: '' }
  }

  if (!trimmed.startsWith('epubcfi(') || !trimmed.endsWith(')')) {
    return { locationStart: trimmed, locationEnd: trimmed }
  }

  const inner = trimmed.slice('epubcfi('.length, -1)
  const parts = splitTopLevelCommas(inner)

  if (parts.length >= 3) {
    const base = parts[0]!
    const startLocal = parts[1]!
    const endLocal = parts[parts.length - 1]!
    return {
      locationStart: `epubcfi(${base},${startLocal})`,
      locationEnd: `epubcfi(${base},${endLocal})`,
    }
  }

  if (parts.length === 2) {
    const a = parts[0]!
    const b = parts[1]!
    const start = a.startsWith('epubcfi(') ? a : `epubcfi(${a})`
    const end = b.startsWith('epubcfi(') ? b : `epubcfi(${b})`
    return { locationStart: start, locationEnd: end }
  }

  return { locationStart: trimmed, locationEnd: trimmed }
}

/**
 * Heuristic overlap for EPUB CFIs without loading EpubCFI runtime.
 * Treats exact range match, shared endpoints, or nested subset paths as overlap.
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

  const localOf = (cfi: string) => {
    const inner =
      cfi.startsWith('epubcfi(') && cfi.endsWith(')')
        ? cfi.slice('epubcfi('.length, -1)
        : cfi
    return inner
  }
  const la = localOf(left)
  const lb = localOf(right)
  return la.includes(lb) || lb.includes(la)
}

/**
 * Parse epubjs selection range CFI into start/end point CFIs (T5.1).
 * Pure string helpers live in `@reading-book/book-reader-sdk`; DOM/geometry stays here.
 */

import {
  cfiRangesOverlap,
  splitCfiRange,
  splitTopLevelCommas,
  type SplitCfiRange,
} from '@reading-book/book-reader-sdk'

export type { SplitCfiRange }
export { cfiRangesOverlap, splitCfiRange }

/**
 * Normalize a stored CFI for `rendition.display`.
 * Range form `epubcfi(base,start,end)` becomes the start point, merged into a
 * single continuous path — never `epubcfi(base,leaf)`. epubjs' own
 * `EpubCFI.getRange()` only recognizes a range when the comma-split yields
 * exactly 3 parts; a 2-part comma form is *not* valid CFI syntax to it, and
 * `EpubCFI.getPathComponent()` silently drops everything after the first
 * comma (`indirection[1].split(",")[0]`), so the leaf offset (`/1:0`) is
 * discarded and epubjs resolves only the shared ancestor node. That produces
 * a collapsed Range, which `Contents.locationOf()` then tries to "uncollapse"
 * by calling `range.setEnd(startContainer, pos)` with a character-search
 * offset — invalid once `startContainer` is an Element, since Range offsets
 * on an Element index child nodes, not characters. That mismatch is exactly
 * the `IndexSizeError: There is no child at offset N` epubjs logs (and
 * swallows) in `Contents.locationOf`. Garbage input → null.
 */
export function toEpubjsDisplayCfi(cfi: string): string | null {
  const trimmed = cfi.trim()
  if (!trimmed) return null
  if (!trimmed.startsWith('epubcfi(') || !trimmed.endsWith(')')) {
    return trimmed.startsWith('/') ? `epubcfi(${trimmed})` : null
  }
  const inner = trimmed.slice('epubcfi('.length, -1)
  const parts = splitTopLevelCommas(inner)
  if (parts.length === 0) return null
  if (parts.length >= 2) return `epubcfi(${parts[0]}${parts[1]})`
  return trimmed
}

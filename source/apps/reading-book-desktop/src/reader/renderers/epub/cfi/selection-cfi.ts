/**
 * Parse epubjs selection range CFI into start/end point CFIs (T5.1).
 * Pure string helpers live in `@reading-book/shared/utils`; DOM/geometry stays here.
 */

import type {
  HighlightHandleRect,
  ViewportRect,
} from '@reading-book/shared/models'
import {
  cfiRangesOverlap,
  splitCfiRange,
  splitTopLevelCommas,
  type SplitCfiRange,
} from '@reading-book/shared/utils'

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

/** Map iframe-local DOMRect into parent viewport coords for SelectionTooltip. */
export function iframeRangeToViewportRect(
  iframe: Element,
  rangeRect: DOMRect,
): ViewportRect {
  const frame = iframe.getBoundingClientRect()
  return {
    top: frame.top + rangeRect.top,
    left: frame.left + rangeRect.left,
    width: rangeRect.width,
    height: rangeRect.height,
  }
}

function domRectToViewport(
  rect: DOMRectReadOnly,
  frameEl?: Element | null,
): ViewportRect {
  if (frameEl) {
    return iframeRangeToViewportRect(frameEl, rect as DOMRect)
  }
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

function nonEmptyClientRects(source: Range | Element): DOMRect[] {
  const list =
    source instanceof Range
      ? source.getClientRects()
      : source.getClientRects()
  return Array.from(list).filter((r) => r.width > 0 && r.height > 0)
}

/**
 * Cluster fragment rects into visual lines (same approximate top).
 * Returns one merged rect per line, top→bottom.
 */
function groupClientRectsByLine(rects: DOMRect[]): DOMRect[] {
  if (rects.length === 0) return []

  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left)
  const medianH = (() => {
    const heights = sorted.map((r) => r.height).sort((a, b) => a - b)
    return heights[Math.floor(heights.length / 2)] ?? 20
  })()
  const threshold = Math.max(4, medianH * 0.45)

  const lines: DOMRect[] = []
  let bucket: DOMRect[] = []
  let bucketTop = sorted[0].top

  const flush = () => {
    if (bucket.length === 0) return
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    for (const r of bucket) {
      left = Math.min(left, r.left)
      right = Math.max(right, r.right)
      top = Math.min(top, r.top)
      bottom = Math.max(bottom, r.bottom)
    }
    lines.push(
      new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top)),
    )
    bucket = []
  }

  for (const r of sorted) {
    if (bucket.length === 0) {
      bucket = [r]
      bucketTop = r.top
      continue
    }
    if (Math.abs(r.top - bucketTop) <= threshold) {
      bucket.push(r)
    } else {
      flush()
      bucket = [r]
      bucketTop = r.top
    }
  }
  flush()

  // Drop absurdly tall "lines" (annotation wrappers that span the whole mark).
  const sane = lines.filter((l) => l.height <= medianH * 2.25)
  return sane.length > 0 ? sane : lines
}

/** Typical single-line caret height when only a multi-line bounding box is available. */
function estimateLineHeight(blockHeight: number): number {
  if (blockHeight <= 0) return 18
  if (blockHeight <= 36) return blockHeight
  // Prefer a reading-line estimate over the full block height.
  return Math.min(28, Math.max(16, Math.round(blockHeight / Math.ceil(blockHeight / 24))))
}

/** Fallback when line rects are unavailable — single-line or coarse multi-line. */
export function viewportRectToHighlightHandleRect(
  rect: ViewportRect,
): HighlightHandleRect {
  const lineHeight = estimateLineHeight(rect.height)
  return {
    ...rect,
    start: {
      top: rect.top,
      left: rect.left,
      lineHeight,
    },
    end: {
      top: rect.top + rect.height - lineHeight,
      left: rect.left + rect.width,
      lineHeight,
    },
  }
}

function handleRectFromLineRects(
  bounds: ViewportRect,
  lines: ViewportRect[],
): HighlightHandleRect {
  if (lines.length === 0) {
    return viewportRectToHighlightHandleRect(bounds)
  }

  const first = lines[0]
  const last = lines[lines.length - 1]
  const startLh = Math.max(12, Math.min(first.height, 40))
  const endLh = Math.max(12, Math.min(last.height, 40))

  return {
    ...bounds,
    start: {
      top: first.top,
      left: first.left,
      lineHeight: startLh,
    },
    end: {
      top: last.top,
      left: last.left + last.width,
      lineHeight: endLh,
    },
  }
}

/** Word-like handle anchors from a DOM Range (first/last line via getClientRects). */
export function rangeToHighlightHandleRect(
  range: Range,
  frameEl?: Element | null,
): HighlightHandleRect {
  const fragments = nonEmptyClientRects(range)
  const bounds = domRectToViewport(range.getBoundingClientRect(), frameEl)
  const lines = groupClientRectsByLine(fragments).map((r) =>
    domRectToViewport(r, frameEl),
  )
  return handleRectFromLineRects(bounds, lines)
}

/** Handle anchors from a painted highlight mark element (fallback). */
export function elementToHighlightHandleRect(
  el: Element,
  frameEl?: Element | null,
): HighlightHandleRect | null {
  const rawBounds = el.getBoundingClientRect()
  if (rawBounds.width <= 0 || rawBounds.height <= 0) return null

  const fragments = nonEmptyClientRects(el)
  const bounds = domRectToViewport(rawBounds, frameEl)
  const lines = groupClientRectsByLine(fragments).map((r) =>
    domRectToViewport(r, frameEl),
  )

  // Annotation SVG wrappers often expose one tall rect — treat as bounding box.
  if (lines.length <= 1 && bounds.height > 40) {
    return viewportRectToHighlightHandleRect(bounds)
  }

  return handleRectFromLineRects(bounds, lines)
}

/** Empty handle rect used before geometry is resolved. */
export function emptyHighlightHandleRect(): HighlightHandleRect {
  return {
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    start: { top: 0, left: 0, lineHeight: 0 },
    end: { top: 0, left: 0, lineHeight: 0 },
  }
}

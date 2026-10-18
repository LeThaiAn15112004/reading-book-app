/**
 * Cut the text at every annotation edge so each piece has a single, well-defined set of covering
 * annotations — what the reading surface needs to paint overlapping marks. Pure: the renderer only
 * turns segments into spans.
 */

import type { TxtSpan } from './txt-annotations.js'

export interface TxtSegment {
  /** Half-open range `[start, end)` of the canonical text. */
  start: number
  end: number
  /** Ids of the annotations covering the whole segment, in the order the input listed them. */
  ids: string[]
}

/**
 * Segments tile `[0, length)` exactly, in order, none empty. Annotation ranges are clamped to the
 * text; ones that end up empty are ignored. A text with no annotations is one segment.
 */
export function segmentTxt(length: number, spans: readonly TxtSpan[]): TxtSegment[] {
  if (length <= 0) return []
  const usable = spans
    .map((s) => ({ id: s.id, start: Math.max(0, s.startOffset), end: Math.min(length, s.endOffset) }))
    .filter((s) => s.end > s.start)

  const cuts = new Set<number>([0, length])
  for (const s of usable) {
    cuts.add(s.start)
    cuts.add(s.end)
  }
  const points = [...cuts].sort((a, b) => a - b)

  const segments: TxtSegment[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const start = points[i]!
    const end = points[i + 1]!
    segments.push({ start, end, ids: usable.filter((s) => s.start <= start && s.end >= end).map((s) => s.id) })
  }
  return segments
}

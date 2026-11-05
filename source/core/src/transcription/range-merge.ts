import { isValidTimeRange, type TimeRange, type TranscriptPassage } from './transcript-model.js'

/**
 * Interval arithmetic for "what is already transcribed" (research R4) and the overlap rule between
 * consecutive decode windows (research R3). Pure; inputs are never mutated.
 */

/** Sort and merge overlapping or touching intervals; unusable ones (non-finite, `start >= end`, negative start) are dropped. */
export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter(([start, end]) => isValidTimeRange(start, end))
    .map(([start, end]): TimeRange => [start, end])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: TimeRange[] = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) {
      if (range[1] > last[1]) merged[merged.length - 1] = [last[0], range[1]]
    } else {
      merged.push(range)
    }
  }
  return merged
}

/** The parts of `requested` that `covered` does not already cover, merged and sorted. */
export function subtractRanges(requested: readonly TimeRange[], covered: readonly TimeRange[]): TimeRange[] {
  const cover = mergeRanges(covered)
  const result: TimeRange[] = []
  for (const [reqStart, reqEnd] of mergeRanges(requested)) {
    let cursor = reqStart
    for (const [covStart, covEnd] of cover) {
      if (covEnd <= cursor) continue
      if (covStart >= reqEnd) break
      if (covStart > cursor) result.push([cursor, covStart])
      cursor = Math.max(cursor, covEnd)
      if (cursor >= reqEnd) break
    }
    if (cursor < reqEnd) result.push([cursor, reqEnd])
  }
  return result
}

/** True when `requested` is non-empty and entirely inside `covered`. */
export function isCovered(requested: readonly TimeRange[], covered: readonly TimeRange[]): boolean {
  const wanted = mergeRanges(requested)
  return wanted.length > 0 && subtractRanges(wanted, covered).length === 0
}

/** Sum of the lengths of the merged intervals. */
export function totalRangeMs(ranges: readonly TimeRange[]): number {
  return mergeRanges(ranges).reduce((sum, [start, end]) => sum + (end - start), 0)
}

function overlapMs(a: TranscriptPassage, b: TranscriptPassage): number {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs))
}

/**
 * Overlap rule between two consecutive decode windows. An `earlier` passage is superseded when a
 * `later` passage of the same track overlaps it by MORE than half of the shorter one's duration; the
 * later window's text wins (it heard the words with more context before them). Returns the earlier
 * passages that survive and those that must be removed; the later passages are all kept by the caller.
 */
export function dropSupersededPassages<T extends TranscriptPassage>(
  earlier: readonly T[],
  later: readonly TranscriptPassage[],
): { kept: T[]; dropped: T[] } {
  const kept: T[] = []
  const dropped: T[] = []
  for (const passage of earlier) {
    const superseded = later.some((other) => {
      if ((other.trackId ?? null) !== (passage.trackId ?? null)) return false
      const shorter = Math.min(passage.endMs - passage.startMs, other.endMs - other.startMs)
      return shorter > 0 && overlapMs(passage, other) / shorter > 0.5
    })
    ;(superseded ? dropped : kept).push(passage)
  }
  return { kept, dropped }
}

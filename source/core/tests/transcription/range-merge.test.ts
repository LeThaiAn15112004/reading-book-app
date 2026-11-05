import { describe, expect, it } from 'vitest'
import {
  dropSupersededPassages,
  isCovered,
  mergeRanges,
  subtractRanges,
  totalRangeMs,
} from '../../src/transcription/range-merge'
import type { TimeRange, TranscriptPassage } from '../../src/transcription/transcript-model'

describe('mergeRanges', () => {
  it('empty in, empty out', () => {
    expect(mergeRanges([])).toEqual([])
  })

  it('sorts and keeps disjoint intervals', () => {
    expect(mergeRanges([[50, 60], [0, 10]])).toEqual([[0, 10], [50, 60]])
  })

  it('merges overlapping and touching (adjacent) intervals', () => {
    expect(mergeRanges([[0, 10], [10, 20], [15, 30]])).toEqual([[0, 30]])
    expect(mergeRanges([[0, 10], [5, 8]])).toEqual([[0, 10]])
  })

  it('drops unusable intervals', () => {
    const bad: TimeRange[] = [[5, 5], [10, 2], [-1, 4], [NaN, 4], [0, Infinity]]
    expect(mergeRanges(bad)).toEqual([])
  })

  it('does not mutate its input', () => {
    const input: TimeRange[] = [[20, 30], [0, 10]]
    mergeRanges(input)
    expect(input).toEqual([[20, 30], [0, 10]])
  })
})

describe('subtractRanges', () => {
  it('nothing covered → the request, merged', () => {
    expect(subtractRanges([[0, 100]], [])).toEqual([[0, 100]])
  })

  it('fully covered → nothing left', () => {
    expect(subtractRanges([[10, 20]], [[0, 100]])).toEqual([])
    expect(subtractRanges([[0, 100]], [[0, 100]])).toEqual([])
  })

  it('covered prefix, suffix and middle', () => {
    expect(subtractRanges([[0, 100]], [[0, 30]])).toEqual([[30, 100]])
    expect(subtractRanges([[0, 100]], [[70, 100]])).toEqual([[0, 70]])
    expect(subtractRanges([[0, 100]], [[30, 60]])).toEqual([[0, 30], [60, 100]])
  })

  it('several covered pieces and a request wider than all of them', () => {
    expect(subtractRanges([[0, 100]], [[10, 20], [40, 50], [90, 200]])).toEqual([[0, 10], [20, 40], [50, 90]])
  })

  it('adjacent covered pieces behave as one', () => {
    expect(subtractRanges([[0, 100]], [[0, 50], [50, 100]])).toEqual([])
  })

  it('covered range entirely outside the request changes nothing', () => {
    expect(subtractRanges([[0, 10]], [[20, 30]])).toEqual([[0, 10]])
  })

  it('several requested ranges', () => {
    expect(subtractRanges([[0, 10], [20, 40]], [[5, 25]])).toEqual([[0, 5], [25, 40]])
  })
})

describe('isCovered / totalRangeMs', () => {
  it('requires a non-empty request that is fully inside the covered ranges', () => {
    expect(isCovered([[10, 20]], [[0, 30]])).toBe(true)
    expect(isCovered([[10, 40]], [[0, 30]])).toBe(false)
    expect(isCovered([], [[0, 30]])).toBe(false)
  })

  it('sums merged lengths (overlap counted once)', () => {
    expect(totalRangeMs([[0, 10], [5, 15], [100, 110]])).toBe(25)
    expect(totalRangeMs([])).toBe(0)
  })
})

describe('dropSupersededPassages', () => {
  const p = (startMs: number, endMs: number, text: string, trackId?: string): TranscriptPassage =>
    trackId ? { startMs, endMs, text, trackId } : { startMs, endMs, text }

  it('keeps earlier passages that do not overlap the later window', () => {
    const { kept, dropped } = dropSupersededPassages([p(0, 4000, 'a'), p(4000, 8000, 'b')], [p(9000, 12000, 'c')])
    expect(kept.map((x) => x.text)).toEqual(['a', 'b'])
    expect(dropped).toEqual([])
  })

  it('drops an earlier passage overlapped by more than half of the shorter one', () => {
    const earlier = [p(28000, 30000, 'old tail')]
    const later = [p(28500, 31000, 'new')]
    // overlap 1500 / shorter 2000 = 0.75 > 0.5
    const { kept, dropped } = dropSupersededPassages(earlier, later)
    expect(kept).toEqual([])
    expect(dropped.map((x) => x.text)).toEqual(['old tail'])
  })

  it('keeps it when the overlap is exactly half or less', () => {
    const { kept } = dropSupersededPassages([p(0, 2000, 'a')], [p(1000, 5000, 'b')])
    expect(kept).toHaveLength(1) // overlap 1000 / shorter 2000 = 0.5, not MORE than half
  })

  it('compares passages of the same track only', () => {
    const { kept, dropped } = dropSupersededPassages(
      [p(0, 2000, 'a', 'track-1')],
      [p(0, 2000, 'b', 'track-2'), p(0, 2000, 'c')],
    )
    expect(kept).toHaveLength(1)
    expect(dropped).toEqual([])
    expect(dropSupersededPassages([p(0, 2000, 'a', 'track-1')], [p(0, 2000, 'b', 'track-1')]).dropped).toHaveLength(1)
  })

  it('ignores zero/negative-length passages instead of dividing by zero', () => {
    const { kept } = dropSupersededPassages([p(1000, 1000, 'empty')], [p(0, 5000, 'x')])
    expect(kept).toHaveLength(1)
  })
})

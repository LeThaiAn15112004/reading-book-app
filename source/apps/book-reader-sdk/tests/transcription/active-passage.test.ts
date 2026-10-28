import { describe, expect, it } from 'vitest'
import { findActivePassage, findActivePassageIndex } from '../../src/transcription/active-passage'
import type { TranscriptPassage } from '../../src/transcription/transcript-model'

const p = (startMs: number, endMs: number, text: string, trackId?: string): TranscriptPassage => ({ startMs, endMs, text, trackId })

describe('findActivePassageIndex — single file', () => {
  const passages = [p(1000, 2000, 'a'), p(2000, 3000, 'b'), p(5000, 6000, 'c')]

  it('no passages → -1', () => {
    expect(findActivePassageIndex([], { ms: 100 })).toBe(-1)
  })

  it('before the first passage → -1 (nothing is highlighted yet)', () => {
    expect(findActivePassageIndex(passages, { ms: 0 })).toBe(-1)
    expect(findActivePassageIndex(passages, { ms: 999 })).toBe(-1)
  })

  it('inside a passage → that passage; a boundary belongs to the passage that starts there', () => {
    expect(findActivePassageIndex(passages, { ms: 1000 })).toBe(0)
    expect(findActivePassageIndex(passages, { ms: 1999 })).toBe(0)
    expect(findActivePassageIndex(passages, { ms: 2000 })).toBe(1)
    expect(findActivePassageIndex(passages, { ms: 5500 })).toBe(2)
  })

  it('in a gap → the nearest previous passage stays active', () => {
    expect(findActivePassageIndex(passages, { ms: 3500 })).toBe(1)
    expect(findActivePassageIndex(passages, { ms: 4999 })).toBe(1)
  })

  it('after the last passage → the last one', () => {
    expect(findActivePassageIndex(passages, { ms: 999_999 })).toBe(2)
  })

  it('a non-finite position finds nothing', () => {
    expect(findActivePassageIndex(passages, { ms: NaN })).toBe(-1)
    expect(findActivePassageIndex(passages, { ms: Infinity })).toBe(-1)
  })

  it('agrees with a linear scan on many positions (binary search is right)', () => {
    const many = Array.from({ length: 200 }, (_, i) => p(i * 1500, i * 1500 + 1000, `p${i}`))
    for (let ms = 0; ms < 300_500; ms += 137) {
      let expected = -1
      for (let i = 0; i < many.length; i += 1) if ((many[i] as TranscriptPassage).startMs <= ms) expected = i
      expect(findActivePassageIndex(many, { ms })).toBe(expected)
    }
  })

  it('findActivePassage returns the passage or null', () => {
    expect(findActivePassage(passages, { ms: 2500 })?.text).toBe('b')
    expect(findActivePassage(passages, { ms: 10 })).toBeNull()
  })
})

describe('findActivePassageIndex — multi-track', () => {
  const order = ['t1', 't2', 't3']
  const passages = [
    p(1000, 2000, 't1-a', 't1'),
    p(3000, 4000, 't1-b', 't1'),
    p(500, 1500, 't2-a', 't2'),
    p(9000, 9500, 't2-b', 't2'),
  ]

  it('looks only inside the current track', () => {
    expect(findActivePassageIndex(passages, { trackId: 't1', ms: 3500 }, order)).toBe(1)
    expect(findActivePassageIndex(passages, { trackId: 't2', ms: 600 }, order)).toBe(2)
  })

  it('before the first passage of a later track is NOT the last passage of the earlier track', () => {
    expect(findActivePassageIndex(passages, { trackId: 't2', ms: 100 }, order)).toBe(-1)
  })

  it('after the last passage of a track → that track\'s last passage, not the next track\'s first', () => {
    expect(findActivePassageIndex(passages, { trackId: 't1', ms: 600_000 }, order)).toBe(1)
  })

  it('a track without passages, or not part of the book → -1', () => {
    expect(findActivePassageIndex(passages, { trackId: 't3', ms: 5000 }, order)).toBe(-1)
    expect(findActivePassageIndex(passages, { trackId: 'ghost', ms: 5000 }, order)).toBe(-1)
  })

  it('a single-file point never matches multi-track passages', () => {
    expect(findActivePassageIndex(passages, { ms: 1500 }, order)).toBe(-1)
  })

  it('works when the playback order differs from the alphabetical order of the ids', () => {
    const reordered = ['z', 'a']
    const list = [p(100, 200, 'z1', 'z'), p(100, 200, 'a1', 'a')]
    expect(findActivePassageIndex(list, { trackId: 'a', ms: 150 }, reordered)).toBe(1)
    expect(findActivePassageIndex(list, { trackId: 'z', ms: 150 }, reordered)).toBe(0)
  })
})

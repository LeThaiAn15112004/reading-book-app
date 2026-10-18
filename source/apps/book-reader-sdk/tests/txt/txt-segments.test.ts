import { describe, expect, it } from 'vitest'
import { segmentTxt, type TxtSpan } from '../../src/txt/index.js'
import { randomInt, rng } from './txt-fixtures.js'

const span = (id: string, startOffset: number, endOffset: number): TxtSpan => ({ id, startOffset, endOffset })

describe('segmentTxt', () => {
  it('is empty for an empty text and one plain segment without annotations', () => {
    expect(segmentTxt(0, [])).toEqual([])
    expect(segmentTxt(0, [span('a', 0, 3)])).toEqual([])
    expect(segmentTxt(10, [])).toEqual([{ start: 0, end: 10, ids: [] }])
  })

  it('cuts at the edges of one annotation', () => {
    expect(segmentTxt(10, [span('a', 3, 6)])).toEqual([
      { start: 0, end: 3, ids: [] },
      { start: 3, end: 6, ids: ['a'] },
      { start: 6, end: 10, ids: [] },
    ])
  })

  it('an annotation touching the start or the end leaves no empty segment', () => {
    expect(segmentTxt(5, [span('a', 0, 5)])).toEqual([{ start: 0, end: 5, ids: ['a'] }])
    expect(segmentTxt(5, [span('a', 0, 2)])).toEqual([
      { start: 0, end: 2, ids: ['a'] },
      { start: 2, end: 5, ids: [] },
    ])
  })

  it('overlapping annotations share the middle piece, in input order', () => {
    expect(segmentTxt(12, [span('a', 2, 8), span('b', 5, 10)])).toEqual([
      { start: 0, end: 2, ids: [] },
      { start: 2, end: 5, ids: ['a'] },
      { start: 5, end: 8, ids: ['a', 'b'] },
      { start: 8, end: 10, ids: ['b'] },
      { start: 10, end: 12, ids: [] },
    ])
  })

  it('nested and identical annotations', () => {
    expect(segmentTxt(10, [span('outer', 1, 9), span('inner', 3, 5), span('twin', 3, 5)])).toEqual([
      { start: 0, end: 1, ids: [] },
      { start: 1, end: 3, ids: ['outer'] },
      { start: 3, end: 5, ids: ['outer', 'inner', 'twin'] },
      { start: 5, end: 9, ids: ['outer'] },
      { start: 9, end: 10, ids: [] },
    ])
  })

  it('clamps ranges to the text and drops ones that end up empty', () => {
    expect(segmentTxt(5, [span('past', 3, 99), span('outside', 7, 9), span('neg', -4, 2)])).toEqual([
      { start: 0, end: 2, ids: ['neg'] },
      { start: 2, end: 3, ids: [] },
      { start: 3, end: 5, ids: ['past'] },
    ])
  })

  it('always tiles the text exactly with no empty piece, and ids match coverage (randomised)', () => {
    const next = rng(9)
    for (let round = 0; round < 200; round++) {
      const length = randomInt(next, 1, 60)
      const spans: TxtSpan[] = []
      for (let i = 0; i < randomInt(next, 0, 8); i++) {
        const s = randomInt(next, 0, length - 1)
        spans.push(span(`s${i}`, s, randomInt(next, s + 1, length)))
      }
      const segments = segmentTxt(length, spans)
      expect(segments[0]!.start).toBe(0)
      expect(segments[segments.length - 1]!.end).toBe(length)
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!
        expect(seg.end).toBeGreaterThan(seg.start)
        if (i > 0) expect(seg.start).toBe(segments[i - 1]!.end)
        for (const s of spans) {
          const covers = s.startOffset <= seg.start && s.endOffset >= seg.end
          expect(seg.ids.includes(s.id)).toBe(covers)
        }
      }
    }
  })
})

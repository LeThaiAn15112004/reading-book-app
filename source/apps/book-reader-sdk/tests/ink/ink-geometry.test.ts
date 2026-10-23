import { describe, expect, it } from 'vitest'
import {
  clientToPageUnit,
  distanceToInkPaths,
  filterMinDistance,
  inkPathData,
  inkStrokeAt,
  pageHeightRatio,
  simplifyInkPoints,
  translateInkPaths,
} from '../../src/ink/ink-geometry.js'
import type { InkPoint } from '../../src/ink/pdf-ink.js'

describe('clientToPageUnit', () => {
  it('stays the same point at any zoom, scroll or page offset', () => {
    const spot = (rect: { left: number; top: number; width: number; height: number }) =>
      clientToPageUnit(rect.left + rect.width * 0.25, rect.top + rect.height * 0.75, rect)
    const a = spot({ left: 100, top: 40, width: 600, height: 800 })
    const b = spot({ left: -50, top: -900, width: 1200, height: 1600 })
    const c = spot({ left: 10, top: 5, width: 300, height: 400 })
    for (const p of [a, b, c]) {
      expect(p![0]).toBeCloseTo(0.25, 9)
      expect(p![1]).toBeCloseTo(0.75, 9)
    }
  })

  it('clamps to the page box and rejects an empty rect', () => {
    expect(clientToPageUnit(-10, 5000, { left: 0, top: 0, width: 100, height: 100 })).toEqual([0, 1])
    expect(clientToPageUnit(1, 1, { left: 0, top: 0, width: 0, height: 100 })).toBeNull()
  })

  it('pageHeightRatio is height / width, 1 when unknown', () => {
    expect(pageHeightRatio(600, 800)).toBeCloseTo(4 / 3)
    expect(pageHeightRatio(0, 800)).toBe(1)
  })
})

describe('decimation', () => {
  it('filterMinDistance keeps endpoints and drops near-duplicates', () => {
    const pts: InkPoint[] = [
      [0, 0],
      [0.0001, 0],
      [0.5, 0],
      [0.5001, 0],
      [1, 0],
    ]
    expect(filterMinDistance(pts, 0.01, 1)).toEqual([
      [0, 0],
      [0.5, 0],
      [1, 0],
    ])
    expect(
      filterMinDistance(
        [
          [0, 0],
          [0, 0],
        ],
        0.01,
        1,
      ),
    ).toEqual([
      [0, 0],
      [0, 0],
    ])
  })

  it('simplifyInkPoints keeps a corner, drops collinear points, is idempotent', () => {
    const pts: InkPoint[] = [
      [0, 0],
      [0.25, 0],
      [0.5, 0],
      [0.5, 0.25],
      [0.5, 0.5],
    ]
    const out = simplifyInkPoints(pts, 0.001, 1)
    expect(out).toEqual([
      [0, 0],
      [0.5, 0],
      [0.5, 0.5],
    ])
    expect(simplifyInkPoints(out, 0.001, 1)).toEqual(out)
  })

  it('measures y in page-width units (a tall page)', () => {
    // 0.05 apart in y on a page twice as tall as wide is 0.1 page-width units.
    const path: InkPoint[] = [
      [0.5, 0.5],
      [0.5, 0.5],
    ]
    expect(distanceToInkPaths([path], 0.5, 0.55, 2)).toBeCloseTo(0.1, 9)
  })
})

describe('inkPathData', () => {
  it('scales y by the height ratio and handles 1, 2 and many points', () => {
    expect(inkPathData([[0.5, 0.5]], 2)).toBe('M 0.5 1 l 0 0')
    expect(
      inkPathData(
        [
          [0, 0],
          [1, 0.5],
        ],
        2,
      ),
    ).toBe('M 0 0 L 1 1')
    expect(
      inkPathData(
        [
          [0, 0],
          [0.5, 0.5],
          [1, 0],
        ],
        1,
      ),
    ).toBe('M 0 0 Q 0.5 0.5 0.75 0.25 L 1 0')
    expect(inkPathData([], 1)).toBe('')
  })
})

describe('inkStrokeAt', () => {
  const line: InkPoint[] = [
    [0.1, 0.5],
    [0.9, 0.5],
  ]
  const strokes = [
    { id: 'under', pageIndex: 0, paths: [line], width: 0.01 },
    { id: 'over', pageIndex: 0, paths: [line], width: 0.01 },
    { id: 'other-page', pageIndex: 1, paths: [line], width: 0.01 },
  ]

  it('returns the topmost stroke of the page under the point, within width/2 + slop', () => {
    expect(inkStrokeAt(strokes, 0, 0.5, 0.5, 1, 0)?.id).toBe('over')
    expect(inkStrokeAt(strokes, 1, 0.5, 0.5, 1, 0)?.id).toBe('other-page')
    expect(inkStrokeAt(strokes, 0, 0.5, 0.52, 1, 0)).toBeNull()
    expect(inkStrokeAt(strokes, 0, 0.5, 0.52, 1, 0.02)?.id).toBe('over')
    expect(inkStrokeAt(strokes, 2, 0.5, 0.5, 1, 0.02)).toBeNull()
  })
})

describe('translateInkPaths', () => {
  const path: InkPoint[] = [
    [0.2, 0.3],
    [0.4, 0.5],
  ]

  it('moves every point by the shift', () => {
    const out = translateInkPaths([path], 0.1, -0.1)
    expect(out.dx).toBeCloseTo(0.1, 9)
    expect(out.dy).toBeCloseTo(-0.1, 9)
    expect(out.paths).toEqual([
      [
        [0.3, 0.2],
        [0.5, 0.4],
      ],
    ])
  })

  it('clamps so the stroke stays inside the page and reports the shift really applied', () => {
    const right = translateInkPaths([path], 5, 0)
    expect(right.paths[0]![1]![0]).toBe(1)
    expect(right.dx).toBeCloseTo(0.6, 9)
    const upLeft = translateInkPaths([path], -5, -5)
    expect(upLeft.paths[0]![0]).toEqual([0, 0])
    expect(upLeft.dx).toBeCloseTo(-0.2, 9)
    expect(upLeft.dy).toBeCloseTo(-0.3, 9)
  })

  it('does not change the input and ignores non-finite shifts / empty paths', () => {
    const copy = JSON.parse(JSON.stringify(path))
    translateInkPaths([path], 0.1, 0.1)
    expect(path).toEqual(copy)
    expect(translateInkPaths([path], Number.NaN, 0.1).paths).toEqual([path])
    expect(translateInkPaths([], 0.1, 0.1)).toEqual({ paths: [], dx: 0, dy: 0 })
  })
})

import { describe, expect, it } from 'vitest'
import {
  INK_ERASER_RADIUS_PX,
  clampEraserRadiusPx,
  inkStrokesTouchedBySweep,
  inkSweepTouchesPaths,
} from '../../src/ink/ink-eraser.js'
import { clientToPageUnit } from '../../src/ink/ink-geometry.js'
import { applyHistoryStep, createUndoHistory, type HistoryAction } from '../../src/annotations/history.js'
import type { InkPoint } from '../../src/ink/pdf-ink.js'

const stroke = (id: string, pageIndex: number, path: InkPoint[], width = 0.004) => ({ id, pageIndex, paths: [path], width })

describe('eraser radius', () => {
  it('uses the plan defaults and clamps to 6–30 px', () => {
    expect(INK_ERASER_RADIUS_PX).toEqual({ default: 10, min: 6, max: 30 })
    expect(clampEraserRadiusPx(1)).toBe(6)
    expect(clampEraserRadiusPx(99)).toBe(30)
    expect(clampEraserRadiusPx(12)).toBe(12)
    expect(clampEraserRadiusPx(Number.NaN)).toBe(10)
  })
})

describe('inkSweepTouchesPaths', () => {
  const line: InkPoint[][] = [[[0.2, 0.5], [0.8, 0.5]]]

  it('hits when the eraser disc reaches the centre line, misses just beyond radius + half width', () => {
    expect(inkSweepTouchesPaths(line, 0.004, [0.5, 0.5], [0.5, 0.5], 0.01, 1)).toBe(true)
    // reach = 0.01 + 0.002
    expect(inkSweepTouchesPaths(line, 0.004, [0.5, 0.511], [0.5, 0.511], 0.01, 1)).toBe(true)
    expect(inkSweepTouchesPaths(line, 0.004, [0.5, 0.513], [0.5, 0.513], 0.01, 1)).toBe(false)
  })

  it('catches a fast sweep that jumps over the stroke between two samples', () => {
    expect(inkSweepTouchesPaths(line, 0.004, [0.5, 0.3], [0.5, 0.7], 0.005, 1)).toBe(true)
    expect(inkSweepTouchesPaths(line, 0.004, [0.1, 0.3], [0.1, 0.7], 0.005, 1)).toBe(false)
  })

  it('measures y in page-width units: the same page distance is farther on a tall page', () => {
    // 0.02 apart in y: 0.02 on a square page, 0.028 when the page is 1.4 times as tall as wide.
    expect(inkSweepTouchesPaths(line, 0.004, [0.5, 0.52], [0.5, 0.52], 0.02, 1)).toBe(true)
    expect(inkSweepTouchesPaths(line, 0.004, [0.5, 0.52], [0.5, 0.52], 0.02, 1.4)).toBe(false)
  })

  it('hits a dot (single-point path) and uses every path of the stroke', () => {
    expect(inkSweepTouchesPaths([[[0.3, 0.3]]], 0.004, [0.31, 0.3], [0.31, 0.3], 0.01, 1)).toBe(true)
    const two: InkPoint[][] = [[[0.1, 0.1], [0.2, 0.1]], [[0.8, 0.8], [0.9, 0.8]]]
    expect(inkSweepTouchesPaths(two, 0.004, [0.85, 0.8], [0.85, 0.8], 0.01, 1)).toBe(true)
  })
})

describe('inkStrokesTouchedBySweep', () => {
  const strokes = [
    stroke('a', 0, [[0.1, 0.5], [0.9, 0.5]]),
    stroke('b', 0, [[0.1, 0.8], [0.9, 0.8]]),
    stroke('other-page', 1, [[0.1, 0.5], [0.9, 0.5]]),
  ]

  it('returns every touched stroke of THAT page, whole, in input order', () => {
    expect(inkStrokesTouchedBySweep(strokes, 0, [0.5, 0.45], [0.5, 0.85], 0.01, 1)).toEqual(['a', 'b'])
    expect(inkStrokesTouchedBySweep(strokes, 1, [0.5, 0.45], [0.5, 0.55], 0.01, 1)).toEqual(['other-page'])
    expect(inkStrokesTouchedBySweep(strokes, 2, [0.5, 0.5], [0.5, 0.5], 0.01, 1)).toEqual([])
  })

  it('misses everything when the eraser stays clear', () => {
    expect(inkStrokesTouchedBySweep(strokes, 0, [0.5, 0.2], [0.5, 0.3], 0.01, 1)).toEqual([])
  })

  it('selects the same strokes at any zoom: a fixed screen radius is converted with the page width', () => {
    // The same on-screen gesture (a 10 px eraser pass 6 px beside the line) on a 400 px and an 800 px wide page.
    const touched = (pageWidth: number) => {
      const rect = { left: 30, top: 10, width: pageWidth, height: pageWidth * 1.4 }
      const from = clientToPageUnit(rect.left + pageWidth * 0.5, rect.top + 0.5 * rect.height + 6, rect)!
      const radius = INK_ERASER_RADIUS_PX.default / pageWidth
      return inkStrokesTouchedBySweep([stroke('z', 0, [[0.1, 0.5], [0.9, 0.5]], 0.002)], 0, from, from, radius, 1.4)
    }
    // 6 px away in screen space is inside the 10 px disc at 400 px, and also inside at 800 px (page width scales the radius, not the offset).
    expect(touched(400)).toEqual(['z'])
    expect(touched(800)).toEqual(['z'])
  })

  it('does not hit at a zoom where the same offset is farther than the screen radius', () => {
    const rect = { left: 0, top: 0, width: 400, height: 560 }
    const from = clientToPageUnit(200, 0.5 * rect.height + 14, rect)!
    expect(inkStrokesTouchedBySweep([stroke('z', 0, [[0.1, 0.5], [0.9, 0.5]], 0.002)], 0, from, from, 10 / 400, 1.4)).toEqual([])
  })
})

describe('one eraser gesture = one undo step (history batch)', () => {
  type Mark = { id: string }
  const apply = (action: HistoryAction<Mark>, direction: 'undo' | 'redo', live: Map<string, Mark>) =>
    applyHistoryStep(action, direction, {
      restore: (v) => void live.set(v.id, v),
      remove: (v) => void live.delete(v.id),
    })

  it('undo restores all erased strokes together and redo removes them again', () => {
    const history = createUndoHistory<Mark>()
    const live = new Map<string, Mark>([['c', { id: 'c' }]])
    history.push({ kind: 'batch', actions: [{ kind: 'remove', value: { id: 'a' } }, { kind: 'remove', value: { id: 'b' } }] })
    expect(history.canUndo()).toBe(true)
    apply(history.undo()!, 'undo', live)
    expect([...live.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(true)
    apply(history.redo()!, 'redo', live)
    expect([...live.keys()]).toEqual(['c'])
  })
})

describe('Eraser and Brush strokes', () => {
  const brushStroke = { id: 'brush', pageIndex: 0, paths: [[[0.2, 0.5], [0.8, 0.5]] as InkPoint[]], width: 0.012, penStyle: 'brush' }
  const penStroke = { id: 'pen', pageIndex: 0, paths: [[[0.2, 0.8], [0.8, 0.8]] as InkPoint[]], width: 0.004, penStyle: 'pen' }

  it('erases a Brush stroke as a whole, like any other Readmate stroke, and only the touched one', () => {
    const hit = inkStrokesTouchedBySweep([penStroke, brushStroke], 0, [0.5, 0.5], [0.5, 0.5], 0.01, 1)
    expect(hit).toEqual(['brush'])
  })

  it('the wider Brush is reached from further away than a Pen stroke (reach = radius + half width)', () => {
    const near = [0.5, 0.5 + 0.015] as InkPoint
    expect(inkStrokesTouchedBySweep([brushStroke], 0, near, near, 0.01, 1)).toEqual(['brush'])
    const penNear = [0.5, 0.8 + 0.015] as InkPoint
    expect(inkStrokesTouchedBySweep([penStroke], 0, penNear, penNear, 0.01, 1)).toEqual([])
  })
})

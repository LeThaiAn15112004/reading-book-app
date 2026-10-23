import { describe, expect, it } from 'vitest'
import {
  INK_INTERACTION_IDLE,
  INK_MIN_RESIZE_EXTENT,
  canResizeInk,
  clientToPageUnit,
  inkHandlePosition,
  inkOutlinesAvailable,
  inkSelectionBox,
  inkToolbarSide,
  pickInkTarget,
  reduceInkInteraction,
  resizeInkPaths,
  type InkInteraction,
  type InkPoint,
} from '../../src/index.js'

const RATIO = 1.4
const stroke = (id: string, paths: InkPoint[][], width = 0.004, pageIndex = 0) => ({ id, pageIndex, paths, width })
const A = stroke('a', [[[0.2, 0.2], [0.6, 0.4]]])
const B = stroke('b', [[[0.2, 0.2], [0.6, 0.4]]]) // exactly on top of A, drawn later

describe('reduceInkInteraction', () => {
  it('hover enter / leave only touches hoverId and never selects', () => {
    const entered = reduceInkInteraction(INK_INTERACTION_IDLE, { type: 'hover', id: 'a' })
    expect(entered).toEqual({ hoverId: 'a', selectedId: null })
    const left = reduceInkInteraction(entered, { type: 'hover', id: null })
    expect(left).toEqual(INK_INTERACTION_IDLE)
  })

  it('hover that changes nothing returns the same state object', () => {
    const s: InkInteraction = { hoverId: 'a', selectedId: null }
    expect(reduceInkInteraction(s, { type: 'hover', id: 'a' })).toBe(s)
  })

  it('hover to select: selecting drops the hover and sets the selection', () => {
    const hovered = reduceInkInteraction(INK_INTERACTION_IDLE, { type: 'hover', id: 'a' })
    expect(reduceInkInteraction(hovered, { type: 'select', id: 'a' })).toEqual({ hoverId: null, selectedId: 'a' })
  })

  it('the selected stroke is never hover-outlined; other strokes still are', () => {
    const selected: InkInteraction = { hoverId: null, selectedId: 'a' }
    expect(reduceInkInteraction(selected, { type: 'hover', id: 'a' })).toBe(selected)
    expect(reduceInkInteraction(selected, { type: 'hover', id: 'b' })).toEqual({ hoverId: 'b', selectedId: 'a' })
  })

  it('hover alone keeps the selection while the pointer moves around (handles, toolbar → hover null)', () => {
    let s: InkInteraction = { hoverId: null, selectedId: 'a' }
    for (const id of ['b', null, 'a', null]) s = reduceInkInteraction(s, { type: 'hover', id })
    expect(s.selectedId).toBe('a')
  })

  it('click on empty space and Escape deselect, hover feedback stays available', () => {
    const s: InkInteraction = { hoverId: 'b', selectedId: 'a' }
    expect(reduceInkInteraction(s, { type: 'clear' })).toEqual({ hoverId: 'b', selectedId: null })
    expect(reduceInkInteraction(s, { type: 'escape' })).toEqual({ hoverId: 'b', selectedId: null })
    const none = reduceInkInteraction(INK_INTERACTION_IDLE, { type: 'escape' })
    expect(none).toBe(INK_INTERACTION_IDLE)
    expect(reduceInkInteraction(none, { type: 'hover', id: 'c' }).hoverId).toBe('c')
  })

  it('removed strokes leave neither hover nor selection behind', () => {
    const s: InkInteraction = { hoverId: 'b', selectedId: 'a' }
    expect(reduceInkInteraction(s, { type: 'removed', ids: ['a'] })).toEqual({ hoverId: 'b', selectedId: null })
    expect(reduceInkInteraction(s, { type: 'removed', ids: ['a', 'b'] })).toEqual(INK_INTERACTION_IDLE)
    expect(reduceInkInteraction(s, { type: 'removed', ids: ['z'] })).toBe(s)
  })
})

describe('inkOutlinesAvailable (other reader tools)', () => {
  it('is on for Hand / Select and off while pen, eraser or text markup is armed', () => {
    expect(inkOutlinesAvailable({ pen: false, eraser: false, markup: false })).toBe(true)
    expect(inkOutlinesAvailable({ pen: true, eraser: false, markup: false })).toBe(false)
    expect(inkOutlinesAvailable({ pen: false, eraser: true, markup: false })).toBe(false)
    expect(inkOutlinesAvailable({ pen: false, eraser: false, markup: true })).toBe(false)
  })
})

describe('pickInkTarget (overlap)', () => {
  const strokes = [A, B]
  const onLine = [0.4, 0.3] as const
  it('picks the topmost (last drawn) stroke when nothing is selected', () => {
    expect(pickInkTarget(strokes, null, 0, onLine[0], onLine[1], RATIO, 0.01)?.id).toBe('b')
  })
  it('keeps the selected stroke even under a later one', () => {
    expect(pickInkTarget(strokes, 'a', 0, onLine[0], onLine[1], RATIO, 0.01)?.id).toBe('a')
  })
  it('falls back to the topmost when the selected stroke is not under the pointer', () => {
    const far = stroke('c', [[[0.8, 0.8], [0.9, 0.9]]])
    expect(pickInkTarget([A, B, far], 'c', 0, onLine[0], onLine[1], RATIO, 0.01)?.id).toBe('b')
  })
  it('is null on empty space and ignores other pages', () => {
    expect(pickInkTarget(strokes, null, 0, 0.9, 0.9, RATIO, 0.01)).toBeNull()
    expect(pickInkTarget(strokes, null, 1, onLine[0], onLine[1], RATIO, 0.01)).toBeNull()
  })
  it('is stable for the same input', () => {
    const ids = Array.from({ length: 5 }, () => pickInkTarget(strokes, null, 0, 0.4, 0.3, RATIO, 0.01)?.id)
    expect(new Set(ids).size).toBe(1)
  })
})

describe('inkSelectionBox', () => {
  it('wraps all points padded by the pen and keeps the same physical margin on both axes', () => {
    const box = inkSelectionBox(A.paths, A.width, RATIO)!
    const padX = A.paths[0]![0]![0] - box.x
    const padY = A.paths[0]![0]![1] - box.y
    expect(padX).toBeGreaterThan(A.width / 2)
    expect(padY * RATIO).toBeCloseTo(padX, 10)
    expect(box.x + box.width).toBeCloseTo(0.6 + padX, 10)
  })
  it('is null for no points', () => {
    expect(inkSelectionBox([], 0.004, RATIO)).toBeNull()
  })
  it('follows the page when the stroke moves (pure data, no pixel state): zoom only changes the scale', () => {
    const box = inkSelectionBox(A.paths, A.width, RATIO)!
    // Normalized units: the same box at 100 % and 200 % zoom maps to doubled pixels.
    const at = (w: number) => ({ left: 0, top: 0, width: w, height: w * RATIO })
    const p100 = clientToPageUnit(box.x * 600, box.y * 600 * RATIO, at(600))!
    const p200 = clientToPageUnit(box.x * 1200, box.y * 1200 * RATIO, at(1200))!
    expect(p100[0]).toBeCloseTo(p200[0], 10)
    expect(p100[1]).toBeCloseTo(p200[1], 10)
  })
})

describe('resize', () => {
  const paths: InkPoint[][] = [[[0.2, 0.2], [0.4, 0.3], [0.6, 0.4]]]
  const width = 0.004
  const box = inkSelectionBox(paths, width, RATIO)!

  it('is only offered for strokes with extent on both axes', () => {
    expect(canResizeInk(paths, RATIO)).toBe(true)
    expect(canResizeInk([[[0.5, 0.5], [0.5, 0.5]]], RATIO)).toBe(false) // dot
    expect(canResizeInk([[[0.2, 0.5], [0.6, 0.5]]], RATIO)).toBe(false) // flat line
    expect(canResizeInk([], RATIO)).toBe(false)
    expect(resizeInkPaths([[[0.5, 0.5], [0.5, 0.5]]], width, 'se', [0.9, 0.9], RATIO)).toBeNull()
  })

  it('dragging the south-east handle keeps the north-west corner and scales the rest', () => {
    const [hx, hy] = inkHandlePosition(box, 'se')
    const out = resizeInkPaths(paths, width, 'se', [hx + 0.2, hy + 0.1], RATIO)!
    expect(out[0]![0]).toEqual([0.2, 0.2])
    expect(out[0]![2]![0]).toBeCloseTo(0.8, 4)
    expect(out[0]![2]![1]).toBeCloseTo(0.5, 4)
    expect(out[0]![1]![0]).toBeCloseTo(0.5, 4) // the middle point scales with it
  })

  it('an edge handle changes one axis only', () => {
    const [hx, hy] = inkHandlePosition(box, 'e')
    const out = resizeInkPaths(paths, width, 'e', [hx + 0.2, hy], RATIO)!
    expect(out[0]!.map((p) => p[1])).toEqual([0.2, 0.3, 0.4])
    expect(out[0]![2]![0]).toBeCloseTo(0.8, 4)
  })

  it('no-op drag leaves the points unchanged', () => {
    const [hx, hy] = inkHandlePosition(box, 'nw')
    const out = resizeInkPaths(paths, width, 'nw', [hx, hy], RATIO)!
    out[0]!.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(paths[0]![i]![0], 4)
      expect(p[1]).toBeCloseTo(paths[0]![i]![1], 4)
    })
  })

  it('cannot collapse below the minimum extent or flip over the opposite edge', () => {
    const out = resizeInkPaths(paths, width, 'e', [0.0, 0.3], RATIO)!
    const xs = out[0]!.map((p) => p[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(INK_MIN_RESIZE_EXTENT - 1e-4)
    expect(Math.min(...xs)).toBeCloseTo(0.2, 4)
  })

  it('never leaves the page', () => {
    const out = resizeInkPaths(paths, width, 'se', [5, 5], RATIO)!
    for (const p of out[0]!) {
      expect(p[0]).toBeLessThanOrEqual(1)
      expect(p[1]).toBeLessThanOrEqual(1)
    }
  })
})

describe('inkToolbarSide', () => {
  it('opens above unless the box is too close to the page top', () => {
    expect(inkToolbarSide(200)).toBe('above')
    expect(inkToolbarSide(10)).toBe('below')
  })
})

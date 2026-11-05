import { describe, expect, it } from 'vitest'
import { erasePathsWithSweeps, type InkEraseSweep } from '../../src/ink/ink-partial-eraser.js'
import { INK_PEN_PRESETS, INK_PEN_STYLES } from '../../src/ink/ink-pen-styles.js'
import { clientToPageUnit } from '../../src/ink/ink-geometry.js'
import { parsePdfInk, type InkPoint } from '../../src/ink/pdf-ink.js'

const hline: InkPoint[][] = [[[0.1, 0.5], [0.9, 0.5]]]
const tap = (x: number, y: number): InkEraseSweep => ({ from: [x, y], to: [x, y] })

describe('erasePathsWithSweeps', () => {
  it('leaves the stroke alone when the eraser stays clear', () => {
    const r = erasePathsWithSweeps(hline, 0.004, [tap(0.5, 0.6)], 0.02, 1)
    expect(r.changed).toBe(false)
    expect(r.pieces).toEqual(hline)
  })

  it('cuts exactly on the eraser boundary (radius + half the pen width) and splits in two', () => {
    const r = erasePathsWithSweeps(hline, 0.004, [tap(0.5, 0.5)], 0.02, 1)
    expect(r.changed).toBe(true)
    expect(r.pieces).toHaveLength(2)
    const reach = 0.02 + 0.002
    expect(r.pieces[0]![0]).toEqual([0.1, 0.5])
    expect(r.pieces[0]![1]![0]).toBeCloseTo(0.5 - reach, 9)
    expect(r.pieces[1]![0]![0]).toBeCloseTo(0.5 + reach, 9)
    expect(r.pieces[1]![1]).toEqual([0.9, 0.5])
  })

  it('a thicker stroke is cut wider: the eraser reaches the pen edge, not just the centre line', () => {
    const thin = erasePathsWithSweeps(hline, 0.002, [tap(0.5, 0.5)], 0.02, 1).pieces
    const thick = erasePathsWithSweeps(hline, 0.03, [tap(0.5, 0.5)], 0.02, 1).pieces
    expect(thick[0]![1]![0]).toBeLessThan(thin[0]![1]![0])
  })

  it('an eraser passing beside the line cuts a shorter gap; one beyond radius + width/2 cuts nothing', () => {
    const direct = erasePathsWithSweeps(hline, 0.004, [tap(0.5, 0.5)], 0.02, 1).pieces
    const beside = erasePathsWithSweeps(hline, 0.004, [tap(0.5, 0.515)], 0.02, 1).pieces
    expect(beside).toHaveLength(2)
    expect(beside[0]![1]![0]).toBeGreaterThan(direct[0]![1]![0])
    expect(erasePathsWithSweeps(hline, 0.004, [tap(0.5, 0.53)], 0.02, 1).changed).toBe(false)
  })

  it('trims an end (one piece) and erases everything when the sweep covers the whole stroke', () => {
    const end = erasePathsWithSweeps(hline, 0.004, [tap(0.1, 0.5)], 0.03, 1)
    expect(end.pieces).toHaveLength(1)
    expect(end.pieces[0]![0]![0]).toBeCloseTo(0.1 + 0.032, 9)
    expect(end.pieces[0]![1]).toEqual([0.9, 0.5])
    const all = erasePathsWithSweeps(hline, 0.004, [{ from: [0.05, 0.5], to: [0.95, 0.5] }], 0.02, 1)
    expect(all.changed).toBe(true)
    expect(all.pieces).toEqual([])
  })

  it('a sweep that jumps over the stroke between two samples still cuts it', () => {
    const r = erasePathsWithSweeps(hline, 0.004, [{ from: [0.5, 0.3], to: [0.5, 0.7] }], 0.01, 1)
    expect(r.pieces).toHaveLength(2)
  })

  it('keeps a bend as one polyline and cuts only the covered stretch', () => {
    const bent: InkPoint[][] = [[[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.9, 0.5]]]
    const keep = erasePathsWithSweeps(bent, 0.004, [tap(0.1, 0.1)], 0.02, 1).pieces
    expect(keep).toHaveLength(1)
    expect(keep[0]).toHaveLength(4)
    const cut = erasePathsWithSweeps(bent, 0.004, [tap(0.5, 0.3)], 0.02, 1).pieces
    expect(cut).toHaveLength(2)
    expect(cut[0]!.at(-1)![0]).toBeCloseTo(0.5, 9)
    expect(cut[0]!.at(-1)![1]).toBeCloseTo(0.3 - 0.022, 9)
    expect(cut[1]![0]![1]).toBeCloseTo(0.3 + 0.022, 9)
  })

  it('is idempotent: repeating the same sweep never erases more', () => {
    const one = erasePathsWithSweeps(hline, 0.004, [tap(0.5, 0.5)], 0.02, 1)
    const again = erasePathsWithSweeps(hline, 0.004, [tap(0.5, 0.5), tap(0.5, 0.5), tap(0.5, 0.5)], 0.02, 1)
    expect(again.pieces).toEqual(one.pieces)
  })

  it('repeated crossings in one gesture: three passes leave three gaps and four intact pieces', () => {
    const sweeps = [0.25, 0.5, 0.75].map((x): InkEraseSweep => ({ from: [x, 0.4], to: [x, 0.6] }))
    const r = erasePathsWithSweeps(hline, 0.004, sweeps, 0.02, 1)
    expect(r.pieces).toHaveLength(4)
    expect(r.pieces[0]![0]).toEqual([0.1, 0.5])
    expect(r.pieces[3]!.at(-1)).toEqual([0.9, 0.5])
    const more = erasePathsWithSweeps(hline, 0.004, [...sweeps, { from: [0.5, 0.6], to: [0.5, 0.4] }], 0.02, 1)
    expect(more.pieces).toEqual(r.pieces)
  })

  it('overlapping sweeps merge into one gap', () => {
    const r = erasePathsWithSweeps(hline, 0.004, [tap(0.45, 0.5), tap(0.5, 0.5), tap(0.55, 0.5)], 0.03, 1)
    expect(r.pieces).toHaveLength(2)
  })

  it('drops a speck left between two close cuts, but keeps an untouched short path', () => {
    const r = erasePathsWithSweeps(hline, 0.02, [tap(0.3, 0.5), tap(0.3 + 0.1 + 0.005, 0.5)], 0.04, 1)
    // reach 0.05: the stretch between the cuts is 0.105 - 0.1 = 0.005 long, under width / 2
    expect(r.pieces).toHaveLength(2)
    const tick: InkPoint[][] = [[[0.8, 0.2], [0.8005, 0.2]], [[0.1, 0.5], [0.9, 0.5]]]
    const t = erasePathsWithSweeps(tick, 0.02, [tap(0.5, 0.5)], 0.03, 1)
    expect(t.pieces[0]).toEqual([[0.8, 0.2], [0.8005, 0.2]])
  })

  it('erases a dot (single point or two equal points) entirely or not at all', () => {
    const dot: InkPoint[][] = [[[0.3, 0.3], [0.3, 0.3]]]
    expect(erasePathsWithSweeps(dot, 0.004, [tap(0.31, 0.3)], 0.02, 1).pieces).toEqual([])
    expect(erasePathsWithSweeps(dot, 0.004, [tap(0.6, 0.6)], 0.02, 1).pieces).toEqual(dot)
    expect(erasePathsWithSweeps([[[0.3, 0.3]]], 0.004, [tap(0.31, 0.3)], 0.02, 1).pieces).toEqual([])
  })

  it('closely spaced strokes: only the one the eraser touches is cut', () => {
    const other: InkPoint[][] = [[[0.1, 0.56], [0.9, 0.56]]]
    const sweep = [tap(0.5, 0.5)]
    expect(erasePathsWithSweeps(hline, 0.004, sweep, 0.02, 1).changed).toBe(true)
    expect(erasePathsWithSweeps(other, 0.004, sweep, 0.02, 1).changed).toBe(false)
  })

  it('works in page-width units: a tall page cuts a shorter vertical gap in normalized y', () => {
    const vline: InkPoint[][] = [[[0.5, 0.1], [0.5, 0.9]]]
    const square = erasePathsWithSweeps(vline, 0.004, [tap(0.5, 0.5)], 0.02, 1).pieces
    const tall = erasePathsWithSweeps(vline, 0.004, [tap(0.5, 0.5)], 0.02, 1.4).pieces
    expect(0.5 - square[0]![1]![1]).toBeCloseTo(0.022, 9)
    expect(0.5 - tall[0]![1]![1]).toBeCloseTo(0.022 / 1.4, 9)
  })

  it('the same on-screen gesture covers a smaller part of the page when zoomed in', () => {
    const cutAt = (pageWidth: number) => {
      const rect = { left: 12, top: 40, width: pageWidth, height: pageWidth * 1.4 }
      const centre = clientToPageUnit(rect.left + pageWidth * 0.5, rect.top + rect.height * 0.5, rect)!
      const r = erasePathsWithSweeps(hline, 0.004, [{ from: centre, to: centre }], 10 / pageWidth, 1.4)
      return r.pieces[0]![1]![0]
    }
    expect(cutAt(1800)).toBeGreaterThan(cutAt(300))
    expect(cutAt(300)).toBeCloseTo(0.5 - (10 / 300 + 0.002), 9)
  })

  it('every piece is a valid stroke for each freehand style (Pen, Pencil, Marker, Brush)', () => {
    expect(INK_PEN_STYLES).toEqual(['pen', 'pencil', 'marker', 'brush'])
    for (const style of INK_PEN_STYLES) {
      const width = INK_PEN_PRESETS[style].width
      const { pieces } = erasePathsWithSweeps(hline, width, [tap(0.5, 0.5)], 0.02, 1)
      expect(pieces.length).toBe(2)
      for (const piece of pieces) {
        expect(parsePdfInk({ pageIndex: 0, paths: [piece], penStyle: style, width })).toBeDefined()
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
import {
  focalZoomScroll,
  nearestZoomAnchorIndex,
  scrollToHoldZoomAnchor,
  zoomAnchorAt,
  type ScrollOffset,
  type ZoomAnchorBox,
} from '../../src/viewport/zoom.js'

/**
 * Model of the desktop PDF surface (PdfRenderer in a native ReaderZoomViewport): pages stacked
 * top to bottom, each slot `floor(pt × 4/3 × zoom)` px, gap / padding `round(12|16 × zoom)`, the
 * column centred in a container at least as wide as the viewport. The viewport sits at client
 * (0, 0), so a box's client rect is its content position minus the scroll offset.
 */
type Size = { w: number; h: number }
const VIEW = { w: 1000, h: 700 }

function layout(pages: Size[], zoom: number) {
  const scale = (96 / 72) * zoom
  const pad = Math.round(16 * zoom)
  const gap = Math.round(12 * zoom)
  const boxes = pages.map((p) => ({ width: Math.floor(p.w * scale), height: Math.floor(p.h * scale) }))
  const columnWidth = Math.max(VIEW.w, Math.max(...boxes.map((b) => b.width)) + 2 * pad)
  let top = pad
  const placed = boxes.map((b) => {
    const box = { left: (columnWidth - b.width) / 2, top, width: b.width, height: b.height }
    top += b.height + gap
    return box
  })
  const contentHeight = top - gap + pad
  return {
    boxes: placed,
    maxLeft: Math.max(0, columnWidth - VIEW.w),
    maxTop: Math.max(0, contentHeight - VIEW.h),
  }
}

type Layout = ReturnType<typeof layout>

const client = (box: ZoomAnchorBox, scroll: ScrollOffset): ZoomAnchorBox => ({
  ...box,
  left: box.left - scroll.left,
  top: box.top - scroll.top,
})

const clampTo = (l: Layout, s: ScrollOffset): ScrollOffset => ({
  left: Math.min(Math.max(s.left, 0), l.maxLeft),
  top: Math.min(Math.max(s.top, 0), l.maxTop),
})

/** Scroll that puts the top of page `index` (0-based) at the top of the viewport. */
function scrollToPage(l: Layout, index: number): ScrollOffset {
  return clampTo(l, { left: l.maxLeft / 2, top: l.boxes[index]!.top })
}

/**
 * One zoom step from `zoom` to `next` with the cursor at client (x, y), the way the viewport does
 * it: capture the anchor in the old layout, relayout, measure the anchor box, scroll (clamped).
 * Returns the new scroll and how far the document point ended up from the cursor.
 */
function zoomStep(
  pages: Size[],
  zoom: number,
  next: number,
  scroll: ScrollOffset,
  x: number,
  y: number,
  method: 'anchor' | 'linear' = 'anchor',
) {
  const before = layout(pages, zoom)
  const index = nearestZoomAnchorIndex(
    pages.length,
    (i) => {
      const b = client(before.boxes[i]!, scroll)
      return { top: b.top, bottom: b.top + b.height }
    },
    y,
  )
  const anchor = zoomAnchorAt(index, client(before.boxes[index]!, scroll), x, y)
  const after = layout(pages, next)
  const wanted =
    method === 'anchor'
      ? scrollToHoldZoomAnchor(scroll, client(after.boxes[index]!, scroll), anchor, x, y)
      : focalZoomScroll(scroll, zoom, next, { offsetX: x, offsetY: y })
  const applied = clampTo(after, wanted)
  const box = client(after.boxes[index]!, applied)
  const ideal = scrollToHoldZoomAnchor(scroll, client(after.boxes[index]!, scroll), anchor, x, y)
  return {
    scroll: applied,
    index,
    dx: box.left + anchor.fx * box.width - x,
    dy: box.top + anchor.fy * box.height - y,
    clampedX: ideal.left < 0 || ideal.left > after.maxLeft,
    clampedY: ideal.top < 0 || ideal.top > after.maxTop,
  }
}

const UNIFORM: Size[] = Array.from({ length: 300 }, () => ({ w: 612, h: 792 }))
const MIXED: Size[] = Array.from({ length: 60 }, (_, i) =>
  [{ w: 612, h: 792 }, { w: 500, h: 700 }, { w: 792, h: 612 }, { w: 420, h: 595 }][i % 4]!,
)

function expectHeld(step: ReturnType<typeof zoomStep>) {
  if (!step.clampedX) expect(Math.abs(step.dx)).toBeLessThan(1e-6)
  if (!step.clampedY) expect(Math.abs(step.dy)).toBeLessThan(1e-6)
}

describe('nearestZoomAnchorIndex', () => {
  const boxes = [
    { top: 0, bottom: 100 },
    { top: 110, bottom: 200 },
    { top: 220, bottom: 300 },
  ]
  const at = (i: number) => boxes[i]!

  it('finds the box holding y', () => {
    expect(nearestZoomAnchorIndex(3, at, 50)).toBe(0)
    expect(nearestZoomAnchorIndex(3, at, 110)).toBe(1)
    expect(nearestZoomAnchorIndex(3, at, 299)).toBe(2)
  })

  it('picks the nearer neighbour inside a gap', () => {
    expect(nearestZoomAnchorIndex(3, at, 103)).toBe(0)
    expect(nearestZoomAnchorIndex(3, at, 108)).toBe(1)
    expect(nearestZoomAnchorIndex(3, at, 205)).toBe(1)
    expect(nearestZoomAnchorIndex(3, at, 215)).toBe(2)
  })

  it('clamps to the first / last box beyond the ends, -1 with no boxes', () => {
    expect(nearestZoomAnchorIndex(3, at, -40)).toBe(0)
    expect(nearestZoomAnchorIndex(3, at, 900)).toBe(2)
    expect(nearestZoomAnchorIndex(0, at, 10)).toBe(-1)
  })

  it('reads only O(log n) boxes', () => {
    let reads = 0
    const many = (i: number) => {
      reads++
      return { top: i * 100, bottom: i * 100 + 90 }
    }
    expect(nearestZoomAnchorIndex(10_000, many, 512_345)).toBe(5123)
    expect(reads).toBeLessThan(40)
  })
})

describe('zoomAnchorAt / scrollToHoldZoomAnchor', () => {
  it('round-trips a point through a box that moved and grew', () => {
    const anchor = zoomAnchorAt(4, { left: 100, top: 50, width: 200, height: 400 }, 150, 250)
    expect(anchor).toEqual({ index: 4, fx: 0.25, fy: 0.5 })
    // Same box after zoom ×1.5 and a shift: the point is now at (250, 500) → scroll by (100, 250).
    const next = scrollToHoldZoomAnchor({ left: 10, top: 1000 }, { left: 175, top: 200, width: 300, height: 600 }, anchor, 150, 250)
    expect(next).toEqual({ left: 110, top: 1250 })
  })

  it('keeps fractions outside 0..1 for a point in the gap beside a box', () => {
    const anchor = zoomAnchorAt(0, { left: 0, top: 0, width: 100, height: 100 }, 50, 106)
    expect(anchor.fy).toBeCloseTo(1.06)
  })
})

describe('cursor zoom on a PDF-like layout', () => {
  it('root cause: the proportional formula drifts with per-page pixel rounding far into the document', () => {
    let l = layout(UNIFORM, 1)
    const scroll = scrollToPage(l, 200)
    const linear = zoomStep(UNIFORM, 1, 1.1, scroll, 500, 350, 'linear')
    // Tens of px per 10% step at page 200 — and it compounds step after step.
    expect(Math.abs(linear.dy)).toBeGreaterThan(40)
    l = layout(MIXED, 1)
    const mixed = zoomStep(MIXED, 1, 1.1, scrollToPage(l, 34), 400, 420, 'linear')
    expect(Math.abs(mixed.dy)).toBeGreaterThan(10)
  })

  it('holds the point in the middle of a page, zooming in and out', () => {
    let zoom = 1
    let scroll = scrollToPage(layout(UNIFORM, zoom), 120)
    for (const factor of [1.1, 1.1, 1.1, 1 / 1.1, 1 / 1.1, 1 / 1.1, 1 / 1.1, 1.25]) {
      const step = zoomStep(UNIFORM, zoom, zoom * factor, scroll, 500, 350)
      expectHeld(step)
      expect(step.index).toBe(120)
      zoom *= factor
      scroll = step.scroll
    }
  })

  it('holds corners and edge points (horizontal centring included)', () => {
    for (const [x, y] of [
      [40, 30],
      [960, 30],
      [40, 680],
      [960, 680],
      [500, 2],
    ] as const) {
      let zoom = 1.6 // page wider than the viewport: horizontal scrolling is live
      let scroll = scrollToPage(layout(UNIFORM, zoom), 50)
      for (const factor of [1.1, 1.1, 1 / 1.1, 1 / 1.1, 1 / 1.1]) {
        const step = zoomStep(UNIFORM, zoom, zoom * factor, scroll, x, y)
        expectHeld(step)
        zoom *= factor
        scroll = step.scroll
      }
    }
  })

  it('holds a point in the gap / at the boundary between two pages without changing page', () => {
    const zoom = 1
    const l = layout(UNIFORM, zoom)
    const scroll = { left: 0, top: l.boxes[80]!.top + l.boxes[80]!.height - 350 }
    const boundary = l.boxes[80]!.top + l.boxes[80]!.height - scroll.top // client y of page 81's bottom
    // On page 81, in the 12 px gap, on page 82. A gap point may re-attach to the other neighbour
    // (it is nearest to either), but never to a page beyond the two.
    for (const [y, inGap] of [
      [boundary - 3, false],
      [boundary + 2, true],
      [boundary + 6, true],
      [boundary + 11, true],
      [boundary + 14, false],
    ] as const) {
      let z = zoom
      let s = scroll
      const first = zoomStep(UNIFORM, z, z, s, 500, y).index
      for (const factor of [1.1, 1.1, 1.1, 1 / 1.1, 1 / 1.1, 1 / 1.1]) {
        const step = zoomStep(UNIFORM, z, z * factor, s, 500, y)
        expectHeld(step)
        if (inGap) expect([80, 81]).toContain(step.index)
        else expect(step.index).toBe(first)
        z *= factor
        s = step.scroll
      }
    }
  })

  it('holds the point across mixed page sizes far into the document, many steps', () => {
    let zoom = 1
    let scroll = scrollToPage(layout(MIXED, zoom), 47)
    const factors = [1.1, 1.21, 1.1, 1 / 1.331, 1 / 1.1, 1 / 1.1, 1.25, 1.25, 1.25, 1 / 1.25, 1.1]
    for (const factor of factors) {
      const step = zoomStep(MIXED, zoom, zoom * factor, scroll, 380, 520)
      expectHeld(step)
      expect(step.index).toBe(47)
      zoom *= factor
      scroll = step.scroll
    }
  })

  it('only gives up the point where the scroll range runs out (top of the document)', () => {
    const step = zoomStep(UNIFORM, 1.5, 1.5 / 1.1, { left: 0, top: 0 }, 500, 20)
    expect(step.clampedY).toBe(true)
    expect(step.scroll.top).toBe(0)
  })
})

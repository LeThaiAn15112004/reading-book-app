import { describe, expect, it } from 'vitest'
import { classifyGesture, isSwipeCandidate, type GestureInput } from '../../src/app-models/reader-gesture.js'

const W = 400

function gesture(patch: Partial<GestureInput> & { dx?: number; dy?: number; ms?: number; x?: number } = {}): GestureInput {
  const { dx = 0, dy = 0, ms = 200, x = 200, ...rest } = patch
  return {
    view: 'page',
    start: { x, y: 300, t: 1000 },
    end: { x: x + dx, y: 300 + dy, t: 1000 + ms },
    maxMoveBeforeMs350: { dx: Math.sign(dx) * Math.min(Math.abs(dx), 40), dy: 0 },
    width: W,
    startedOnMarkOrLink: false,
    selectionSeen: false,
    layersOpen: false,
    zoomEdge: null,
    ...rest,
  }
}

const kind = (input: GestureInput) => classifyGesture(input).kind

describe('classifyGesture — swipes (spec 019 FR-003 / FR-004)', () => {
  it('a long horizontal swipe turns: left = next, right = prev', () => {
    expect(kind(gesture({ dx: -150 }))).toBe('swipe-next')
    expect(kind(gesture({ dx: 150 }))).toBe('swipe-prev')
  })

  it('a short but fast flick turns (velocity)', () => {
    expect(kind(gesture({ dx: -60, ms: 100 }))).toBe('swipe-next')
  })

  it('a short slow move springs back', () => {
    expect(kind(gesture({ dx: -60, ms: 400 }))).toBe('none')
  })

  it('below the minimum distance or mostly vertical: none', () => {
    expect(kind(gesture({ dx: -40, ms: 50 }))).toBe('none')
    expect(kind(gesture({ dx: -120, dy: 100 }))).toBe('none')
  })

  it('a move that started after 350 ms (long press, selection) never turns', () => {
    expect(kind(gesture({ dx: -200, ms: 900, maxMoveBeforeMs350: { dx: 2, dy: 1 } }))).toBe('none')
  })

  it('selection, a mark / link start or an open layer: no swipe', () => {
    expect(kind(gesture({ dx: -200, selectionSeen: true }))).toBe('none')
    expect(kind(gesture({ dx: -200, startedOnMarkOrLink: true }))).toBe('none')
    expect(kind(gesture({ dx: -200, layersOpen: true }))).toBe('none')
  })

  it('Scroll view never swipes (FR-006)', () => {
    expect(kind(gesture({ dx: -200, view: 'scroll' }))).toBe('none')
  })
})

describe('classifyGesture — zoomed PDF (FR-013b)', () => {
  it('turns only when the edge of its direction was already reached', () => {
    expect(kind(gesture({ dx: -200, zoomEdge: { left: false, right: false } }))).toBe('none')
    expect(kind(gesture({ dx: -200, zoomEdge: { left: true, right: false } }))).toBe('none')
    expect(kind(gesture({ dx: -200, zoomEdge: { left: false, right: true } }))).toBe('swipe-next')
    expect(kind(gesture({ dx: 200, zoomEdge: { left: true, right: false } }))).toBe('swipe-prev')
  })
})

describe('classifyGesture — taps (FR-005 / FR-006 / FR-008)', () => {
  it('Page view: edges turn, the middle toggles', () => {
    expect(kind(gesture({ x: 20, ms: 100 }))).toBe('tap-prev')
    expect(kind(gesture({ x: 390, ms: 100 }))).toBe('tap-next')
    expect(kind(gesture({ x: 200, ms: 100 }))).toBe('tap-middle')
  })

  it('Scroll view: a tap anywhere toggles', () => {
    expect(kind(gesture({ x: 5, ms: 100, view: 'scroll' }))).toBe('tap-middle')
  })

  it('a tap on a mark / link or with a selection is left to the page', () => {
    expect(kind(gesture({ x: 5, ms: 100, startedOnMarkOrLink: true }))).toBe('none')
    expect(kind(gesture({ x: 200, ms: 100, selectionSeen: true }))).toBe('none')
  })

  it('with a layer open an edge tap does not turn (tap-middle closes the layer)', () => {
    expect(kind(gesture({ x: 5, ms: 100, layersOpen: true }))).toBe('tap-middle')
  })

  it('a long press without movement is none', () => {
    expect(kind(gesture({ x: 200, ms: 700 }))).toBe('none')
  })
})

describe('isSwipeCandidate (the page follows the finger)', () => {
  const base = {
    view: 'page' as const,
    dy: 0,
    maxMoveBeforeMs350: { dx: -20, dy: 0 },
    startedOnMarkOrLink: false,
    selectionSeen: false,
    layersOpen: false,
    zoomEdge: null,
  }
  it('follows an early horizontal move', () => {
    expect(isSwipeCandidate({ ...base, dx: -30 })).toBe(true)
  })
  it('not for late, vertical, blocked or scroll moves', () => {
    expect(isSwipeCandidate({ ...base, dx: -30, maxMoveBeforeMs350: { dx: 1, dy: 0 } })).toBe(false)
    expect(isSwipeCandidate({ ...base, dx: -30, dy: 40 })).toBe(false)
    expect(isSwipeCandidate({ ...base, dx: -30, selectionSeen: true })).toBe(false)
    expect(isSwipeCandidate({ ...base, dx: -30, view: 'scroll' })).toBe(false)
    expect(isSwipeCandidate({ ...base, dx: -30, zoomEdge: { left: true, right: false } })).toBe(false)
  })
})

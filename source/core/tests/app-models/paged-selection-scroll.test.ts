import { describe, expect, it } from 'vitest'
import {
  isPageAligned,
  pageIndexAt,
  selectionEdgeAt,
  turnedPageScrollLeft,
  type SelectionEdgeInput,
} from '../../src/app-models/paged-selection-scroll.js'

/** A phone page: 400 px wide, text from y 40 to 760, 24 px lines. */
function edge(patch: Partial<SelectionEdgeInput> & { x?: number; y?: number } = {}): SelectionEdgeInput {
  const { x = 200, y = 400, ...rest } = patch
  return {
    focus: { left: x, top: y, bottom: y + 20 },
    forward: true,
    visible: { left: 0, right: 400 },
    text: { top: 40, bottom: 760 },
    columnWidth: 400,
    lineHeight: 24,
    ...rest,
  }
}

describe('selectionEdgeAt — selecting forwards', () => {
  it('the middle of the page is no edge', () => {
    expect(selectionEdgeAt(edge())).toBeNull()
  })

  it('the last lines of the page are the end', () => {
    expect(selectionEdgeAt(edge({ y: 720 }))).toBe('next')
    expect(selectionEdgeAt(edge({ y: 690 }))).toBeNull()
  })

  it('past the page on the right is the end', () => {
    expect(selectionEdgeAt(edge({ x: 410, y: 60 }))).toBe('next')
  })

  it('the first lines are no edge forwards, and the focus left behind after a turn never turns back', () => {
    expect(selectionEdgeAt(edge({ y: 45 }))).toBeNull()
    expect(selectionEdgeAt(edge({ x: -300, y: 730 }))).toBeNull()
  })

  it('a two-page spread: only the last lines of the RIGHT column', () => {
    const spread = { visible: { left: 0, right: 800 }, columnWidth: 400 }
    expect(selectionEdgeAt(edge({ ...spread, x: 200, y: 730 }))).toBeNull()
    expect(selectionEdgeAt(edge({ ...spread, x: 600, y: 730 }))).toBe('next')
  })
})

describe('selectionEdgeAt — selecting backwards (copying text of the page before)', () => {
  it('the first lines of the page are the start', () => {
    expect(selectionEdgeAt(edge({ forward: false, y: 50 }))).toBe('prev')
    expect(selectionEdgeAt(edge({ forward: false, y: 120 }))).toBeNull()
  })

  it('past the page on the left is the start', () => {
    expect(selectionEdgeAt(edge({ forward: false, x: -5, y: 400 }))).toBe('prev')
  })

  it('the last lines are no edge backwards', () => {
    expect(selectionEdgeAt(edge({ forward: false, y: 730 }))).toBeNull()
    expect(selectionEdgeAt(edge({ forward: false, x: 700, y: 60 }))).toBeNull()
  })

  it('a two-page spread: only the first lines of the LEFT column', () => {
    const spread = { visible: { left: 0, right: 800 }, columnWidth: 400, forward: false }
    expect(selectionEdgeAt(edge({ ...spread, x: 600, y: 50 }))).toBeNull()
    expect(selectionEdgeAt(edge({ ...spread, x: 100, y: 50 }))).toBe('prev')
  })
})

describe('page boundaries', () => {
  const STEP = 400
  const MAX = 4 * STEP

  it('pageIndexAt rounds to the nearest page, clamped', () => {
    expect(pageIndexAt(0, STEP, MAX)).toBe(0)
    expect(pageIndexAt(STEP + 150, STEP, MAX)).toBe(1)
    expect(pageIndexAt(STEP + 250, STEP, MAX)).toBe(2)
    expect(pageIndexAt(99_999, STEP, MAX)).toBe(4)
  })

  it('turnedPageScrollLeft: one whole page, none past the section', () => {
    expect(turnedPageScrollLeft(1, 'next', STEP, MAX)).toBe(2 * STEP)
    expect(turnedPageScrollLeft(1, 'prev', STEP, MAX)).toBe(0)
    expect(turnedPageScrollLeft(0, 'prev', STEP, MAX)).toBeNull()
    expect(turnedPageScrollLeft(4, 'next', STEP, MAX)).toBeNull()
  })

  it('isPageAligned: a boundary (sub-pixel ok) vs half-way', () => {
    expect(isPageAligned(2 * STEP + 0.5, STEP, MAX)).toBe(true)
    expect(isPageAligned(2 * STEP + 37, STEP, MAX)).toBe(false)
    expect(isPageAligned(123, 0, MAX)).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import {
  idleTimerRunning,
  initialChromeState,
  reduceChrome,
  swipesAllowed,
  topLayer,
  type ChromeEvent,
  type ChromeState,
  TAP_DEDUPE_MS,
  TAP_SCROLL_GRACE_MS,
} from '../../src/app-models/phone-reader-chrome.js'

const run = (state: ChromeState, ...events: ChromeEvent[]) => events.reduce(reduceChrome, state)
const shown = (): ChromeState => ({ ...initialChromeState('b1'), barsVisible: true })

describe('reduceChrome (spec 019 FR-008 / FR-021)', () => {
  it('open-book resets everything and hides the bars', () => {
    const busy: ChromeState = {
      bookId: 'b1',
      barsVisible: true,
      layers: ['marks', 'mark'],
      sliderDragging: true,
      toast: { id: 3, text: 'x' },
      topInsetPx: 52,
      lastTapAt: 1000,
    }
    const next = reduceChrome(busy, { type: 'open-book', bookId: 'b2' })
    expect(next).toEqual({
      bookId: 'b2',
      barsVisible: false,
      layers: [],
      sliderDragging: false,
      toast: null,
      topInsetPx: 52,
      lastTapAt: null,
    })
  })

  it('one physical tap seen twice switches the bars once; a later tap switches them back', () => {
    const s0 = initialChromeState('b1')
    const once = run(s0, { type: 'tap-middle', at: 1000 }, { type: 'tap-middle', at: 1000 + TAP_DEDUPE_MS - 1 })
    expect(once.barsVisible).toBe(true)
    expect(run(once, { type: 'tap-middle', at: 1000 + TAP_DEDUPE_MS + 50 }).barsVisible).toBe(false)
  })

  it('a duplicate tap does not also close a layer', () => {
    const s = run(shown(), { type: 'layer-open', layer: 'marks' }, { type: 'layer-open', layer: 'mark' })
    const next = run(s, { type: 'tap-middle', at: 5000 }, { type: 'tap-middle', at: 5100 })
    expect(next.layers).toEqual(['marks'])
  })

  it('a scroll right after the tap that showed the bars keeps them; a later scroll hides them', () => {
    const s = reduceChrome(initialChromeState('b1'), { type: 'tap-middle', at: 2000 })
    expect(reduceChrome(s, { type: 'scrolled', at: 2000 + TAP_SCROLL_GRACE_MS - 1 }).barsVisible).toBe(true)
    expect(reduceChrome(s, { type: 'scrolled', at: 2000 + TAP_SCROLL_GRACE_MS }).barsVisible).toBe(false)
  })

  it('tap-middle toggles the bars only when no layer is open', () => {
    const s0 = initialChromeState('b1')
    expect(reduceChrome(s0, { type: 'tap-middle' }).barsVisible).toBe(true)
    expect(run(s0, { type: 'tap-middle' }, { type: 'tap-middle' }).barsVisible).toBe(false)
  })

  it('tap-middle with a layer open closes the top layer and leaves the bars', () => {
    const s = run(shown(), { type: 'layer-open', layer: 'marks' }, { type: 'layer-open', layer: 'mark' })
    const next = reduceChrome(s, { type: 'tap-middle' })
    expect(next.layers).toEqual(['marks'])
    expect(next.barsVisible).toBe(true)
  })

  it('page-turned and scrolled hide the bars and keep the layers', () => {
    const s = run(shown(), { type: 'layer-open', layer: 'selection' })
    for (const type of ['page-turned', 'scrolled'] as const) {
      const next = reduceChrome(s, { type })
      expect(next.barsVisible).toBe(false)
      expect(next.layers).toEqual(['selection'])
    }
  })

  it('idle-elapsed hides only with no layer and the slider not held', () => {
    expect(reduceChrome(shown(), { type: 'idle-elapsed' }).barsVisible).toBe(false)
    expect(run(shown(), { type: 'layer-open', layer: 'toc' }, { type: 'idle-elapsed' }).barsVisible).toBe(true)
    expect(run(shown(), { type: 'slider-drag', on: true }, { type: 'idle-elapsed' }).barsVisible).toBe(true)
  })

  it('layer-open pushes without duplicates; an open layer moves to the top', () => {
    const s = run(
      initialChromeState('b1'),
      { type: 'layer-open', layer: 'marks' },
      { type: 'layer-open', layer: 'mark' },
      { type: 'layer-open', layer: 'marks' },
    )
    expect(s.layers).toEqual(['mark', 'marks'])
    expect(topLayer(s)).toBe('marks')
  })

  it('layer-close removes the layer and every layer above it, bars unchanged (FR-002)', () => {
    const s = run(
      shown(),
      { type: 'layer-open', layer: 'marks' },
      { type: 'layer-open', layer: 'mark' },
      { type: 'layer-open', layer: 'confirm' },
    )
    const next = reduceChrome(s, { type: 'layer-close', layer: 'mark' })
    expect(next.layers).toEqual(['marks'])
    expect(next.barsVisible).toBe(true)
    expect(reduceChrome(next, { type: 'layer-close', layer: 'toc' })).toBe(next)
  })

  it('toasts replace each other and expire by id', () => {
    const a = reduceChrome(initialChromeState('b1'), { type: 'toast', text: 'one' })
    const b = reduceChrome(a, { type: 'toast', text: 'two' })
    expect(b.toast?.text).toBe('two')
    expect(reduceChrome(b, { type: 'toast-expired', id: a.toast!.id }).toast?.text).toBe('two')
    expect(reduceChrome(b, { type: 'toast-expired', id: b.toast!.id }).toast).toBeNull()
  })

  it('derived: swipesAllowed and idleTimerRunning', () => {
    const s = shown()
    expect(swipesAllowed(s)).toBe(true)
    expect(idleTimerRunning(s)).toBe(true)
    const withLayer = reduceChrome(s, { type: 'layer-open', layer: 'selection' })
    expect(swipesAllowed(withLayer)).toBe(false)
    expect(idleTimerRunning(withLayer)).toBe(false)
    expect(idleTimerRunning(reduceChrome(s, { type: 'slider-drag', on: true }))).toBe(false)
    expect(idleTimerRunning(initialChromeState('b1'))).toBe(false)
  })
})

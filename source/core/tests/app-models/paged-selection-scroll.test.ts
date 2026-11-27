import { describe, expect, it } from 'vitest'
import {
  SELECTION_PAGE_TURN_COOLDOWN_MS,
  decidePagedSelectionScroll,
  initialPagedSelectionScrollState,
  type PagedSelectionScrollInput,
  type PagedSelectionScrollState,
} from '../../src/app-models/paged-selection-scroll.js'

const W = 400
/** A section of 5 pages: scrollLeft 0 … 1600. */
const MAX = 4 * W

function input(patch: Partial<PagedSelectionScrollInput>): PagedSelectionScrollInput {
  return {
    scrollLeft: 0,
    pageWidth: W,
    maxScrollLeft: MAX,
    selectionActive: true,
    selectionJustEnded: false,
    now: 10_000,
    ...patch,
  }
}

const onPage = (page: number): PagedSelectionScrollState => ({ settledPage: page, lastTurnAt: null })

describe('decidePagedSelectionScroll — selecting across pages', () => {
  it('a drift forward while selecting turns one whole page forward', () => {
    const d = decidePagedSelectionScroll(onPage(1), input({ scrollLeft: W + 37 }))
    expect(d.targetScrollLeft).toBe(2 * W)
    expect(d.state).toEqual({ settledPage: 2, lastTurnAt: 10_000 })
  })

  it('a drift back while selecting turns one whole page back (copying text of the page before)', () => {
    const d = decidePagedSelectionScroll(onPage(2), input({ scrollLeft: 2 * W - 25 }))
    expect(d.targetScrollLeft).toBe(W)
    expect(d.state.settledPage).toBe(1)
  })

  it('inside the cooldown a drift snaps back to the page it is on; after it, the next page turns', () => {
    const turned: PagedSelectionScrollState = { settledPage: 2, lastTurnAt: 10_000 }
    const held = decidePagedSelectionScroll(turned, input({ scrollLeft: 2 * W + 15, now: 10_200 }))
    expect(held.targetScrollLeft).toBe(2 * W)
    expect(held.state).toEqual(turned)
    const again = decidePagedSelectionScroll(
      turned,
      input({ scrollLeft: 2 * W + 15, now: 10_000 + SELECTION_PAGE_TURN_COOLDOWN_MS }),
    )
    expect(again.targetScrollLeft).toBe(3 * W)
  })

  it('never past the first or the last page of the section', () => {
    expect(decidePagedSelectionScroll(onPage(0), input({ scrollLeft: 0.5 })).targetScrollLeft).toBeNull()
    expect(decidePagedSelectionScroll(onPage(4), input({ scrollLeft: MAX - 20 })).targetScrollLeft).toBe(3 * W)
    const atEnd = decidePagedSelectionScroll({ settledPage: 4, lastTurnAt: null }, input({ scrollLeft: MAX + 0 }))
    expect(atEnd.targetScrollLeft).toBeNull()
  })

  it('a remembered page far from the box (another section / layout) starts from where the box is', () => {
    const d = decidePagedSelectionScroll(onPage(4), input({ scrollLeft: 30 }))
    expect(d.targetScrollLeft).toBe(W)
  })

  it('a two-page spread is one step', () => {
    const spread = 2 * W
    const d = decidePagedSelectionScroll(
      onPage(0),
      input({ pageWidth: spread, maxScrollLeft: 2 * spread, scrollLeft: 60 }),
    )
    expect(d.targetScrollLeft).toBe(spread)
  })
})

describe('decidePagedSelectionScroll — boundaries and no selection', () => {
  it('on a boundary nothing moves; the page is remembered', () => {
    const d = decidePagedSelectionScroll(onPage(0), input({ scrollLeft: 3 * W + 0.4, selectionActive: false }))
    expect(d.targetScrollLeft).toBeNull()
    expect(d.state.settledPage).toBe(3)
  })

  it('a drift right after the selection ended snaps to the nearest page', () => {
    const d = decidePagedSelectionScroll(
      onPage(1),
      input({ scrollLeft: W + 260, selectionActive: false, selectionJustEnded: true }),
    )
    expect(d.targetScrollLeft).toBe(2 * W)
  })

  it('without a selection a drift is left alone (epub.js moves, a hand pan, a resize)', () => {
    const d = decidePagedSelectionScroll(onPage(1), input({ scrollLeft: W + 120, selectionActive: false }))
    expect(d.targetScrollLeft).toBeNull()
  })

  it('no page width yet: nothing', () => {
    expect(decidePagedSelectionScroll(onPage(0), input({ pageWidth: 0, scrollLeft: 50 })).targetScrollLeft).toBeNull()
  })

  it('initial state from the box', () => {
    expect(initialPagedSelectionScrollState(2 * W, W)).toEqual({ settledPage: 2, lastTurnAt: null })
    expect(initialPagedSelectionScrollState(100, 0)).toEqual({ settledPage: 0, lastTurnAt: null })
  })
})

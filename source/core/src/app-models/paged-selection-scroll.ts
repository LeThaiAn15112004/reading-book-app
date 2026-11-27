/**
 * EPUB Page view: keep the paginated box on a page boundary while text is being selected.
 *
 * epub.js lays a section out as CSS columns in a box with `overflow: hidden`; a "page" is only `scrollLeft`, a multiple
 * of the page width. Dragging a selection to an edge makes the browser scroll that box by however far the finger
 * pushes (Chrome autoscroll, Android's selection-handle scroll), so the page stopped half-way between two pages — and
 * epub.js turns by adding one page to the current `scrollLeft`, so the offset stayed on every later page.
 *
 * Rule: while a selection is live, a scroll off the boundary is read as "go on selecting there": it turns ONE whole
 * page in that direction (forward or back), at most one page per `SELECTION_PAGE_TURN_COOLDOWN_MS`; inside the
 * cooldown it snaps back to the page it is on. Right after the selection ends, a leftover drift snaps to the nearest
 * page. Without a selection nothing is touched (epub.js's own moves, a hand pan, a resize stay theirs).
 * Pure: the caller reads the DOM and applies `targetScrollLeft`.
 */

/** A selection drag turns at most one page this often (a held edge keeps turning, one page at a time). */
export const SELECTION_PAGE_TURN_COOLDOWN_MS = 500
/** After the selection ends, a drift this soon is still the drag's own (the browser's last autoscroll). */
export const SELECTION_SETTLE_MS = 1000
/** Sub-pixel rounding of `scrollLeft` is not a drift. */
export const PAGE_ALIGN_EPSILON_PX = 1

export interface PagedSelectionScrollState {
  /** The page (0-based, within the section) the box was last on a boundary of. */
  settledPage: number
  /** When the last selection turn happened (ms, the caller's clock); null = none yet. */
  lastTurnAt: number | null
}

export interface PagedSelectionScrollInput {
  scrollLeft: number
  /** Width of one page step (epub.js `layout.delta`; a two-page spread is one step). */
  pageWidth: number
  /** `scrollWidth - clientWidth` of the box. */
  maxScrollLeft: number
  /** A non-collapsed selection exists in the section right now. */
  selectionActive: boolean
  /** A selection ended within `SELECTION_SETTLE_MS`. */
  selectionJustEnded: boolean
  /** ms */
  now: number
}

export interface PagedSelectionScrollDecision {
  state: PagedSelectionScrollState
  /** Where to put `scrollLeft`; null = leave it. */
  targetScrollLeft: number | null
}

export function initialPagedSelectionScrollState(scrollLeft = 0, pageWidth = 0): PagedSelectionScrollState {
  return { settledPage: pageWidth > 0 ? Math.max(0, Math.round(scrollLeft / pageWidth)) : 0, lastTurnAt: null }
}

function lastPageOf(pageWidth: number, maxScrollLeft: number): number {
  return Math.max(0, Math.ceil((Math.max(0, maxScrollLeft) - PAGE_ALIGN_EPSILON_PX) / pageWidth))
}

/** `scrollLeft` of 0-based `page` (the last page may end short of a full step). */
export function pageScrollLeft(page: number, pageWidth: number, maxScrollLeft: number): number {
  return Math.min(page * pageWidth, Math.max(0, maxScrollLeft))
}

export function decidePagedSelectionScroll(
  state: PagedSelectionScrollState,
  input: PagedSelectionScrollInput,
): PagedSelectionScrollDecision {
  const { scrollLeft, pageWidth, maxScrollLeft } = input
  if (!(pageWidth > 0)) return { state, targetScrollLeft: null }
  const lastPage = lastPageOf(pageWidth, maxScrollLeft)
  const clamp = (page: number) => Math.min(lastPage, Math.max(0, page))
  const offset = (page: number) => pageScrollLeft(page, pageWidth, maxScrollLeft)

  const nearest = clamp(Math.round(scrollLeft / pageWidth))
  if (Math.abs(scrollLeft - offset(nearest)) <= PAGE_ALIGN_EPSILON_PX) {
    // On a boundary (epub.js's own turn, or our snap landing): remember it.
    return { state: { ...state, settledPage: nearest }, targetScrollLeft: null }
  }

  if (input.selectionActive) {
    // A remembered page more than a step away belongs to another layout / section: start from where the box is.
    let settled = clamp(state.settledPage)
    if (Math.abs(scrollLeft - offset(settled)) >= pageWidth) settled = clamp(Math.floor(scrollLeft / pageWidth))
    const direction = scrollLeft > offset(settled) ? 1 : -1
    const canTurn = state.lastTurnAt === null || input.now - state.lastTurnAt >= SELECTION_PAGE_TURN_COOLDOWN_MS
    const page = canTurn ? clamp(settled + direction) : settled
    const turned = page !== settled
    return {
      state: { settledPage: page, lastTurnAt: turned ? input.now : state.lastTurnAt },
      targetScrollLeft: offset(page),
    }
  }

  if (input.selectionJustEnded) {
    return { state: { ...state, settledPage: nearest }, targetScrollLeft: offset(nearest) }
  }

  return { state, targetScrollLeft: null }
}

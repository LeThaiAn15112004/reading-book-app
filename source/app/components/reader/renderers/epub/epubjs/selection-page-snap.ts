/**
 * Page view: a selection dragged to an edge turns whole pages instead of leaving the page between two pages.
 *
 * The browser scrolls epub.js's paginated box (`overflow: hidden`, a page = `scrollLeft` step) while a selection is
 * dragged against an edge, by however far the finger / mouse pushes. On that box's `scroll` event this applies core
 * `decidePagedSelectionScroll`: one whole page in the drag's direction (forward or back), at most one page per
 * cooldown, else back onto the page boundary. Setting `scrollLeft` fires epub.js's own scroll handling, which reports
 * the new location (CFI, progress), so nothing else is needed. Handled synchronously in the `scroll` event (dispatched
 * before paint), so the half-page offset is never drawn. Left-to-right books only (epub.js's RTL `scrollLeft` is
 * negative or reversed depending on the engine).
 */
import type { Rendition } from 'epubjs'
import {
  SELECTION_SETTLE_MS,
  decidePagedSelectionScroll,
  initialPagedSelectionScrollState,
  type PagedSelectionScrollState,
} from '@core'
import { currentSectionDocument, getRenditionLayoutDelta, renditionManager } from './rendition-internals'

type ManagerLike = { container?: HTMLElement; settings?: { direction?: string } }

function hasLiveSelection(doc: Document | null): boolean {
  const selection = doc?.defaultView?.getSelection()
  return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed)
}

/** Starts watching; returns the cleanup. `isPaged` is read at every scroll (the view mode can change). */
export function attachSelectionPageSnap(rendition: Rendition, isPaged: () => boolean): () => void {
  const manager = renditionManager(rendition) as ManagerLike | undefined
  const container = manager?.container
  if (!container) return () => {}

  let state: PagedSelectionScrollState = initialPagedSelectionScrollState(
    container.scrollLeft,
    getRenditionLayoutDelta(rendition),
  )
  let lastSelectionAt = -Infinity

  const onScroll = () => {
    if (!isPaged()) return
    const direction = manager?.settings?.direction
    if (direction && direction !== 'ltr') return
    const now = performance.now()
    const selectionActive = hasLiveSelection(currentSectionDocument(rendition))
    if (selectionActive) lastSelectionAt = now
    const decision = decidePagedSelectionScroll(state, {
      scrollLeft: container.scrollLeft,
      pageWidth: getRenditionLayoutDelta(rendition),
      maxScrollLeft: container.scrollWidth - container.clientWidth,
      selectionActive,
      selectionJustEnded: !selectionActive && now - lastSelectionAt < SELECTION_SETTLE_MS,
      now,
    })
    state = decision.state
    if (decision.targetScrollLeft !== null && decision.targetScrollLeft !== container.scrollLeft) {
      container.scrollLeft = decision.targetScrollLeft
    }
  }

  // A new section (or a re-layout) starts from wherever epub.js put the box.
  const onRendered = () => {
    state = initialPagedSelectionScrollState(container.scrollLeft, getRenditionLayoutDelta(rendition))
  }

  container.addEventListener('scroll', onScroll, { passive: true })
  rendition.on('rendered', onRendered)
  return () => {
    container.removeEventListener('scroll', onScroll)
    rendition.off('rendered', onRendered)
  }
}

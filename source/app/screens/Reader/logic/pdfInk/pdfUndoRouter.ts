import { usePdfHighlightsStore } from '../pdfHighlights/pdfHighlightsStore'
import { usePdfInkStore } from './pdfInkStore'

/**
 * Ctrl/Cmd+Z on a PDF goes to ONE of two independent histories: Ink strokes (`pdfInkStore`) or text
 * markup (`pdfHighlightsStore`). The newest edit is undone first, so draw → highlight → undo → undo
 * reverts the highlight, then the stroke; redo replays them in the opposite order.
 *
 * The router keeps the interleaving itself: `order` lists which store made each edit (oldest first) and
 * `redoOrder` which store each undo went to. An edit is seen as it happens — Ink counts its recorded
 * edits (`pushes`), text markup changes its `highlights` list — while the router's own undo/redo steps
 * (`routing`) are ignored. A change to the highlights that has no history entry (an embedded-annotation
 * sync) can leave a stray `hl` in `order`; undo then skips entries whose store has nothing to undo.
 */
type Which = 'ink' | 'hl'

const MAX_ORDER = 200
let order: Which[] = []
let redoOrder: Which[] = []
let routing = false

function noteEdit(which: Which): void {
  order.push(which)
  if (order.length > MAX_ORDER) order.shift()
  redoOrder = []
}

function forget(): void {
  order = []
  redoOrder = []
}

usePdfInkStore.subscribe((state, prev) => {
  if (state.pushes === 0) {
    if (prev.pushes !== 0) forget()
  } else if (state.pushes > prev.pushes) {
    noteEdit('ink')
  }
})

usePdfHighlightsStore.subscribe((state, prev) => {
  if (routing || state.highlights === prev.highlights) return
  // A cleared history is a new book (or a reset): nothing from before it can be undone.
  if (!state.history.canUndo()) forget()
  else noteEdit('hl')
})

function canUndo(which: Which): boolean {
  return which === 'ink' ? usePdfInkStore.getState().canUndo() : usePdfHighlightsStore.getState().history.canUndo()
}

function canRedo(which: Which): boolean {
  return which === 'ink' ? usePdfInkStore.getState().canRedo() : usePdfHighlightsStore.getState().history.canRedo()
}

function step(which: Which, direction: 'undo' | 'redo'): void {
  routing = true
  try {
    if (which === 'ink') usePdfInkStore.getState()[direction]()
    else usePdfHighlightsStore.getState()[direction]()
  } finally {
    routing = false
  }
}

export function pdfUndo(): void {
  while (order.length > 0) {
    const which = order.pop()!
    if (!canUndo(which)) continue
    step(which, 'undo')
    redoOrder.push(which)
    return
  }
  // Nothing in the log (edits made before the router saw them): whichever store has something.
  const which: Which | null = canUndo('ink') ? 'ink' : canUndo('hl') ? 'hl' : null
  if (which) {
    step(which, 'undo')
    redoOrder.push(which)
  }
}

export function pdfRedo(): void {
  while (redoOrder.length > 0) {
    const which = redoOrder.pop()!
    if (!canRedo(which)) continue
    step(which, 'redo')
    order.push(which)
    return
  }
}

/** Delete targets whichever store has the selection/focus: a selected stroke first, else the focused text mark. */
export function pdfHasFocusedMark(): boolean {
  return usePdfInkStore.getState().selectedId != null || usePdfHighlightsStore.getState().hasFocusedHighlight()
}

export function pdfDeleteFocused(): void {
  const ink = usePdfInkStore.getState()
  if (ink.selectedId) ink.deleteSelected()
  else usePdfHighlightsStore.getState().deleteFocused()
}

import type { HighlightAction } from './highlight-history.js'
import type { ReaderHighlight } from './highlight-location.js'

/**
 * Applies the opposite of a pushed action (undo) or re-applies it (redo) — the caller supplies
 * the actual state-mutation + persistence side effects; this module only picks which snapshot
 * goes where. Adapted from the deleted, multi-entity `annotation-undo.ts` (`git show HEAD`),
 * narrowed to `ReaderHighlight` — a single-entity history no longer needs per-entity
 * restore/remove pairs or a separate "replaced" refresh callback (the zustand store's
 * `patchHighlightById` already keeps an open edit popup in sync with the live row).
 */
export type HighlightUndoHandlers = {
  /** Make `h` the current row — insert if missing, overwrite if present. Covers an 'add' redo,
   *  a 'remove' undo, and either side of a 'replace' uniformly. */
  restore: (h: ReaderHighlight) => void
  remove: (id: string) => void
}

export function applyHighlightHistoryStep(
  action: HighlightAction,
  direction: 'undo' | 'redo',
  handlers: HighlightUndoHandlers,
): void {
  if (action.kind === 'add') {
    if (direction === 'undo') handlers.remove(action.value.id)
    else handlers.restore(action.value)
    return
  }
  if (action.kind === 'remove') {
    if (direction === 'undo') handlers.restore(action.value)
    else handlers.remove(action.value.id)
    return
  }
  handlers.restore(direction === 'undo' ? action.before : action.after)
}

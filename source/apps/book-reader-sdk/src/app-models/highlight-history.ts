import type { ReaderHighlight } from './highlight-location.js'

/**
 * One reversible highlight mutation for Ctrl+Z / Ctrl+Y. Adapted from the deleted, generic
 * `annotation-history.ts` (recoverable via `git show HEAD`), narrowed to this app's one
 * remaining overlay type — no more `{entity, value}` tagged-union wrapper.
 */
export type HighlightAction =
  | { kind: 'add'; value: ReaderHighlight }
  | { kind: 'remove'; value: ReaderHighlight }
  | { kind: 'replace'; before: ReaderHighlight; after: ReaderHighlight }

const DEFAULT_LIMIT = 50

export type HighlightHistory = {
  push: (action: HighlightAction) => void
  undo: () => HighlightAction | null
  redo: () => HighlightAction | null
  clear: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

/**
 * Session-only undo/redo stack — never persisted to disk. A fresh instance is created per book
 * (the reader hook calls `.clear()` whenever the open book changes).
 */
export function createHighlightHistory(limit = DEFAULT_LIMIT): HighlightHistory {
  let undoStack: HighlightAction[] = []
  let redoStack: HighlightAction[] = []

  return {
    push(action) {
      undoStack.push(action)
      if (undoStack.length > limit) undoStack.shift()
      redoStack = []
    },
    undo() {
      const action = undoStack.pop()
      if (!action) return null
      redoStack.push(action)
      return action
    },
    redo() {
      const action = redoStack.pop()
      if (!action) return null
      undoStack.push(action)
      return action
    },
    clear() {
      undoStack = []
      redoStack = []
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
  }
}

export function highlightAdd(value: ReaderHighlight): HighlightAction {
  return { kind: 'add', value }
}

export function highlightRemove(value: ReaderHighlight): HighlightAction {
  return { kind: 'remove', value }
}

export function highlightReplace(before: ReaderHighlight, after: ReaderHighlight): HighlightAction {
  return { kind: 'replace', before, after }
}

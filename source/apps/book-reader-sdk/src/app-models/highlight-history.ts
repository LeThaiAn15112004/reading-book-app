import type { ReaderHighlight } from './highlight-location.js'

/**
 * One reversible highlight mutation for Ctrl+Z / Ctrl+Y. Adapted from the deleted, generic
 * `annotation-history.ts` (recoverable via `git show HEAD`), narrowed to this app's one
 * remaining overlay type — no more `{entity, value}` tagged-union wrapper. Generic over the row
 * type so the PDF store (`PdfReaderHighlight`) shares it; defaults to the EPUB `ReaderHighlight`.
 */
export type HighlightAction<T = ReaderHighlight> =
  | { kind: 'add'; value: T }
  | { kind: 'remove'; value: T }
  | { kind: 'replace'; before: T; after: T }

const DEFAULT_LIMIT = 50

export type HighlightHistory<T = ReaderHighlight> = {
  push: (action: HighlightAction<T>) => void
  undo: () => HighlightAction<T> | null
  redo: () => HighlightAction<T> | null
  clear: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

/**
 * Session-only undo/redo stack — never persisted to disk. A fresh instance is created per book
 * (the reader hook calls `.clear()` whenever the open book changes).
 */
export function createHighlightHistory<T = ReaderHighlight>(limit = DEFAULT_LIMIT): HighlightHistory<T> {
  let undoStack: HighlightAction<T>[] = []
  let redoStack: HighlightAction<T>[] = []

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

export function highlightAdd<T = ReaderHighlight>(value: T): HighlightAction<T> {
  return { kind: 'add', value }
}

export function highlightRemove<T = ReaderHighlight>(value: T): HighlightAction<T> {
  return { kind: 'remove', value }
}

export function highlightReplace<T = ReaderHighlight>(before: T, after: T): HighlightAction<T> {
  return { kind: 'replace', before, after }
}

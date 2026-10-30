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
export const COALESCE_WINDOW_MS = 1000

export type HighlightHistory<T = ReaderHighlight> = {
  /**
   * `coalesceKey`: a `replace` pushed with the same key as the previous push, on the same row and within
   * `COALESCE_WINDOW_MS`, merges into it (one undo step for a colour / size drag): `before` stays the first one.
   */
  push: (action: HighlightAction<T>, coalesceKey?: string) => void
  undo: () => HighlightAction<T> | null
  redo: () => HighlightAction<T> | null
  clear: () => void
  /**
   * Remove every step (undo and redo side) `matches` holds for — e.g. all steps of a row that no longer exists, so
   * a step that can never be applied does not block the ones behind it.
   */
  dropWhere: (matches: (action: HighlightAction<T>) => boolean) => void
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
  let last: { key: string; at: number } | null = null

  return {
    push(action, coalesceKey) {
      const top = undoStack[undoStack.length - 1]
      const now = Date.now()
      if (
        coalesceKey &&
        last?.key === coalesceKey &&
        now - last.at <= COALESCE_WINDOW_MS &&
        top?.kind === 'replace' &&
        action.kind === 'replace' &&
        (top.after as { id?: unknown }).id === (action.before as { id?: unknown }).id
      ) {
        undoStack[undoStack.length - 1] = { kind: 'replace', before: top.before, after: action.after }
        last = { key: coalesceKey, at: now }
        redoStack = []
        return
      }
      last = coalesceKey ? { key: coalesceKey, at: now } : null
      undoStack.push(action)
      if (undoStack.length > limit) undoStack.shift()
      redoStack = []
    },
    undo() {
      last = null
      const action = undoStack.pop()
      if (!action) return null
      redoStack.push(action)
      return action
    },
    redo() {
      last = null
      const action = redoStack.pop()
      if (!action) return null
      undoStack.push(action)
      return action
    },
    clear() {
      last = null
      undoStack = []
      redoStack = []
    },
    dropWhere(matches) {
      last = null
      undoStack = undoStack.filter((a) => !matches(a))
      redoStack = redoStack.filter((a) => !matches(a))
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

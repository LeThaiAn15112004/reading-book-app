import type { ReaderHighlight } from './readerSession'

/** One reversible annotation mutation for Ctrl+Z / Ctrl+Y. */
export type AnnotationAction =
  | { kind: 'add'; highlight: ReaderHighlight }
  | { kind: 'remove'; highlight: ReaderHighlight }
  | { kind: 'replace'; before: ReaderHighlight; after: ReaderHighlight }

const DEFAULT_LIMIT = 50

export type AnnotationHistory = {
  push: (action: AnnotationAction) => void
  undo: () => AnnotationAction | null
  redo: () => AnnotationAction | null
  clear: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

export function createAnnotationHistory(
  limit = DEFAULT_LIMIT,
): AnnotationHistory {
  let undoStack: AnnotationAction[] = []
  let redoStack: AnnotationAction[] = []

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

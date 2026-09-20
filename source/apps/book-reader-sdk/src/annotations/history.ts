/** One reversible mutation of an entity keyed by `id`. */
export type HistoryAction<T> =
  | { kind: 'add'; value: T }
  | { kind: 'remove'; value: T }
  | { kind: 'replace'; before: T; after: T }

export interface UndoHistory<T> {
  push(action: HistoryAction<T>): void
  /** Pops the latest action onto the redo stack and returns it; `null` when empty. */
  undo(): HistoryAction<T> | null
  redo(): HistoryAction<T> | null
  clear(): void
  canUndo(): boolean
  canRedo(): boolean
}

/**
 * Session-only undo/redo stack (never persisted). Generalized from the desktop
 * `createHighlightHistory`; a new push clears the redo stack, the oldest entry is dropped past
 * `limit`.
 */
export function createUndoHistory<T>(limit = 50): UndoHistory<T> {
  let undoStack: HistoryAction<T>[] = []
  let redoStack: HistoryAction<T>[] = []

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

export interface HistoryStepHandlers<T> {
  /** Make `value` the current row — insert if missing, overwrite if present. */
  restore(value: T): void
  remove(value: T): void
}

/** Apply the inverse of `action` (undo) or re-apply it (redo) through the caller's side effects. */
export function applyHistoryStep<T>(
  action: HistoryAction<T>,
  direction: 'undo' | 'redo',
  handlers: HistoryStepHandlers<T>,
): void {
  switch (action.kind) {
    case 'add':
      if (direction === 'undo') handlers.remove(action.value)
      else handlers.restore(action.value)
      return
    case 'remove':
      if (direction === 'undo') handlers.restore(action.value)
      else handlers.remove(action.value)
      return
    case 'replace':
      handlers.restore(direction === 'undo' ? action.before : action.after)
  }
}

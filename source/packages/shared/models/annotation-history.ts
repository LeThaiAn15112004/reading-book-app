import type {
  ReaderBookmark,
  ReaderHighlight,
  ReaderShapeAnnotation,
  ReaderTypewriterNote,
} from './reader-session.js'

/** One persisted annotation entity — extend when new overlay types ship. */
export type AnnotationSnapshot =
  | { entity: 'highlight'; value: ReaderHighlight }
  | { entity: 'typewriter'; value: ReaderTypewriterNote }
  | { entity: 'bookmark'; value: ReaderBookmark }
  | { entity: 'freehand'; value: ReaderShapeAnnotation }

/** One reversible annotation mutation for Ctrl+Z / Ctrl+Y. */
export type AnnotationAction =
  | { kind: 'add'; snapshot: AnnotationSnapshot }
  | { kind: 'remove'; snapshot: AnnotationSnapshot }
  | { kind: 'replace'; before: AnnotationSnapshot; after: AnnotationSnapshot }

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

/** Convenience builders — same shape for every annotation type. */
export function annotationAdd(snapshot: AnnotationSnapshot): AnnotationAction {
  return { kind: 'add', snapshot }
}

export function annotationRemove(
  snapshot: AnnotationSnapshot,
): AnnotationAction {
  return { kind: 'remove', snapshot }
}

export function annotationReplace(
  before: AnnotationSnapshot,
  after: AnnotationSnapshot,
): AnnotationAction {
  return { kind: 'replace', before, after }
}

export function snapshotEntity(
  snapshot: AnnotationSnapshot,
): AnnotationSnapshot['entity'] {
  return snapshot.entity
}

export function snapshotId(snapshot: AnnotationSnapshot): string {
  return snapshot.value.id
}

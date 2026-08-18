import type {
  AnnotationAction,
  AnnotationSnapshot,
} from './annotation-history.js'
import type {
  ReaderBookmark,
  ReaderHighlight,
  ReaderShapeAnnotation,
  ReaderTypewriterNote,
} from './reader-session.js'

export type AnnotationUndoHandlers = {
  restoreHighlight: (h: ReaderHighlight) => void
  removeHighlight: (id: string) => void
  restoreTypewriter: (n: ReaderTypewriterNote) => void
  removeTypewriter: (id: string) => void
  restoreBookmark: (b: ReaderBookmark) => void
  removeBookmark: (id: string) => void
  restoreFreehand: (s: ReaderShapeAnnotation) => void
  removeFreehand: (id: string) => void
  onHighlightReplaced?: (h: ReaderHighlight) => void
  onFreehandReplaced?: (s: ReaderShapeAnnotation) => void
}

function applySnapshot(
  snapshot: AnnotationSnapshot,
  mode: 'restore' | 'remove',
  h: AnnotationUndoHandlers,
) {
  switch (snapshot.entity) {
    case 'highlight':
      if (mode === 'restore') h.restoreHighlight(snapshot.value)
      else h.removeHighlight(snapshot.value.id)
      break
    case 'typewriter':
      if (mode === 'restore') h.restoreTypewriter(snapshot.value)
      else h.removeTypewriter(snapshot.value.id)
      break
    case 'bookmark':
      if (mode === 'restore') h.restoreBookmark(snapshot.value)
      else h.removeBookmark(snapshot.value.id)
      break
    case 'freehand':
      if (mode === 'restore') h.restoreFreehand(snapshot.value)
      else h.removeFreehand(snapshot.value.id)
      break
  }
}

/** Apply the inverse of a pushed action (undo) or re-apply it (redo). */
export function applyAnnotationHistoryStep(
  action: AnnotationAction,
  direction: 'undo' | 'redo',
  handlers: AnnotationUndoHandlers,
) {
  if (action.kind === 'add') {
    applySnapshot(
      action.snapshot,
      direction === 'undo' ? 'remove' : 'restore',
      handlers,
    )
    return
  }
  if (action.kind === 'remove') {
    applySnapshot(
      action.snapshot,
      direction === 'undo' ? 'restore' : 'remove',
      handlers,
    )
    return
  }
  const target = direction === 'undo' ? action.before : action.after
  applySnapshot(target, 'restore', handlers)
  if (target.entity === 'highlight') {
    handlers.onHighlightReplaced?.(target.value)
  }
  if (target.entity === 'freehand') {
    handlers.onFreehandReplaced?.(target.value)
  }
}

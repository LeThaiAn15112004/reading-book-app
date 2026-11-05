/**
 * The open TXT document as a pure, immutable value: text + annotations + one linear undo history.
 * The renderer's zustand store holds a `TxtDocument` and calls these reducers; nothing here knows
 * about React, the DOM or IPC, so every rule is unit-testable.
 *
 * One history for everything the user does to the document — typing, deleting, pasting, and
 * creating / removing / restyling an annotation — so Ctrl+Z always undoes the most recent thing,
 * and undoing an edit brings back the annotations that edit removed.
 */

import type { HighlightAction } from '../app-models/highlight-history.js'
import {
  applyTextEdit,
  isNoopEdit,
  shiftOffsetForEdit,
  type TextEdit,
} from './txt-edit.js'
import {
  planAnnotationEdit,
  withTxtOffsets,
  type TxtReaderHighlight,
} from './txt-annotations.js'

export interface TxtSelection {
  start: number
  end: number
}

export type TxtHistoryEntry =
  | {
      kind: 'edit'
      edit: TextEdit
      /** Text the edit removed (so the inverse can put it back). */
      removedText: string
      /** Annotations the edit removed, offsets relative to the text BEFORE the edit. */
      removedHighlights: TxtReaderHighlight[]
      selectionBefore: TxtSelection
      selectionAfter: TxtSelection
      at: number
    }
  | { kind: 'highlight'; action: HighlightAction<TxtReaderHighlight> }

export interface TxtDocument {
  readonly text: string
  /** In creation order — later rows paint on top. */
  readonly highlights: readonly TxtReaderHighlight[]
  readonly undoStack: readonly TxtHistoryEntry[]
  readonly redoStack: readonly TxtHistoryEntry[]
  /** Top of the viewport as a text offset; follows edits so it always points at the same text. */
  readonly readingOffset: number
}

export const TXT_HISTORY_LIMIT = 500
/** Typing / deleting within this many ms of the previous keystroke joins its undo step. */
export const TXT_COALESCE_MS = 1000

export function createTxtDocument(
  text: string,
  highlights: readonly TxtReaderHighlight[] = [],
  readingOffset = 0,
): TxtDocument {
  return {
    text,
    highlights: sortByCreation(highlights),
    undoStack: [],
    redoStack: [],
    readingOffset: Math.min(Math.max(readingOffset, 0), text.length),
  }
}

function sortByCreation(items: readonly TxtReaderHighlight[]): TxtReaderHighlight[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.createdAt < b.item.createdAt ? -1 : a.item.createdAt > b.item.createdAt ? 1 : a.index - b.index))
    .map(({ item }) => item)
}

function pushHistory(stack: readonly TxtHistoryEntry[], entry: TxtHistoryEntry): TxtHistoryEntry[] {
  const next = [...stack, entry]
  return next.length > TXT_HISTORY_LIMIT ? next.slice(next.length - TXT_HISTORY_LIMIT) : next
}

/** Move annotations by `edit` (the edit rule); rows that moved get a fresh locator. */
function applyEditToHighlights(
  highlights: readonly TxtReaderHighlight[],
  edit: TextEdit,
): { highlights: TxtReaderHighlight[]; removed: TxtReaderHighlight[] } {
  const plan = planAnnotationEdit(highlights, edit)
  const moved = new Set(plan.shiftedIds)
  return {
    highlights: plan.kept.map((h) => (moved.has(h.id) ? withTxtOffsets(h, h.startOffset, h.endOffset) : h)),
    removed: plan.removed,
  }
}

function isTypedCharacter(edit: TextEdit): boolean {
  return edit.deleteLength === 0 && edit.insert.length === 1 && edit.insert !== '\n'
}

/** Join a keystroke onto the previous undo step when it continues the same run of typing/deleting. */
function coalesce(
  last: TxtHistoryEntry | undefined,
  next: Extract<TxtHistoryEntry, { kind: 'edit' }>,
): Extract<TxtHistoryEntry, { kind: 'edit' }> | null {
  if (!last || last.kind !== 'edit') return null
  if (next.at - last.at > TXT_COALESCE_MS) return null
  if (last.removedHighlights.length > 0 || next.removedHighlights.length > 0) return null
  const a = last.edit
  const b = next.edit

  // Typing forward: the new character lands right after what was typed.
  if (a.deleteLength === 0 && isTypedCharacter(b) && b.start === a.start + a.insert.length && a.insert !== '') {
    return {
      ...next,
      edit: { start: a.start, deleteLength: 0, insert: a.insert + b.insert },
      removedText: '',
      selectionBefore: last.selectionBefore,
    }
  }
  // Backspace run: each deletion ends where the previous one began.
  if (a.insert === '' && b.insert === '' && b.start + b.deleteLength === a.start) {
    return {
      ...next,
      edit: { start: b.start, deleteLength: a.deleteLength + b.deleteLength, insert: '' },
      removedText: next.removedText + last.removedText,
      selectionBefore: last.selectionBefore,
    }
  }
  // Forward-delete run: each deletion starts where the previous one did.
  if (a.insert === '' && b.insert === '' && b.start === a.start) {
    return {
      ...next,
      edit: { start: a.start, deleteLength: a.deleteLength + b.deleteLength, insert: '' },
      removedText: last.removedText + next.removedText,
      selectionBefore: last.selectionBefore,
    }
  }
  return null
}

export interface TxtEditContext {
  now: number
  selectionBefore: TxtSelection
  selectionAfter: TxtSelection
}

export interface TxtEditResult {
  doc: TxtDocument
  /** Annotations this edit removed (empty when it only moved or missed them). */
  removed: TxtReaderHighlight[]
}

/** A user edit: new text, annotations moved / removed by the edit rule, one history step. */
export function editTxtDocument(doc: TxtDocument, edit: TextEdit, context: TxtEditContext): TxtEditResult {
  if (isNoopEdit(edit)) return { doc, removed: [] }
  const removedText = doc.text.slice(edit.start, edit.start + edit.deleteLength)
  const { highlights, removed } = applyEditToHighlights(doc.highlights, edit)
  const entry: Extract<TxtHistoryEntry, { kind: 'edit' }> = {
    kind: 'edit',
    edit,
    removedText,
    removedHighlights: removed,
    selectionBefore: context.selectionBefore,
    selectionAfter: context.selectionAfter,
    at: context.now,
  }
  const last = doc.undoStack[doc.undoStack.length - 1]
  const merged = coalesce(last, entry)
  const undoStack = merged
    ? [...doc.undoStack.slice(0, -1), merged]
    : pushHistory(doc.undoStack, entry)
  return {
    doc: {
      text: applyTextEdit(doc.text, edit),
      highlights,
      undoStack,
      redoStack: [],
      readingOffset: shiftOffsetForEdit(doc.readingOffset, edit),
    },
    removed,
  }
}

// ---------------------------------------------------------------------------------------------
// Annotation operations (each is one history step)
// ---------------------------------------------------------------------------------------------

export function addTxtHighlight(doc: TxtDocument, highlight: TxtReaderHighlight): TxtDocument {
  return {
    ...doc,
    highlights: sortByCreation([...doc.highlights.filter((h) => h.id !== highlight.id), highlight]),
    undoStack: pushHistory(doc.undoStack, { kind: 'highlight', action: { kind: 'add', value: highlight } }),
    redoStack: [],
  }
}

export function removeTxtHighlight(doc: TxtDocument, id: string): TxtDocument {
  const current = doc.highlights.find((h) => h.id === id)
  if (!current) return doc
  return {
    ...doc,
    highlights: doc.highlights.filter((h) => h.id !== id),
    undoStack: pushHistory(doc.undoStack, { kind: 'highlight', action: { kind: 'remove', value: current } }),
    redoStack: [],
  }
}

/** Change an annotation's color / style / note / tags (never its offsets). */
export function updateTxtHighlight(
  doc: TxtDocument,
  id: string,
  patch: Partial<Pick<TxtReaderHighlight, 'colorHex' | 'styleKind' | 'note' | 'tags'>>,
  updatedAt: string,
): TxtDocument {
  const before = doc.highlights.find((h) => h.id === id)
  if (!before) return doc
  const after: TxtReaderHighlight = { ...before, ...patch, updatedAt }
  return {
    ...doc,
    highlights: doc.highlights.map((h) => (h.id === id ? after : h)),
    undoStack: pushHistory(doc.undoStack, { kind: 'highlight', action: { kind: 'replace', before, after } }),
    redoStack: [],
  }
}

// ---------------------------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------------------------

export interface TxtStepResult {
  doc: TxtDocument
  /** Caret / selection to put back (edit steps only). */
  selection?: TxtSelection
  /** True when the text itself changed (the editor must re-sync its value). */
  textChanged: boolean
}

function upsertHighlight(list: readonly TxtReaderHighlight[], row: TxtReaderHighlight): TxtReaderHighlight[] {
  return sortByCreation([...list.filter((h) => h.id !== row.id), row])
}

function applyHighlightAction(
  doc: TxtDocument,
  action: HighlightAction<TxtReaderHighlight>,
  direction: 'undo' | 'redo',
): TxtReaderHighlight[] {
  if (action.kind === 'add') {
    return direction === 'undo'
      ? doc.highlights.filter((h) => h.id !== action.value.id)
      : upsertHighlight(doc.highlights, action.value)
  }
  if (action.kind === 'remove') {
    return direction === 'undo'
      ? upsertHighlight(doc.highlights, action.value)
      : doc.highlights.filter((h) => h.id !== action.value.id)
  }
  return upsertHighlight(doc.highlights, direction === 'undo' ? action.before : action.after)
}

export function canUndoTxt(doc: TxtDocument): boolean {
  return doc.undoStack.length > 0
}

export function canRedoTxt(doc: TxtDocument): boolean {
  return doc.redoStack.length > 0
}

export function undoTxtDocument(doc: TxtDocument): TxtStepResult | null {
  const entry = doc.undoStack[doc.undoStack.length - 1]
  if (!entry) return null
  const undoStack = doc.undoStack.slice(0, -1)
  const redoStack = [...doc.redoStack, entry]

  if (entry.kind === 'highlight') {
    return {
      doc: { ...doc, highlights: applyHighlightAction(doc, entry.action, 'undo'), undoStack, redoStack },
      textChanged: false,
    }
  }

  const inverse: TextEdit = {
    start: entry.edit.start,
    deleteLength: entry.edit.insert.length,
    insert: entry.removedText,
  }
  const { highlights } = applyEditToHighlights(doc.highlights, inverse)
  // The annotations this edit removed fit the text as it was before the edit — i.e. now.
  const restored = entry.removedHighlights.reduce(upsertHighlight, highlights)
  return {
    doc: {
      text: applyTextEdit(doc.text, inverse),
      highlights: restored,
      undoStack,
      redoStack,
      readingOffset: shiftOffsetForEdit(doc.readingOffset, inverse),
    },
    selection: entry.selectionBefore,
    textChanged: true,
  }
}

export function redoTxtDocument(doc: TxtDocument): TxtStepResult | null {
  const entry = doc.redoStack[doc.redoStack.length - 1]
  if (!entry) return null
  const redoStack = doc.redoStack.slice(0, -1)
  const undoStack = [...doc.undoStack, entry]

  if (entry.kind === 'highlight') {
    return {
      doc: { ...doc, highlights: applyHighlightAction(doc, entry.action, 'redo'), undoStack, redoStack },
      textChanged: false,
    }
  }

  const { highlights } = applyEditToHighlights(doc.highlights, entry.edit)
  return {
    doc: {
      text: applyTextEdit(doc.text, entry.edit),
      highlights,
      undoStack,
      redoStack,
      readingOffset: shiftOffsetForEdit(doc.readingOffset, entry.edit),
    },
    selection: entry.selectionAfter,
    textChanged: true,
  }
}

/** Move the saved reading position (scroll) without touching history. */
export function setTxtReadingOffset(doc: TxtDocument, offset: number): TxtDocument {
  const next = Math.min(Math.max(Math.trunc(offset), 0), doc.text.length)
  return next === doc.readingOffset ? doc : { ...doc, readingOffset: next }
}

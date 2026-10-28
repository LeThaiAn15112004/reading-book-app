import { create } from 'zustand'
import { emptyTypewriterDoc, applyAlign, applyStyle, familyHasItalic, type PdfTypewriterDoc, type TypewriterAlign, type TypewriterTextStyle } from '@reading-book/book-reader-sdk'
import type { TypewriterFlag } from '../../../../reader/renderers/pdf/PdfTypewriterEditor'
import { typewriterFormatValues } from './typewriterFormatValues'

/** A normalized box over the page (0–1 on both axes). */
export type TypewriterBox = { x: number; y: number; width: number; height: number }

export type TypewriterSelection = { start: number; end: number }

type Snapshot = { text: string; doc: PdfTypewriterDoc; selection: TypewriterSelection }

/** The note being typed (a draft: nothing is saved until it is committed). */
export type TypewriterSession = {
  /** The saved note being edited (its row id), or null for a new note. */
  editingId: string | null
  /** Fresh per session — a different id means a different note (everything transient is dropped). */
  id: string
  pageIndex: number
  box: TypewriterBox
  /** Page height / page width at creation time, to turn laid-out height into a fraction of the page height. */
  heightRatio: number
  text: string
  doc: PdfTypewriterDoc
  selection: TypewriterSelection
  /** Style patch pending at a collapsed caret: applies to the next typed text only. */
  pending: Partial<TypewriterTextStyle> | null
  /** Bumped when the DOM must be rebuilt from the model (after an IME composition). */
  epoch: number
  /** Set when the last change was cut at the character cap (the editor shows a message). */
  truncated: boolean
}

type TypewriterEditorState = {
  session: TypewriterSession | null
  /** Text-level undo / redo of the open session (the annotation history takes over after commit). */
  undoStack: Snapshot[]
  redoStack: Snapshot[]
  /** Edit a saved note in place: the session starts from its text, document and box. */
  beginEdit: (input: { id: string; pageIndex: number; box: TypewriterBox; heightRatio: number; text: string; doc: PdfTypewriterDoc }) => void
  begin: (input: { pageIndex: number; box: TypewriterBox; heightRatio: number; style: TypewriterTextStyle; align: TypewriterAlign }) => void
  change: (next: { text: string; doc: PdfTypewriterDoc; selection: TypewriterSelection; truncated?: boolean }) => void
  select: (selection: TypewriterSelection) => void
  setPending: (pending: Partial<TypewriterTextStyle> | null) => void
  rebuild: () => void
  /** Format: a range → that range; a collapsed caret → the style of the next typed text; an empty text → the whole box. */
  formatStyle: (patch: Partial<TypewriterTextStyle>) => void
  /** Keyboard shortcut (Ctrl+B / I / U / Shift+X): flip one flag on the selection, the caret or the empty box. */
  toggleFlag: (key: TypewriterFlag) => void
  /** Alignment of the paragraphs touched by the selection (an empty text: the whole box). */
  formatAlign: (align: TypewriterAlign) => void
  undo: () => void
  redo: () => void
  end: () => void
}

const UNDO_LIMIT = 200

export const useTypewriterEditorStore = create<TypewriterEditorState>()((set, get) => ({
  session: null,
  undoStack: [],
  redoStack: [],

  begin: ({ pageIndex, box, heightRatio, style, align }) => {
    let doc = emptyTypewriterDoc(style)
    if (align !== 'left') doc = applyAlign(doc, ' ', null, align)
    set({
      session: { editingId: null, id: crypto.randomUUID(), pageIndex, box, heightRatio, text: '', doc, selection: { start: 0, end: 0 }, pending: null, epoch: 0, truncated: false },
      undoStack: [],
      redoStack: [],
    })
  },

  beginEdit: ({ id, pageIndex, box, heightRatio, text, doc }) => {
    set({
      session: { editingId: id, id: crypto.randomUUID(), pageIndex, box, heightRatio, text, doc, selection: { start: text.length, end: text.length }, pending: null, epoch: 0, truncated: false },
      undoStack: [],
      redoStack: [],
    })
  },

  change: ({ text, doc, selection, truncated }) => {
    const { session, undoStack } = get()
    if (!session) return
    const snapshot: Snapshot = { text: session.text, doc: session.doc, selection: session.selection }
    set({
      session: { ...session, text, doc, selection, pending: null, truncated: !!truncated },
      undoStack: [...undoStack.slice(-(UNDO_LIMIT - 1)), snapshot],
      redoStack: [],
    })
  },

  select: (selection) => {
    const { session } = get()
    if (!session || (session.selection.start === selection.start && session.selection.end === selection.end)) return
    // Moving the caret drops a pending typing style (it belonged to the old position).
    set({ session: { ...session, selection, pending: null } })
  },

  setPending: (pending) => {
    const { session } = get()
    if (session) set({ session: { ...session, pending } })
  },

  rebuild: () => {
    const { session } = get()
    if (session) set({ session: { ...session, epoch: session.epoch + 1 } })
  },

  toggleFlag: (key) => {
    const { session } = get()
    if (!session) return
    const { style, mixed } = typewriterFormatValues(session.doc, session.text, session.selection, session.pending)
    if (key === 'italic' && !familyHasItalic(style.family)) return
    // Same rule as the sidebar buttons: a mixed selection turns the flag on, otherwise it flips.
    get().formatStyle({ [key]: mixed.has(key) ? true : !style[key] })
  },

  formatStyle: (patch) => {
    const { session } = get()
    if (!session) return
    const { selection, text, doc } = session
    if (text.length === 0) {
      get().change({ text, doc: applyStyle(doc, text, null, patch), selection })
    } else if (selection.start === selection.end) {
      set({ session: { ...session, pending: { ...(session.pending ?? {}), ...patch } } })
    } else {
      get().change({ text, doc: applyStyle(doc, text, selection, patch), selection })
    }
  },

  formatAlign: (align) => {
    const { session } = get()
    if (!session) return
    const { selection, text, doc } = session
    get().change({ text, doc: applyAlign(doc, text, text.length === 0 ? null : selection, align), selection })
  },

  undo: () => {
    const { session, undoStack, redoStack } = get()
    const last = undoStack[undoStack.length - 1]
    if (!session || !last) return
    set({
      session: { ...session, ...last, pending: null, epoch: session.epoch + 1, truncated: false },
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, { text: session.text, doc: session.doc, selection: session.selection }],
    })
  },

  redo: () => {
    const { session, undoStack, redoStack } = get()
    const next = redoStack[redoStack.length - 1]
    if (!session || !next) return
    set({
      session: { ...session, ...next, pending: null, epoch: session.epoch + 1, truncated: false },
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, { text: session.text, doc: session.doc, selection: session.selection }],
    })
  },

  end: () => set({ session: null, undoStack: [], redoStack: [] }),
}))

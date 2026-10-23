import { create } from 'zustand'
import { markupToast } from '../markupToast'
import { opensNotePopup } from '../noteKinds'
import type { MutableRefObject } from 'react'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  applyHighlightHistoryStep,
  buildMdSelectionText,
  createHighlightHistory,
  highlightAdd,
  highlightRemove,
  highlightReplace,
  mdAnnotationOf,
  mdHighlightDtoToReaderHighlight,
  packMdAnnotationRef,
  packMdHighlightLocator,
  packSelectionTextRef,
  type HighlightHistory,
  type HighlightStyleKind,
  type MarkupInteractionTool,
  type MdPoint,
  type MdReaderHighlight,
} from '@reading-book/book-reader-sdk'
import { overlayApi } from '../../../../bridge'
import type { MdInsertionInfo, MdRendererApi, MdSelectionInfo } from '../../../../reader/renderers/md'

/** Client-px box a popup anchors to (a `DOMRect` fits; same shape as the other surfaces' anchors). */
export type MdAnnotationAnchor = {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

export type ActiveMdHighlight = { highlight: MdReaderHighlight; rect: MdAnnotationAnchor }

export type MdMarkupTool = MarkupInteractionTool

/** Caret color for Inserted Text (pink, like the PDF one) — changeable per mark afterwards. */
export const MD_INSERT_CARET_COLOR = '#ec407a'

/** An Inserted Text caret that has been placed but not saved: nothing exists until it gets text. */
export type PendingMdInsert = {
  point: MdPoint
  anchor: MdAnnotationAnchor
  before: string
  after: string
}

/** Inputs `useReaderMdHighlights` threads in from ReaderScreen — not UI state anything renders. */
type MdHighlightsContext = {
  mdApiRef: MutableRefObject<MdRendererApi | null> | null
  bookId: string | undefined
  onToast: (message: string | null) => void
  onChromeHidden: (hidden: boolean) => void
}

const emptyContext: MdHighlightsContext = {
  mdApiRef: null,
  bookId: undefined,
  onToast: () => {},
  onChromeHidden: () => {},
}

type MdHighlightsStoreState = MdHighlightsContext & {
  highlights: MdReaderHighlight[]
  /** The annotation whose menu / note popup is open. */
  activeHighlight: ActiveMdHighlight | null
  /** Outlined mark (last clicked / just created); Delete removes it. */
  focusedHighlightId: string | null
  /** Default color for the next mark — session-only. */
  lastUsedColorHex: string
  /** Session-only undo/redo, a fresh one per book. */
  history: HighlightHistory<MdReaderHighlight>
  /** The caret being placed (editor open, not saved). Never persisted; cancel leaves no trace. */
  pendingInsert: PendingMdInsert | null

  setContext: (patch: Partial<MdHighlightsContext>) => void
  resetForNewBook: () => void
  loadHighlights: () => Promise<void>
  /**
   * Mark `selection` (from the selection menu or a markup-tool drag) as `styleKind`. A `textbox` note
   * and a `replace` open their popup at `anchor` right away; other kinds just get the focus outline.
   */
  createFromSelection: (
    selection: MdSelectionInfo,
    styleKind: HighlightStyleKind,
    anchor?: MdAnnotationAnchor,
  ) => MdReaderHighlight | null
  /** A markup tool's press ended with text selected — mark it with the last-used color. */
  commitMarkupSelection: (selection: MdSelectionInfo, tool: MdMarkupTool) => void
  /** Insert Text tool: place a caret at `info` and open its editor. Saves nothing yet. */
  beginInsert: (info: MdInsertionInfo) => void
  /** Save the pending caret with the text typed; empty text cancels instead (no empty annotation). */
  commitInsert: (text: string) => void
  cancelInsert: () => void
  /** Click / right-click on a mark — focus it and open its menu (note: its popup). */
  openHighlight: (id: string, rect: MdAnnotationAnchor) => void
  closeEditPopup: () => void
  /** A click on blank text: close the menu, drop the outline. */
  dismissAnnotationUi: () => void
  updateHighlightColor: (id: string, colorHex: string) => void
  updateHighlightStyleKind: (id: string, styleKind: HighlightStyleKind) => void
  updateHighlightNote: (id: string, note: string) => void
  updateHighlightTags: (id: string, tags: string[]) => void
  deleteHighlight: (id: string) => void
  /** Sidebar jump: scroll to the annotation. */
  jumpToHighlight: (highlight: MdReaderHighlight) => void
  undo: () => void
  redo: () => void
  deleteFocused: () => void
  hasFocusedHighlight: () => boolean
}

/**
 * Markdown annotations for the open book — docs/implementation_plan/markdown_reader.md §5. Same
 * `notes` rows, IPC and undo history as the PDF store, anchored by (piece, offset) points instead of
 * page rects; painting is declarative (MdRenderer paints `highlights`).
 */
export const useMdHighlightsStore = create<MdHighlightsStoreState>()((set, get) => ({
  ...emptyContext,
  highlights: [],
  activeHighlight: null,
  focusedHighlightId: null,
  lastUsedColorHex: DEFAULT_HIGHLIGHT_COLOR,
  history: createHighlightHistory<MdReaderHighlight>(),
  pendingInsert: null,

  setContext: (patch) => set(patch),

  resetForNewBook: () => {
    get().history.clear()
    set({ highlights: [], activeHighlight: null, focusedHighlightId: null, pendingInsert: null })
  },

  loadHighlights: async () => {
    const { bookId, onToast } = get()
    if (!bookId) return
    try {
      const rows = await overlayApi.listHighlights(bookId)
      // A newer book may have opened while this was in flight.
      if (get().bookId !== bookId) return
      set({
        highlights: rows
          .map(mdHighlightDtoToReaderHighlight)
          .filter((h): h is MdReaderHighlight => h !== null),
      })
    } catch {
      onToast('Could not load highlights.')
    }
  },

  createFromSelection: (selection, styleKind, anchor) => {
    const { bookId, onToast } = get()
    if (!bookId) return null
    const annotation = { startSegment: selection.start.segment, startOffset: selection.start.offset, endSegment: selection.end.segment, endOffset: selection.end.offset }
    const now = new Date().toISOString()
    const highlight: MdReaderHighlight = {
      id: crypto.randomUUID(),
      locatorRef: packMdHighlightLocator(annotation),
      ...annotation,
      chapterIndex: annotation.startSegment,
      styleKind,
      colorHex: get().lastUsedColorHex,
      tags: [],
      selectionText: buildMdSelectionText(selection.before, selection.text, selection.after),
      createdAt: now,
      updatedAt: now,
    }
    get().history.push(highlightAdd(highlight))
    set((s) => ({
      highlights: [...s.highlights, highlight],
      focusedHighlightId: highlight.id,
      activeHighlight: opensNotePopup(styleKind) && anchor ? { highlight, rect: anchor } : null,
    }))
    window.getSelection()?.removeAllRanges()
    persistNew(get, set, highlight, onToast)
    return highlight
  },

  commitMarkupSelection: (selection, tool) => {
    const anchor = opensNotePopup(tool) && selection.box ? selection.box : undefined
    if (!get().createFromSelection(selection, tool, anchor)) return
    get().onToast(markupToast(tool))
  },

  beginInsert: (info) => {
    const { x, bottom } = info.client
    set({
      pendingInsert: {
        point: info.point,
        before: info.before,
        after: info.after,
        anchor: { top: bottom, bottom, left: x, right: x, width: 0, height: 0 },
      },
      activeHighlight: null,
      focusedHighlightId: null,
    })
  },

  commitInsert: (text) => {
    const { bookId, pendingInsert, onToast } = get()
    if (!pendingInsert) return
    set({ pendingInsert: null })
    const note = text.trim()
    if (!bookId || !note) return
    const { point } = pendingInsert
    const annotation = {
      startSegment: point.segment,
      startOffset: point.offset,
      endSegment: point.segment,
      endOffset: point.offset,
      caret: true as const,
    }
    const now = new Date().toISOString()
    const highlight: MdReaderHighlight = {
      id: crypto.randomUUID(),
      locatorRef: packMdHighlightLocator(annotation),
      ...annotation,
      chapterIndex: annotation.startSegment,
      styleKind: 'insert',
      colorHex: MD_INSERT_CARET_COLOR,
      note,
      tags: [],
      selectionText: { highlight: '', before: pendingInsert.before, after: pendingInsert.after },
      createdAt: now,
      updatedAt: now,
    }
    get().history.push(highlightAdd(highlight))
    set((s) => ({ highlights: [...s.highlights, highlight], focusedHighlightId: highlight.id }))
    persistNew(get, set, highlight, onToast)
  },

  cancelInsert: () => {
    if (get().pendingInsert) set({ pendingInsert: null })
  },

  openHighlight: (id, rect) => {
    const found = get().highlights.find((h) => h.id === id)
    if (!found) return
    set({ focusedHighlightId: id, activeHighlight: { highlight: found, rect } })
  },

  closeEditPopup: () => set({ activeHighlight: null, focusedHighlightId: null }),

  dismissAnnotationUi: () => {
    if (get().pendingInsert) get().cancelInsert()
    if (get().activeHighlight || get().focusedHighlightId) get().closeEditPopup()
  },

  updateHighlightColor: (id, colorHex) => {
    patchHighlight(get, set, id, { colorHex })
    set({ lastUsedColorHex: colorHex })
  },

  updateHighlightStyleKind: (id, styleKind) => {
    const current = get().highlights.find((h) => h.id === id)
    if (!current || current.styleKind === styleKind) return
    patchHighlight(get, set, id, { styleKind })
  },

  updateHighlightNote: (id, note) => {
    patchHighlight(get, set, id, { note: note.trim() || undefined })
  },

  updateHighlightTags: (id, tags) => {
    patchHighlight(get, set, id, { tags })
  },

  deleteHighlight: (id) => {
    const { bookId, onToast } = get()
    if (!bookId) return
    const current = get().highlights.find((h) => h.id === id)
    if (!current) return
    get().history.push(highlightRemove(current))
    removeHighlightRow(set, id)
    const restore = () => {
      set((s) => ({ highlights: [...s.highlights, current] }))
      onToast('Could not delete highlight.')
    }
    void overlayApi
      .deleteHighlight({ bookId, id })
      .then((result) => {
        if (!result.ok) restore()
      })
      .catch(restore)
  },

  jumpToHighlight: (highlight) => {
    const api = get().mdApiRef?.current
    if (!api) return
    api.scrollToAnnotation(highlight.id)
    get().onChromeHidden(true)
  },

  undo: () => {
    const action = get().history.undo()
    if (action) applyHighlightHistoryStep(action, 'undo', historyHandlers(get, set))
  },

  redo: () => {
    const action = get().history.redo()
    if (action) applyHighlightHistoryStep(action, 'redo', historyHandlers(get, set))
  },

  deleteFocused: () => {
    const id = get().focusedHighlightId
    if (id) get().deleteHighlight(id)
  },

  hasFocusedHighlight: () => get().focusedHighlightId != null,
}))

type Get = () => MdHighlightsStoreState
type Set = (
  partial:
    | Partial<MdHighlightsStoreState>
    | ((state: MdHighlightsStoreState) => Partial<MdHighlightsStoreState>),
) => void

/** The IPC save for one row — the anchor travels as `mdAnnotationRef` (validated in Main). */
function toSaveInput(bookId: string, h: MdReaderHighlight) {
  return {
    bookId,
    id: h.id,
    locatorRef: h.locatorRef,
    styleKind: h.styleKind,
    colorHex: h.colorHex,
    note: h.note,
    tags: h.tags,
    selectionTextRef: packSelectionTextRef(h.selectionText),
    mdAnnotationRef: packMdAnnotationRef(mdAnnotationOf(h)),
    createdAt: h.createdAt,
  }
}

/** Save a new row; a failed save takes it back out and says so. */
function persistNew(get: Get, set: Set, highlight: MdReaderHighlight, onToast: (m: string | null) => void): void {
  const { bookId } = get()
  if (!bookId) return
  const fail = () => {
    removeHighlightRow(set, highlight.id)
    onToast('Could not save highlight.')
  }
  void overlayApi
    .saveHighlight(toSaveInput(bookId, highlight))
    .then((saved) => {
      if (!saved) fail()
    })
    .catch(fail)
}

/** Every removal path clears the menu / outline pointing at the row too. */
function removeHighlightRow(set: Set, id: string): void {
  set((s) => ({
    highlights: s.highlights.filter((h) => h.id !== id),
    activeHighlight: s.activeHighlight?.highlight.id === id ? null : s.activeHighlight,
    focusedHighlightId: s.focusedHighlightId === id ? null : s.focusedHighlightId,
  }))
}

/** Patch one field set, record it for undo, re-persist (optimistic; a failed save only toasts). */
function patchHighlight(get: Get, set: Set, id: string, patch: Partial<MdReaderHighlight>): void {
  const current = get().highlights.find((h) => h.id === id)
  if (!current) return
  const next: MdReaderHighlight = { ...current, ...patch, updatedAt: new Date().toISOString() }
  get().history.push(highlightReplace(current, next))
  replaceRow(set, next)
  persistHighlight(get, next)
}

function replaceRow(set: Set, h: MdReaderHighlight): void {
  set((s) => ({
    highlights: s.highlights.map((x) => (x.id === h.id ? h : x)),
    activeHighlight:
      s.activeHighlight?.highlight.id === h.id ? { ...s.activeHighlight, highlight: h } : s.activeHighlight,
  }))
}

function persistHighlight(get: Get, h: MdReaderHighlight): void {
  const { bookId, onToast } = get()
  if (!bookId) return
  void overlayApi
    .saveHighlight(toSaveInput(bookId, h))
    .then((saved) => {
      if (!saved) onToast('Could not update highlight.')
    })
    .catch(() => onToast('Could not update highlight.'))
}

/** Undo / redo: re-apply a snapshot (insert or overwrite) or remove — and persist either way. */
function historyHandlers(get: Get, set: Set) {
  return {
    restore: (h: MdReaderHighlight) => {
      if (get().highlights.some((x) => x.id === h.id)) replaceRow(set, h)
      else set((s) => ({ highlights: [...s.highlights, h] }))
      persistHighlight(get, h)
    },
    remove: (id: string) => {
      removeHighlightRow(set, id)
      const { bookId, onToast } = get()
      if (!bookId) return
      void overlayApi.deleteHighlight({ bookId, id }).catch(() => onToast('Could not undo.'))
    },
  }
}

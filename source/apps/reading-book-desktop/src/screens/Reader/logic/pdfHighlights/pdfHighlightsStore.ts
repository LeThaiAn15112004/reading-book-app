import { create } from 'zustand'
import { markupToast } from '../markupToast'
import type { MutableRefObject } from 'react'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  applyHighlightHistoryStep,
  createHighlightHistory,
  highlightAdd,
  highlightRemove,
  highlightReplace,
  packPdfHighlightLocator,
  packSelectionTextRef,
  pdfAnnotationFromRects,
  pdfAnnotationRefForRects,
  pdfHighlightDtoToReaderHighlight,
  pdfRectsFromAnnotation,
  type HighlightHistory,
  type HighlightStyleKind,
  type MarkupInteractionTool,
  type PdfReaderHighlight,
} from '@reading-book/book-reader-sdk'
import { overlayApi } from '../../../../bridge'
import { usePdfSignedWriteStore } from '../pdfExport/pdfSignedWriteStore'
import type { PdfRendererApi, PdfSelectionInfo } from '../../../../reader/renderers/pdf'

/** Derived from the bridge: the renderer never imports from electron/. */
type PdfEmbeddedAnnotationsChangedDto = Parameters<Parameters<typeof overlayApi.onPdfEmbeddedAnnotationsChanged>[0]>[0]
export type PdfAnnotationConflict = PdfEmbeddedAnnotationsChangedDto['conflicts'][number]

/** Client-px box a popup anchors to (a `DOMRect` fits; same shape as the EPUB anchor rects). */
export type PdfAnnotationAnchor = {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

export type ActivePdfHighlight = { highlight: PdfReaderHighlight; rect: PdfAnnotationAnchor }

export type PdfMarkupTool = MarkupInteractionTool

/** Inputs `useReaderPdfHighlights` threads in from ReaderScreen — not UI state anything renders. */
type PdfHighlightsContext = {
  pdfApiRef: MutableRefObject<PdfRendererApi | null> | null
  bookId: string | undefined
  onToast: (message: string | null) => void
  onChromeHidden: (hidden: boolean) => void
}

const emptyContext: PdfHighlightsContext = {
  pdfApiRef: null,
  bookId: undefined,
  onToast: () => {},
  onChromeHidden: () => {},
}

type PdfHighlightsStoreState = PdfHighlightsContext & {
  highlights: PdfReaderHighlight[]
  /** The annotation whose menu / note popup is open. */
  activeHighlight: ActivePdfHighlight | null
  /** Outlined mark (last clicked / just created); Delete removes it. */
  focusedHighlightId: string | null
  /** Default color for the next mark — session-only, like the EPUB store's. */
  lastUsedColorHex: string
  /** Session-only undo/redo, a fresh one per book. */
  history: HighlightHistory<PdfReaderHighlight>
  /**
   * PDF.js ids of embedded annotations the app paints itself — PdfRenderer stops drawing their own
   * appearance. Set by the open sync only (when the scanned file is the displayed one).
   */
  hiddenEmbeddedObjectIds: string[]
  /** Two-way sync conflicts by note id (both Readmate and another app changed the annotation). */
  conflicts: Record<string, PdfAnnotationConflict>

  setContext: (patch: Partial<PdfHighlightsContext>) => void
  resetForNewBook: () => void
  loadHighlights: () => Promise<void>
  /**
   * A sync of the open PDF's embedded annotations (Main: on open and whenever the file settles after
   * a change in another app — pdf_embedded_annotation_live_sync.md). Merges written rows, drops
   * deleted ones, and takes the canvas-hiding ids. Ignored for any other book.
   */
  applyEmbeddedSync: (event: PdfEmbeddedAnnotationsChangedDto) => void
  /** Open conflicts of the book (on open; later ones arrive with sync events). */
  loadConflicts: () => Promise<void>
  /** Keep Readmate's version (written into the PDF) or take the PDF's. */
  resolveConflict: (id: string, choice: 'keep-readmate' | 'use-pdf') => Promise<void>
  /**
   * Mark `selection` (from the selection menu or a markup-tool drag) as `styleKind`. A `textbox`
   * note opens its popup at `anchor` right away; other kinds just get the focus outline.
   */
  createFromSelection: (
    selection: PdfSelectionInfo,
    styleKind: HighlightStyleKind,
    anchor?: PdfAnnotationAnchor,
  ) => PdfReaderHighlight | null
  /** A markup tool's press ended with text selected — mark it with the last-used color. */
  commitMarkupSelection: (selection: PdfSelectionInfo, tool: PdfMarkupTool) => void
  /** Click / right-click on a mark or note icon — focus it and open its menu (note: its popup). */
  openHighlight: (id: string, rect: PdfAnnotationAnchor) => void
  closeEditPopup: () => void
  /** A click on blank page area (or a fresh selection menu): close the menu, drop the outline. */
  dismissAnnotationUi: () => void
  updateHighlightColor: (id: string, colorHex: string) => void
  updateHighlightStyleKind: (id: string, styleKind: HighlightStyleKind) => void
  updateHighlightNote: (id: string, note: string) => void
  updateHighlightTags: (id: string, tags: string[]) => void
  deleteHighlight: (id: string) => void
  /** Sidebar jump: scroll to the annotation's page / position, then pulse its marks. */
  jumpToHighlight: (highlight: PdfReaderHighlight) => void
  undo: () => void
  redo: () => void
  deleteFocused: () => void
  hasFocusedHighlight: () => boolean
}

/**
 * PDF text annotations (highlight / underline / strikethrough / note) for the open PDF —
 * docs/implementation_plan/pdf_text_annotations.md. Same `notes` rows, IPC and undo history as the
 * EPUB `highlightsStore`, but anchored by page + normalized rects instead of a CFI; painting is
 * declarative (PdfRenderer draws `highlights`), so there is no imperative mark API to keep in sync.
 * Kept separate from the EPUB store on purpose (that one is bound to epub.js events and handles).
 */
export const usePdfHighlightsStore = create<PdfHighlightsStoreState>()((set, get) => ({
  ...emptyContext,
  highlights: [],
  activeHighlight: null,
  focusedHighlightId: null,
  lastUsedColorHex: DEFAULT_HIGHLIGHT_COLOR,
  history: createHighlightHistory<PdfReaderHighlight>(),
  hiddenEmbeddedObjectIds: [],
  conflicts: {},

  setContext: (patch) => set(patch),

  resetForNewBook: () => {
    get().history.clear()
    set({ highlights: [], activeHighlight: null, focusedHighlightId: null, hiddenEmbeddedObjectIds: [], conflicts: {} })
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
          .map(pdfHighlightDtoToReaderHighlight)
          .filter((h): h is PdfReaderHighlight => h != null),
      })
    } catch {
      if (get().bookId === bookId) onToast('Could not load highlights.')
    }
  },

  applyEmbeddedSync: (event) => {
    if (!event || event.bookId !== get().bookId) return
    const written = [...event.inserted, ...event.updated]
      .map(pdfHighlightDtoToReaderHighlight)
      .filter((h): h is PdfReaderHighlight => h != null)
    const byId = new Map(written.map((h) => [h.id, h]))
    const deleted = new Set(event.deletedIds)
    const { onToast } = get()
    switch (event.writeStatus) {
      case 'locked':
        onToast('The PDF is in use by another app — Readmate will retry writing your annotations.')
        break
      case 'failed':
        onToast('Could not write your annotations into the PDF file. They are kept in Readmate.')
        break
      case 'read_only':
        onToast('The PDF file or its folder is read-only, so your annotations are kept in Readmate but not written into it.')
        break
      case 'encrypted':
        onToast('This PDF is encrypted — your annotations are kept in Readmate but can’t be written into it.')
        break
      case 'unsupported_pdf':
        onToast('This PDF’s structure doesn’t allow writing annotations — they are kept in Readmate.')
        break
      case 'signed':
        usePdfSignedWriteStore.getState().request(event.bookId, event.signerName)
        break
      // 'managed_copy': a copy Readmate keeps itself (URL / cloud) — annotations stay in Readmate by design.
      default:
        break
    }
    if (event.conflicts.length > 0) {
      set((s) => ({ conflicts: { ...s.conflicts, ...Object.fromEntries(event.conflicts.map((c) => [c.noteId, c])) } }))
      onToast(
        event.conflicts.length === 1
          ? 'An annotation was changed in Readmate and in another app — open it to choose a version.'
          : `${event.conflicts.length} annotations were changed in Readmate and in another app — open them to choose.`,
      )
    }
    if (byId.size === 0 && deleted.size === 0 && event.hiddenObjectIds.length === 0) return
    set((s) => {
      const kept = s.highlights.filter((h) => !deleted.has(h.id)).map((h) => byId.get(h.id) ?? h)
      const known = new Set(kept.map((h) => h.id))
      const active = s.activeHighlight
      return {
        highlights: [...kept, ...written.filter((h) => !known.has(h.id))],
        // An open menu / focus outline on a row that changed or left the file would be stale.
        activeHighlight: active && (deleted.has(active.highlight.id) || byId.has(active.highlight.id)) ? null : active,
        focusedHighlightId: s.focusedHighlightId && deleted.has(s.focusedHighlightId) ? null : s.focusedHighlightId,
        hiddenEmbeddedObjectIds: event.hiddenObjectIds.length > 0 ? event.hiddenObjectIds : s.hiddenEmbeddedObjectIds,
      }
    })
  },

  loadConflicts: async () => {
    const { bookId } = get()
    if (!bookId) return
    try {
      const list = await overlayApi.listPdfAnnotationConflicts(bookId)
      if (get().bookId === bookId) set({ conflicts: Object.fromEntries(list.map((c) => [c.noteId, c])) })
    } catch {
      // No conflicts shown; the next sync event brings new ones.
    }
  },

  resolveConflict: async (id, choice) => {
    const { bookId, onToast } = get()
    if (!bookId) return
    try {
      const result = await overlayApi.resolvePdfAnnotationConflict(bookId, id, choice)
      if (get().bookId !== bookId) return
      if (!result.ok) {
        onToast('Could not resolve the conflict.')
        return
      }
      const updated = result.updated ? pdfHighlightDtoToReaderHighlight(result.updated) : null
      set((s) => {
        const conflicts = { ...s.conflicts }
        delete conflicts[id]
        return {
          conflicts,
          highlights: result.deletedId ? s.highlights.filter((h) => h.id !== result.deletedId) : s.highlights.map((h) => (updated && h.id === updated.id ? updated : h)),
          activeHighlight: null,
        }
      })
    } catch {
      onToast('Could not resolve the conflict.')
    }
  },

  createFromSelection: (selection, styleKind, anchor) => {
    const { bookId, pdfApiRef, onToast } = get()
    if (!bookId) return null
    const annotation = pdfAnnotationFromRects(selection.rects)
    if (!annotation) {
      onToast('Could not mark this selection.')
      return null
    }
    const now = new Date().toISOString()
    // `textbox` keeps the color slot but never paints it, so it doesn't change the last-used color.
    const colorHex = get().lastUsedColorHex
    const highlight: PdfReaderHighlight = {
      id: crypto.randomUUID(),
      locatorRef: packPdfHighlightLocator(annotation),
      page: annotation.pageIndex + 1,
      chapterIndex: annotation.pageIndex,
      rects: pdfRectsFromAnnotation(annotation),
      styleKind,
      colorHex,
      tags: [],
      selectionText: selection.text ? { highlight: selection.text } : undefined,
      createdAt: now,
      updatedAt: now,
    }
    get().history.push(highlightAdd(highlight))
    set((s) => ({
      highlights: [...s.highlights, highlight],
      focusedHighlightId: highlight.id,
      activeHighlight: styleKind === 'textbox' && anchor ? { highlight, rect: anchor } : null,
    }))
    pdfApiRef?.current?.clearSelection()

    void overlayApi
      .saveHighlight(toSaveInput(bookId, highlight))
      .then((saved) => {
        if (saved) return
        removeHighlightRow(set, highlight.id)
        onToast('Could not save highlight.')
      })
      .catch(() => {
        removeHighlightRow(set, highlight.id)
        onToast('Could not save highlight.')
      })
    return highlight
  },

  commitMarkupSelection: (selection, tool) => {
    if (!get().createFromSelection(selection, tool)) return
    get().onToast(
      markupToast(tool),
    )
  },

  openHighlight: (id, rect) => {
    const found = get().highlights.find((h) => h.id === id)
    if (!found) return
    set({ focusedHighlightId: id, activeHighlight: { highlight: found, rect } })
  },

  closeEditPopup: () => set({ activeHighlight: null, focusedHighlightId: null }),

  dismissAnnotationUi: () => {
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
    const api = get().pdfApiRef?.current
    if (!api) return
    const first = highlight.rects.find((r) => r.page === highlight.page)
    api.goToPagePoint(highlight.page, first?.y)
    get().onChromeHidden(true)
    api.flashAnnotation(highlight.id)
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

type Get = () => PdfHighlightsStoreState
type Set = (
  partial:
    | Partial<PdfHighlightsStoreState>
    | ((state: PdfHighlightsStoreState) => Partial<PdfHighlightsStoreState>),
) => void

/** The IPC save for one row — the geometry travels as `pdfAnnotationRef` (validated in Main). */
function toSaveInput(bookId: string, h: PdfReaderHighlight) {
  return {
    bookId,
    id: h.id,
    locatorRef: h.locatorRef,
    styleKind: h.styleKind,
    colorHex: h.colorHex,
    note: h.note,
    tags: h.tags,
    selectionTextRef: packSelectionTextRef(h.selectionText),
    pdfAnnotationRef: pdfAnnotationRefForRects(h.rects),
    createdAt: h.createdAt,
  }
}

/** Every removal path clears the menu / outline pointing at the row too. */
function removeHighlightRow(set: Set, id: string): void {
  set((s) => ({
    highlights: s.highlights.filter((h) => h.id !== id),
    activeHighlight: s.activeHighlight?.highlight.id === id ? null : s.activeHighlight,
    focusedHighlightId: s.focusedHighlightId === id ? null : s.focusedHighlightId,
  }))
}

/** Patch one field set, record it for undo, re-persist (optimistic; a failed save only toasts,
 *  matching the EPUB store). */
function patchHighlight(get: Get, set: Set, id: string, patch: Partial<PdfReaderHighlight>): void {
  const current = get().highlights.find((h) => h.id === id)
  if (!current) return
  const next: PdfReaderHighlight = { ...current, ...patch, updatedAt: new Date().toISOString() }
  get().history.push(highlightReplace(current, next))
  replaceRow(set, next)
  persistHighlight(get, next)
}

function replaceRow(set: Set, h: PdfReaderHighlight): void {
  set((s) => ({
    highlights: s.highlights.map((x) => (x.id === h.id ? h : x)),
    activeHighlight:
      s.activeHighlight?.highlight.id === h.id ? { ...s.activeHighlight, highlight: h } : s.activeHighlight,
  }))
}

function persistHighlight(get: Get, h: PdfReaderHighlight): void {
  const { bookId, onToast } = get()
  if (!bookId) return
  void overlayApi
    .saveHighlight(toSaveInput(bookId, h))
    .then((saved) => {
      if (!saved) onToast('Could not update highlight.')
    })
    .catch(() => onToast('Could not update highlight.'))
}

/** Undo / redo: re-apply a snapshot (insert or overwrite) or remove — and persist either way, so
 *  reopening the book shows the reverted state. Never records itself in the history. */
function historyHandlers(get: Get, set: Set) {
  return {
    restore: (h: PdfReaderHighlight) => {
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

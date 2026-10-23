import { create } from 'zustand'
import {
  applyHistoryStep,
  createUndoHistory,
  normalizeInkPoints,
  translateInkPaths,
  packPdfInkLocator,
  packPdfInkRef,
  parsePdfInk,
  parsePdfInkRef,
  type HistoryAction,
  type InkPenStyle,
  type InkPoint,
  type PdfInkStroke,
  type UndoHistory,
} from '@reading-book/book-reader-sdk'
import { overlayApi } from '../../../../bridge'
import { usePdfInkPrefsStore } from './pdfInkPrefsStore'

/** One stroke as the PDF surface paints it and the store persists it. */
export type PdfInkMark = {
  id: string
  /** 0-based page. */
  pageIndex: number
  paths: InkPoint[][]
  penStyle: InkPenStyle
  /** Fraction of the page width. */
  width: number
  colorHex: string
  opacity: number
  createdAt: string
  updatedAt: string
}

type InkDto = Awaited<ReturnType<typeof overlayApi.listInk>>[number]

type PdfInkContext = {
  bookId: string | undefined
  onToast: (message: string | null) => void
}

type PdfInkStoreState = PdfInkContext & {
  strokes: PdfInkMark[]
  selectedId: string | null
  /** Session-only undo/redo, a fresh one per book. */
  history: UndoHistory<PdfInkMark>
  /** Edits recorded for this book (0 after a reset). Lets the undo router see a new edit; undo / redo never change it. */
  pushes: number

  setContext: (patch: Partial<PdfInkContext>) => void
  resetForNewBook: () => void
  loadInk: () => Promise<void>
  /** A finished pen drag on 0-based `pageIndex`: save it with the CURRENT pen settings. */
  commitStroke: (pageIndex: number, points: readonly InkPoint[]) => PdfInkMark | null
  select: (id: string | null) => void
  deleteStroke: (id: string) => void
  /** Move a stroke by (`dx`, `dy`) page units (clamped to its page): one undo step, saved like any edit. */
  moveStroke: (id: string, dx: number, dy: number) => void
  deleteSelected: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  undo: () => void
  redo: () => void
}

const HISTORY_LIMIT = 50

export function dtoToInkMark(dto: InkDto): PdfInkMark | null {
  const ink = parsePdfInkRef(dto.pdfInkRef)
  if (!ink) return null
  return {
    id: dto.id,
    pageIndex: ink.pageIndex,
    paths: ink.paths,
    penStyle: ink.penStyle,
    width: ink.width,
    colorHex: dto.colorHex,
    opacity: dto.opacity,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

function inkOf(mark: PdfInkMark): PdfInkStroke {
  return { pageIndex: mark.pageIndex, paths: mark.paths, penStyle: mark.penStyle, width: mark.width }
}

function toSaveInput(bookId: string, mark: PdfInkMark) {
  const ink = inkOf(mark)
  return {
    bookId,
    id: mark.id,
    locatorRef: packPdfInkLocator(ink),
    colorHex: mark.colorHex,
    opacity: mark.opacity,
    pdfInkRef: packPdfInkRef(ink),
    createdAt: mark.createdAt,
  }
}

/**
 * PDF freehand Ink for the open PDF — docs/implementation_plan/pdf_freehand_ink_eraser_plan.md (Phase 1:
 * Pen only, SQLite only; nothing is written into the PDF file). Same optimistic-save / rollback pattern
 * and undo history as `pdfHighlightsStore`, but a separate store and separate IPC: strokes are `notes`
 * rows of their own type and never mix with text annotations.
 *
 * A stroke copies the pen settings when it is committed; changing the settings later never touches saved
 * strokes (they live in `pdfInkPrefsStore`).
 */
export const usePdfInkStore = create<PdfInkStoreState>()((set, get) => {
  const record = (action: HistoryAction<PdfInkMark>) => {
    get().history.push(action)
    set((s) => ({ pushes: s.pushes + 1 }))
  }

  const persist = (mark: PdfInkMark, failureMessage: string) => {
    const { bookId, onToast } = get()
    if (!bookId) return
    void overlayApi
      .saveInk(toSaveInput(bookId, mark))
      .then((saved) => {
        if (!saved) onToast(failureMessage)
      })
      .catch(() => onToast(failureMessage))
  }

  const dropRow = (id: string) => {
    set((s) => ({
      strokes: s.strokes.filter((m) => m.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }))
  }

  const handlers = {
    restore: (mark: PdfInkMark) => {
      set((s) => ({
        strokes: s.strokes.some((m) => m.id === mark.id) ? s.strokes.map((m) => (m.id === mark.id ? mark : m)) : [...s.strokes, mark],
      }))
      persist(mark, 'Could not restore the stroke.')
    },
    remove: (mark: PdfInkMark) => {
      dropRow(mark.id)
      const { bookId, onToast } = get()
      if (!bookId) return
      void overlayApi.deleteInk({ bookId, id: mark.id }).catch(() => onToast('Could not undo.'))
    },
  }

  return {
    bookId: undefined,
    onToast: () => {},
    strokes: [],
    selectedId: null,
    history: createUndoHistory<PdfInkMark>(HISTORY_LIMIT),
    pushes: 0,

    setContext: (patch) => set(patch),

    resetForNewBook: () => {
      get().history.clear()
      set({ strokes: [], selectedId: null, pushes: 0 })
    },

    loadInk: async () => {
      const { bookId, onToast } = get()
      if (!bookId) return
      try {
        const rows = await overlayApi.listInk(bookId)
        // A newer book may have opened while this was in flight.
        if (get().bookId !== bookId) return
        set({ strokes: rows.map(dtoToInkMark).filter((m): m is PdfInkMark => m != null) })
      } catch {
        if (get().bookId === bookId) onToast('Could not load pen strokes.')
      }
    },

    commitStroke: (pageIndex, points) => {
      const { bookId, onToast } = get()
      if (!bookId) return null
      const clean = normalizeInkPoints(points)
      // A tap is a dot: two identical points make a valid one-segment path.
      const path: InkPoint[] = clean.length === 1 ? [clean[0]!, clean[0]!] : clean
      const pen = usePdfInkPrefsStore.getState().pen
      const ink = parsePdfInk({ pageIndex, paths: [path], penStyle: 'pen', width: pen.width })
      if (!ink) {
        onToast('Could not save the stroke.')
        return null
      }
      const now = new Date().toISOString()
      const mark: PdfInkMark = {
        id: crypto.randomUUID(),
        pageIndex: ink.pageIndex,
        paths: ink.paths,
        penStyle: ink.penStyle,
        width: ink.width,
        colorHex: pen.colorHex,
        opacity: 1,
        createdAt: now,
        updatedAt: now,
      }
      record({ kind: 'add', value: mark })
      set((s) => ({ strokes: [...s.strokes, mark] }))
      void overlayApi
        .saveInk(toSaveInput(bookId, mark))
        .then((saved) => {
          if (saved) return
          dropRow(mark.id)
          onToast('Could not save the stroke.')
        })
        .catch(() => {
          dropRow(mark.id)
          onToast('Could not save the stroke.')
        })
      return mark
    },

    select: (id) => {
      if (get().selectedId !== id) set({ selectedId: id })
    },

    deleteStroke: (id) => {
      const { bookId, onToast } = get()
      if (!bookId) return
      const current = get().strokes.find((m) => m.id === id)
      if (!current) return
      record({ kind: 'remove', value: current })
      dropRow(id)
      const restore = () => {
        set((s) => ({ strokes: [...s.strokes, current] }))
        onToast('Could not delete the stroke.')
      }
      void overlayApi
        .deleteInk({ bookId, id })
        .then((result) => {
          if (!result.ok) restore()
        })
        .catch(restore)
    },

    moveStroke: (id, dx, dy) => {
      const current = get().strokes.find((m) => m.id === id)
      if (!current) return
      const moved = translateInkPaths(current.paths, dx, dy)
      if (Math.abs(moved.dx) < 1e-6 && Math.abs(moved.dy) < 1e-6) return
      const next: PdfInkMark = { ...current, paths: moved.paths, updatedAt: new Date().toISOString() }
      record({ kind: 'replace', before: current, after: next })
      set((s) => ({ strokes: s.strokes.map((m) => (m.id === id ? next : m)) }))
      persist(next, 'Could not save the moved stroke.')
    },

    deleteSelected: () => {
      const id = get().selectedId
      if (id) get().deleteStroke(id)
    },

    canUndo: () => get().history.canUndo(),
    canRedo: () => get().history.canRedo(),

    undo: () => {
      const action = get().history.undo()
      if (!action) return
      applyHistoryStep(action, 'undo', handlers)
    },

    redo: () => {
      const action = get().history.redo()
      if (!action) return
      applyHistoryStep(action, 'redo', handlers)
    },
  }
})

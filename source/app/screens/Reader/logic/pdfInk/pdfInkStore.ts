import { create } from 'zustand'
import {
  applyHistoryStep,
  clampInkOpacity,
  clampInkWidth,
  isInkPenStyle,
  createUndoHistory,
  normalizeInkPoints,
  translateInkPaths,
  packPdfInkLocator,
  packPdfInkRef,
  parsePdfInk,
  parsePdfInkRef,
  restyleInk,
  type HistoryAction,
  type InkPenStyle,
  type InkPoint,
  type PdfInkStroke,
  type UndoHistory,
} from '@reading-book/book-reader-sdk'
import { overlayApi } from '../../../../bridge'
import { activeInkLook, usePdfInkPrefsStore } from './pdfInkPrefsStore'

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
  /**
   * Change the look of ONE saved stroke (colour, thickness, opacity, style). Values are normalized like
   * the pen settings (hex `#RRGGBB`, clamped width / opacity, switching style re-derives the opacity);
   * one `replace` history entry, only that row is re-saved. A patch that changes nothing records nothing.
   */
  updateStroke: (id: string, patch: Partial<Pick<PdfInkMark, 'penStyle' | 'colorHex' | 'width' | 'opacity'>>) => void
  /** Move a stroke by (`dx`, `dy`) page units (clamped to its page): one undo step, saved like any edit. */
  moveStroke: (id: string, dx: number, dy: number) => void
  /** Replace the points of a stroke with a resized copy (same page, same look): one undo step, saved like any edit. */
  resizeStroke: (id: string, paths: readonly (readonly InkPoint[])[]) => void
  deleteSelected: () => void
  /**
   * Stroke Eraser release: delete every stroke in `ids` that is a saved Ink stroke of this book (anything
   * else is ignored) as ONE undo step. Returns how many were removed.
   */
  eraseStrokes: (ids: readonly string[]) => number
  /**
   * Partial Eraser release: for each `{ id, pieces }` the saved stroke becomes its remaining `pieces` (each
   * ≥ 2 points) — none deletes it, one rewrites it, several keep the first under the same id and add the
   * others as new strokes with the same look. ALL of it is one undo step. Ids that are not saved Ink strokes
   * are ignored. Returns how many strokes were edited.
   */
  applyPartialErase: (edits: readonly { id: string; pieces: readonly (readonly InkPoint[])[] }[]) => number
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
      // The look is copied NOW: later changes to the pen settings never reach a saved stroke.
      const pen = activeInkLook(usePdfInkPrefsStore.getState())
      const ink = parsePdfInk({ pageIndex, paths: [path], penStyle: pen.penStyle, width: pen.width })
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
        opacity: pen.opacity,
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

    updateStroke: (id, patch) => {
      const current = get().strokes.find((m) => m.id === id)
      if (!current) return
      let { penStyle, width, opacity } = current
      if (patch.penStyle !== undefined && isInkPenStyle(patch.penStyle) && patch.penStyle !== penStyle) {
        const restyled = restyleInk({ penStyle, width, opacity }, patch.penStyle)
        penStyle = restyled.penStyle
        width = restyled.width
        opacity = restyled.opacity
      }
      if (patch.width !== undefined) width = clampInkWidth(penStyle, patch.width)
      if (patch.opacity !== undefined) opacity = clampInkOpacity(penStyle, patch.opacity)
      const hex = patch.colorHex !== undefined && /^#[0-9a-f]{6}$/i.test(patch.colorHex) ? patch.colorHex.toUpperCase() : current.colorHex
      if (penStyle === current.penStyle && width === current.width && opacity === current.opacity && hex === current.colorHex) return
      const next: PdfInkMark = { ...current, penStyle, width, opacity, colorHex: hex, updatedAt: new Date().toISOString() }
      record({ kind: 'replace', before: current, after: next })
      set((s) => ({ strokes: s.strokes.map((m) => (m.id === id ? next : m)) }))
      persist(next, 'Could not save the stroke.')
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

    resizeStroke: (id, paths) => {
      const current = get().strokes.find((m) => m.id === id)
      if (!current) return
      const ink = parsePdfInk({ pageIndex: current.pageIndex, paths, penStyle: current.penStyle, width: current.width })
      if (!ink || JSON.stringify(ink.paths) === JSON.stringify(current.paths)) return
      const next: PdfInkMark = { ...current, paths: ink.paths, updatedAt: new Date().toISOString() }
      record({ kind: 'replace', before: current, after: next })
      set((s) => ({ strokes: s.strokes.map((m) => (m.id === id ? next : m)) }))
      persist(next, 'Could not save the resized stroke.')
    },

    deleteSelected: () => {
      const id = get().selectedId
      if (id) get().deleteStroke(id)
    },

    applyPartialErase: (edits) => {
      const { bookId, onToast } = get()
      if (!bookId) return 0
      const now = new Date().toISOString()
      const actions: HistoryAction<PdfInkMark>[] = []
      // Final strokes list: pieces sit right after the stroke they came from (same createdAt keeps the saved order).
      const replaced = new Map<string, PdfInkMark[]>()
      const gone = new Set<string>()
      const toSave: PdfInkMark[] = []
      const before = new Map<string, PdfInkMark>()
      for (const edit of edits) {
        const current = get().strokes.find((m) => m.id === edit.id)
        if (!current || replaced.has(edit.id) || gone.has(edit.id)) continue
        const pieces = edit.pieces
          .map((piece) => normalizeInkPoints(piece))
          .filter((piece) => piece.length >= 2)
          .map((piece) => parsePdfInk({ pageIndex: current.pageIndex, paths: [piece], penStyle: current.penStyle, width: current.width })?.paths[0])
          .filter((piece): piece is InkPoint[] => piece !== undefined)
        if (pieces.length === 0) {
          actions.push({ kind: 'remove', value: current })
          gone.add(current.id)
          continue
        }
        before.set(current.id, current)
        const first: PdfInkMark = { ...current, paths: [pieces[0]!], updatedAt: now }
        const result = [first]
        actions.push({ kind: 'replace', before: current, after: first })
        for (const piece of pieces.slice(1)) {
          const extra: PdfInkMark = { ...current, id: crypto.randomUUID(), paths: [piece], createdAt: current.createdAt, updatedAt: now }
          result.push(extra)
          actions.push({ kind: 'add', value: extra })
        }
        replaced.set(current.id, result)
        toSave.push(...result)
      }
      if (actions.length === 0) return 0
      record(actions.length === 1 ? actions[0]! : { kind: 'batch', actions })
      set((s) => ({
        strokes: s.strokes.flatMap((m) => (gone.has(m.id) ? [] : (replaced.get(m.id) ?? [m]))),
        selectedId: s.selectedId !== null && gone.has(s.selectedId) ? null : s.selectedId,
      }))
      let failed = false
      const fail = (undo: () => void) => {
        undo()
        if (!failed) onToast('Could not save the erased strokes.')
        failed = true
      }
      for (const mark of toSave) {
        const original = before.get(mark.id)
        void overlayApi
          .saveInk(toSaveInput(bookId, mark))
          .then((saved) => {
            if (saved) return
            fail(() => (original ? set((s) => ({ strokes: s.strokes.map((m) => (m.id === mark.id ? original : m)) })) : dropRow(mark.id)))
          })
          .catch(() => fail(() => (original ? set((s) => ({ strokes: s.strokes.map((m) => (m.id === mark.id ? original : m)) })) : dropRow(mark.id))))
      }
      for (const id of gone) {
        const mark = actions.flatMap((a) => (a.kind === 'remove' && a.value.id === id ? [a.value] : []))[0]!
        const restore = () => fail(() => set((s) => (s.strokes.some((m) => m.id === id) ? s : { strokes: [...s.strokes, mark] })))
        void overlayApi
          .deleteInk({ bookId, id })
          .then((result) => {
            if (!result.ok) restore()
          })
          .catch(restore)
      }
      return replaced.size + gone.size
    },

    eraseStrokes: (ids) => {
      const { bookId, onToast } = get()
      if (!bookId) return 0
      const wanted = new Set(ids)
      const removed = get().strokes.filter((m) => wanted.has(m.id))
      if (removed.length === 0) return 0
      // One gesture = one undo step; a single stroke stays a plain `remove`.
      record(removed.length === 1 ? { kind: 'remove', value: removed[0]! } : { kind: 'batch', actions: removed.map((value) => ({ kind: 'remove', value })) })
      set((s) => ({
        strokes: s.strokes.filter((m) => !wanted.has(m.id)),
        selectedId: s.selectedId !== null && wanted.has(s.selectedId) ? null : s.selectedId,
      }))
      let failed = 0
      for (const mark of removed) {
        const restore = () => {
          failed++
          set((s) => (s.strokes.some((m) => m.id === mark.id) ? s : { strokes: [...s.strokes, mark] }))
          if (failed === 1) onToast('Could not erase every stroke.')
        }
        void overlayApi
          .deleteInk({ bookId, id: mark.id })
          .then((result) => {
            if (!result.ok) restore()
          })
          .catch(restore)
      }
      return removed.length
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

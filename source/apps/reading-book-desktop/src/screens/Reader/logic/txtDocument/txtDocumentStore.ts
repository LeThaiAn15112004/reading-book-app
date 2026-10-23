import { create } from 'zustand'
import { markupToast } from '../markupToast'
import { opensNotePopup } from '../noteKinds'
import type { MutableRefObject } from 'react'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  addTxtHighlight,
  buildTxtSelectionText,
  canRedoTxt,
  canUndoTxt,
  committedTxtState,
  createTxtDocument,
  createTxtPersistedState,
  editTxtDocument,
  isValidTxtRange,
  packTxtHighlightLocator,
  planTxtCommit,
  redoTxtDocument,
  removeTxtHighlight,
  setTxtReadingOffset,
  splitAnnotationsByText,
  txtHighlightDtoToReaderHighlight,
  txtHighlightToWire,
  undoTxtDocument,
  updateTxtHighlight,
  type HighlightStyleKind,
  type TextEdit,
  type TxtDocument,
  type TxtPersistedState,
  type TxtReaderHighlight,
  type TxtSelection,
  type TxtStepResult,
} from '@reading-book/book-reader-sdk'
import { txtApi, type TxtOpenResult } from '../../../../bridge'
import type {
  ClientBox,
  TxtCaretRequest,
  TxtMarkupTool,
  TxtRendererApi,
  TxtSelectionInfo,
} from '../../../../reader/renderers/txt'

/** Typing waits this long for a pause before it is written… */
export const TXT_SAVE_DEBOUNCE_MS = 700
/** …but never longer than this while the user keeps typing. */
export const TXT_SAVE_MAX_WAIT_MS = 4000
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 30_000

/**
 * What the save indicator may say. `saved` is only ever set after `txt:commit` returned ok AND
 * nothing changed since the snapshot it saved.
 */
export type TxtSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

export type ActiveTxtHighlight = { highlight: TxtReaderHighlight; rect: ClientBox }

export type TxtSelectionMenu = { selection: TxtSelectionInfo; point: { x: number; y: number } }

type TxtContext = {
  bookId: string | undefined
  txtApiRef: MutableRefObject<TxtRendererApi | null> | null
  onToast: (message: string | null) => void
  onChromeHidden: (hidden: boolean) => void
}

const emptyContext: TxtContext = {
  bookId: undefined,
  txtApiRef: null,
  onToast: () => {},
  onChromeHidden: () => {},
}

type TxtDocumentStoreState = TxtContext & {
  loadStatus: 'idle' | 'loading' | 'ready' | 'error'
  errorCode: string | null
  errorMessage: string | null

  /** The book `doc` belongs to (the screen's `bookId` may already have moved on). */
  docBookId: string | null
  doc: TxtDocument | null
  /** What the database holds (text revision + one signature per annotation row). */
  persisted: TxtPersistedState | null
  editable: boolean
  /** The text came from the app's edited copy (not the original file). */
  edited: boolean
  encoding: string | null

  saveStatus: TxtSaveStatus
  saveError: string | null
  /** The save cannot succeed by retrying (the document changed under us / the data is rejected). */
  saveFatal: boolean

  activeHighlight: ActiveTxtHighlight | null
  focusedHighlightId: string | null
  selectionMenu: TxtSelectionMenu | null
  lastUsedColorHex: string
  /** Where the editor should put the caret after an undo / redo. */
  caretRequest: TxtCaretRequest | null

  setContext: (patch: Partial<TxtContext>) => void
  resetForNewBook: () => void
  load: (bookId: string) => Promise<void>
  /** The screen is leaving this book: save what is pending, then drop the document. */
  leave: () => Promise<void>

  applyEdit: (edit: TextEdit, selectionBefore: TxtSelection, selectionAfter: TxtSelection) => void
  undo: () => void
  redo: () => void
  setReadingOffset: (offset: number) => void

  createFromSelection: (selection: TxtSelectionInfo, styleKind: HighlightStyleKind, anchor?: ClientBox) => TxtReaderHighlight | null
  commitMarkupSelection: (selection: TxtSelectionInfo, tool: TxtMarkupTool) => void
  openHighlight: (id: string, rect: ClientBox) => void
  closeEditPopup: () => void
  dismissAnnotationUi: () => void
  updateHighlightColor: (id: string, colorHex: string) => void
  updateHighlightStyleKind: (id: string, styleKind: HighlightStyleKind) => void
  updateHighlightNote: (id: string, note: string) => void
  updateHighlightTags: (id: string, tags: string[]) => void
  deleteHighlight: (id: string) => void
  deleteFocused: () => void
  hasFocusedHighlight: () => boolean
  jumpToHighlight: (highlight: TxtReaderHighlight) => void
  openSelectionMenu: (selection: TxtSelectionInfo, x: number, y: number) => void
  closeSelectionMenu: () => void

  /** Write everything that changed. Resolves true when the document is saved (or nothing to save). */
  flush: () => Promise<boolean>
  retrySave: () => void
}

// Timers live outside the store: they are not state anything renders.
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryAttempt = 0
/** Increments on every book switch so a late reply for the previous book is dropped. */
let generation = 0
let saveChain: Promise<boolean> = Promise.resolve(true)

function clearSaveTimers(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (maxWaitTimer) clearTimeout(maxWaitTimer)
  if (retryTimer) clearTimeout(retryTimer)
  debounceTimer = maxWaitTimer = retryTimer = null
  retryAttempt = 0
}

function noticeText(result: TxtOpenResult, staleCount: number): string | null {
  const parts: string[] = []
  if (result.notices?.includes('working_copy_lost')) {
    parts.push('Your edited copy could not be read — showing the original file.')
  }
  if (result.notices?.includes('source_changed')) {
    parts.push('The original file was changed outside Readmate.')
  }
  if (result.notices?.includes('legacy_encoding')) {
    parts.push('This file is not UTF-8; it was read as Windows-1252, so some characters may look wrong.')
  }
  if (staleCount > 0) {
    parts.push(
      staleCount === 1
        ? '1 annotation no longer matches the text and is hidden.'
        : `${staleCount} annotations no longer match the text and are hidden.`,
    )
  }
  if (result.editable === false) {
    parts.push('This file is too large to edit here — you can still read and annotate it.')
  }
  return parts.length > 0 ? parts.join(' ') : null
}

function removedNotice(count: number): string {
  return count === 1
    ? '1 annotation was removed because the text under it changed.'
    : `${count} annotations were removed because the text under them changed.`
}

/**
 * The open TXT book: text + annotations (an SDK `TxtDocument`, pure), what is saved, and the
 * save loop. The reducers in the SDK decide what an edit does to annotations; this store only
 * wires them to the screen and to `txt:commit`. Kept apart from the EPUB / PDF stores on purpose:
 * those are bound to epub.js events / page geometry, this one to offsets in an editable text.
 * See docs/implementation_plan/txt_reader.md.
 */
export const useTxtDocumentStore = create<TxtDocumentStoreState>()((set, get) => {
  // ---- helpers bound to the store ----------------------------------------------------------
  function replaceDoc(doc: TxtDocument, extra: Partial<TxtDocumentStoreState> = {}): void {
    set({ doc, ...extra })
    markDirty()
  }

  function markDirty(): void {
    const { saveStatus } = get()
    if (saveStatus === 'saved') set({ saveStatus: 'dirty' })
  }

  function scheduleSave(immediate = false): void {
    if (immediate) {
      void get().flush()
      return
    }
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void get().flush()
    }, TXT_SAVE_DEBOUNCE_MS)
    maxWaitTimer ??= setTimeout(() => {
      maxWaitTimer = null
      void get().flush()
    }, TXT_SAVE_MAX_WAIT_MS)
  }

  function scheduleRetry(): void {
    if (retryTimer) clearTimeout(retryTimer)
    const delay = Math.min(RETRY_BASE_MS * 2 ** retryAttempt, RETRY_MAX_MS)
    retryAttempt += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      void get().flush()
    }, delay)
  }

  /** The save loop: re-plan against the latest document until nothing is left or a commit fails. */
  async function runFlush(): Promise<boolean> {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (maxWaitTimer) clearTimeout(maxWaitTimer)
    // A flush is running now: a retry scheduled by an earlier failure would only be a duplicate.
    if (retryTimer) clearTimeout(retryTimer)
    debounceTimer = maxWaitTimer = retryTimer = null

    for (let round = 0; round < 8; round++) {
      // The document's own book id: the screen's may already point at the next book.
      const { docBookId: bookId, doc, persisted } = get()
      if (!bookId || !doc || !persisted) return true
      const plan = planTxtCommit(persisted, doc)
      if (plan.empty) {
        retryAttempt = 0
        set({ saveStatus: 'saved', saveError: null, saveFatal: false })
        return true
      }
      set({ saveStatus: 'saving' })
      const snapshot = doc
      let result: Awaited<ReturnType<typeof txtApi.commit>>
      try {
        result = await txtApi.commit({
          bookId,
          baseRevision: persisted.revision,
          text: plan.textChanged ? snapshot.text : undefined,
          upserts: plan.upserts.map((h) => ({ bookId, ...txtHighlightToWire(h) })),
          deletedIds: plan.deletedIds,
        })
      } catch {
        result = { ok: false, errorCode: 'db_failed', errorMessage: 'Could not save your changes.' }
      }
      if (get().docBookId !== bookId) return false
      if (!result.ok || result.revision === undefined) {
        const fatal = result.errorCode === 'conflict' || result.errorCode === 'invalid' || result.errorCode === 'too_large'
        set({
          saveStatus: 'error',
          saveError: result.errorMessage ?? 'Could not save your changes.',
          saveFatal: fatal,
        })
        if (!fatal) scheduleRetry()
        return false
      }
      set({ persisted: committedTxtState(snapshot, result.revision) })
    }
    // Still changing after several rounds (the user is typing): the debounce picks it up.
    set({ saveStatus: 'dirty' })
    scheduleSave()
    return false
  }

  function applyStep(step: TxtStepResult | null): void {
    if (!step) return
    const active = get().activeHighlight
    const stillThere = active ? step.doc.highlights.find((h) => h.id === active.highlight.id) : undefined
    const focused = get().focusedHighlightId
    replaceDoc(step.doc, {
      activeHighlight: active && stillThere ? { ...active, highlight: stillThere } : null,
      focusedHighlightId: focused && step.doc.highlights.some((h) => h.id === focused) ? focused : null,
      caretRequest: step.selection
        ? { start: step.selection.start, end: step.selection.end, token: (get().caretRequest?.token ?? 0) + 1 }
        : get().caretRequest,
    })
    scheduleSave(!step.textChanged)
  }

  /** Edit one annotation (color / style / note / tags) — one history step, saved right away. */
  function patch(
    id: string,
    changes: Partial<Pick<TxtReaderHighlight, 'colorHex' | 'styleKind' | 'note' | 'tags'>>,
  ): void {
    const { doc } = get()
    if (!doc) return
    const next = updateTxtHighlight(doc, id, changes, new Date().toISOString())
    if (next === doc) return
    const active = get().activeHighlight
    const updated = next.highlights.find((h) => h.id === id)
    replaceDoc(next, {
      activeHighlight: active && updated && active.highlight.id === id ? { ...active, highlight: updated } : active,
    })
    scheduleSave(true)
  }

  return {
    ...emptyContext,
    loadStatus: 'idle',
    errorCode: null,
    errorMessage: null,
    docBookId: null,
    doc: null,
    persisted: null,
    editable: true,
    edited: false,
    encoding: null,
    saveStatus: 'saved',
    saveError: null,
    saveFatal: false,
    activeHighlight: null,
    focusedHighlightId: null,
    selectionMenu: null,
    lastUsedColorHex: DEFAULT_HIGHLIGHT_COLOR,
    caretRequest: null,

    setContext: (patch) => set(patch),

    resetForNewBook: () => {
      generation += 1
      clearSaveTimers()
      saveChain = Promise.resolve(true)
      set({
        loadStatus: 'idle',
        errorCode: null,
        errorMessage: null,
        docBookId: null,
        doc: null,
        persisted: null,
        editable: true,
        edited: false,
        encoding: null,
        saveStatus: 'saved',
        saveError: null,
        saveFatal: false,
        activeHighlight: null,
        focusedHighlightId: null,
        selectionMenu: null,
        caretRequest: null,
      })
    },

    load: async (bookId) => {
      // Whatever the previous book left unsaved is written first (against ITS book id).
      await get().flush()
      const mine = ++generation
      clearSaveTimers()
      set({ loadStatus: 'loading', errorCode: null, errorMessage: null, doc: null, persisted: null, docBookId: null })
      let result: TxtOpenResult
      try {
        result = await txtApi.open(bookId)
      } catch {
        result = { ok: false, bookId, errorCode: 'read_failed', errorMessage: 'Could not read the book file.' }
      }
      if (mine !== generation) return
      if (!result.ok || result.text === undefined || result.revision === undefined) {
        set({
          loadStatus: 'error',
          errorCode: result.errorCode ?? 'read_failed',
          errorMessage: result.errorMessage ?? 'Could not read the book file.',
        })
        return
      }
      const rows = (result.highlights ?? [])
        .map(txtHighlightDtoToReaderHighlight)
        .filter((h): h is TxtReaderHighlight => h !== null)
      // Rows that no longer sit on their quote are hidden, not moved and not deleted.
      const { valid, stale } = splitAnnotationsByText(rows, result.text)
      set({
        loadStatus: 'ready',
        docBookId: bookId,
        doc: createTxtDocument(result.text, valid),
        persisted: createTxtPersistedState(result.text, result.revision, valid),
        editable: result.editable !== false,
        edited: result.edited === true,
        encoding: result.encoding ?? null,
        saveStatus: 'saved',
        saveError: null,
        saveFatal: false,
        activeHighlight: null,
        focusedHighlightId: null,
        selectionMenu: null,
        caretRequest: null,
      })
      const notice = noticeText(result, stale.length)
      if (notice) get().onToast(notice)
    },

    leave: async () => {
      const left = generation
      await get().flush()
      // A load that started meanwhile owns the store now.
      if (left === generation) get().resetForNewBook()
    },

    // ---- editing ------------------------------------------------------------------------
    applyEdit: (edit, selectionBefore, selectionAfter) => {
      const { doc, editable } = get()
      if (!doc || !editable) return
      const { doc: next, removed } = editTxtDocument(doc, edit, {
        now: Date.now(),
        selectionBefore,
        selectionAfter,
      })
      const active = get().activeHighlight
      const removedIds = new Set(removed.map((h) => h.id))
      const focused = get().focusedHighlightId
      replaceDoc(next, {
        activeHighlight: active && !removedIds.has(active.highlight.id) ? active : null,
        focusedHighlightId: focused && !removedIds.has(focused) ? focused : null,
        selectionMenu: null,
      })
      if (removed.length > 0) get().onToast(removedNotice(removed.length))
      scheduleSave()
    },

    undo: () => {
      const { doc } = get()
      if (!doc || !canUndoTxt(doc)) return
      applyStep(undoTxtDocument(doc))
    },

    redo: () => {
      const { doc } = get()
      if (!doc || !canRedoTxt(doc)) return
      applyStep(redoTxtDocument(doc))
    },

    setReadingOffset: (offset) => {
      const { doc } = get()
      if (!doc) return
      const next = setTxtReadingOffset(doc, offset)
      if (next !== doc) set({ doc: next })
    },

    // ---- annotations --------------------------------------------------------------------
    createFromSelection: (selection, styleKind, anchor) => {
      const { doc, docBookId, onToast } = get()
      if (!doc || !docBookId) return null
      if (!isValidTxtRange(selection.start, selection.end, doc.text)) {
        onToast('Could not mark this selection.')
        return null
      }
      const now = new Date().toISOString()
      const range = { startOffset: selection.start, endOffset: selection.end }
      const highlight: TxtReaderHighlight = {
        id: crypto.randomUUID(),
        locatorRef: packTxtHighlightLocator(range),
        ...range,
        chapterIndex: 0,
        styleKind,
        colorHex: get().lastUsedColorHex,
        tags: [],
        selectionText: buildTxtSelectionText(doc.text, selection.start, selection.end),
        createdAt: now,
        updatedAt: now,
      }
      replaceDoc(addTxtHighlight(doc, highlight), {
        focusedHighlightId: highlight.id,
        activeHighlight: opensNotePopup(styleKind) && anchor ? { highlight, rect: anchor } : null,
        selectionMenu: null,
      })
      get().txtApiRef?.current?.clearSelection()
      scheduleSave(true)
      return highlight
    },

    commitMarkupSelection: (selection, tool) => {
      if (!get().createFromSelection(selection, tool, selection.box ?? undefined)) return
      get().onToast(
        markupToast(tool),
      )
    },

    openHighlight: (id, rect) => {
      const found = get().doc?.highlights.find((h) => h.id === id)
      if (!found) return
      set({ focusedHighlightId: id, activeHighlight: { highlight: found, rect }, selectionMenu: null })
    },

    closeEditPopup: () => set({ activeHighlight: null, focusedHighlightId: null }),

    dismissAnnotationUi: () => {
      if (get().activeHighlight || get().focusedHighlightId || get().selectionMenu) {
        set({ activeHighlight: null, focusedHighlightId: null, selectionMenu: null })
      }
    },

    updateHighlightColor: (id, colorHex) => {
      patch(id, { colorHex })
      set({ lastUsedColorHex: colorHex })
    },

    updateHighlightStyleKind: (id, styleKind) => {
      const current = get().doc?.highlights.find((h) => h.id === id)
      if (!current || current.styleKind === styleKind) return
      patch(id, { styleKind })
    },

    updateHighlightNote: (id, note) => {
      patch(id, { note: note.trim() || undefined })
    },

    updateHighlightTags: (id, tags) => {
      patch(id, { tags })
    },

    deleteHighlight: (id) => {
      const { doc } = get()
      if (!doc || !doc.highlights.some((h) => h.id === id)) return
      replaceDoc(removeTxtHighlight(doc, id), {
        activeHighlight: get().activeHighlight?.highlight.id === id ? null : get().activeHighlight,
        focusedHighlightId: get().focusedHighlightId === id ? null : get().focusedHighlightId,
      })
      scheduleSave(true)
    },

    deleteFocused: () => {
      const id = get().focusedHighlightId
      if (id) get().deleteHighlight(id)
    },

    hasFocusedHighlight: () => get().focusedHighlightId != null,

    jumpToHighlight: (highlight) => {
      const api = get().txtApiRef?.current
      if (!api) return
      api.scrollToOffset(highlight.startOffset)
      get().onChromeHidden(true)
      api.flashHighlight(highlight.id)
    },

    openSelectionMenu: (selection, x, y) => set({ selectionMenu: { selection, point: { x, y } }, activeHighlight: null }),
    closeSelectionMenu: () => {
      if (get().selectionMenu) set({ selectionMenu: null })
    },

    // ---- saving -------------------------------------------------------------------------
    flush: () => {
      saveChain = saveChain.then(runFlush, runFlush)
      return saveChain
    },

    retrySave: () => {
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
      set({ saveFatal: false })
      void get().flush()
    },
  }
})

import { createStore } from 'zustand/vanilla'
import { applyHistoryStep, createUndoHistory } from '../annotations/history.js'
import { compareAnchors } from '../annotations/query.js'
import { chapterIndexOf, hydrateLocator } from '../annotations/locator.js'
import { SdkError } from '../core/errors.js'
import type { SdkRuntime } from '../core/runtime.js'
import type { HighlightRecord } from '../domain/annotation/highlight.js'
import type { AnnotationService, CreateMarkupInput, MarkupPatch } from '../services/annotation-service.js'
import { createWriteQueue, reportStoreError, type LoadStatus, type ReadonlyStore } from './store-types.js'

export interface AnnotationsState {
  bookId: string | null
  status: LoadStatus
  /** Document order (chapter, then CFI / page / offset). */
  items: HighlightRecord[]
  /** The markup the user last clicked — outline + keyboard delete target. */
  focusedId: string | null
  /** Default color for the next colored markup. App-session scoped: survives switching books. */
  lastUsedColorHex: string
  canUndo: boolean
  canRedo: boolean

  /** Reset per-book state (list, focus, undo stack) and load `bookId`'s markups. */
  open(bookId: string): Promise<void>
  close(): void
  reload(): Promise<void>
  /**
   * Optimistic create: the row is in `items` (and painted) before this returns a promise. The
   * promise resolves to the saved markup, or `null` after a failed save was rolled back (an
   * `error` event is emitted). `colorHex` defaults to `lastUsedColorHex`.
   */
  create(input: Omit<CreateMarkupInput, 'bookId'>): Promise<HighlightRecord | null>
  /** Change kind / color / note / tags. Resolves `false` when missing or rolled back. */
  update(id: string, patch: MarkupPatch): Promise<boolean>
  remove(id: string): Promise<boolean>
  removeFocused(): Promise<boolean>
  undo(): void
  redo(): void
  focus(id: string | null): void
  /** Navigate the attached surface to a markup, then flash it. `false` when it cannot resolve. */
  jumpTo(id: string): Promise<boolean>
  /** Re-paint every markup — call after the surface (re)renders a section. Idempotent. */
  repaintAll(): void
  /** Resolves once every queued write has settled. */
  whenIdle(): Promise<void>
}

function upsertSorted(items: readonly HighlightRecord[], markup: HighlightRecord): HighlightRecord[] {
  return [...items.filter((m) => m.id !== markup.id), markup].sort(compareAnchors)
}

export function createAnnotationsStore(
  rt: SdkRuntime,
  service: AnnotationService,
): ReadonlyStore<AnnotationsState> {
  const history = createUndoHistory<HighlightRecord>(rt.options.undoLimit)
  const writes = createWriteQueue()
  const surface = () => rt.surface.current()

  return createStore<AnnotationsState>()((set, get) => {
    const syncHistoryFlags = () => set({ canUndo: history.canUndo(), canRedo: history.canRedo() })

    const findItem = (id: string) => get().items.find((m) => m.id === id)

    const requireOpenBook = (operation: string): string => {
      rt.lifecycle.assertAlive(`annotations.${operation}`)
      const { bookId } = get()
      if (!bookId) throw new SdkError('NO_BOOK_OPEN', `annotations.${operation}: no book is open`)
      return bookId
    }

    /** State + surface: make `markup` the current row (insert or overwrite). */
    const putRow = (markup: HighlightRecord) => {
      const previous = findItem(markup.id)
      // Engines like epub.js key marks by (range, type): remove the old snapshot, paint the new.
      if (previous && previous !== markup) surface()?.unpaintMarkup?.(previous)
      set((s) => ({ items: upsertSorted(s.items, markup) }))
      surface()?.paintMarkup?.(markup)
    }

    /** State + surface: drop a row and any focus pointing at it. */
    const dropRow = (id: string) => {
      const previous = findItem(id)
      if (!previous) return
      surface()?.unpaintMarkup?.(previous)
      set((s) => ({
        items: s.items.filter((m) => m.id !== id),
        focusedId: s.focusedId === id ? null : s.focusedId,
      }))
      if (get().focusedId === null) surface()?.setFocusedMarkup?.(null)
    }

    const stillOpen = (bookId: string) => get().bookId === bookId && !rt.lifecycle.disposed

    const historyHandlers = (bookId: string) => ({
      restore: (markup: HighlightRecord) => {
        putRow(markup)
        writes
          .enqueue(markup.id, () => service.applyPatch(markup, {}))
          .then(() => {
            if (stillOpen(bookId)) rt.events.emit('annotations:changed', { reason: 'restored', bookId, annotationId: markup.id })
          })
          .catch((err: unknown) => stillOpen(bookId) && reportStoreError(rt, 'annotations', 'save', err))
      },
      remove: (markup: HighlightRecord) => {
        dropRow(markup.id)
        writes
          .enqueue(markup.id, () => service.remove(bookId, markup.id))
          .then(() => {
            if (stillOpen(bookId)) rt.events.emit('annotations:changed', { reason: 'deleted', bookId, annotationId: markup.id })
          })
          .catch((err: unknown) => stillOpen(bookId) && reportStoreError(rt, 'annotations', 'delete', err))
      },
    })

    const loadFor = async (bookId: string) => {
      set({ status: 'loading' })
      try {
        const items = await service.list(bookId)
        // The open book may have changed while loading — never clobber the newer book's list.
        if (!stillOpen(bookId)) return
        set({ items, status: 'ready' })
        get().repaintAll()
      } catch (err) {
        if (!stillOpen(bookId)) return
        set({ status: 'error' })
        reportStoreError(rt, 'annotations', 'load', err)
      }
    }

    return {
      bookId: null,
      status: 'idle',
      items: [],
      focusedId: null,
      lastUsedColorHex: rt.options.defaultHighlightColor,
      canUndo: false,
      canRedo: false,

      async open(bookId) {
        rt.lifecycle.assertAlive('annotations.open')
        get().close()
        set({ bookId })
        await loadFor(bookId)
      },

      close() {
        history.clear()
        set({ bookId: null, status: 'idle', items: [], focusedId: null, canUndo: false, canRedo: false })
      },

      async reload() {
        const bookId = requireOpenBook('reload')
        await loadFor(bookId)
      },

      async create(input) {
        const bookId = requireOpenBook('create')
        const id = rt.ids.newId()
        const now = rt.clock.nowIso()
        const optimistic: HighlightRecord = {
          id,
          bookId,
          locator: { kind: 'cfi', cfi: '', chapterIndex: input.chapterIndex } as HighlightRecord['locator'],
          styleKind: input.styleKind,
          colorHex: input.colorHex ?? get().lastUsedColorHex,
          note: input.note,
          tags: [...(input.tags ?? [])],
          selectionText: input.selectionText,
          createdAt: now,
          updatedAt: now,
        }
        history.push({ kind: 'add', value: optimistic })
        putRow(optimistic)
        if (input.styleKind !== 'textbox') set({ lastUsedColorHex: optimistic.colorHex })
        surface()?.clearSelection?.()
        get().focus(id)
        syncHistoryFlags()

        try {
          const saved = await writes.enqueue(id, () => service.save({ ...input, bookId }, id))
          if (!stillOpen(bookId)) return null
          putRow(saved)
          rt.events.emit('annotations:changed', { reason: 'created', bookId, annotationId: id })
          return saved
        } catch (err) {
          if (stillOpen(bookId)) dropRow(id)
          reportStoreError(rt, 'annotations', 'save', err)
          return null
        }
      },

      async update(id, patch) {
        const bookId = requireOpenBook('update')
        const current = findItem(id)
        if (!current) return false

        try {
          const next = await writes.enqueue(id, () => service.applyPatch(current, patch))
          if (!stillOpen(bookId)) return false
          history.push({ kind: 'replace', before: current, after: next })
          putRow(next)
          if (patch.colorHex !== undefined && next.styleKind !== 'textbox') set({ lastUsedColorHex: next.colorHex })
          syncHistoryFlags()
          rt.events.emit('annotations:changed', { reason: 'updated', bookId, annotationId: id })
          return true
        } catch (err) {
          reportStoreError(rt, 'annotations', 'save', err)
          return false
        }
      },

      async remove(id) {
        const bookId = requireOpenBook('remove')
        const current = findItem(id)
        if (!current) return false

        history.push({ kind: 'remove', value: current })
        dropRow(id)
        syncHistoryFlags()

        try {
          const ok = await writes.enqueue(id, () => service.remove(bookId, id))
          if (!ok && stillOpen(bookId) && !findItem(id)) putRow(current)
          if (ok) rt.events.emit('annotations:changed', { reason: 'deleted', bookId, annotationId: id })
          return ok
        } catch (err) {
          if (stillOpen(bookId) && !findItem(id)) putRow(current)
          reportStoreError(rt, 'annotations', 'delete', err)
          return false
        }
      },

      removeFocused() {
        const id = get().focusedId
        return id ? get().remove(id) : Promise.resolve(false)
      },

      undo() {
        const bookId = requireOpenBook('undo')
        const action = history.undo()
        if (action) applyHistoryStep(action, 'undo', historyHandlers(bookId))
        syncHistoryFlags()
      },

      redo() {
        const bookId = requireOpenBook('redo')
        const action = history.redo()
        if (action) applyHistoryStep(action, 'redo', historyHandlers(bookId))
        syncHistoryFlags()
      },

      focus(id) {
        const next = id && findItem(id) ? id : null
        set({ focusedId: next })
        surface()?.setFocusedMarkup?.(next)
      },

      async jumpTo(id) {
        const markup = findItem(id)
        const target = surface()
        if (!markup || !target?.goTo) return false
        try {
          await target.goTo(hydrateLocator(markup.locator), { chapterIndex: chapterIndexOf(markup.locator) })
          surface()?.flashMarkup?.(markup)
          return true
        } catch (err) {
          rt.logger.warn('Could not resolve annotation location', { id, error: err })
          return false
        }
      },

      repaintAll() {
        const target = surface()
        if (!target?.paintMarkup) return
        for (const markup of get().items) target.paintMarkup(markup)
      },

      whenIdle: () => writes.whenIdle(),
    }
  })
}

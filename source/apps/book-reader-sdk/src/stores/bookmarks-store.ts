import { createStore } from 'zustand/vanilla'
import { compareAnchors, findBookmarksAt } from '../annotations/query.js'
import { chapterIndexOf, hydrateLocator } from '../annotations/locator.js'
import { SdkError } from '../core/errors.js'
import type { SdkRuntime } from '../core/runtime.js'
import type { BookmarkRecord } from '../domain/annotation/bookmark.js'
import type { Location } from '../domain/index.js'
import type { BookmarkService, CreateBookmarkInput } from '../services/annotation-service.js'
import { createWriteQueue, reportStoreError, type LoadStatus, type ReadonlyStore } from './store-types.js'

export type ToggleBookmarkResult =
  | { action: 'added'; bookmark: BookmarkRecord }
  | { action: 'removed'; bookmarks: BookmarkRecord[] }
  | { action: 'failed' }

export interface BookmarksState {
  bookId: string | null
  status: LoadStatus
  /** Document order. */
  items: BookmarkRecord[]

  open(bookId: string): Promise<void>
  close(): void
  reload(): Promise<void>
  add(input: Omit<CreateBookmarkInput, 'bookId'>): Promise<BookmarkRecord | null>
  /** The ribbon button: remove every bookmark exactly at `location`, or add one there. */
  toggleAt(input: Omit<CreateBookmarkInput, 'bookId'>): Promise<ToggleBookmarkResult>
  rename(id: string, label: string): Promise<boolean>
  remove(id: string): Promise<boolean>
  jumpTo(id: string): Promise<boolean>
  whenIdle(): Promise<void>
}

/** Non-reactive helper: bookmarks at an exact location (for "is this page bookmarked?"). */
export function selectBookmarksAt(
  state: Pick<BookmarksState, 'items'>,
  location: Location | null | undefined,
): BookmarkRecord[] {
  return location ? findBookmarksAt(state.items, location) : []
}

export function createBookmarksStore(rt: SdkRuntime, service: BookmarkService): ReadonlyStore<BookmarksState> {
  const writes = createWriteQueue()

  return createStore<BookmarksState>()((set, get) => {
    const findItem = (id: string) => get().items.find((b) => b.id === id)
    const stillOpen = (bookId: string) => get().bookId === bookId && !rt.lifecycle.disposed

    const requireOpenBook = (operation: string): string => {
      rt.lifecycle.assertAlive(`bookmarks.${operation}`)
      const { bookId } = get()
      if (!bookId) throw new SdkError('NO_BOOK_OPEN', `bookmarks.${operation}: no book is open`)
      return bookId
    }

    const putRow = (bookmark: BookmarkRecord) =>
      set((s) => ({ items: [...s.items.filter((b) => b.id !== bookmark.id), bookmark].sort(compareAnchors) }))
    const dropRow = (id: string) => set((s) => ({ items: s.items.filter((b) => b.id !== id) }))

    const loadFor = async (bookId: string) => {
      set({ status: 'loading' })
      try {
        const items = await service.list(bookId)
        if (!stillOpen(bookId)) return
        set({ items, status: 'ready' })
      } catch (err) {
        if (!stillOpen(bookId)) return
        set({ status: 'error' })
        reportStoreError(rt, 'bookmarks', 'load', err)
      }
    }

    const removeRow = async (bookId: string, current: BookmarkRecord): Promise<boolean> => {
      dropRow(current.id)
      try {
        const ok = await writes.enqueue(current.id, () => service.remove(bookId, current.id))
        if (!ok && stillOpen(bookId) && !findItem(current.id)) putRow(current)
        if (ok) rt.events.emit('bookmarks:changed', { reason: 'deleted', bookId, bookmarkId: current.id })
        return ok
      } catch (err) {
        if (stillOpen(bookId)) putRow(current)
        reportStoreError(rt, 'bookmarks', 'delete', err)
        return false
      }
    }

    return {
      bookId: null,
      status: 'idle',
      items: [],

      async open(bookId) {
        rt.lifecycle.assertAlive('bookmarks.open')
        get().close()
        set({ bookId })
        await loadFor(bookId)
      },

      close() {
        set({ bookId: null, status: 'idle', items: [] })
      },

      async reload() {
        await loadFor(requireOpenBook('reload'))
      },

      async add(input) {
        const bookId = requireOpenBook('add')
        const id = rt.ids.newId()
        try {
          const bookmark = await writes.enqueue(id, () => service.save({ ...input, bookId }, id))
          if (!stillOpen(bookId)) return null
          putRow(bookmark)
          rt.events.emit('bookmarks:changed', { reason: 'created', bookId, bookmarkId: bookmark.id })
          return bookmark
        } catch (err) {
          reportStoreError(rt, 'bookmarks', 'save', err)
          return null
        }
      },

      async toggleAt(input) {
        const bookId = requireOpenBook('toggleAt')
        const here = findBookmarksAt(get().items, input.location)
        if (here.length === 0) {
          const bookmark = await get().add(input)
          return bookmark ? { action: 'added', bookmark } : { action: 'failed' }
        }
        const results = await Promise.all(here.map((b) => removeRow(bookId, b)))
        return results.every(Boolean) ? { action: 'removed', bookmarks: here } : { action: 'failed' }
      },

      async rename(id, label) {
        const bookId = requireOpenBook('rename')
        const current = findItem(id)
        if (!current) return false
        try {
          const next = await writes.enqueue(id, () => service.rename(current, label))
          if (!stillOpen(bookId)) return false
          putRow(next)
          rt.events.emit('bookmarks:changed', { reason: 'updated', bookId, bookmarkId: id })
          return true
        } catch (err) {
          reportStoreError(rt, 'bookmarks', 'save', err)
          return false
        }
      },

      async remove(id) {
        const bookId = requireOpenBook('remove')
        const current = findItem(id)
        return current ? removeRow(bookId, current) : false
      },

      async jumpTo(id) {
        const bookmark = findItem(id)
        const target = rt.surface.current()
        if (!bookmark || !target?.goTo) return false
        try {
          await target.goTo(hydrateLocator(bookmark.locator), { chapterIndex: chapterIndexOf(bookmark.locator) })
          return true
        } catch (err) {
          rt.logger.warn('Could not resolve bookmark location', { id, error: err })
          return false
        }
      },

      whenIdle: () => writes.whenIdle(),
    }
  })
}

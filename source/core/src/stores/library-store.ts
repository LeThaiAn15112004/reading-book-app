import { createStore } from 'zustand/vanilla'
import type { SdkError } from '../core/errors.js'
import type { SdkRuntime } from '../core/runtime.js'
import type { Book } from '../domain/index.js'
import type { BookUpdate, ImportFileInput, ImportOutcome, LibraryService } from '../services/library-service.js'
import { reportStoreError, type LoadStatus, type ReadonlyStore } from './store-types.js'

export type LibraryImportResult = ImportOutcome | { status: 'failed'; error: SdkError }

export interface LibraryState {
  status: LoadStatus
  /** Most recently updated first. */
  books: Book[]
  /** Number of imports in flight (drives a progress indicator). */
  importing: number

  load(): Promise<void>
  /** Never throws: failures resolve `{ status: 'failed' }` and emit an `error` event. */
  importFile(input: ImportFileInput): Promise<LibraryImportResult>
  update(id: string, patch: BookUpdate): Promise<Book | null>
  setFavorite(id: string, isFavorite: boolean): Promise<Book | null>
  remove(id: string): Promise<boolean>
}

const byRecent = (a: Book, b: Book) => b.updatedAt.localeCompare(a.updatedAt)

export function createLibraryStore(rt: SdkRuntime, service: LibraryService): ReadonlyStore<LibraryState> {
  return createStore<LibraryState>()((set, get) => {
    const putBook = (book: Book) =>
      set((s) => ({ books: [...s.books.filter((b) => b.id !== book.id), book].sort(byRecent) }))

    return {
      status: 'idle',
      books: [],
      importing: 0,

      async load() {
        rt.lifecycle.assertAlive('library.load')
        set({ status: 'loading' })
        try {
          const books = await service.list()
          set({ books: [...books].sort(byRecent), status: 'ready' })
        } catch (err) {
          set({ status: 'error' })
          reportStoreError(rt, 'library', 'load', err)
        }
      },

      async importFile(input) {
        set((s) => ({ importing: s.importing + 1 }))
        try {
          const outcome = await service.importFile(input)
          if (outcome.status === 'imported') putBook(outcome.book)
          return outcome
        } catch (err) {
          return { status: 'failed', error: reportStoreError(rt, 'library', 'importFile', err) }
        } finally {
          set((s) => ({ importing: Math.max(0, s.importing - 1) }))
        }
      },

      async update(id, patch) {
        try {
          const book = await service.update(id, patch)
          putBook(book)
          return book
        } catch (err) {
          reportStoreError(rt, 'library', 'update', err)
          return null
        }
      },

      setFavorite(id, isFavorite) {
        return get().update(id, { isFavorite })
      },

      async remove(id) {
        const target = get().books.find((b) => b.id === id)
        set((s) => ({ books: s.books.filter((b) => b.id !== id) }))
        // Put back only this book, so a concurrent import is not clobbered by the rollback.
        const rollback = () => {
          if (target) putBook(target)
        }
        try {
          const removed = await service.remove(id)
          if (!removed) rollback()
          return removed
        } catch (err) {
          rollback()
          reportStoreError(rt, 'library', 'remove', err)
          return false
        }
      },
    }
  })
}

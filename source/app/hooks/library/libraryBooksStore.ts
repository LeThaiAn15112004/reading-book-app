import { create } from 'zustand'
import { mapBookSummary, type BookSummaryInput, type LibraryBook } from '@core'

export type LibraryBooksClient = {
  listBooks: () => Promise<BookSummaryInput[]>
}

type LibraryBooksState = {
  /** `null` until the first load answered. */
  books: LibraryBook[] | null
  /** Reloads the whole list (explicit refreshes only — a single-book change uses `upsertBook` / `patchBook`). */
  load: (client: LibraryBooksClient) => Promise<void>
  /** Inserts a book, or replaces the entry with the same id (spec 016: a finished import adds one book). */
  upsertBook: (book: LibraryBook) => void
  /** Changes fields of one entry (spec 016 FR-006: a generated cover patches that book only). */
  patchBook: (id: string, patch: Partial<Omit<LibraryBook, 'id'>>) => void
  removeBook: (id: string) => void
}

/** Answers of an older `load` that arrive after a newer one started are dropped. */
let loadSeq = 0

/**
 * The Library book list (spec 016 research R8). Module-level, so a finished import or a generated cover can update one
 * entry from outside React without reloading the whole list.
 */
export const useLibraryBooksStore = create<LibraryBooksState>((set) => ({
  books: null,
  load: async (client) => {
    const seq = ++loadSeq
    let books: LibraryBook[]
    try {
      books = (await client.listBooks()).map(mapBookSummary)
    } catch {
      books = []
    }
    if (seq === loadSeq) set({ books })
  },
  upsertBook: (book) =>
    set(({ books }) => {
      if (!books) return { books: [book] }
      const i = books.findIndex((b) => b.id === book.id)
      if (i < 0) return { books: [book, ...books] }
      const next = books.slice()
      next[i] = book
      return { books: next }
    }),
  patchBook: (id, patch) =>
    set(({ books }) => {
      if (!books) return {}
      const i = books.findIndex((b) => b.id === id)
      if (i < 0) return {}
      const next = books.slice()
      next[i] = { ...next[i]!, ...patch }
      return { books: next }
    }),
  removeBook: (id) =>
    set(({ books }) => (books ? { books: books.filter((b) => b.id !== id) } : {})),
}))

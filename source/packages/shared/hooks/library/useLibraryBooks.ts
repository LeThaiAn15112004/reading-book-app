import { useEffect, useRef, useState } from 'react'
import {
  mapBookSummary,
  type BookSummaryInput,
  type LibraryBook,
} from '../../models/library-book.js'

export type LibraryBooksClient = {
  listBooks: () => Promise<BookSummaryInput[]>
}

export type UseLibraryBooksOptions = {
  /** Injected by desktop (IPC) / mobile (store) — no Electron in shared. */
  client: LibraryBooksClient
}

/** Load + refresh library rows via injected client. */
export function useLibraryBooks({ client }: UseLibraryBooksOptions) {
  const [books, setBooks] = useState<LibraryBook[] | null>(null)
  const clientRef = useRef(client)
  clientRef.current = client

  async function refreshLibrary() {
    try {
      const rows = await clientRef.current.listBooks()
      setBooks(rows.map(mapBookSummary))
    } catch {
      setBooks([])
    }
  }

  useEffect(() => {
    let cancelled = false
    clientRef.current
      .listBooks()
      .then((rows) => {
        if (!cancelled) setBooks(rows.map(mapBookSummary))
      })
      .catch(() => {
        if (!cancelled) setBooks([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { books, refreshLibrary }
}

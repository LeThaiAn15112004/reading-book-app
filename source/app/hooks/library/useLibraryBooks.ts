import { useEffect, useRef } from 'react'
import { useLibraryBooksStore, type LibraryBooksClient } from './libraryBooksStore.js'

export type { LibraryBooksClient } from './libraryBooksStore.js'

export type UseLibraryBooksOptions = {
  /** Injected by desktop (IPC) / mobile (store) — no Electron in shared. */
  client: LibraryBooksClient
}

/** Load + refresh library rows via injected client. The list itself lives in `libraryBooksStore` (spec 016). */
export function useLibraryBooks({ client }: UseLibraryBooksOptions) {
  const books = useLibraryBooksStore((s) => s.books)
  const clientRef = useRef(client)
  clientRef.current = client

  function refreshLibrary() {
    return useLibraryBooksStore.getState().load(clientRef.current)
  }

  useEffect(() => {
    void useLibraryBooksStore.getState().load(clientRef.current)
  }, [])

  return { books, refreshLibrary }
}

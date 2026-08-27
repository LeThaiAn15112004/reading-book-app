import { useCallback, useState } from 'react'
import type { LibraryBook } from '@reading-book/shared/models'

const STORAGE_KEY = 'rb-library-shelf-order-v1'

type ShelfOrderMap = Record<string, string[]>

function loadOrderMap(): ShelfOrderMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveOrderMap(map: ShelfOrderMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Ignore quota / privacy-mode failures — order just won't persist.
  }
}

/** Applies a saved drag order over a shelf's default list; unseen books keep their default position at the end. */
function applyOrder(books: LibraryBook[], order: string[] | undefined): LibraryBook[] {
  if (!order || order.length === 0) return books
  const remaining = new Map(books.map((b) => [b.id, b]))
  const ordered: LibraryBook[] = []
  for (const id of order) {
    const book = remaining.get(id)
    if (book) {
      ordered.push(book)
      remaining.delete(id)
    }
  }
  for (const book of books) {
    if (remaining.has(book.id)) ordered.push(book)
  }
  return ordered
}

/** Per-shelf manual drag order, persisted in localStorage (rail cards on the Library hub). */
export function useShelfOrder() {
  const [orderMap, setOrderMap] = useState<ShelfOrderMap>(() => loadOrderMap())

  const orderShelf = useCallback(
    (shelfId: string, books: LibraryBook[]) => applyOrder(books, orderMap[shelfId]),
    [orderMap],
  )

  const reorderShelf = useCallback((shelfId: string, orderedBooks: LibraryBook[]) => {
    setOrderMap((prev) => {
      const next = { ...prev, [shelfId]: orderedBooks.map((b) => b.id) }
      saveOrderMap(next)
      return next
    })
  }, [])

  return { orderShelf, reorderShelf }
}

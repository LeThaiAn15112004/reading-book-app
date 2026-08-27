import { useCallback, useState } from 'react'
import { LIBRARY_SHELVES, type LibrarySectionId } from '../components'

const STORAGE_KEY = 'rb-library-section-order-v1'

const DEFAULT_ORDER: LibrarySectionId[] = LIBRARY_SHELVES.map((shelf) => shelf.id)

function loadOrder(): LibrarySectionId[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveOrder(order: LibrarySectionId[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
  } catch {
    // Ignore quota / privacy-mode failures — order just won't persist.
  }
}

/** Reconciles a saved order against the known section ids: drops stale ids, appends any new ones. */
function reconcileOrder(order: LibrarySectionId[] | null): LibrarySectionId[] {
  if (!order) return DEFAULT_ORDER
  const known = new Set(DEFAULT_ORDER)
  const seen = new Set<LibrarySectionId>()
  const ordered: LibrarySectionId[] = []
  for (const id of order) {
    if (known.has(id) && !seen.has(id)) {
      ordered.push(id)
      seen.add(id)
    }
  }
  for (const id of DEFAULT_ORDER) {
    if (!seen.has(id)) ordered.push(id)
  }
  return ordered
}

/** Library hub section order (Favorites / Recent Books / Completed / Not started), persisted in localStorage. */
export function useSectionOrder() {
  const [sectionOrder, setSectionOrder] = useState<LibrarySectionId[]>(() =>
    reconcileOrder(loadOrder()),
  )

  /** Merges a (possibly partial) reordered subsequence back into the full section order. */
  const reorderSections = useCallback((newOrder: ReadonlyArray<LibrarySectionId>) => {
    setSectionOrder((prev) => {
      const reordered = [...newOrder]
      const included = new Set(reordered)
      let cursor = 0
      const next = prev.map((id) => (included.has(id) ? reordered[cursor++] : id))
      saveOrder(next)
      return next
    })
  }, [])

  return { sectionOrder, reorderSections }
}

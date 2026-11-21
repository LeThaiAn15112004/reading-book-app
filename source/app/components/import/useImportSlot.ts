import { useMemo } from 'react'
import { importedBookIdsOf, importedLeadCount, placeholdersOf, type ImportPlaceholder } from '@core'
import { useImportQueueStore } from '../../hooks/library/importQueueStore'

export type ImportSlot = {
  placeholders: ImportPlaceholder[]
  /** Visible books drawn BEFORE the placeholders (this run's imports, newest first, "recently added" only). */
  leadCount: number
  /** This run's imported books that are not drawn before the placeholders (another sort): shown as a count. */
  addedElsewhere: number
}

const NO_SLOT: ImportSlot = { placeholders: [], leadCount: 0, addedElsewhere: 0 }

/**
 * Spec 016 (FR-010): the coming books live in the SAME grid / list as the books, first in "All books" only (never in
 * Collections, other filters or search results). A book whose import finished is shown at once: with "recently added"
 * it goes before the placeholders (already its final place), with any other sort in its sorted place.
 */
export function useImportSlot(visibleBookIds: readonly string[], sort: string, visible: boolean): ImportSlot {
  const queue = useImportQueueStore((s) => s.queue)
  return useMemo(() => {
    if (!visible) return NO_SLOT
    const placeholders = placeholdersOf(queue)
    if (placeholders.length === 0) return NO_SLOT
    const imported = importedBookIdsOf(queue)
    const leadCount = importedLeadCount(visibleBookIds, imported, sort)
    const addedElsewhere = leadCount === 0 ? visibleBookIds.filter((id) => imported.has(id)).length : 0
    return { placeholders, leadCount, addedElsewhere }
  }, [queue, visibleBookIds, sort, visible])
}


/**
 * Pure derivations of the Collections screens (spec 015, data-model.md §Derived): the cover slots of a card, the rows
 * of the "Add books" picker and the toast summary of a bulk add.
 */
import type { LibraryBook } from './library-book.js'

export type CollectionCoverSlot = { kind: 'book'; bookId: string } | { kind: 'empty' }

/**
 * The first `count` books of a collection that still exist in the library, in collection order, padded with empty
 * slots (FR-012). Always `count` entries.
 */
export function collectionCoverSlots(
  bookIds: readonly string[],
  hasBook: (id: string) => boolean,
  count = 3,
): CollectionCoverSlot[] {
  const slots: CollectionCoverSlot[] = []
  for (const bookId of bookIds) {
    if (slots.length >= count) break
    if (hasBook(bookId)) slots.push({ kind: 'book', bookId })
  }
  while (slots.length < count) slots.push({ kind: 'empty' })
  return slots
}

export type PickerRow = { book: LibraryBook; included: boolean }

/**
 * Picker rows (FR-008, FR-009): the books in the given (Library-sorted) order, filtered by title or author — the
 * query trimmed and compared without case — each marked `included` when it is already in the collection.
 */
export function pickerRows(
  books: readonly LibraryBook[],
  collectionBookIds: readonly string[],
  query: string,
): PickerRow[] {
  const q = query.trim().toLowerCase()
  const inCollection = new Set(collectionBookIds)
  const rows: PickerRow[] = []
  for (const book of books) {
    if (q && !book.title.toLowerCase().includes(q) && !book.author.toLowerCase().includes(q)) continue
    rows.push({ book, included: inCollection.has(book.id) })
  }
  return rows
}

export type BulkAddResult = { ok: boolean; added: readonly string[]; skipped: readonly string[] }
export type BulkAddSummary = { kind: 'added' | 'partial' | 'failed'; added: number; skipped: number }

/** What the toast says after "Add (n)" (FR-010): nothing added on a failure; skipped books are counted apart. */
export function bulkAddSummary(result: BulkAddResult): BulkAddSummary {
  if (!result.ok) return { kind: 'failed', added: 0, skipped: 0 }
  return {
    kind: result.skipped.length > 0 ? 'partial' : 'added',
    added: result.added.length,
    skipped: result.skipped.length,
  }
}

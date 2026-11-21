/**
 * Selecting several books in the phone Library (long press → select mode): the pure rules behind the selection bar
 * and the bulk actions (favourite, add to collection, remove).
 */

/** Adds or removes one id, keeping the order the books were picked in. */
export function toggleSelected(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

/** Only the ids still shown (a book removed or filtered out meanwhile leaves the selection). */
export function pruneSelection(ids: readonly string[], visibleIds: readonly string[]): string[] {
  const visible = new Set(visibleIds)
  return ids.filter((id) => visible.has(id))
}

/** "Select all" turns into "Deselect all" once every shown book is selected. */
export function allSelected(ids: readonly string[], visibleIds: readonly string[]): boolean {
  if (visibleIds.length === 0) return false
  const picked = new Set(ids)
  return visibleIds.every((id) => picked.has(id))
}

type FavoriteBook = { id: string; isFavorite?: boolean }

/**
 * What the Favourite button does for the selection: `true` = mark every one a favourite (at least one is not),
 * `false` = remove them all from favourites (every one already is).
 */
export function bulkFavoriteTarget(books: readonly FavoriteBook[], ids: readonly string[]): boolean {
  const picked = new Set(ids)
  return books.some((b) => picked.has(b.id) && !b.isFavorite)
}

/** The ids whose favourite flag actually changes (the others are left alone). */
export function favoriteChanges(books: readonly FavoriteBook[], ids: readonly string[], target: boolean): string[] {
  const picked = new Set(ids)
  return books.filter((b) => picked.has(b.id) && Boolean(b.isFavorite) !== target).map((b) => b.id)
}

/** A multi-chapter audiobook is removed with its own call (folder + chapter rows); everything else is one book. */
export function removalKindOf(book: { chapterCount?: number }): 'remove' | 'remove-audiobook' {
  return (book.chapterCount ?? 0) > 1 ? 'remove-audiobook' : 'remove'
}

/** The toast after a bulk action: all done, some failed, or nothing done. */
export type BulkResult = { kind: 'done'; count: number } | { kind: 'partial'; done: number; failed: number } | { kind: 'failed' }

export function bulkResult(done: number, failed: number): BulkResult {
  if (done === 0) return { kind: 'failed' }
  return failed === 0 ? { kind: 'done', count: done } : { kind: 'partial', done, failed }
}

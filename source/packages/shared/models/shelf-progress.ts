import type { LibraryBook } from './library-book.js'

/** Progress chip / last-read line for shelf & filter list rows (SCR-01a). */
export type ShelfProgressView = {
  progressKind?: 'chip' | 'last'
  progressLabel?: string
  progressDone?: boolean
}

/**
 * Derive list progress chrome from LibraryBook status / last-read location.
 * Platforms map this into their list-item props.
 */
export function shelfProgressForBook(book: LibraryBook): ShelfProgressView {
  const useChip = book.status === 'completed' || book.status === 'not-started'
  if (useChip) {
    return {
      progressKind: 'chip',
      progressLabel: book.status === 'completed' ? 'Completed' : 'Not started',
      progressDone: book.status === 'completed',
    }
  }
  if (book.lastReadLocation) {
    return {
      progressKind: 'last',
      progressLabel: `Last at · ${book.lastReadLocation}`,
      progressDone: false,
    }
  }
  return {}
}

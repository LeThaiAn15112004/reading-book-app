import type { MessageRef } from '../i18n/translate.js'
import type { LibraryBook } from './library-book.js'

/** Progress chip / last-read line for shelf & filter list rows (SCR-01a). The label is translated by the UI (spec 012). */
export type ShelfProgressView = {
  progressKind?: 'chip' | 'last'
  progressLabel?: MessageRef
  progressDone?: boolean
}

export function formatLastReadLine(location: string): MessageRef {
  return { key: 'library.progress.lastAt', params: { location: location.trim() } }
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
      progressLabel: { key: book.status === 'completed' ? 'library.progress.completed' : 'library.progress.notStarted' },
      progressDone: book.status === 'completed',
    }
  }
  if (book.lastReadLocation) {
    return {
      progressKind: 'last',
      progressLabel: formatLastReadLine(book.lastReadLocation),
      progressDone: false,
    }
  }
  return {}
}

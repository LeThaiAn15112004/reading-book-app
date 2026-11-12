/**
 * Phone Library rules (spec 013, data-model.md): filter chips, the Continue Reading carousel, Resume vs Read again
 * and the list-row progress bar. Pure functions over `LibraryBook`; the desktop Library keeps its own rules.
 */
import type { MessageKey } from '../i18n/translate.js'
import { filterByNav, type LibraryBook } from './library-book.js'

/** The four chips of the phone Library, in display order. `favorites` is labelled "Saved". */
export type PhoneChipId = 'all' | 'recent' | 'favorites' | 'completed'

/** Every Library filter id the phone may find in the shared browse store (desktop-only ones included). */
export type PhoneBrowseFilter = PhoneChipId | 'reading' | 'not-started'

export const PHONE_LIBRARY_CHIPS: readonly { id: PhoneChipId; labelKey: MessageKey }[] = [
  { id: 'all', labelKey: 'library.phone.chips.all' },
  { id: 'recent', labelKey: 'library.phone.chips.recent' },
  { id: 'favorites', labelKey: 'library.phone.chips.saved' },
  { id: 'completed', labelKey: 'library.phone.chips.completed' },
]

export type ContinueAction = 'resume' | 'read-again'

const titleCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Most recently read first; ties by title. Books without `lastReadAt` must be filtered out before. */
function byLastReadDesc(a: LibraryBook, b: LibraryBook): number {
  const byDate = (b.lastReadAt ?? '').localeCompare(a.lastReadAt ?? '')
  return byDate || titleCollator.compare(a.title, b.title)
}

/**
 * Books shown by one chip. `recent` = books that have been opened, most recently read first (it ignores the chosen
 * sort, FR-032); the other chips keep the input order, which the caller has already sorted.
 */
export function filterPhoneChip(books: readonly LibraryBook[], chip: PhoneChipId): LibraryBook[] {
  switch (chip) {
    case 'all':
      return [...books]
    case 'recent':
      return books.filter((book) => Boolean(book.lastReadAt)).sort(byLastReadDesc)
    case 'favorites':
    case 'completed':
      return filterByNav([...books], chip)
  }
}

/** The chip to highlight for a filter: desktop-only filters (`reading`, `not-started`) are shown as All. */
export function toPhoneChip(filter: PhoneBrowseFilter): PhoneChipId {
  return filter === 'reading' || filter === 'not-started' ? 'all' : filter
}

/** Continue Reading on the phone: started books (in progress or finished), most recently read first, at most `limit`. */
export function pickPhoneContinueReading(books: readonly LibraryBook[], limit = 10): LibraryBook[] {
  return books
    .filter((book) => (book.status === 'reading' || book.status === 'completed') && Boolean(book.lastReadAt))
    .sort(byLastReadDesc)
    .slice(0, limit)
}

/** "Read again" for a finished book (completed, or read to 100 %), "Resume" otherwise. */
export function continueAction(book: LibraryBook): ContinueAction {
  return book.status === 'completed' || (book.progressPercent ?? 0) >= 100 ? 'read-again' : 'resume'
}

/** Rounded progress for the list row's thin bar, or `undefined` (no bar) for a book that has never been opened. */
export function listRowProgress(book: LibraryBook): number | undefined {
  const percent = book.progressPercent ?? 0
  if (!book.lastReadAt && !(percent > 0)) return undefined
  return Math.round(percent)
}

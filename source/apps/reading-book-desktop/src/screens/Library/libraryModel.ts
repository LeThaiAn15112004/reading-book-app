import type { ShelfDetailItemData } from './components/ShelfDetailItem'
import type { LibraryBook } from '@reading-book/shared/models'

export type {
  BookSummaryInput,
  CollectionSummary,
  LibraryBook,
  LibraryReadingStatus,
  NavFilterId,
  ShelfId,
} from '@reading-book/shared/models'

export {
  NAV_FILTERS,
  filterByNav,
  filterByShelf,
  formatRelativeLastRead,
  mapBookSummary,
  matchesSearch,
  pickContinueReading,
} from '@reading-book/shared/models'

/** Map LibraryBook → shelf/filter list row (desktop ShelfDetailItem chrome). */
export function toShelfDetailItem(
  book: LibraryBook,
  opts?: { forceFavoriteStar?: boolean },
): ShelfDetailItemData {
  const showStar = opts?.forceFavoriteStar || book.isFavorite
  const useChip = book.status === 'completed' || book.status === 'not-started'
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    fileName: book.fileName,
    format: book.format,
    coverUrl: book.coverUrl,
    isFavorite: showStar,
    progressKind: useChip ? 'chip' : book.lastReadLocation ? 'last' : undefined,
    progressLabel: useChip
      ? book.status === 'completed'
        ? 'Completed'
        : 'Not started'
      : book.lastReadLocation
        ? `Last at · ${book.lastReadLocation}`
        : undefined,
    progressDone: book.status === 'completed',
  }
}

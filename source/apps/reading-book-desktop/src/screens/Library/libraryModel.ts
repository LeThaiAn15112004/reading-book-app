import type { ShelfDetailItemData } from './components/shelves/ShelfDetailItem'
import {
  shelfProgressForBook,
  type LibraryBook,
} from '@reading-book/shared/models'

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
  formatFileSizeMb,
  formatLastReadLine,
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
  const progress = shelfProgressForBook(book)
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    fileName: book.fileName,
    format: book.format,
    coverUrl: book.coverUrl,
    fileSizeBytes: book.fileSizeBytes,
    description: book.description,
    genre: book.genre,
    genres: book.genres,
    pageCount: book.pageCount,
    isFavorite: showStar,
    ...progress,
  }
}

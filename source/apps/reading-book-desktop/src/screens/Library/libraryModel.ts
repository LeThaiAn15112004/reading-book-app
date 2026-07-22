import { libraryApi } from '../../bridge'
import type { ShelfDetailItemData } from './components/ShelfDetailItem'

type BookSummaryDto = Awaited<ReturnType<typeof libraryApi.listBooks>>[number]

/** Reading status used by shelves + nav filters (SCR-01). */
export type LibraryReadingStatus = 'reading' | 'completed' | 'not-started'

/** Library row enriched for search / filters / Continue Reading (FR-08). */
export type LibraryBook = {
  id: string
  title: string
  author: string
  fileName: string
  format: string
  isFavorite: boolean
  status: LibraryReadingStatus
  /** When set, book is eligible for Continue Reading. */
  lastReadLocation?: string
  lastReadAt?: string
  noteCount: number
}

export type NavFilterId = 'favorites' | 'completed' | 'to-read'

export type CollectionSummary = {
  id: string
  name: string
  description?: string
  /** Book ids in this collection (`COLLECTION_BOOK`), display order. */
  bookIds: string[]
  createdAt: string
  updatedAt: string
}

export const NAV_FILTERS: Record<
  NavFilterId,
  { title: string; empty: string; showStar: boolean }
> = {
  favorites: {
    title: 'Favorites',
    empty: 'No favorites yet. Star a book from the library to see it here.',
    showStar: true,
  },
  completed: {
    title: 'Completed',
    empty: 'No completed books yet. Mark a book completed to see it here.',
    showStar: false,
  },
  'to-read': {
    title: 'To read',
    empty: 'Nothing queued yet. Books you have not started appear here.',
    showStar: false,
  },
}

/** Map IPC summary → Library UI model (optional fields filled as G2+ lands). */
export function mapBookSummary(dto: BookSummaryDto): LibraryBook {
  const fileName =
    dto.fileName?.trim() ||
    (dto.title ? `${dto.title}.${dto.format}` : `${dto.id}.${dto.format}`)
  const lastReadLocation = dto.lastReadLocation?.trim() || undefined
  const status: LibraryReadingStatus =
    dto.readingStatus ??
    (lastReadLocation ? 'reading' : 'not-started')

  return {
    id: dto.id,
    title: dto.title,
    author: dto.author?.trim() || '—',
    fileName,
    format: dto.format,
    isFavorite: dto.isFavorite ?? false,
    status,
    lastReadLocation,
    lastReadAt: dto.lastReadAt,
    noteCount: dto.noteCount ?? 0,
  }
}

/** Most recently updated book that has a last-read location (FR-08 / T1.7). */
export function pickContinueReading(books: LibraryBook[]): LibraryBook | null {
  const withLast = books.filter((b) => Boolean(b.lastReadLocation))
  if (withLast.length === 0) return null
  return withLast.reduce((best, b) => {
    const a = best.lastReadAt ?? ''
    const c = b.lastReadAt ?? ''
    return c > a ? b : best
  })
}

/** Local search: title / author / filename (+ format, matching mockup). */
export function matchesSearch(book: LibraryBook, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    book.title.toLowerCase().includes(q) ||
    book.author.toLowerCase().includes(q) ||
    book.fileName.toLowerCase().includes(q) ||
    book.format.toLowerCase().includes(q)
  )
}

export function filterByNav(books: LibraryBook[], filter: NavFilterId): LibraryBook[] {
  switch (filter) {
    case 'favorites':
      return books.filter((b) => b.isFavorite)
    case 'completed':
      return books.filter((b) => b.status === 'completed')
    case 'to-read':
      return books.filter((b) => b.status === 'not-started')
  }
}

/** Books belonging to a SCR-01 shelf (status === shelf id). */
export function filterByShelf(
  books: LibraryBook[],
  shelfId: LibraryReadingStatus,
): LibraryBook[] {
  return books.filter((b) => b.status === shelfId)
}

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

export function formatRelativeLastRead(iso?: string): string | undefined {
  if (!iso) return undefined
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return undefined
  const diffMs = Date.now() - then
  if (diffMs < 60_000) return 'just now'
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

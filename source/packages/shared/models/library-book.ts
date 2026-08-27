/** Reading status used by shelves + nav filters (SCR-01). */
export type LibraryReadingStatus = 'reading' | 'completed' | 'not-started'

/** SCR-01 shelf ids (same as reading status groups). */
export type ShelfId = LibraryReadingStatus

/** Library row enriched for search / filters / Continue Reading (FR-08). */
export type LibraryBook = {
  id: string
  title: string
  author: string
  fileName: string
  format: string
  isFavorite: boolean
  status: LibraryReadingStatus
  /** Renderer-safe cover URL when import extracted a cover (e.g. EPUB). */
  coverUrl?: string
  /** When set, book is eligible for Continue Reading. */
  lastReadLocation?: string
  lastReadAt?: string
  noteCount: number
  /** File size in bytes for Library MB display. */
  fileSizeBytes?: number
  /** Short blurb (OPF description / enrich). */
  description?: string
  /** Genre / subject names (from book_genres). */
  genres?: string[]
  /** Joined genre label for list / search display. */
  genre?: string
  /** Page or spine-section count when known. */
  pageCount?: number
  /** Cloud Sources provenance — set only for books downloaded from a linked provider. */
  sourceProvider?: 'google_drive' | 'dropbox' | 'onedrive'
  externalId?: string
}

export type NavFilterId = 'favorites' | 'completed' | 'to-read' | 'reading'

/**
 * Platform book list row (IPC / store DTO). Apps map this into `LibraryBook`.
 * Keep field names aligned with desktop `BookSummaryDto`.
 */
export type BookSummaryInput = {
  id: string
  title: string
  format: string
  author?: string
  fileName?: string
  /** Renderer-safe cover URL (`rb-cover://…`); optional. */
  coverUrl?: string
  fileSizeBytes?: number
  description?: string
  genres?: string[]
  /** @deprecated Prefer genres[]; kept for older IPC shapes. */
  genre?: string
  pageCount?: number
  isFavorite?: boolean
  readingStatus?: LibraryReadingStatus
  lastReadLocation?: string
  lastReadAt?: string
  noteCount?: number
  sourceProvider?: 'google_drive' | 'dropbox' | 'onedrive'
  externalId?: string
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
  reading: {
    title: 'Recent Books',
    empty: 'No recent books. Start reading to see them here.',
    showStar: false,
  },
}

/** Map store/IPC summary → Library UI model. */
export function mapBookSummary(dto: BookSummaryInput): LibraryBook {
  const fileName =
    dto.fileName?.trim() ||
    (dto.title ? `${dto.title}.${dto.format}` : `${dto.id}.${dto.format}`)
  const lastReadLocation = dto.lastReadLocation?.trim() || undefined
  const status: LibraryReadingStatus =
    dto.readingStatus ?? (lastReadLocation ? 'reading' : 'not-started')

  const coverUrl = dto.coverUrl?.trim() || undefined
  const description = dto.description?.trim() || undefined
  const genres = [
    ...new Set(
      (dto.genres ?? [])
        .map((g) => g.trim())
        .filter((g) => g.length > 0),
    ),
  ]
  if (genres.length === 0 && dto.genre?.trim()) {
    for (const part of dto.genre.split(',')) {
      const t = part.trim()
      if (t) genres.push(t)
    }
  }
  const genre = genres.length > 0 ? genres.join(', ') : undefined
  const pageCount =
    dto.pageCount != null && dto.pageCount > 0
      ? Math.floor(dto.pageCount)
      : undefined
  const fileSizeBytes =
    dto.fileSizeBytes != null && dto.fileSizeBytes >= 0
      ? dto.fileSizeBytes
      : undefined

  return {
    id: dto.id,
    title: dto.title,
    author: dto.author?.trim() || '—',
    fileName,
    format: dto.format,
    isFavorite: dto.isFavorite ?? false,
    status,
    coverUrl,
    lastReadLocation,
    lastReadAt: dto.lastReadAt,
    noteCount: dto.noteCount ?? 0,
    fileSizeBytes,
    description,
    genres: genres.length > 0 ? genres : undefined,
    genre,
    pageCount,
    sourceProvider: dto.sourceProvider,
    externalId: dto.externalId,
  }
}

/** Most recently updated book that has a last-read location (FR-08 / T1.7). */
export function pickContinueReading(books: LibraryBook[]): LibraryBook | null {
  const withLast = books.filter(
    (book) => book.status === 'reading' && Boolean(book.lastReadLocation),
  )
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
    book.format.toLowerCase().includes(q) ||
    (book.genre?.toLowerCase().includes(q) ?? false) ||
    (book.genres?.some((g) => g.toLowerCase().includes(q)) ?? false) ||
    (book.description?.toLowerCase().includes(q) ?? false)
  )
}

export function filterByNav(
  books: LibraryBook[],
  filter: NavFilterId,
): LibraryBook[] {
  switch (filter) {
    case 'favorites':
      return books.filter((b) => b.isFavorite)
    case 'completed':
      return books.filter((b) => b.status === 'completed')
    case 'to-read':
      return books.filter((b) => b.status === 'not-started')
    case 'reading':
      return books.filter((b) => b.status === 'reading')
  }
}

/** Books belonging to a SCR-01 shelf (status === shelf id). */
export function filterByShelf(
  books: LibraryBook[],
  shelfId: ShelfId,
): LibraryBook[] {
  return books.filter((b) => b.status === shelfId)
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

/** Human-readable file size for Library cards (G1-N7). */
export function formatFileSizeMb(bytes?: number): string | undefined {
  if (bytes == null || bytes < 0 || !Number.isFinite(bytes)) return undefined
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 10) return `${mb.toFixed(1)} MB`
  return `${Math.round(mb)} MB`
}

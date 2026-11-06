/**
 * Library row ⇄ domain codecs shared by Desktop's `SqliteLibraryStore` and Mobile's `MobileLibraryStore`
 * (spec 009 T032, contracts/sql-drivers.md). Pure: no driver, no I/O.
 */
import type { AudioChapterRecord } from '../../audio/audio-book-layout.js'
import { Book } from '../../domain/book/book.js'
import { signatureInfoFromMetadata } from '../../domain/book/book-signature.js'
import { parseDocumentFormat } from '../../domain/book/document-format.js'
import {
  normalizeGenreNames,
  parseGenres,
  parseMetadata,
  parseReadingState,
  type BookMetadataJson,
  type ReadingStateJson,
} from '../../persistence/books-json.js'
import { displayLabelFromStoredLocation } from '../../persistence/session-location.js'
import type { SqlValue } from '../driver.js'

export type ReadingStatus = 'reading' | 'completed' | 'not-started'

/** One `books` row as SQLite returns it. */
export interface BookRow {
  id: string
  title: string
  file_path: string
  normalized_path: string | null
  file_format: string
  cover_path: string | null
  sha256: string
  is_favorite: number
  reading_status: string
  source_url: string | null
  source_provider: string | null
  external_id: string | null
  /** fileSizeBytes, pageCount, description, signatureStatus, … (see books-json.ts). */
  metadata_json: string
  /** string[] of genre names, sorted A→Z. */
  genres_json: string
  /** Last-read location + per-book display prefs (see books-json.ts). */
  reading_state_json: string
  added_at: string
  updated_at: string
}

export interface ReadingSessionSummary {
  /** Human-readable last-read label for Library (never raw CFI JSON). */
  lastReadLocation?: string
  /** `reading_state_json.updatedAt` — when the reading state last changed. */
  lastReadAt?: string
  /** `reading_state_json.percent` (0–100) — reading progress stored by the Reader. */
  progressPercent?: number
}

export interface BookListItem {
  book: Book
  readingStatus: ReadingStatus
  /** Comma-joined author display names (empty if none). */
  authorNames: string
  /** Genre / subject names (empty if none). */
  genreNames: string[]
  session?: ReadingSessionSummary
}

export interface CollectionListItem {
  id: string
  name: string
  description?: string
  bookIds: string[]
  createdAt: string
  updatedAt: string
}

export interface CollectionRow {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface AudioChapterRow {
  id: string
  book_id: string
  position: number
  title: string
  file_name: string
  source_path: string
  file_format: string
  size_bytes: number
  sha256: string
  duration_seconds: number | null
}

export function bookFromRow(row: BookRow): Book {
  const metadata = parseMetadata(row.metadata_json)
  return new Book({
    id: row.id,
    title: row.title,
    filePath: row.file_path,
    normalizedPath: row.normalized_path ?? undefined,
    format: parseDocumentFormat(row.file_format),
    coverPath: row.cover_path ?? undefined,
    sha256: row.sha256,
    fileSizeBytes: metadata.fileSizeBytes ?? undefined,
    description: metadata.description ?? undefined,
    pageCount: metadata.pageCount ?? undefined,
    isFavorite: row.is_favorite === 1,
    signature: signatureInfoFromMetadata(metadata),
    sourceUrl: row.source_url ?? undefined,
    sourceProvider: row.source_provider ?? undefined,
    externalId: row.external_id ?? undefined,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  })
}

/**
 * Book → the values of `INSERT INTO books` (column order of `insertBook`). The signature members are only written when
 * the book carries one: `JSON.stringify` drops the undefined ones, so a book without a signature stores none (Mobile).
 */
export function bookToRowValues(book: Book, genreNames: readonly string[] = []): SqlValue[] {
  const metadata: BookMetadataJson = {
    fileSizeBytes: book.fileSizeBytes,
    pageCount: book.pageCount,
    description: book.description,
    signatureStatus: book.signature?.status,
    signerName: book.signature?.signerName,
    signedAt: book.signature?.signedAt,
    signatureCheckedAt: book.signature?.checkedAt,
    signatureCheckedSha256: book.signature?.checkedSha256,
  }
  return [
    book.id,
    book.title,
    book.filePath,
    book.normalizedPath ?? null,
    book.format,
    book.coverPath ?? null,
    book.sha256,
    book.isFavorite ? 1 : 0,
    book.sourceUrl ?? null,
    book.sourceProvider ?? null,
    book.externalId ?? null,
    JSON.stringify(metadata),
    JSON.stringify(normalizeGenreNames(genreNames)),
    book.addedAt,
    book.updatedAt,
  ]
}

export function sessionSummaryFromState(state: ReadingStateJson): ReadingSessionSummary | undefined {
  const label = displayLabelFromStoredLocation(state.lastReadLocation ?? '')
  if (!label) return undefined
  const percent =
    typeof state.percent === 'number' && Number.isFinite(state.percent) ? Math.min(100, Math.max(0, state.percent)) : undefined
  return { lastReadLocation: label, lastReadAt: state.updatedAt ?? undefined, progressPercent: percent }
}

export function bookListItemFromRow(row: BookRow, authorNames: string): BookListItem {
  return {
    book: bookFromRow(row),
    readingStatus: row.reading_status as ReadingStatus,
    authorNames,
    genreNames: parseGenres(row.genres_json),
    session: sessionSummaryFromState(parseReadingState(row.reading_state_json)),
  }
}

export function collectionFromRow(row: CollectionRow, bookIds: string[]): CollectionListItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    bookIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function audioChapterFromRow(r: AudioChapterRow): AudioChapterRecord {
  return {
    id: r.id,
    bookId: r.book_id,
    position: r.position,
    title: r.title,
    fileName: r.file_name,
    sourcePath: r.source_path,
    fileFormat: r.file_format,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    durationSeconds: r.duration_seconds,
  }
}

export function audioChapterToValues(c: AudioChapterRecord): SqlValue[] {
  return [c.id, c.bookId, c.position, c.title, c.fileName, c.sourcePath, c.fileFormat, c.sizeBytes, c.sha256, c.durationSeconds]
}

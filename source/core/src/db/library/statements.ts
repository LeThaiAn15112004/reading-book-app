/**
 * SQL of the library stores as `Statement` builders (positional `?`), shared by Desktop's `SqliteLibraryStore` and
 * Mobile's `MobileLibraryStore` (spec 009 T032). The stores keep their own control flow and transactions; they only
 * run these through their driver. No driver, no I/O.
 */
import type { ReadingStateJson } from '../../persistence/books-json.js'
import type { SqlValue, Statement } from '../driver.js'
import type { ReadingStatus } from './codec.js'

const s = (sql: string, ...params: SqlValue[]): Statement => ({ sql, params })

export const BOOK_COLUMNS = `
  id, title, file_path, normalized_path, file_format, cover_path, sha256,
  is_favorite, reading_status, source_url, source_provider, external_id,
  metadata_json, genres_json, reading_state_json,
  added_at, updated_at
`

export const AUDIO_CHAPTER_COLUMNS =
  'id, book_id, position, title, file_name, source_path, file_format, size_bytes, sha256, duration_seconds'

// --- books ---------------------------------------------------------------------------------------------------------

export const selectBookById = (id: string) => s(`SELECT ${BOOK_COLUMNS} FROM books WHERE id = ?`, id)
export const selectBookBySha256 = (hash: string) => s(`SELECT ${BOOK_COLUMNS} FROM books WHERE sha256 = ?`, hash)
export const selectBookByProviderAndExternalId = (provider: string, externalId: string) =>
  s(`SELECT ${BOOK_COLUMNS} FROM books WHERE source_provider = ? AND external_id = ?`, provider, externalId)
export const selectAllBooksNewestFirst = () => s(`SELECT ${BOOK_COLUMNS} FROM books ORDER BY added_at DESC`)
export const selectAllBookIds = () => s('SELECT id FROM books')
export const selectBookFilePaths = () => s('SELECT file_path FROM books')
export const selectBookTitle = (id: string) => s('SELECT title FROM books WHERE id = ?', id)
export const selectBookGenres = (id: string) => s('SELECT genres_json FROM books WHERE id = ?', id)
export const selectBookReadingStatus = (id: string) => s('SELECT reading_status FROM books WHERE id = ?', id)
export const selectBookReadingState = (id: string) => s('SELECT reading_state_json FROM books WHERE id = ?', id)

/** Values in the order of `bookToRowValues`; `reading_status` and `reading_state_json` take their column defaults. */
export const insertBook = (values: SqlValue[]) =>
  s(
    `INSERT INTO books (
       id, title, file_path, normalized_path, file_format, cover_path, sha256,
       is_favorite, source_url, source_provider, external_id,
       metadata_json, genres_json, added_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...values,
  )

export const deleteBook = (id: string) => s('DELETE FROM books WHERE id = ?', id)
export const deleteNotesOfBook = (bookId: string) => s('DELETE FROM notes WHERE book_id = ?', bookId)
export const deleteCollectionLinksOfBook = (bookId: string) => s('DELETE FROM collection_books WHERE book_id = ?', bookId)

export const updateReadingStatus = (bookId: string, status: ReadingStatus, now: string) =>
  s('UPDATE books SET reading_status = ?, updated_at = ? WHERE id = ?', status, now, bookId)
export const updateFavorite = (bookId: string, value: boolean, now: string) =>
  s('UPDATE books SET is_favorite = ?, updated_at = ? WHERE id = ?', value ? 1 : 0, now, bookId)
export const updateCoverPath = (bookId: string, coverPath: string, now: string) =>
  s('UPDATE books SET cover_path = ?, updated_at = ? WHERE id = ?', coverPath, now, bookId)
export const updateFilePath = (bookId: string, filePath: string, now: string) =>
  s('UPDATE books SET file_path = ?, updated_at = ? WHERE id = ?', filePath, now, bookId)
export const updateGenres = (bookId: string, genresJson: string) =>
  s('UPDATE books SET genres_json = ? WHERE id = ?', genresJson, bookId)

/** Merge `patch` into `reading_state_json` in one atomic statement (`json_patch`, RFC 7396). */
export const patchReadingState = (bookId: string, patch: ReadingStateJson) =>
  s('UPDATE books SET reading_state_json = json_patch(reading_state_json, ?) WHERE id = ?', JSON.stringify(patch), bookId)

/** `sha256` is kept in step with the file; no-op when unchanged (`sha256 <> ?`). `updated_at` is left alone. */
export const updateFileFingerprint = (bookId: string, sha256: string, patchJson: string) =>
  s('UPDATE books SET sha256 = ?, metadata_json = json_patch(metadata_json, ?) WHERE id = ? AND sha256 <> ?', sha256, patchJson, bookId, sha256)

/** Merge-patches `metadata_json` only (`updated_at` left alone: derived data such as a signature result). */
export const patchMetadata = (bookId: string, patchJson: string) =>
  s('UPDATE books SET metadata_json = json_patch(metadata_json, ?) WHERE id = ?', patchJson, bookId)

/** Title + metadata merge-patch + `updated_at` (Desktop's edit dialog / backfill). */
export const updateBookMetadata = (bookId: string, title: string, patchJson: string, now: string) =>
  s('UPDATE books SET title = ?, metadata_json = json_patch(metadata_json, ?), updated_at = ? WHERE id = ?', title, patchJson, now, bookId)

/** The same plus `genres_json` (Mobile does title, metadata and genres in one statement). */
export const updateBookMetadataAndGenres = (bookId: string, title: string, patchJson: string, genresJson: string, now: string) =>
  s('UPDATE books SET title = ?, metadata_json = json_patch(metadata_json, ?), genres_json = ?, updated_at = ? WHERE id = ?', title, patchJson, genresJson, now, bookId)

// --- authors -------------------------------------------------------------------------------------------------------

export const selectAuthorByName = (name: string) =>
  s('SELECT id, name, sort_name, created_at FROM authors WHERE LOWER(name) = LOWER(?) LIMIT 1', name)
export const insertAuthor = (id: string, name: string, sortName: string | null, createdAt: string) =>
  s('INSERT INTO authors (id, name, sort_name, created_at) VALUES (?, ?, ?, ?)', id, name, sortName, createdAt)
export const insertBookAuthor = (bookId: string, authorId: string, sortOrder: number) =>
  s('INSERT OR IGNORE INTO book_authors (book_id, author_id, sort_order) VALUES (?, ?, ?)', bookId, authorId, sortOrder)
export const deleteBookAuthors = (bookId: string) => s('DELETE FROM book_authors WHERE book_id = ?', bookId)
export const selectAuthorNamesOfBook = (bookId: string) =>
  s(
    `SELECT a.name AS name
     FROM book_authors ba
     JOIN authors a ON a.id = ba.author_id
     WHERE ba.book_id = ?
     ORDER BY ba.sort_order ASC, a.name ASC`,
    bookId,
  )
export const selectAllAuthorNames = () =>
  s(
    `SELECT ba.book_id AS book_id, a.name AS name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
     ORDER BY ba.book_id, ba.sort_order ASC, a.name ASC`,
  )

// --- collections ---------------------------------------------------------------------------------------------------

export const selectCollections = () => s('SELECT id, name, description, created_at, updated_at FROM collections ORDER BY updated_at DESC')
export const selectCollectionBookIds = (collectionId: string) =>
  s('SELECT book_id FROM collection_books WHERE collection_id = ? ORDER BY sort_order ASC, added_at ASC', collectionId)
export const selectAllCollectionLinks = () =>
  s('SELECT collection_id, book_id FROM collection_books ORDER BY sort_order ASC, added_at ASC')
export const selectCollectionExists = (id: string) => s('SELECT 1 AS one FROM collections WHERE id = ?', id)
export const insertCollection = (id: string, name: string, description: string | null, createdAt: string, updatedAt: string) =>
  s('INSERT INTO collections (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, name, description, createdAt, updatedAt)
export const updateCollection = (id: string, name: string, description: string | null, now: string) =>
  s('UPDATE collections SET name = ?, description = ?, updated_at = ? WHERE id = ?', name, description, now, id)
export const deleteCollection = (id: string) => s('DELETE FROM collections WHERE id = ?', id)
export const deleteCollectionLinks = (collectionId: string) => s('DELETE FROM collection_books WHERE collection_id = ?', collectionId)
export const selectNextCollectionSortOrder = (collectionId: string) =>
  s('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM collection_books WHERE collection_id = ?', collectionId)
export const insertCollectionBook = (collectionId: string, bookId: string, sortOrder: number, addedAt: string) =>
  s('INSERT OR IGNORE INTO collection_books (collection_id, book_id, sort_order, added_at) VALUES (?, ?, ?, ?)', collectionId, bookId, sortOrder, addedAt)
export const touchCollection = (collectionId: string, now: string) =>
  s('UPDATE collections SET updated_at = ? WHERE id = ?', now, collectionId)
export const deleteCollectionBook = (collectionId: string, bookId: string) =>
  s('DELETE FROM collection_books WHERE collection_id = ? AND book_id = ?', collectionId, bookId)

// --- multi-chapter audiobooks (Desktop only) -----------------------------------------------------------------------

/** Values in the order of `audioChapterToValues`. */
export const insertAudioChapter = (values: SqlValue[]) =>
  s(`INSERT INTO book_audio_chapters (${AUDIO_CHAPTER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...values)
export const selectAudioChapters = (bookId: string) =>
  s(`SELECT ${AUDIO_CHAPTER_COLUMNS} FROM book_audio_chapters WHERE book_id = ? ORDER BY position`, bookId)
export const selectAudioChapter = (bookId: string, chapterId: string) =>
  s(`SELECT ${AUDIO_CHAPTER_COLUMNS} FROM book_audio_chapters WHERE book_id = ? AND id = ?`, bookId, chapterId)
export const selectHasAudioChapters = (bookId: string) => s('SELECT 1 FROM book_audio_chapters WHERE book_id = ? LIMIT 1', bookId)
export const selectAudioChapterCounts = () => s('SELECT book_id, COUNT(*) AS n FROM book_audio_chapters GROUP BY book_id')

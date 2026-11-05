/**
 * Mobile's `LibraryStore` (spec 008, T044): the SDK port over the host's SQLite, writing `books` rows that mean
 * exactly what Desktop's `SqliteLibraryStore` rows mean (FR-021; checked by the contract fixtures, T046). Row
 * mapping reuses the SDK's JSON helpers (`parseMetadata`, `signatureInfoFromMetadata`, `normalizeGenreNames`).
 *
 * Mobile-only rules (data-model.md), enforced on every save:
 *   - `id` is a UUID;
 *   - `sha256` is unique, lowercase hex, the same SHA-256 of the file bytes Desktop uses;
 *   - `file_path` is relative, `books/{id}/file`, never absolute (absolute paths change after iOS app updates);
 *   - `cover_path` is relative, `covers/{id}.png`, or absent;
 *   - `file_format` is `epub`, `pdf`, `txt` or `md`;
 *   - `signatureStatus` stays absent (not checked; Mobile never verifies signatures).
 */
import {
  Book,
  STARTED_LOCATION_LABEL,
  displayLabelFromStoredLocation,
  isDocumentFormat,
  isPersistedLocationJson,
  normalizeGenreNames,
  parseDocumentFormat,
  parseGenres,
  parseMetadata,
  parseReadingState,
  signatureInfoFromMetadata,
  type BookAuthor,
  type BookMetadataJson,
  type LibraryStore,
  type ReadingStateJson,
} from '@reading-book/book-reader-sdk'
import { queryOne, type SqlDriver, type SqlStatement } from '../db/sql-driver'

export const MOBILE_BOOK_FORMATS = ['epub', 'pdf', 'txt', 'md'] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/

export class MobileBookRuleError extends Error {
  constructor(readonly rule: string, message: string) {
    super(message)
    this.name = 'MobileBookRuleError'
  }
}

export const bookFilePath = (id: string) => `books/${id}/file`
export const bookCoverPath = (id: string) => `covers/${id}.png`

interface BookRow {
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
  metadata_json: string
  genres_json: string
  reading_state_json: string
  added_at: string
  updated_at: string
}

const BOOK_COLUMNS = `id, title, file_path, normalized_path, file_format, cover_path, sha256, is_favorite, reading_status,
  source_url, source_provider, external_id, metadata_json, genres_json, reading_state_json, added_at, updated_at`

/** Same column set and defaults as Desktop's INSERT_BOOK_SQL: reading_status and reading_state_json take their defaults. */
const INSERT_BOOK_SQL = `INSERT INTO books (
    id, title, file_path, normalized_path, file_format, cover_path, sha256,
    is_favorite, source_url, source_provider, external_id,
    metadata_json, genres_json, added_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

export function assertMobileBookRules(book: Book): void {
  const fail = (rule: string, message: string): never => {
    throw new MobileBookRuleError(rule, message)
  }
  if (!UUID.test(book.id)) fail('id', `Book id must be a UUID, got "${book.id}"`)
  if (!SHA256.test(book.sha256)) fail('sha256', 'sha256 must be 64 lowercase hex characters (SHA-256 of the file bytes)')
  if (book.filePath !== bookFilePath(book.id)) fail('file_path', `file_path must be "${bookFilePath(book.id)}", relative to app storage`)
  if (book.coverPath !== undefined && book.coverPath !== bookCoverPath(book.id)) fail('cover_path', `cover_path must be "${bookCoverPath(book.id)}" or absent`)
  if (!(MOBILE_BOOK_FORMATS as readonly string[]).includes(book.format)) fail('file_format', `Mobile stores only ${MOBILE_BOOK_FORMATS.join(', ')}, not ${book.format}`)
  if (book.signature !== undefined) fail('signatureStatus', 'Mobile never checks signatures, so signatureStatus stays absent')
}

function rowToBook(row: BookRow): Book {
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

function bookToParams(book: Book, genreNames: readonly string[] = []) {
  const metadata: BookMetadataJson = {
    fileSizeBytes: book.fileSizeBytes,
    pageCount: book.pageCount,
    description: book.description,
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

export class MobileLibraryStore implements LibraryStore {
  constructor(private readonly db: SqlDriver) {}

  async findById(id: string): Promise<Book | undefined> {
    const row = await queryOne<BookRow>(this.db, `SELECT ${BOOK_COLUMNS} FROM books WHERE id = ?`, [id])
    return row ? rowToBook(row) : undefined
  }

  async findBySha256(hash: string): Promise<Book | undefined> {
    const row = await queryOne<BookRow>(this.db, `SELECT ${BOOK_COLUMNS} FROM books WHERE sha256 = ?`, [hash])
    return row ? rowToBook(row) : undefined
  }

  /** Not used by the first release; Desktop's store does not implement it either. */
  async findByAuthor(): Promise<Book[]> {
    throw new Error('MobileLibraryStore.findByAuthor is not implemented (not used by the first release)')
  }

  async save(book: Book): Promise<void> {
    assertMobileBookRules(book)
    await this.db.run(INSERT_BOOK_SQL, bookToParams(book))
  }

  /** Caller must ensure each author exists in `authors` (same contract as Desktop). */
  async linkAuthors(bookId: string, authors: BookAuthor[]): Promise<void> {
    if (authors.length === 0) return
    await this.db.transaction(
      authors.map((link) => ({
        sql: 'INSERT OR IGNORE INTO book_authors (book_id, author_id, sort_order) VALUES (?, ?, ?)',
        params: [bookId, link.authorId, link.sortOrder],
      })),
    )
  }

  /** Genres are names in books.genres_json (Desktop migration 020); there is no table to link. */
  async linkGenres(): Promise<void> {
    throw new Error('MobileLibraryStore.linkGenres is unsupported: genres live in books.genres_json')
  }

  /**
   * Removes the book's rows in one transaction. The dependents are deleted explicitly, so the result does not depend
   * on the connection's `foreign_keys` setting. Files are the bridge's job, after this (data-model.md, Removal).
   */
  async deleteCascade(bookId: string): Promise<void> {
    await this.db.transaction([
      { sql: 'DELETE FROM notes WHERE book_id = ?', params: [bookId] },
      { sql: 'DELETE FROM collection_books WHERE book_id = ?', params: [bookId] },
      { sql: 'DELETE FROM book_authors WHERE book_id = ?', params: [bookId] },
      { sql: 'DELETE FROM books WHERE id = ?', params: [bookId] },
    ])
  }

  // --- What Desktop's SqliteLibraryStore offers beyond the port (library:* handlers), with the same meaning. ----

  /** Book row + authors + genres in ONE transaction (Desktop's persistImportedBook). */
  async persistImported(book: Book, authorNames: readonly string[] = [], genreNames: readonly string[] = []): Promise<void> {
    assertMobileBookRules(book)
    const statements: SqlStatement[] = [{ sql: INSERT_BOOK_SQL, params: bookToParams(book, genreNames) }]
    statements.push(...(await this.authorLinkStatements(book.id, authorNames)))
    await this.db.transaction(statements)
  }

  /** Every listable book, newest first; a row of a format the app does not know is left out, never fatal. */
  async listItems(): Promise<BookListItem[]> {
    const rows = await this.db.query<BookRow>(`SELECT ${BOOK_COLUMNS} FROM books ORDER BY added_at DESC`)
    const authors = await this.allAuthorNames()
    return rows.filter((row) => isDocumentFormat(row.file_format)).map((row) => rowToItem(row, authors.get(row.id) ?? ''))
  }

  async getItem(id: string): Promise<BookListItem | undefined> {
    const row = await queryOne<BookRow>(this.db, `SELECT ${BOOK_COLUMNS} FROM books WHERE id = ?`, [id])
    if (!row || !isDocumentFormat(row.file_format)) return undefined
    return rowToItem(row, await this.authorNamesForBook(id))
  }

  async authorNamesForBook(bookId: string): Promise<string> {
    const rows = await this.db.query<{ name: string }>(
      `SELECT a.name AS name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
       WHERE ba.book_id = ? ORDER BY ba.sort_order ASC, a.name ASC`,
      [bookId],
    )
    return rows.map((r) => r.name).join(', ')
  }

  /** Desktop's markAsReading: status `reading`; an empty location becomes the `Started` label, a real one is kept. */
  async markAsReading(bookId: string, now = new Date().toISOString()): Promise<void> {
    const row = await queryOne<{ reading_state_json: string }>(this.db, 'SELECT reading_state_json FROM books WHERE id = ?', [bookId])
    if (!row) return
    const current = parseReadingState(row.reading_state_json).lastReadLocation ?? ''
    const patch: ReadingStateJson = { updatedAt: now }
    if (!isPersistedLocationJson(current)) patch.lastReadLocation = current.trim() || STARTED_LOCATION_LABEL
    await this.db.transaction([
      { sql: 'UPDATE books SET reading_status = ?, updated_at = ? WHERE id = ?', params: ['reading', now, bookId] },
      { sql: 'UPDATE books SET reading_state_json = json_patch(reading_state_json, ?) WHERE id = ?', params: [JSON.stringify(patch), bookId] },
    ])
  }

  async setReadingStatus(bookId: string, status: 'reading' | 'completed' | 'not-started', now = new Date().toISOString()): Promise<void> {
    await this.db.run('UPDATE books SET reading_status = ?, updated_at = ? WHERE id = ?', [status, now, bookId])
  }

  async setFavorite(bookId: string, value: boolean): Promise<void> {
    await this.db.run('UPDATE books SET is_favorite = ?, updated_at = ? WHERE id = ?', [value ? 1 : 0, new Date().toISOString(), bookId])
  }

  /** Mobile's cover is always `covers/{id}.png` (data-model.md). */
  async setCoverPath(bookId: string): Promise<void> {
    await this.db.run('UPDATE books SET cover_path = ?, updated_at = ? WHERE id = ?', [bookCoverPath(bookId), new Date().toISOString(), bookId])
  }

  /** Title, description, page count, authors and genres in ONE transaction (Desktop does them one after another). */
  async updateLibraryMetadata(
    bookId: string,
    fields: { title: string; description: string | null; pageCount: number | null; authorNames: string[]; genreNames: string[] },
  ): Promise<boolean> {
    const current = await queryOne<{ title: string }>(this.db, 'SELECT title FROM books WHERE id = ?', [bookId])
    if (!current) return false
    // Only these keys are touched; `null` deletes the key, so unrelated metadata survives (json_patch).
    const patch: BookMetadataJson = {
      description: fields.description?.trim() || null,
      pageCount: fields.pageCount != null && fields.pageCount > 0 ? Math.floor(fields.pageCount) : null,
    }
    const title = fields.title.trim() || current.title
    await this.db.transaction([
      {
        sql: 'UPDATE books SET title = ?, metadata_json = json_patch(metadata_json, ?), genres_json = ?, updated_at = ? WHERE id = ?',
        params: [title, JSON.stringify(patch), JSON.stringify(normalizeGenreNames(fields.genreNames)), new Date().toISOString(), bookId],
      },
      { sql: 'DELETE FROM book_authors WHERE book_id = ?', params: [bookId] },
      ...(await this.authorLinkStatements(bookId, fields.authorNames)),
    ])
    return true
  }

  async listCollections(): Promise<CollectionListItem[]> {
    const rows = await this.db.query<{ id: string; name: string; description: string | null; created_at: string; updated_at: string }>(
      'SELECT id, name, description, created_at, updated_at FROM collections ORDER BY updated_at DESC',
    )
    const links = await this.db.query<{ collection_id: string; book_id: string }>(
      'SELECT collection_id, book_id FROM collection_books ORDER BY sort_order ASC, added_at ASC',
    )
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      bookIds: links.filter((l) => l.collection_id === row.id).map((l) => l.book_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  async createCollection(input: { name: string; description?: string }, id: string = globalThis.crypto.randomUUID()): Promise<CollectionListItem> {
    const now = new Date().toISOString()
    const item: CollectionListItem = { id, name: input.name.trim(), description: input.description?.trim() || undefined, bookIds: [], createdAt: now, updatedAt: now }
    await this.db.run('INSERT INTO collections (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
      item.id,
      item.name,
      item.description ?? null,
      now,
      now,
    ])
    return item
  }

  async updateCollection(id: string, input: { name: string; description?: string }): Promise<CollectionListItem | undefined> {
    const result = await this.db.run('UPDATE collections SET name = ?, description = ?, updated_at = ? WHERE id = ?', [
      input.name.trim(),
      input.description?.trim() || null,
      new Date().toISOString(),
      id,
    ])
    if (result.changes === 0) return undefined
    return (await this.listCollections()).find((c) => c.id === id)
  }

  /** Links first, explicitly: the host's transaction connection has no foreign keys (expo-sqlite), so nothing cascades. */
  async deleteCollection(id: string): Promise<boolean> {
    const results = await this.db.transaction([
      { sql: 'DELETE FROM collection_books WHERE collection_id = ?', params: [id] },
      { sql: 'DELETE FROM collections WHERE id = ?', params: [id] },
    ])
    return results[1]!.changes > 0
  }

  async collectionExists(id: string): Promise<boolean> {
    return (await queryOne(this.db, 'SELECT 1 AS one FROM collections WHERE id = ?', [id])) !== undefined
  }

  async addBookToCollection(collectionId: string, bookId: string): Promise<void> {
    const now = new Date().toISOString()
    const next = await queryOne<{ value: number }>(this.db, 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM collection_books WHERE collection_id = ?', [collectionId])
    await this.db.transaction([
      { sql: 'INSERT OR IGNORE INTO collection_books (collection_id, book_id, sort_order, added_at) VALUES (?, ?, ?, ?)', params: [collectionId, bookId, next?.value ?? 0, now] },
      { sql: 'UPDATE collections SET updated_at = ? WHERE id = ?', params: [now, collectionId] },
    ])
  }

  async removeBookFromCollection(collectionId: string, bookId: string): Promise<boolean> {
    const result = await this.db.run('DELETE FROM collection_books WHERE collection_id = ? AND book_id = ?', [collectionId, bookId])
    if (result.changes > 0) await this.db.run('UPDATE collections SET updated_at = ? WHERE id = ?', [new Date().toISOString(), collectionId])
    return result.changes > 0
  }

  async allBookIds(): Promise<string[]> {
    return (await this.db.query<{ id: string }>('SELECT id FROM books')).map((r) => r.id)
  }

  /** Statements linking `names` in order, creating the authors that do not exist yet (matched case-insensitively). */
  private async authorLinkStatements(bookId: string, names: readonly string[]): Promise<SqlStatement[]> {
    const statements: SqlStatement[] = []
    const seen = new Map<string, string>()
    for (const [index, raw] of names.entries()) {
      const name = raw.trim()
      if (!name) continue
      const key = name.toLowerCase()
      let authorId = seen.get(key)
      if (!authorId) {
        authorId = (await queryOne<{ id: string }>(this.db, 'SELECT id FROM authors WHERE LOWER(name) = LOWER(?) LIMIT 1', [name]))?.id
        if (!authorId) {
          authorId = globalThis.crypto.randomUUID()
          statements.push({ sql: 'INSERT INTO authors (id, name, sort_name, created_at) VALUES (?, ?, NULL, ?)', params: [authorId, name, new Date().toISOString()] })
        }
        seen.set(key, authorId)
      }
      statements.push({ sql: 'INSERT OR IGNORE INTO book_authors (book_id, author_id, sort_order) VALUES (?, ?, ?)', params: [bookId, authorId, index] })
    }
    return statements
  }

  private async allAuthorNames(): Promise<Map<string, string>> {
    const rows = await this.db.query<{ book_id: string; name: string }>(
      `SELECT ba.book_id AS book_id, a.name AS name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
       ORDER BY ba.book_id, ba.sort_order ASC, a.name ASC`,
    )
    const out = new Map<string, string[]>()
    for (const r of rows) out.set(r.book_id, [...(out.get(r.book_id) ?? []), r.name])
    return new Map([...out].map(([id, names]) => [id, names.join(', ')]))
  }
}

export interface ReadingSessionSummary {
  lastReadLocation?: string
  lastReadAt?: string
  progressPercent?: number
}

export interface BookListItem {
  book: Book
  readingStatus: 'reading' | 'completed' | 'not-started'
  authorNames: string
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

/** Desktop's summaryFromState, same meaning: a display label only, never raw Location JSON. */
function summaryFromState(state: ReadingStateJson): ReadingSessionSummary | undefined {
  const label = displayLabelFromStoredLocation(state.lastReadLocation ?? '')
  if (!label) return undefined
  const percent = typeof state.percent === 'number' && Number.isFinite(state.percent) ? Math.min(100, Math.max(0, state.percent)) : undefined
  return { lastReadLocation: label, lastReadAt: state.updatedAt ?? undefined, progressPercent: percent }
}

function rowToItem(row: BookRow, authorNames: string): BookListItem {
  return {
    book: rowToBook(row),
    readingStatus: row.reading_status as BookListItem['readingStatus'],
    authorNames,
    genreNames: parseGenres(row.genres_json),
    session: summaryFromState(parseReadingState(row.reading_state_json)),
  }
}

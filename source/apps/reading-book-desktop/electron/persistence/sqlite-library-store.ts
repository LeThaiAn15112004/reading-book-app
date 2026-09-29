import {
  Author,
  Book,
  BookAuthor,
  parseDocumentFormat,
  type LibraryStore,
} from '@reading-book/book-reader-sdk'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  normalizeGenreNames,
  parseGenres,
  parseMetadata,
  parseReadingState,
  signatureInfoFromMetadata,
  signatureMetadataPatch,
  type BookMetadataJson,
  type BookSignatureInfo,
  type ReadingStateJson,
} from '@reading-book/book-reader-sdk'
import { getDatabase } from './db'
import {
  STARTED_LOCATION_LABEL,
  displayLabelFromStoredLocation,
  isPersistedLocationJson,
} from '@reading-book/book-reader-sdk'

interface BookRow {
  id: string
  title: string
  file_path: string
  normalized_path: string | null
  file_format: string
  cover_path: string | null
  sha256: string
  is_favorite: number
  reading_status: 'reading' | 'completed' | 'not-started'
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

export type ReadingSessionSummary = {
  /** Human-readable last-read label for Library (never raw CFI JSON). */
  lastReadLocation?: string
  /** `reading_state_json.updatedAt` — when the reading state last changed. */
  lastReadAt?: string
}

export type BookListItem = {
  book: Book
  readingStatus: 'reading' | 'completed' | 'not-started'
  /** Comma-joined author display names (empty if none). */
  authorNames: string
  /** Genre / subject names (empty if none). */
  genreNames: string[]
  session?: ReadingSessionSummary
}

export type CollectionListItem = {
  id: string
  name: string
  description?: string
  bookIds: string[]
  createdAt: string
  updatedAt: string
}

const BOOK_COLUMNS = `
  id, title, file_path, normalized_path, file_format, cover_path, sha256,
  is_favorite, reading_status, source_url, source_provider, external_id,
  metadata_json, genres_json, reading_state_json,
  added_at, updated_at
`

const INSERT_BOOK_SQL = `
  INSERT INTO books (
    id, title, file_path, normalized_path, file_format, cover_path, sha256,
    is_favorite, source_url, source_provider, external_id,
    metadata_json, genres_json, added_at, updated_at
  ) VALUES (
    @id, @title, @file_path, @normalized_path, @file_format, @cover_path, @sha256,
    @is_favorite, @source_url, @source_provider, @external_id,
    @metadata_json, @genres_json, @added_at, @updated_at
  )
`

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

/** Book → the `books` columns + JSON blobs. Parameterized (`@name`), never string-built. */
function bookToRowParams(book: Book, genreNames: readonly string[]) {
  // undefined members are dropped by JSON.stringify → "absent" in the stored JSON.
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
  return {
    id: book.id,
    title: book.title,
    file_path: book.filePath,
    normalized_path: book.normalizedPath ?? null,
    file_format: book.format,
    cover_path: book.coverPath ?? null,
    sha256: book.sha256,
    is_favorite: book.isFavorite ? 1 : 0,
    source_url: book.sourceUrl ?? null,
    source_provider: book.sourceProvider ?? null,
    external_id: book.externalId ?? null,
    metadata_json: JSON.stringify(metadata),
    genres_json: JSON.stringify(normalizeGenreNames(genreNames)),
    added_at: book.addedAt,
    updated_at: book.updatedAt,
  }
}

function summaryFromState(state: ReadingStateJson): ReadingSessionSummary | undefined {
  const label = displayLabelFromStoredLocation(state.lastReadLocation ?? '')
  if (!label) return undefined
  return { lastReadLocation: label, lastReadAt: state.updatedAt ?? undefined }
}

/**
 * SQLite LibraryStore — T2.7 find + T2.8 save / linkAuthors / listAll.
 * Genres, reading state and the lesser book metadata live in JSON columns of `books`
 * (migration 020) instead of separate tables.
 */
export class SqliteLibraryStore implements LibraryStore {
  constructor(private readonly db: SqliteDatabase = getDatabase()) {}

  async findById(id: string): Promise<Book | undefined> {
    const row = this.db
      .prepare(`SELECT ${BOOK_COLUMNS} FROM books WHERE id = ?`)
      .get(id) as BookRow | undefined
    return row ? rowToBook(row) : undefined
  }

  async findBySha256(hash: string): Promise<Book | undefined> {
    const row = this.db
      .prepare(`SELECT ${BOOK_COLUMNS} FROM books WHERE sha256 = ?`)
      .get(hash) as BookRow | undefined
    return row ? rowToBook(row) : undefined
  }

  async findByAuthor(_authorId: string): Promise<Book[]> {
    throw new Error('SqliteLibraryStore.findByAuthor is not implemented yet')
  }

  /** Cloud Sources: find a book already imported from a given provider file (dedup lazy download). */
  async findByProviderAndExternalId(
    provider: string,
    externalId: string,
  ): Promise<Book | undefined> {
    const row = this.db
      .prepare(
        `SELECT ${BOOK_COLUMNS} FROM books WHERE source_provider = ? AND external_id = ?`,
      )
      .get(provider, externalId) as BookRow | undefined
    return row ? rowToBook(row) : undefined
  }

  async save(book: Book): Promise<void> {
    this.db.prepare(INSERT_BOOK_SQL).run(bookToRowParams(book, []))
  }

  /**
   * Link book ↔ authors. Caller must ensure each authorId already exists in `authors`.
   */
  async linkAuthors(bookId: string, authors: BookAuthor[]): Promise<void> {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO book_authors (book_id, author_id, sort_order)
       VALUES (@book_id, @author_id, @sort_order)`,
    )
    const run = this.db.transaction((links: BookAuthor[]) => {
      for (const link of links) {
        insert.run({
          book_id: bookId,
          author_id: link.authorId,
          sort_order: link.sortOrder,
        })
      }
    })
    run(authors)
  }

  /**
   * Port method kept for the SDK contract, but there is no `genres` table to link against any
   * more (migration 020): genres are names stored in `books.genres_json`.
   */
  async linkGenres(): Promise<void> {
    throw new Error(
      'SqliteLibraryStore.linkGenres is unsupported: genres live in books.genres_json — use persistImportedBook() or setGenres().',
    )
  }

  /**
   * Find author by case-insensitive name, or create a new row.
   */
  findOrCreateAuthorByName(name: string): Author {
    const trimmed = name.trim()
    if (!trimmed) {
      throw new Error('Author name must not be empty')
    }

    const existing = this.db
      .prepare(
        `SELECT id, name, sort_name, created_at FROM authors
         WHERE LOWER(name) = LOWER(?) LIMIT 1`,
      )
      .get(trimmed) as
      | { id: string; name: string; sort_name: string | null; created_at: string }
      | undefined

    if (existing) {
      return new Author({
        id: existing.id,
        name: existing.name,
        sortName: existing.sort_name ?? undefined,
        createdAt: existing.created_at,
      })
    }

    const author = Author.create(randomUUID(), trimmed)
    this.db
      .prepare(
        `INSERT INTO authors (id, name, sort_name, created_at)
         VALUES (@id, @name, @sort_name, @created_at)`,
      )
      .run({
        id: author.id,
        name: author.name,
        sort_name: author.sortName ?? null,
        created_at: author.createdAt,
      })
    return author
  }

  getReadingSessionSummary(bookId: string): ReadingSessionSummary | undefined {
    const row = this.db
      .prepare(`SELECT reading_state_json FROM books WHERE id = ?`)
      .get(bookId) as { reading_state_json: string } | undefined
    if (!row) return undefined
    return summaryFromState(parseReadingState(row.reading_state_json))
  }

  /**
   * Merge `patch` into `reading_state_json` in one atomic statement. `json_patch` (RFC 7396)
   * overwrites the keys present in `patch` and keeps every other key.
   */
  private patchReadingState(bookId: string, patch: ReadingStateJson): void {
    this.db
      .prepare(
        `UPDATE books
         SET reading_state_json = json_patch(reading_state_json, @patch)
         WHERE id = @id`,
      )
      .run({ id: bookId, patch: JSON.stringify(patch) })
  }

  /**
   * Mark book as in-progress (Library Reading shelf).
   * Does not overwrite a valid Location JSON (CFI); only fills empty with "Started".
   */
  markAsReading(bookId: string, now = new Date().toISOString()): void {
    this.setReadingStatus(bookId, 'reading', now)
    const row = this.db
      .prepare(`SELECT reading_state_json FROM books WHERE id = ?`)
      .get(bookId) as { reading_state_json: string } | undefined
    if (!row) return

    const current = parseReadingState(row.reading_state_json).lastReadLocation ?? ''
    const patch: ReadingStateJson = { updatedAt: now }
    if (!isPersistedLocationJson(current)) {
      patch.lastReadLocation = current.trim() || STARTED_LOCATION_LABEL
    }
    this.patchReadingState(bookId, patch)
  }

  setReadingStatus(
    bookId: string,
    status: 'reading' | 'completed' | 'not-started',
    now = new Date().toISOString(),
  ): void {
    this.db
      .prepare(
        `UPDATE books
         SET reading_status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, now, bookId)
  }

  /**
   * Point a book at a (moved) file. The caller must already have verified that the file's SHA-256
   * equals `books.sha256`. Only the path moves — book id, annotations, chunks and progress stay.
   */
  updateFilePath(bookId: string, filePath: string): void {
    this.db
      .prepare(`UPDATE books SET file_path = ?, updated_at = ? WHERE id = ?`)
      .run(filePath, new Date().toISOString(), bookId)
  }

  setFavorite(bookId: string, value: boolean): void {
    this.db
      .prepare(
        `UPDATE books
         SET is_favorite = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(value ? 1 : 0, new Date().toISOString(), bookId)
  }

  /**
   * Persist book + authors + genres atomically (genres and the default empty reading state are
   * columns of the same `books` row).
   */
  persistImportedBook(
    book: Book,
    authorNames: string[] = [],
    genreNames: string[] = [],
  ): void {
    const run = this.db.transaction(() => {
      this.db.prepare(INSERT_BOOK_SQL).run(bookToRowParams(book, genreNames))

      const authorLinks: BookAuthor[] = []
      authorNames.forEach((name, index) => {
        const trimmed = name.trim()
        if (!trimmed) return
        const author = this.findOrCreateAuthorByName(trimmed)
        authorLinks.push(
          new BookAuthor({
            bookId: book.id,
            authorId: author.id,
            sortOrder: index,
          }),
        )
      })

      if (authorLinks.length > 0) {
        const insert = this.db.prepare(
          `INSERT OR IGNORE INTO book_authors (book_id, author_id, sort_order)
           VALUES (@book_id, @author_id, @sort_order)`,
        )
        for (const link of authorLinks) {
          insert.run({
            book_id: book.id,
            author_id: link.authorId,
            sort_order: link.sortOrder,
          })
        }
      }
    })
    run()
  }

  /** All books newest-first, with joined author names; genres + session come from the same row. */
  async listAll(): Promise<BookListItem[]> {
    const rows = this.db
      .prepare(
        `SELECT ${BOOK_COLUMNS} FROM books ORDER BY added_at DESC`,
      )
      .all() as BookRow[]

    return rows.map((row) => ({
      book: rowToBook(row),
      readingStatus: row.reading_status,
      authorNames: this.authorNamesForBook(row.id),
      genreNames: parseGenres(row.genres_json),
      session: summaryFromState(parseReadingState(row.reading_state_json)),
    }))
  }

  listCollections(): CollectionListItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, description, created_at, updated_at
         FROM collections
         ORDER BY updated_at DESC`,
      )
      .all() as Array<{
      id: string
      name: string
      description: string | null
      created_at: string
      updated_at: string
    }>
    const books = this.db.prepare(
      `SELECT book_id
       FROM collection_books
       WHERE collection_id = ?
       ORDER BY sort_order ASC, added_at ASC`,
    )
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      bookIds: (books.all(row.id) as Array<{ book_id: string }>).map(
        (item) => item.book_id,
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  createCollection(input: {
    name: string
    description?: string
  }): CollectionListItem {
    const now = new Date().toISOString()
    const collection: CollectionListItem = {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      bookIds: [],
      createdAt: now,
      updatedAt: now,
    }
    this.db
      .prepare(
        `INSERT INTO collections (id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        collection.id,
        collection.name,
        collection.description ?? null,
        collection.createdAt,
        collection.updatedAt,
      )
    return collection
  }

  updateCollection(
    collectionId: string,
    input: { name: string; description?: string },
  ): CollectionListItem | undefined {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `UPDATE collections
         SET name = ?, description = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name.trim(),
        input.description?.trim() || null,
        now,
        collectionId,
      )
    if (result.changes === 0) return undefined
    return this.listCollections().find((item) => item.id === collectionId)
  }

  deleteCollection(collectionId: string): boolean {
    return (
      this.db.prepare(`DELETE FROM collections WHERE id = ?`).run(collectionId)
        .changes > 0
    )
  }

  addBookToCollection(collectionId: string, bookId: string): void {
    const now = new Date().toISOString()
    const run = this.db.transaction(() => {
      const next = this.db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
           FROM collection_books
           WHERE collection_id = ?`,
        )
        .get(collectionId) as { value: number }
      this.db
        .prepare(
          `INSERT OR IGNORE INTO collection_books (
             collection_id, book_id, sort_order, added_at
           ) VALUES (?, ?, ?, ?)`,
        )
        .run(collectionId, bookId, next.value, now)
      this.db
        .prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`)
        .run(now, collectionId)
    })
    run()
  }

  removeBookFromCollection(collectionId: string, bookId: string): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM collection_books
         WHERE collection_id = ? AND book_id = ?`,
      )
      .run(collectionId, bookId)
    if (result.changes > 0) {
      this.db
        .prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), collectionId)
    }
    return result.changes > 0
  }

  authorNamesForBook(bookId: string): string {
    const rows = this.db
      .prepare(
        `SELECT a.name AS name
         FROM book_authors ba
         JOIN authors a ON a.id = ba.author_id
         WHERE ba.book_id = ?
         ORDER BY ba.sort_order ASC, a.name ASC`,
      )
      .all(bookId) as { name: string }[]
    return rows.map((r) => r.name).join(', ')
  }

  genreNamesForBook(bookId: string): string[] {
    const row = this.db
      .prepare(`SELECT genres_json FROM books WHERE id = ?`)
      .get(bookId) as { genres_json: string } | undefined
    return row ? parseGenres(row.genres_json) : []
  }

  /** Update description / page_count / optional title (Library metadata backfill + edit dialog). */
  updateLibraryMetadata(
    bookId: string,
    fields: {
      description?: string | null
      pageCount?: number | null
      title?: string
    },
  ): void {
    const current = this.db
      .prepare(`SELECT title FROM books WHERE id = ?`)
      .get(bookId) as { title: string } | undefined
    if (!current) return

    // Only the keys present in `patch` are touched; `null` deletes the key, so unrelated
    // metadata (signerName, fileSizeBytes, …) survives.
    const patch: BookMetadataJson = {}
    if (fields.description !== undefined) {
      patch.description = fields.description?.trim() || null
    }
    if (fields.pageCount !== undefined) {
      patch.pageCount =
        fields.pageCount != null && fields.pageCount > 0
          ? Math.floor(fields.pageCount)
          : null
    }
    const title =
      fields.title?.trim() && fields.title.trim().length > 0
        ? fields.title.trim()
        : current.title

    this.db
      .prepare(
        `UPDATE books
         SET title = @title,
             metadata_json = json_patch(metadata_json, @patch),
             updated_at = @updated_at
         WHERE id = @id`,
      )
      .run({
        id: bookId,
        title,
        patch: JSON.stringify(patch),
        updated_at: new Date().toISOString(),
      })
  }

  /**
   * Store a signature-verification result, replacing the previous one member by member
   * (`signatureMetadataPatch` nulls anything the new result lacks, so no stale signer name
   * survives). `updated_at` is left alone: this is derived data, not a user edit.
   */
  saveSignature(bookId: string, info: BookSignatureInfo | undefined): void {
    this.db
      .prepare(
        `UPDATE books
         SET metadata_json = json_patch(metadata_json, @patch)
         WHERE id = @id`,
      )
      .run({ id: bookId, patch: JSON.stringify(signatureMetadataPatch(info)) })
  }

  /** Replace author links for a book (used by metadata backfill after cascade wipe). */
  replaceAuthorsByName(bookId: string, authorNames: string[]): void {
    const run = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM book_authors WHERE book_id = ?`).run(bookId)
      authorNames.forEach((name, index) => {
        const trimmed = name.trim()
        if (!trimmed) return
        const author = this.findOrCreateAuthorByName(trimmed)
        this.db
          .prepare(
            `INSERT OR IGNORE INTO book_authors (book_id, author_id, sort_order)
             VALUES (@book_id, @author_id, @sort_order)`,
          )
          .run({
            book_id: bookId,
            author_id: author.id,
            sort_order: index,
          })
      })
    })
    run()
  }

  /** Replace a book's genres (trimmed, case-insensitively de-duplicated, sorted A→Z). */
  setGenres(bookId: string, genreNames: string[]): void {
    this.db
      .prepare(`UPDATE books SET genres_json = @genres WHERE id = @id`)
      .run({ id: bookId, genres: JSON.stringify(normalizeGenreNames(genreNames)) })
  }

  readingStatusForBook(
    bookId: string,
  ): 'reading' | 'completed' | 'not-started' {
    const row = this.db
      .prepare(`SELECT reading_status FROM books WHERE id = ?`)
      .get(bookId) as { reading_status: BookRow['reading_status'] } | undefined
    return row?.reading_status ?? 'not-started'
  }

  async deleteCascade(bookId: string): Promise<void> {
    this.db.prepare(`DELETE FROM books WHERE id = ?`).run(bookId)
  }
}

let libraryStore: SqliteLibraryStore | null = null

/** Singleton LibraryStore backed by the open SQLite DB. */
export function getLibraryStore(): SqliteLibraryStore {
  if (!libraryStore) {
    libraryStore = new SqliteLibraryStore()
  }
  return libraryStore
}

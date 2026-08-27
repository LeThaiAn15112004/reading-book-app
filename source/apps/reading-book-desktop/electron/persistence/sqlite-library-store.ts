import {
  Author,
  Book,
  BookAuthor,
  BookGenre,
  Genre,
  parseDocumentFormat,
  type LibraryStore,
} from '@reading-book/domain'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { getDatabase } from './db'
import {
  STARTED_LOCATION_LABEL,
  displayLabelFromStoredLocation,
  isPersistedLocationJson,
} from './reading-session-location'

interface BookRow {
  id: string
  title: string
  file_path: string
  normalized_path: string | null
  file_format: string
  cover_path: string | null
  sha256: string
  file_size_bytes: number | null
  description: string | null
  page_count: number | null
  is_favorite: number
  reading_status: 'reading' | 'completed' | 'not-started'
  is_signed: number
  source_url: string | null
  source_provider: string | null
  external_id: string | null
  added_at: string
  updated_at: string
}

export type ReadingSessionSummary = {
  /** Human-readable last-read label for Library (never raw CFI JSON). */
  lastReadLocation?: string
  /** Alias of reading_session_states.updated_at. */
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
  id, title, file_path, normalized_path, file_format, cover_path,
  sha256, file_size_bytes, description, page_count,
  is_favorite, reading_status, is_signed, source_url, source_provider, external_id,
  added_at, updated_at
`

function rowToBook(row: BookRow): Book {
  return new Book({
    id: row.id,
    title: row.title,
    filePath: row.file_path,
    normalizedPath: row.normalized_path ?? undefined,
    format: parseDocumentFormat(row.file_format),
    coverPath: row.cover_path ?? undefined,
    sha256: row.sha256,
    fileSizeBytes: row.file_size_bytes ?? undefined,
    description: row.description ?? undefined,
    pageCount: row.page_count ?? undefined,
    isFavorite: row.is_favorite === 1,
    isSigned: row.is_signed === 1,
    sourceUrl: row.source_url ?? undefined,
    sourceProvider: row.source_provider ?? undefined,
    externalId: row.external_id ?? undefined,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  })
}

/**
 * SQLite LibraryStore — T2.7 find + T2.8 save / linkAuthors / linkGenres / listAll.
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
    this.db
      .prepare(
        `INSERT INTO books (
          id, title, file_path, normalized_path, file_format, cover_path,
          sha256, file_size_bytes, description, page_count,
          is_favorite, is_signed, source_url, source_provider, external_id, added_at, updated_at
        ) VALUES (
          @id, @title, @file_path, @normalized_path, @file_format, @cover_path,
          @sha256, @file_size_bytes, @description, @page_count,
          @is_favorite, @is_signed, @source_url, @source_provider, @external_id, @added_at, @updated_at
        )`,
      )
      .run({
        id: book.id,
        title: book.title,
        file_path: book.filePath,
        normalized_path: book.normalizedPath ?? null,
        file_format: book.format,
        cover_path: book.coverPath ?? null,
        sha256: book.sha256,
        file_size_bytes: book.fileSizeBytes ?? null,
        description: book.description ?? null,
        page_count: book.pageCount ?? null,
        is_favorite: book.isFavorite ? 1 : 0,
        is_signed: book.isSigned ? 1 : 0,
        source_url: book.sourceUrl ?? null,
        source_provider: book.sourceProvider ?? null,
        external_id: book.externalId ?? null,
        added_at: book.addedAt,
        updated_at: book.updatedAt,
      })
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
   * Link book ↔ genres. Caller must ensure each genreId already exists in `genres`.
   */
  async linkGenres(bookId: string, genres: BookGenre[]): Promise<void> {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO book_genres (book_id, genre_id)
       VALUES (@book_id, @genre_id)`,
    )
    const run = this.db.transaction((links: BookGenre[]) => {
      for (const link of links) {
        insert.run({
          book_id: bookId,
          genre_id: link.genreId,
        })
      }
    })
    run(genres)
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

  /** Find genre by case-insensitive name, or create a new row. */
  findOrCreateGenreByName(name: string): Genre {
    const trimmed = name.trim()
    if (!trimmed) {
      throw new Error('Genre name must not be empty')
    }

    const existing = this.db
      .prepare(
        `SELECT id, name, created_at FROM genres
         WHERE LOWER(name) = LOWER(?) LIMIT 1`,
      )
      .get(trimmed) as
      | { id: string; name: string; created_at: string }
      | undefined

    if (existing) {
      return new Genre({
        id: existing.id,
        name: existing.name,
        createdAt: existing.created_at,
      })
    }

    const genre = Genre.create(randomUUID(), trimmed)
    this.db
      .prepare(
        `INSERT INTO genres (id, name, created_at)
         VALUES (@id, @name, @created_at)`,
      )
      .run({
        id: genre.id,
        name: genre.name,
        created_at: genre.createdAt,
      })
    return genre
  }

  /** Default reading session row (WF-02 progress mặc định). */
  insertDefaultReadingSession(bookId: string, now = new Date().toISOString()): void {
    this.db
      .prepare(
        `INSERT INTO reading_session_states (
          book_id, last_read_location, percent, is_landscape, updated_at
        ) VALUES (?, '', 0, 0, ?)`,
      )
      .run(bookId, now)
  }

  getReadingSessionSummary(bookId: string): ReadingSessionSummary | undefined {
    const row = this.db
      .prepare(
        `SELECT last_read_location, updated_at
         FROM reading_session_states WHERE book_id = ?`,
      )
      .get(bookId) as
      | { last_read_location: string; updated_at: string }
      | undefined
    if (!row) return undefined
    const label = displayLabelFromStoredLocation(row.last_read_location)
    if (!label) return undefined
    return { lastReadLocation: label, lastReadAt: row.updated_at }
  }

  /**
   * Mark book as in-progress (Library Reading shelf).
   * Does not overwrite a valid Location JSON (CFI); only fills empty with "Started".
   */
  markAsReading(bookId: string, now = new Date().toISOString()): void {
    this.setReadingStatus(bookId, 'reading', now)
    const existing = this.db
      .prepare(
        `SELECT last_read_location FROM reading_session_states WHERE book_id = ?`,
      )
      .get(bookId) as { last_read_location: string } | undefined

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO reading_session_states (
            book_id, last_read_location, percent, is_landscape, updated_at
          ) VALUES (?, ?, 0, 0, ?)`,
        )
        .run(bookId, STARTED_LOCATION_LABEL, now)
      return
    }

    if (isPersistedLocationJson(existing.last_read_location)) {
      this.db
        .prepare(
          `UPDATE reading_session_states
           SET updated_at = ?
           WHERE book_id = ?`,
        )
        .run(now, bookId)
      return
    }

    const loc = existing.last_read_location?.trim()
    this.db
      .prepare(
        `UPDATE reading_session_states
         SET last_read_location = ?, updated_at = ?
         WHERE book_id = ?`,
      )
      .run(loc || STARTED_LOCATION_LABEL, now, bookId)
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
   * Persist book + authors + genres + default reading session atomically.
   */
  persistImportedBook(
    book: Book,
    authorNames: string[] = [],
    genreNames: string[] = [],
  ): void {
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO books (
            id, title, file_path, normalized_path, file_format, cover_path,
            sha256, file_size_bytes, description, page_count,
            is_favorite, is_signed, source_url, source_provider, external_id, added_at, updated_at
          ) VALUES (
            @id, @title, @file_path, @normalized_path, @file_format, @cover_path,
            @sha256, @file_size_bytes, @description, @page_count,
            @is_favorite, @is_signed, @source_url, @source_provider, @external_id, @added_at, @updated_at
          )`,
        )
        .run({
          id: book.id,
          title: book.title,
          file_path: book.filePath,
          normalized_path: book.normalizedPath ?? null,
          file_format: book.format,
          cover_path: book.coverPath ?? null,
          sha256: book.sha256,
          file_size_bytes: book.fileSizeBytes ?? null,
          description: book.description ?? null,
          page_count: book.pageCount ?? null,
          is_favorite: book.isFavorite ? 1 : 0,
          is_signed: book.isSigned ? 1 : 0,
          source_url: book.sourceUrl ?? null,
          source_provider: book.sourceProvider ?? null,
          external_id: book.externalId ?? null,
          added_at: book.addedAt,
          updated_at: book.updatedAt,
        })

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

      const seenGenres = new Set<string>()
      const genreLinks: BookGenre[] = []
      for (const name of genreNames) {
        const trimmed = name.trim()
        if (!trimmed) continue
        const key = trimmed.toLowerCase()
        if (seenGenres.has(key)) continue
        seenGenres.add(key)
        const genre = this.findOrCreateGenreByName(trimmed)
        genreLinks.push(
          new BookGenre({
            bookId: book.id,
            genreId: genre.id,
          }),
        )
      }

      if (genreLinks.length > 0) {
        const insert = this.db.prepare(
          `INSERT OR IGNORE INTO book_genres (book_id, genre_id)
           VALUES (@book_id, @genre_id)`,
        )
        for (const link of genreLinks) {
          insert.run({
            book_id: book.id,
            genre_id: link.genreId,
          })
        }
      }

      this.insertDefaultReadingSession(book.id, book.addedAt)
    })
    run()
  }

  /** All books newest-first, with joined author / genre names + session. */
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
      genreNames: this.genreNamesForBook(row.id),
      session: this.getReadingSessionSummary(row.id),
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
    const rows = this.db
      .prepare(
        `SELECT g.name AS name
         FROM book_genres bg
         JOIN genres g ON g.id = bg.genre_id
         WHERE bg.book_id = ?
         ORDER BY g.name ASC`,
      )
      .all(bookId) as { name: string }[]
    return rows.map((r) => r.name)
  }

  /** Update description / page_count / optional title (Library metadata backfill). */
  updateLibraryMetadata(
    bookId: string,
    fields: {
      description?: string | null
      pageCount?: number | null
      title?: string
    },
  ): void {
    const now = new Date().toISOString()
    const current = this.db
      .prepare(
        `SELECT description, page_count, title FROM books WHERE id = ?`,
      )
      .get(bookId) as
      | { description: string | null; page_count: number | null; title: string }
      | undefined
    if (!current) return

    const description =
      fields.description !== undefined
        ? fields.description?.trim() || null
        : current.description
    const pageCount =
      fields.pageCount !== undefined
        ? fields.pageCount != null && fields.pageCount > 0
          ? Math.floor(fields.pageCount)
          : null
        : current.page_count
    const title =
      fields.title?.trim() && fields.title.trim().length > 0
        ? fields.title.trim()
        : current.title

    this.db
      .prepare(
        `UPDATE books
         SET description = @description,
             page_count = @page_count,
             title = @title,
             updated_at = @updated_at
         WHERE id = @id`,
      )
      .run({
        id: bookId,
        description,
        page_count: pageCount,
        title,
        updated_at: now,
      })
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

  /** Replace genre links for a book. */
  replaceGenresByName(bookId: string, genreNames: string[]): void {
    const run = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM book_genres WHERE book_id = ?`).run(bookId)
      const seen = new Set<string>()
      for (const name of genreNames) {
        const trimmed = name.trim()
        if (!trimmed) continue
        const key = trimmed.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        const genre = this.findOrCreateGenreByName(trimmed)
        this.db
          .prepare(
            `INSERT OR IGNORE INTO book_genres (book_id, genre_id)
             VALUES (@book_id, @genre_id)`,
          )
          .run({
            book_id: bookId,
            genre_id: genre.id,
          })
      }
    })
    run()
  }

  readingStatusForBook(
    bookId: string,
  ): 'reading' | 'completed' | 'not-started' {
    const row = this.db
      .prepare(`SELECT reading_status FROM books WHERE id = ?`)
      .get(bookId) as { reading_status: BookRow['reading_status'] } | undefined
    return row?.reading_status ?? 'not-started'
  }

  /** Ensure a reading session row exists (restore after accidental cascade). */
  ensureReadingSession(bookId: string): void {
    const existing = this.db
      .prepare(`SELECT book_id FROM reading_session_states WHERE book_id = ?`)
      .get(bookId)
    if (existing) return
    this.insertDefaultReadingSession(bookId)
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

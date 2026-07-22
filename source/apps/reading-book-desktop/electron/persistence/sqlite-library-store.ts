import {
  Author,
  Book,
  BookAuthor,
  parseDocumentFormat,
  type LibraryStore,
} from '@reading-book/domain'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { getDatabase } from './db'

interface BookRow {
  id: string
  title: string
  file_path: string
  normalized_path: string | null
  file_format: string
  cover_path: string | null
  sha256: string
  file_size_bytes: number | null
  is_favorite: number
  source_url: string | null
  added_at: string
  updated_at: string
}

export type BookListItem = {
  book: Book
  /** Comma-joined author display names (empty if none). */
  authorNames: string
}

const BOOK_COLUMNS = `
  id, title, file_path, normalized_path, file_format, cover_path,
  sha256, file_size_bytes, is_favorite, source_url, added_at, updated_at
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
    isFavorite: row.is_favorite === 1,
    sourceUrl: row.source_url ?? undefined,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  })
}

/**
 * SQLite LibraryStore — T2.7 find + T2.8 save / linkAuthors / listAll.
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

  async save(book: Book): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO books (
          id, title, file_path, normalized_path, file_format, cover_path,
          sha256, file_size_bytes, is_favorite, source_url, added_at, updated_at
        ) VALUES (
          @id, @title, @file_path, @normalized_path, @file_format, @cover_path,
          @sha256, @file_size_bytes, @is_favorite, @source_url, @added_at, @updated_at
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
        is_favorite: book.isFavorite ? 1 : 0,
        source_url: book.sourceUrl ?? null,
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

  /**
   * Persist book + authors + default reading session atomically.
   * `authorNames` are display names from import metadata.
   */
  persistImportedBook(
    book: Book,
    authorNames: string[] = [],
  ): void {
    const run = this.db.transaction(() => {
      // sync save — call prepare directly inside txn
      this.db
        .prepare(
          `INSERT INTO books (
            id, title, file_path, normalized_path, file_format, cover_path,
            sha256, file_size_bytes, is_favorite, source_url, added_at, updated_at
          ) VALUES (
            @id, @title, @file_path, @normalized_path, @file_format, @cover_path,
            @sha256, @file_size_bytes, @is_favorite, @source_url, @added_at, @updated_at
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
          is_favorite: book.isFavorite ? 1 : 0,
          source_url: book.sourceUrl ?? null,
          added_at: book.addedAt,
          updated_at: book.updatedAt,
        })

      const links: BookAuthor[] = []
      authorNames.forEach((name, index) => {
        const trimmed = name.trim()
        if (!trimmed) return
        const author = this.findOrCreateAuthorByName(trimmed)
        links.push(
          new BookAuthor({
            bookId: book.id,
            authorId: author.id,
            sortOrder: index,
          }),
        )
      })

      if (links.length > 0) {
        const insert = this.db.prepare(
          `INSERT OR IGNORE INTO book_authors (book_id, author_id, sort_order)
           VALUES (@book_id, @author_id, @sort_order)`,
        )
        for (const link of links) {
          insert.run({
            book_id: book.id,
            author_id: link.authorId,
            sort_order: link.sortOrder,
          })
        }
      }

      this.insertDefaultReadingSession(book.id, book.addedAt)
    })
    run()
  }

  /** All books newest-first, with joined author display names. */
  async listAll(): Promise<BookListItem[]> {
    const rows = this.db
      .prepare(
        `SELECT ${BOOK_COLUMNS} FROM books ORDER BY added_at DESC`,
      )
      .all() as BookRow[]

    return rows.map((row) => ({
      book: rowToBook(row),
      authorNames: this.authorNamesForBook(row.id),
    }))
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

  async deleteCascade(_bookId: string): Promise<void> {
    throw new Error('SqliteLibraryStore.deleteCascade is not implemented yet')
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

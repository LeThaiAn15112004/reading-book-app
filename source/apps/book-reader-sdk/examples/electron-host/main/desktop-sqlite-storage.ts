/**
 * Electron MAIN process — `LibraryRepository` + `ReadingSessionRepository` over the EXISTING
 * desktop schema (migrations 001–019: `books`, `authors`/`book_authors`, `genres`/`book_genres`,
 * `reading_session_states`). Together with the SDK's own `createSqlNoteRepositories` (the
 * `notes` table) this lets the desktop app adopt the SDK without a data migration.
 *
 * Written against the `SqlDatabase` port, not better-sqlite3, so the same file also runs on
 * `node:sqlite` in tests.
 */
import {
  normalizeBook,
  sanitizeReadingPrefs,
  serializeLocation,
  tryParseLocation,
  type Book,
  type DocumentFormat,
  type IdGenerator,
  type LibraryRepository,
  type ReadingSession,
  type ReadingSessionRepository,
  type SqlDatabase,
} from '../../../dist/index.mjs'

interface BookRow {
  id: string
  title: string
  file_path: string
  file_format: DocumentFormat
  cover_path: string | null
  sha256: string
  file_size_bytes: number | null
  is_favorite: number
  source_url: string | null
  description: string | null
  page_count: number | null
  source_provider: string | null
  external_id: string | null
  added_at: string
  updated_at: string
  author_names: string | null
  genre_names: string | null
}

/** Unit separator: cannot appear in a name, safe for group_concat. */
const SEP = String.fromCharCode(31)

const SELECT_BOOKS = `
  SELECT b.id, b.title, b.file_path, b.file_format, b.cover_path, b.sha256, b.file_size_bytes,
         b.is_favorite, b.source_url, b.description, b.page_count, b.source_provider, b.external_id,
         b.added_at, b.updated_at,
         (SELECT group_concat(name, char(31)) FROM (
            SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
            WHERE ba.book_id = b.id ORDER BY ba.sort_order)) AS author_names,
         (SELECT group_concat(g.name, char(31)) FROM book_genres bg JOIN genres g ON g.id = bg.genre_id
            WHERE bg.book_id = b.id) AS genre_names
  FROM books b`

function rowToBook(row: BookRow): Book {
  const book: Book = {
    id: row.id,
    title: row.title,
    format: row.file_format,
    fileRef: row.file_path,
    sha256: row.sha256,
    authors: row.author_names ? row.author_names.split(SEP) : [],
    genres: row.genre_names ? row.genre_names.split(SEP) : [],
    isFavorite: row.is_favorite === 1,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  }
  if (row.cover_path) book.coverRef = row.cover_path
  if (row.file_size_bytes != null) book.fileSizeBytes = row.file_size_bytes
  if (row.source_url) book.sourceUrl = row.source_url
  if (row.description) book.description = row.description
  if (row.page_count != null) book.pageCount = row.page_count
  if (row.source_provider) book.sourceProvider = row.source_provider
  if (row.external_id) book.externalId = row.external_id
  return normalizeBook(book)
}

export function createDesktopLibraryRepository(sql: SqlDatabase, ids: IdGenerator): LibraryRepository {
  /** `authors` / `genres` rows are shared across books: reuse by exact name, insert when new. */
  async function idForName(table: 'authors' | 'genres', name: string, now: string): Promise<string> {
    const [existing] = await sql.all<{ id: string }>(`SELECT id FROM ${table} WHERE name = ? LIMIT 1`, [name])
    if (existing) return existing.id
    const id = ids.newId()
    await sql.run(`INSERT INTO ${table} (id, name, created_at) VALUES (?, ?, ?)`, [id, name, now])
    return id
  }

  return {
    listBooks: async () => (await sql.all<BookRow>(`${SELECT_BOOKS} ORDER BY b.updated_at DESC`)).map(rowToBook),

    async getBook(id) {
      const [row] = await sql.all<BookRow>(`${SELECT_BOOKS} WHERE b.id = ?`, [id])
      return row ? rowToBook(row) : null
    },

    async findBySha256(sha256) {
      const [row] = await sql.all<BookRow>(`${SELECT_BOOKS} WHERE b.sha256 = ?`, [sha256])
      return row ? rowToBook(row) : null
    },

    // NOTE: wrap in a transaction on the host side (better-sqlite3 `db.transaction`) when the
    // driver supports it — the SqlDatabase port intentionally stays minimal.
    async saveBook(book) {
      await sql.run(
        `INSERT INTO books (id, title, file_path, file_format, cover_path, sha256, file_size_bytes,
           is_favorite, source_url, description, page_count, source_provider, external_id, added_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, cover_path = excluded.cover_path, is_favorite = excluded.is_favorite,
           description = excluded.description, page_count = excluded.page_count, updated_at = excluded.updated_at`,
        [
          book.id, book.title, book.fileRef, book.format, book.coverRef ?? null, book.sha256,
          book.fileSizeBytes ?? null, book.isFavorite ? 1 : 0, book.sourceUrl ?? null,
          book.description ?? null, book.pageCount ?? null, book.sourceProvider ?? null,
          book.externalId ?? null, book.addedAt, book.updatedAt,
        ],
      )

      await sql.run(`DELETE FROM book_authors WHERE book_id = ?`, [book.id])
      for (const [index, name] of book.authors.entries()) {
        const authorId = await idForName('authors', name, book.updatedAt)
        await sql.run(`INSERT OR IGNORE INTO book_authors (book_id, author_id, sort_order) VALUES (?, ?, ?)`, [book.id, authorId, index])
      }
      await sql.run(`DELETE FROM book_genres WHERE book_id = ?`, [book.id])
      for (const name of book.genres) {
        const genreId = await idForName('genres', name, book.updatedAt)
        await sql.run(`INSERT OR IGNORE INTO book_genres (book_id, genre_id) VALUES (?, ?)`, [book.id, genreId])
      }
    },

    async deleteBook(id) {
      // FK `ON DELETE CASCADE` removes links, session state and notes (requires PRAGMA foreign_keys = ON).
      const { changes } = await sql.run(`DELETE FROM books WHERE id = ?`, [id])
      return changes > 0
    },
  }
}

interface SessionRow {
  last_read_location: string
  percent: number
  font_family: string | null
  font_size: number | null
  font_weight: string | null
  line_height: number | null
  text_align: string | null
  layout_mode: string | null
  margins_enabled: number | null
  margin_preset: string | null
  is_landscape: number
  updated_at: string
}

/**
 * `last_read_location` packs the display label into the Location JSON (`{kind, cfi, label}`) —
 * same encoding as `electron/persistence/reading-session-location.ts`.
 */
export function createDesktopSessionRepository(sql: SqlDatabase): ReadingSessionRepository {
  return {
    async getSession(bookId) {
      const [row] = await sql.all<SessionRow>(
        `SELECT last_read_location, percent, font_family, font_size, font_weight, line_height, text_align,
                layout_mode, margins_enabled, margin_preset, is_landscape, updated_at
         FROM reading_session_states WHERE book_id = ?`,
        [bookId],
      )
      if (!row) return null

      const session: ReadingSession = {
        bookId,
        percent: row.percent,
        prefs: sanitizeReadingPrefs({
          fontFamily: row.font_family,
          fontSize: row.font_size,
          fontWeight: row.font_weight,
          lineHeight: row.line_height,
          textAlign: row.text_align,
          layout: row.layout_mode,
          marginEnabled: row.margins_enabled == null ? undefined : row.margins_enabled === 1,
          margin: row.margin_preset,
          isLandscape: row.is_landscape === 1,
        }),
        updatedAt: row.updated_at,
      }
      const location = tryParseLocation(row.last_read_location) // `Started` / '' → undefined
      if (location) session.location = location
      try {
        const label = (JSON.parse(row.last_read_location) as { label?: unknown }).label
        if (typeof label === 'string' && label.trim()) session.locationLabel = label.trim()
      } catch {
        /* legacy placeholder, no label */
      }
      return session
    },

    async saveSession(session) {
      const packed = session.location
        ? JSON.stringify({ ...JSON.parse(serializeLocation(session.location)), ...(session.locationLabel ? { label: session.locationLabel } : {}) })
        : ''
      const p = session.prefs
      // Only SDK-owned columns are updated; `page_turn_mode` keeps whatever the app wrote.
      await sql.run(
        `INSERT INTO reading_session_states (book_id, last_read_location, percent, font_family, font_size,
           font_weight, line_height, text_align, layout_mode, margins_enabled, margin_preset, is_landscape, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET
           last_read_location = CASE WHEN excluded.last_read_location = '' THEN last_read_location ELSE excluded.last_read_location END,
           percent = excluded.percent, font_family = excluded.font_family, font_size = excluded.font_size,
           font_weight = excluded.font_weight, line_height = excluded.line_height, text_align = excluded.text_align,
           layout_mode = excluded.layout_mode, margins_enabled = excluded.margins_enabled,
           margin_preset = excluded.margin_preset, is_landscape = excluded.is_landscape, updated_at = excluded.updated_at`,
        [
          session.bookId, packed, session.percent, p.fontFamily ?? null, p.fontSize ?? null,
          p.fontWeight != null ? String(p.fontWeight) : null, p.lineHeight ?? null, p.textAlign ?? null,
          p.layout ?? null, p.marginEnabled == null ? null : p.marginEnabled ? 1 : 0, p.margin ?? null,
          p.isLandscape ? 1 : 0, session.updatedAt,
        ],
      )
    },
  }
}

/**
 * Electron MAIN process — `LibraryRepository` + `ReadingSessionRepository` over the EXISTING
 * desktop schema (migrations 001–020): `books` (with its `metadata_json` / `genres_json` /
 * `reading_state_json` columns) and `authors`/`book_authors`. Together with the SDK's own
 * `createSqlNoteRepositories` (the `notes` table) this lets the desktop app adopt the SDK
 * without a data migration.
 *
 * Written against the `SqlDatabase` port, not better-sqlite3, so the same file also runs on
 * `node:sqlite` in tests. JSON columns are merged with SQLite's `json_patch` (RFC 7396): keys in
 * the patch overwrite, a `null` member deletes the key, absent keys are kept.
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
  is_favorite: number
  source_url: string | null
  source_provider: string | null
  external_id: string | null
  /** `{ fileSizeBytes, pageCount, description, isSigned, … }` */
  metadata_json: string
  /** `["Fantasy", "Classics", …]` */
  genres_json: string
  added_at: string
  updated_at: string
  author_names: string | null
}

interface BookMetadata {
  fileSizeBytes?: number | null
  pageCount?: number | null
  description?: string | null
}

/** Unit separator: cannot appear in a name, safe for group_concat. */
const SEP = String.fromCharCode(31)

const SELECT_BOOKS = `
  SELECT b.id, b.title, b.file_path, b.file_format, b.cover_path, b.sha256,
         b.is_favorite, b.source_url, b.source_provider, b.external_id,
         b.metadata_json, b.genres_json, b.added_at, b.updated_at,
         (SELECT group_concat(name, char(31)) FROM (
            SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
            WHERE ba.book_id = b.id ORDER BY ba.sort_order)) AS author_names
  FROM books b`

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function rowToBook(row: BookRow): Book {
  const metadata = parseJson<BookMetadata>(row.metadata_json, {})
  const genres = parseJson<unknown[]>(row.genres_json, []).filter((g): g is string => typeof g === 'string')
  const book: Book = {
    id: row.id,
    title: row.title,
    format: row.file_format,
    fileRef: row.file_path,
    sha256: row.sha256,
    authors: row.author_names ? row.author_names.split(SEP) : [],
    genres,
    isFavorite: row.is_favorite === 1,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  }
  if (row.cover_path) book.coverRef = row.cover_path
  if (metadata.fileSizeBytes != null) book.fileSizeBytes = metadata.fileSizeBytes
  if (row.source_url) book.sourceUrl = row.source_url
  if (metadata.description) book.description = metadata.description
  if (metadata.pageCount != null) book.pageCount = metadata.pageCount
  if (row.source_provider) book.sourceProvider = row.source_provider
  if (row.external_id) book.externalId = row.external_id
  return normalizeBook(book)
}

export function createDesktopLibraryRepository(sql: SqlDatabase, ids: IdGenerator): LibraryRepository {
  /** `authors` rows are shared across books: reuse by exact name, insert when new. */
  async function authorIdForName(name: string, now: string): Promise<string> {
    const [existing] = await sql.all<{ id: string }>(`SELECT id FROM authors WHERE name = ? LIMIT 1`, [name])
    if (existing) return existing.id
    const id = ids.newId()
    await sql.run(`INSERT INTO authors (id, name, created_at) VALUES (?, ?, ?)`, [id, name, now])
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
      // Insert: only the keys that have a value. Update: `null` members delete the key
      // (json_patch), which reproduces the old "overwrite description/page_count with NULL".
      const metadataOnInsert: BookMetadata = {
        fileSizeBytes: book.fileSizeBytes,
        pageCount: book.pageCount,
        description: book.description,
      }
      const metadataPatch: BookMetadata = {
        pageCount: book.pageCount ?? null,
        description: book.description ?? null,
      }
      await sql.run(
        `INSERT INTO books (id, title, file_path, file_format, cover_path, sha256, is_favorite, source_url,
           source_provider, external_id, metadata_json, genres_json, added_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, cover_path = excluded.cover_path, is_favorite = excluded.is_favorite,
           metadata_json = json_patch(books.metadata_json, ?), genres_json = excluded.genres_json,
           updated_at = excluded.updated_at`,
        [
          book.id, book.title, book.fileRef, book.format, book.coverRef ?? null, book.sha256,
          book.isFavorite ? 1 : 0, book.sourceUrl ?? null, book.sourceProvider ?? null,
          book.externalId ?? null, JSON.stringify(metadataOnInsert), JSON.stringify(book.genres),
          book.addedAt, book.updatedAt,
          JSON.stringify(metadataPatch),
        ],
      )

      await sql.run(`DELETE FROM book_authors WHERE book_id = ?`, [book.id])
      for (const [index, name] of book.authors.entries()) {
        const authorId = await authorIdForName(name, book.updatedAt)
        await sql.run(`INSERT OR IGNORE INTO book_authors (book_id, author_id, sort_order) VALUES (?, ?, ?)`, [book.id, authorId, index])
      }
    },

    async deleteBook(id) {
      // FK `ON DELETE CASCADE` removes author links, chunks and notes (requires PRAGMA foreign_keys = ON).
      const { changes } = await sql.run(`DELETE FROM books WHERE id = ?`, [id])
      return changes > 0
    },
  }
}

interface ReadingState {
  lastReadLocation?: string | null
  percent?: number | null
  fontFamily?: string | null
  fontSize?: number | null
  fontWeight?: string | null
  lineHeight?: number | null
  textAlign?: string | null
  layoutMode?: string | null
  marginsEnabled?: boolean | null
  marginPreset?: string | null
  isLandscape?: boolean | null
  updatedAt?: string | null
}

/**
 * `books.reading_state_json.lastReadLocation` packs the display label into the Location JSON
 * (`{kind, cfi, label}`) — same encoding as `electron/persistence/reading-session-location.ts`.
 */
export function createDesktopSessionRepository(sql: SqlDatabase): ReadingSessionRepository {
  return {
    async getSession(bookId) {
      const [row] = await sql.all<{ reading_state_json: string; updated_at: string }>(
        `SELECT reading_state_json, updated_at FROM books WHERE id = ?`,
        [bookId],
      )
      if (!row) return null
      const state = parseJson<ReadingState>(row.reading_state_json, {})
      if (Object.keys(state).length === 0) return null // book exists, never read

      const lastReadLocation = state.lastReadLocation ?? ''
      const session: ReadingSession = {
        bookId,
        percent: state.percent ?? 0,
        prefs: sanitizeReadingPrefs({
          fontFamily: state.fontFamily ?? null,
          fontSize: state.fontSize ?? null,
          fontWeight: state.fontWeight ?? null,
          lineHeight: state.lineHeight ?? null,
          textAlign: state.textAlign ?? null,
          layout: state.layoutMode ?? null,
          marginEnabled: state.marginsEnabled ?? undefined,
          margin: state.marginPreset ?? null,
          isLandscape: state.isLandscape === true,
        }),
        updatedAt: state.updatedAt || row.updated_at,
      }
      const location = tryParseLocation(lastReadLocation) // `Started` / '' → undefined
      if (location) session.location = location
      try {
        const label = (JSON.parse(lastReadLocation) as { label?: unknown }).label
        if (typeof label === 'string' && label.trim()) session.locationLabel = label.trim()
      } catch {
        /* legacy placeholder, no label */
      }
      return session
    },

    async saveSession(session) {
      const p = session.prefs
      // json_patch semantics: a `null` member deletes the key (= "no preference"), a missing
      // member keeps whatever the app wrote — so `pageTurnMode` (not SDK-owned) is never touched,
      // and an empty location leaves the stored location alone.
      const patch: ReadingState = {
        percent: session.percent,
        fontFamily: p.fontFamily ?? null,
        fontSize: p.fontSize ?? null,
        fontWeight: p.fontWeight != null ? String(p.fontWeight) : null,
        lineHeight: p.lineHeight ?? null,
        textAlign: p.textAlign ?? null,
        layoutMode: p.layout ?? null,
        marginsEnabled: p.marginEnabled ?? null,
        marginPreset: p.margin ?? null,
        isLandscape: p.isLandscape === true,
        updatedAt: session.updatedAt,
      }
      if (session.location) {
        patch.lastReadLocation = JSON.stringify({
          ...JSON.parse(serializeLocation(session.location)),
          ...(session.locationLabel ? { label: session.locationLabel } : {}),
        })
      }
      await sql.run(
        `UPDATE books
         SET reading_state_json = json_patch(reading_state_json, ?), updated_at = ?
         WHERE id = ?`,
        [JSON.stringify(patch), session.updatedAt, session.bookId],
      )
    },
  }
}

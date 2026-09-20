import { SdkError } from '../core/errors.js'
import { ReadingSessionState } from '../domain/index.js'
import type { BookmarkRecord } from '../domain/annotation/bookmark.js'
import type { HighlightRecord, HighlightStyleKind } from '../domain/annotation/highlight.js'
import type { NoteLocator, NoteSelectionText } from '../domain/annotation/note.js'
import type { OverlayStore, SaveBookmarkInput, SaveHighlightInput } from '../domain-ports/overlay-store.js'

export type SqlValue = string | number | null | Uint8Array

/**
 * The only thing the SDK needs from a SQLite driver. Positional `?` parameters, async results —
 * a 10-line wrapper over better-sqlite3 (desktop main process), expo-sqlite (mobile),
 * `node:sqlite` or sql.js. The SDK owns the SQL; the host owns the driver.
 */
export interface SqlDatabase {
  run(sql: string, params?: readonly SqlValue[]): Promise<{ changes: number }>
  all<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row[]>
}

/**
 * `notes` + `reading_sessions` table DDL for a fresh database (mobile, tests). On desktop the
 * numbered migrations already own these tables; `IF NOT EXISTS` makes running it there a no-op.
 * Requires the JSON1 functions (bundled with better-sqlite3, expo-sqlite and node:sqlite).
 */
export const NOTES_SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL,
    book_id TEXT NOT NULL,
    note_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notes_book_id ON notes (book_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_group ON notes (json_extract(note_json, '$.group'))`,
  `CREATE TABLE IF NOT EXISTS reading_sessions (
    book_id TEXT PRIMARY KEY NOT NULL,
    session_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
]

export async function ensureNotesSchema(db: SqlDatabase): Promise<void> {
  for (const statement of NOTES_SCHEMA_SQL) await db.run(statement)
}

interface NoteRow {
  id: string
  book_id: string
  note_json: string
  created_at: string
  updated_at: string
}

interface NoteJson {
  group: 'bookmark' | 'annotation'
  locator: NoteLocator
  label?: string
  excerpt?: string
  styleKind?: HighlightStyleKind
  colorHex?: string
  note?: string
  tags?: string[]
  selectionText?: NoteSelectionText
}

const NOTE_COLUMNS = 'id, book_id, note_json, created_at, updated_at'
const IS_BOOKMARK = `json_extract(note_json, '$.group') = 'bookmark'`
const IS_ANNOTATION = `json_extract(note_json, '$.group') = 'annotation'`

function bookmarkRowToRecord(row: NoteRow): BookmarkRecord | undefined {
  const data = JSON.parse(row.note_json) as NoteJson
  if (data.group !== 'bookmark') return undefined
  return {
    id: row.id,
    bookId: row.book_id,
    locator: data.locator,
    label: data.label,
    excerpt: data.excerpt,
    createdAt: row.created_at,
  }
}

function highlightRowToRecord(row: NoteRow): HighlightRecord | undefined {
  const data = JSON.parse(row.note_json) as NoteJson
  if (data.group !== 'annotation' || !data.styleKind || !data.colorHex) return undefined
  return {
    id: row.id,
    bookId: row.book_id,
    locator: data.locator,
    styleKind: data.styleKind,
    colorHex: data.colorHex,
    note: data.note,
    tags: data.tags ?? [],
    selectionText: data.selectionText,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * `OverlayStore` (bookmarks + highlights + reading session) over two tables matching the
 * desktop SQLite layout: the shared `notes` table (migration 019) and `reading_sessions`.
 */
export function createSqlNoteRepositories(db: SqlDatabase): OverlayStore {
  const listRows = (bookId: string, predicate: string) =>
    db.all<NoteRow>(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE book_id = ? AND ${predicate} ORDER BY created_at ASC`,
      [bookId],
    )

  async function upsertNote(
    id: string | undefined,
    bookId: string,
    group: 'bookmark' | 'annotation',
    data: Omit<NoteJson, 'group'>,
    createdAt: string | undefined,
    now: string,
  ): Promise<NoteRow> {
    const guard = group === 'bookmark' ? IS_BOOKMARK : IS_ANNOTATION
    const noteId = id ?? `${group}-${now}-${Math.random().toString(36).slice(2, 8)}`
    const json: NoteJson = { group, ...data }
    const created = createdAt ?? now
    const { changes } = await db.run(
      `INSERT INTO notes (${NOTE_COLUMNS}) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET note_json = excluded.note_json, updated_at = excluded.updated_at
       WHERE ${guard}`,
      [noteId, bookId, JSON.stringify(json), created, now],
    )
    if (id !== undefined && changes === 0) {
      throw new SdkError('STORAGE_FAILED', `note ${id} exists but is not a ${group}`)
    }
    return { id: noteId, book_id: bookId, note_json: JSON.stringify(json), created_at: created, updated_at: now }
  }

  return {
    async getSessionState(bookId) {
      const rows = await db.all<{ session_json: string }>(
        'SELECT session_json FROM reading_sessions WHERE book_id = ?',
        [bookId],
      )
      const row = rows[0]
      if (!row) return undefined
      const data = JSON.parse(row.session_json) as ConstructorParameters<typeof ReadingSessionState>[0]
      return new ReadingSessionState(data)
    },

    async saveSessionState(session) {
      await db.run(
        `INSERT INTO reading_sessions (book_id, session_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET session_json = excluded.session_json, updated_at = excluded.updated_at`,
        [session.bookId, JSON.stringify(session), session.updatedAt],
      )
    },

    async listBookmarks(bookId) {
      const rows = await listRows(bookId, IS_BOOKMARK)
      return rows.map(bookmarkRowToRecord).filter((b): b is BookmarkRecord => b !== undefined)
    },
    async saveBookmark(input: SaveBookmarkInput) {
      const now = new Date().toISOString()
      const row = await upsertNote(
        input.id,
        input.bookId,
        'bookmark',
        { locator: input.locator, label: input.label, excerpt: input.excerpt },
        input.createdAt,
        now,
      )
      const record = bookmarkRowToRecord(row)
      if (!record) throw new SdkError('STORAGE_FAILED', `Could not decode saved bookmark ${row.id}`)
      return record
    },
    async deleteBookmark(bookId, id) {
      const { changes } = await db.run(`DELETE FROM notes WHERE id = ? AND book_id = ? AND ${IS_BOOKMARK}`, [id, bookId])
      return changes > 0
    },

    async listHighlights(bookId) {
      const rows = await listRows(bookId, IS_ANNOTATION)
      return rows.map(highlightRowToRecord).filter((h): h is HighlightRecord => h !== undefined)
    },
    async saveHighlight(input: SaveHighlightInput) {
      const now = new Date().toISOString()
      const row = await upsertNote(
        input.id,
        input.bookId,
        'annotation',
        {
          locator: input.locator,
          styleKind: input.styleKind,
          colorHex: input.colorHex,
          note: input.note,
          tags: input.tags,
          selectionText: input.selectionText,
        },
        input.createdAt,
        now,
      )
      const record = highlightRowToRecord(row)
      if (!record) throw new SdkError('STORAGE_FAILED', `Could not decode saved highlight ${row.id}`)
      return record
    },
    async deleteHighlight(bookId, id) {
      const { changes } = await db.run(`DELETE FROM notes WHERE id = ? AND book_id = ? AND ${IS_ANNOTATION}`, [id, bookId])
      return changes > 0
    },
  }
}

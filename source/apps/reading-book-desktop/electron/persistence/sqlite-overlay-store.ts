import {
  Location,
  ReadingSessionState,
  type BookmarkRecord,
  type HighlightRecord,
  type HighlightStyleKind,
  type INoteState,
  type NoteLocator,
  type NoteSelectionText,
  type OverlayStore,
  type SaveBookmarkInput,
  type SaveHighlightInput,
} from '@reading-book/book-reader-sdk'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { getDatabase } from './db'
import {
  packSessionLocation,
  unpackSessionLocation,
} from './reading-session-location'

interface SessionRow {
  book_id: string
  last_read_location: string
  percent: number
  font_family: string | null
  font_size: number | null
  font_weight: string | null
  line_height: number | null
  text_align: string | null
  layout_mode: string | null
  page_turn_mode: string | null
  margins_enabled: number | null
  margin_preset: string | null
  is_landscape: number
  updated_at: string
}

export type SessionRecord = {
  bookId: string
  lastReadLocation?: string
  lastReadLabel?: string
  percent: number
  fontFamily?: string
  fontSize?: number
  fontWeight?: string
  lineHeight?: number
  textAlign?: string
  layoutMode?: string
  pageTurnMode?: string
  marginsEnabled?: boolean
  marginPreset?: string
  isLandscape?: boolean
  updatedAt: string
}

const SESSION_COLUMNS = `
  book_id, last_read_location, percent,
  font_family, font_size, font_weight, line_height, text_align,
  layout_mode, page_turn_mode, margins_enabled, margin_preset,
  is_landscape, updated_at
`

function rowToSessionState(row: SessionRow): ReadingSessionState | undefined {
  const unpacked = unpackSessionLocation(row.last_read_location)
  if (!unpacked) return undefined

  return new ReadingSessionState({
    bookId: row.book_id,
    lastReadLocation: unpacked.location,
    lastReadLabel: unpacked.label,
    percent: row.percent,
    fontFamily: row.font_family?.trim() || undefined,
    fontSize: row.font_size != null && Number.isFinite(row.font_size)
      ? row.font_size
      : undefined,
    fontWeight: row.font_weight?.trim() || undefined,
    lineHeight: row.line_height != null && Number.isFinite(row.line_height)
      ? row.line_height
      : undefined,
    textAlign: row.text_align?.trim() || undefined,
    layoutMode: row.layout_mode?.trim() || undefined,
    pageTurnMode: row.page_turn_mode?.trim() || undefined,
    marginsEnabled: row.margins_enabled != null ? row.margins_enabled === 1 : undefined,
    marginPreset: row.margin_preset?.trim() || undefined,
    isLandscape: row.is_landscape === 1,
    updatedAt: row.updated_at,
  })
}

function rowToSessionRecord(row: SessionRow): SessionRecord {
  const unpacked = unpackSessionLocation(row.last_read_location)
  return {
    bookId: row.book_id,
    lastReadLocation: unpacked?.location.toString(),
    lastReadLabel: unpacked?.label,
    percent: row.percent,
    fontFamily: row.font_family?.trim() || undefined,
    fontSize: row.font_size != null && Number.isFinite(row.font_size)
      ? row.font_size
      : undefined,
    fontWeight: row.font_weight?.trim() || undefined,
    lineHeight: row.line_height != null && Number.isFinite(row.line_height)
      ? row.line_height
      : undefined,
    textAlign: row.text_align?.trim() || undefined,
    layoutMode: row.layout_mode?.trim() || undefined,
    pageTurnMode: row.page_turn_mode?.trim() || undefined,
    marginsEnabled: row.margins_enabled != null ? row.margins_enabled === 1 : undefined,
    marginPreset: row.margin_preset?.trim() || undefined,
    isLandscape: row.is_landscape === 1,
    updatedAt: row.updated_at,
  }
}

interface NoteRow {
  id: string
  book_id: string
  note_json: string
  created_at: string
  updated_at: string
}

const NOTE_COLUMNS = `id, book_id, note_json, created_at, updated_at`

/**
 * Bookmark rows are `notes` rows whose `note_json.group` is `'bookmark'` (migration 019).
 * A missing `group` means `'annotation'` by convention, and `json_extract` yields NULL there —
 * NULL never equals `'bookmark'`, so annotations stay out of every bookmark query while the
 * predicate still matches the expression index `idx_notes_group` verbatim.
 */
const BOOKMARK_GROUP_PREDICATE = `json_extract(note_json, '$.group') = 'bookmark'`

function rowToBookmarkRecord(row: NoteRow): BookmarkRecord | undefined {
  let note: INoteState
  try {
    note = JSON.parse(row.note_json) as INoteState
  } catch {
    return undefined
  }

  const locator = note.locatorExtended?.locator
  // A bookmark with no jump target cannot be rendered or jumped to — skip the row rather
  // than surfacing an entry that would silently do nothing when clicked.
  if (!locator) return undefined

  return {
    id: row.id,
    bookId: row.book_id,
    locator,
    label: note.label?.trim() || undefined,
    excerpt: note.textualValue?.trim() || undefined,
    createdAt: row.created_at,
  }
}

function buildBookmarkNoteJson(input: {
  locator: NoteLocator
  label?: string
  excerpt?: string
  createdAt: string
  modifiedAt: string
}): string {
  const note: INoteState = {
    schemaVersion: 1,
    type: 'bookmark',
    group: 'bookmark',
    locatorExtended: { locator: input.locator },
    textualValue: input.excerpt,
    label: input.label,
    created: input.createdAt,
    modified: input.modifiedAt,
  }
  return JSON.stringify(note)
}

const DEFAULT_HIGHLIGHT_COLOR = '#FFEB3B'

/**
 * Highlight rows are `notes` rows whose group is `'annotation'` (or absent — pre-019 rows
 * default to annotation by convention) and whose type is one of the two styles this feature
 * supports. The explicit `type IN (...)` guard keeps legacy freehand/textbox/stamp rows left
 * over from the deleted overlay system out of every highlight query.
 */
const HIGHLIGHT_TYPE_PREDICATE = `
  (json_extract(note_json, '$.group') IS NULL OR json_extract(note_json, '$.group') = 'annotation')
  AND json_extract(note_json, '$.type') IN ('highlight', 'underline', 'strikethrough', 'textbox')
`

const HIGHLIGHT_STYLE_KINDS: HighlightStyleKind[] = [
  'highlight',
  'underline',
  'strikethrough',
  'textbox',
]

function rowToHighlightRecord(row: NoteRow): HighlightRecord | undefined {
  let note: INoteState
  try {
    note = JSON.parse(row.note_json) as INoteState
  } catch {
    return undefined
  }

  const locator = note.locatorExtended?.locator
  if (!locator) return undefined
  const styleKind: HighlightStyleKind = HIGHLIGHT_STYLE_KINDS.includes(note.type as HighlightStyleKind)
    ? (note.type as HighlightStyleKind)
    : 'highlight'

  return {
    id: row.id,
    bookId: row.book_id,
    locator,
    styleKind,
    colorHex: note.style?.colorHex?.trim() || DEFAULT_HIGHLIGHT_COLOR,
    note: note.note?.trim() || undefined,
    tags: Array.isArray(note.tags) ? note.tags : [],
    selectionText: note.locatorExtended?.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function buildHighlightNoteJson(input: {
  locator: NoteLocator
  styleKind: HighlightStyleKind
  colorHex: string
  note?: string
  tags?: string[]
  selectionText?: NoteSelectionText
  createdAt: string
  modifiedAt: string
}): string {
  const note: INoteState = {
    schemaVersion: 1,
    type: input.styleKind,
    group: 'annotation',
    locatorExtended: { locator: input.locator, text: input.selectionText },
    textualValue: input.selectionText?.highlight,
    note: input.note ?? null,
    style: { colorHex: input.colorHex },
    tags: input.tags?.length ? input.tags : undefined,
    created: input.createdAt,
    modified: input.modifiedAt,
  }
  return JSON.stringify(note)
}

/**
 * SQLite OverlayStore — reading session state (T4.3), bookmarks (FR-11), and highlights.
 *
 * Bookmarks live in the unified `notes` table (`note_json.group = 'bookmark'`) since migration
 * 019 dropped the standalone `bookmarks` table. Highlights/underlines live in the same table
 * as `note_json.group = 'annotation'` (or absent) rows with `type` `'highlight'`/`'underline'`.
 */
export class SqliteOverlayStore implements OverlayStore {
  constructor(private readonly db: SqliteDatabase = getDatabase()) {}

  async getSessionState(bookId: string): Promise<ReadingSessionState | undefined> {
    const id = bookId.trim()
    if (!id) return undefined

    const row = this.db
      .prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM reading_session_states WHERE book_id = ?`,
      )
      .get(id) as SessionRow | undefined

    if (!row) return undefined
    return rowToSessionState(row)
  }

  async getSessionRecord(bookId: string): Promise<SessionRecord | undefined> {
    const id = bookId.trim()
    if (!id) return undefined
    const row = this.db
      .prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM reading_session_states WHERE book_id = ?`,
      )
      .get(id) as SessionRow | undefined
    return row ? rowToSessionRecord(row) : undefined
  }

  async saveSessionPreferences(record: SessionRecord): Promise<void> {
    let locationText = 'Started'
    let hasLocation = false
    if (record.lastReadLocation?.trim()) {
      try {
        locationText = packSessionLocation(
          Location.parse(record.lastReadLocation.trim()),
          record.lastReadLabel,
        )
        hasLocation = true
      } catch {
        // A settings-only save must preserve the existing location.
      }
    }
    this.db
      .prepare(
        `INSERT INTO reading_session_states (
          book_id, last_read_location, percent,
          font_family, font_size, font_weight, line_height, text_align,
          layout_mode, page_turn_mode, margins_enabled, margin_preset,
          is_landscape, updated_at
        ) VALUES (
          @book_id, @last_read_location, @percent,
          @font_family, @font_size, @font_weight, @line_height, @text_align,
          @layout_mode, @page_turn_mode, @margins_enabled, @margin_preset,
          @is_landscape, @updated_at
        )
        ON CONFLICT(book_id) DO UPDATE SET
          last_read_location = CASE
            WHEN @has_location = 1 THEN @last_read_location
            ELSE reading_session_states.last_read_location
          END,
          percent = CASE
            WHEN @has_location = 1 THEN @percent
            ELSE reading_session_states.percent
          END,
          font_family = COALESCE(@font_family, reading_session_states.font_family),
          font_size = COALESCE(@font_size, reading_session_states.font_size),
          font_weight = COALESCE(@font_weight, reading_session_states.font_weight),
          line_height = COALESCE(@line_height, reading_session_states.line_height),
          text_align = COALESCE(@text_align, reading_session_states.text_align),
          layout_mode = COALESCE(@layout_mode, reading_session_states.layout_mode),
          page_turn_mode = COALESCE(@page_turn_mode, reading_session_states.page_turn_mode),
          margins_enabled = COALESCE(@margins_enabled, reading_session_states.margins_enabled),
          margin_preset = COALESCE(@margin_preset, reading_session_states.margin_preset),
          is_landscape = CASE
            WHEN @has_landscape = 1 THEN @is_landscape
            ELSE reading_session_states.is_landscape
          END,
          updated_at = @updated_at`,
      )
      .run({
        book_id: record.bookId,
        last_read_location: locationText,
        percent: ReadingSessionState.clampPercent(record.percent),
        font_family: record.fontFamily ?? null,
        font_size: record.fontSize ?? null,
        font_weight: record.fontWeight ?? null,
        line_height: record.lineHeight ?? null,
        text_align: record.textAlign ?? null,
        layout_mode: record.layoutMode ?? null,
        page_turn_mode: record.pageTurnMode ?? null,
        margins_enabled:
          record.marginsEnabled === undefined
            ? null
            : record.marginsEnabled
              ? 1
              : 0,
        margin_preset: record.marginPreset ?? null,
        is_landscape: record.isLandscape ? 1 : 0,
        has_location: hasLocation ? 1 : 0,
        has_landscape: record.isLandscape === undefined ? 0 : 1,
        updated_at: record.updatedAt || new Date().toISOString(),
      })
  }

  async saveSessionState(s: ReadingSessionState): Promise<void> {
    const locationText = packSessionLocation(s.lastReadLocation, s.lastReadLabel)
    const percent = ReadingSessionState.clampPercent(s.percent)
    const updatedAt = s.updatedAt || new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO reading_session_states (
          book_id, last_read_location, percent,
          font_family, font_size, font_weight, line_height, text_align,
          layout_mode, page_turn_mode, margins_enabled, margin_preset,
          is_landscape, updated_at
        ) VALUES (
          @book_id, @last_read_location, @percent,
          @font_family, @font_size, @font_weight, @line_height, @text_align,
          @layout_mode, @page_turn_mode, @margins_enabled, @margin_preset,
          @is_landscape, @updated_at
        )
        ON CONFLICT(book_id) DO UPDATE SET
          last_read_location = excluded.last_read_location,
          percent = excluded.percent,
          font_family = excluded.font_family,
          font_size = excluded.font_size,
          font_weight = excluded.font_weight,
          line_height = excluded.line_height,
          text_align = excluded.text_align,
          layout_mode = excluded.layout_mode,
          page_turn_mode = excluded.page_turn_mode,
          margins_enabled = excluded.margins_enabled,
          margin_preset = excluded.margin_preset,
          is_landscape = excluded.is_landscape,
          updated_at = excluded.updated_at
        -- Renderer-side autosave already serializes writes to a single
        -- in-flight IPC call (see useReadingSessionAutosave's inFlightRef
        -- chain), so this is a defense-in-depth guard, not the primary
        -- ordering mechanism: it protects against any future caller that
        -- bypasses that hook (a second window, a sync engine) firing two
        -- saveSessionState calls whose IPC responses resolve out of send
        -- order. @updated_at is an ISO-8601 string (fixed-width, so plain
        -- text comparison is chronological); a write older than the row
        -- already on disk is silently dropped instead of clobbering it.
        WHERE excluded.updated_at >= reading_session_states.updated_at`,
      )
      .run({
        book_id: s.bookId,
        last_read_location: locationText,
        percent,
        font_family: s.fontFamily ?? null,
        font_size: s.fontSize ?? null,
        font_weight: s.fontWeight ?? null,
        line_height: s.lineHeight ?? null,
        text_align: s.textAlign ?? null,
        layout_mode: s.layoutMode ?? null,
        page_turn_mode: s.pageTurnMode ?? null,
        margins_enabled: s.marginsEnabled != null ? (s.marginsEnabled ? 1 : 0) : null,
        margin_preset: s.marginPreset ?? null,
        is_landscape: s.isLandscape ? 1 : 0,
        updated_at: updatedAt,
      })
  }

  async listBookmarks(bookId: string): Promise<BookmarkRecord[]> {
    const id = bookId.trim()
    if (!id) return []

    const rows = this.db
      .prepare(
        `SELECT ${NOTE_COLUMNS}
         FROM notes
         WHERE book_id = ? AND ${BOOKMARK_GROUP_PREDICATE}
         ORDER BY created_at ASC`,
      )
      .all(id) as NoteRow[]

    return rows
      .map(rowToBookmarkRecord)
      .filter((b): b is BookmarkRecord => b !== undefined)
  }

  async saveBookmark(input: SaveBookmarkInput): Promise<BookmarkRecord> {
    const bookId = input.bookId.trim()
    if (!bookId) throw new Error('saveBookmark requires a bookId')

    const now = new Date().toISOString()
    const existingId = input.id?.trim()
    const id = existingId || randomUUID()

    // An update must not rewrite when the bookmark was first placed; only an insert dates it.
    const existingCreatedAt = existingId
      ? (
          this.db
            .prepare(`SELECT created_at FROM notes WHERE id = ? AND book_id = ?`)
            .get(existingId, bookId) as { created_at: string } | undefined
        )?.created_at
      : undefined
    const createdAt = input.createdAt?.trim() || existingCreatedAt || now

    const label = input.label?.trim() || undefined
    const excerpt = input.excerpt?.trim() || undefined
    const noteJson = buildBookmarkNoteJson({
      locator: input.locator,
      label,
      excerpt,
      createdAt,
      modifiedAt: now,
    })

    const result = this.db
      .prepare(
        `INSERT INTO notes (id, book_id, note_json, created_at, updated_at)
         VALUES (@id, @book_id, @note_json, @created_at, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
           note_json = @note_json,
           updated_at = @updated_at
         -- Guard against an id that belongs to an annotation row: a bookmark write must
         -- never silently convert someone's highlight/note into a bookmark.
         WHERE ${BOOKMARK_GROUP_PREDICATE}`,
      )
      .run({
        id,
        book_id: bookId,
        note_json: noteJson,
        created_at: createdAt,
        updated_at: now,
      })

    if (result.changes === 0) {
      throw new Error(`saveBookmark: note ${id} exists but is not a bookmark`)
    }

    return { id, bookId, locator: input.locator, label, excerpt, createdAt }
  }

  async deleteBookmark(bookId: string, id: string): Promise<boolean> {
    const book = bookId.trim()
    const noteId = id.trim()
    if (!book || !noteId) return false

    const result = this.db
      .prepare(
        `DELETE FROM notes
         WHERE id = ? AND book_id = ? AND ${BOOKMARK_GROUP_PREDICATE}`,
      )
      .run(noteId, book)

    return result.changes > 0
  }

  async listHighlights(bookId: string): Promise<HighlightRecord[]> {
    const id = bookId.trim()
    if (!id) return []

    const rows = this.db
      .prepare(
        `SELECT ${NOTE_COLUMNS}
         FROM notes
         WHERE book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE}
         ORDER BY created_at ASC`,
      )
      .all(id) as NoteRow[]

    return rows
      .map(rowToHighlightRecord)
      .filter((h): h is HighlightRecord => h !== undefined)
  }

  async saveHighlight(input: SaveHighlightInput): Promise<HighlightRecord> {
    const bookId = input.bookId.trim()
    if (!bookId) throw new Error('saveHighlight requires a bookId')

    const now = new Date().toISOString()
    const existingId = input.id?.trim()
    const id = existingId || randomUUID()

    // An update must not rewrite when the highlight was first created; only an insert dates it.
    const existingCreatedAt = existingId
      ? (
          this.db
            .prepare(`SELECT created_at FROM notes WHERE id = ? AND book_id = ?`)
            .get(existingId, bookId) as { created_at: string } | undefined
        )?.created_at
      : undefined
    const createdAt = input.createdAt?.trim() || existingCreatedAt || now

    const note = input.note?.trim() || undefined
    const noteJson = buildHighlightNoteJson({
      locator: input.locator,
      styleKind: input.styleKind,
      colorHex: input.colorHex,
      note,
      tags: input.tags,
      selectionText: input.selectionText,
      createdAt,
      modifiedAt: now,
    })

    const result = this.db
      .prepare(
        `INSERT INTO notes (id, book_id, note_json, created_at, updated_at)
         VALUES (@id, @book_id, @note_json, @created_at, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
           note_json = @note_json,
           updated_at = @updated_at
         -- Guard against an id that belongs to a bookmark row: a highlight write must never
         -- silently convert a bookmark into a highlight.
         WHERE (json_extract(note_json, '$.group') IS NULL OR json_extract(note_json, '$.group') = 'annotation')`,
      )
      .run({
        id,
        book_id: bookId,
        note_json: noteJson,
        created_at: createdAt,
        updated_at: now,
      })

    if (result.changes === 0) {
      throw new Error(`saveHighlight: note ${id} exists but is not an annotation`)
    }

    return {
      id,
      bookId,
      locator: input.locator,
      styleKind: input.styleKind,
      colorHex: input.colorHex,
      note,
      tags: input.tags ?? [],
      selectionText: input.selectionText,
      createdAt,
      updatedAt: now,
    }
  }

  async deleteHighlight(bookId: string, id: string): Promise<boolean> {
    const book = bookId.trim()
    const noteId = id.trim()
    if (!book || !noteId) return false

    const result = this.db
      .prepare(
        `DELETE FROM notes
         WHERE id = ? AND book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE}`,
      )
      .run(noteId, book)

    return result.changes > 0
  }
}

let overlayStore: SqliteOverlayStore | null = null

/** Singleton OverlayStore backed by the open SQLite DB. */
export function getOverlayStore(): SqliteOverlayStore {
  if (!overlayStore) {
    overlayStore = new SqliteOverlayStore()
  }
  return overlayStore
}

/** Test helper — reset singleton between isolated DB opens. */
export function resetOverlayStoreForTests(): void {
  overlayStore = null
}

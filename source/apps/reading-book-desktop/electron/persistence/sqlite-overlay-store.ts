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
import {
  parseReadingState,
  type ReadingStateJson,
} from '@reading-book/book-reader-sdk'
import { getDatabase } from './db'
import {
  packSessionLocation,
  unpackSessionLocation,
} from '@reading-book/book-reader-sdk'

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

interface ReadingStateRow {
  reading_state_json: string
  /** The parent `books` row's own timestamp — fallback when the state has no `updatedAt` yet. */
  updated_at: string
}

function finiteOrUndefined(value: number | null | undefined): number | undefined {
  return value != null && Number.isFinite(value) ? value : undefined
}

function trimmedOrUndefined(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined
}

/** `books.reading_state_json` → SessionRecord (same normalisation the old table columns got). */
function recordFromState(
  bookId: string,
  state: ReadingStateJson,
  fallbackUpdatedAt: string,
): SessionRecord {
  const unpacked = unpackSessionLocation(state.lastReadLocation ?? '')
  return {
    bookId,
    lastReadLocation: unpacked?.location.toString(),
    lastReadLabel: unpacked?.label,
    percent: finiteOrUndefined(state.percent) ?? 0,
    fontFamily: trimmedOrUndefined(state.fontFamily),
    fontSize: finiteOrUndefined(state.fontSize),
    fontWeight: trimmedOrUndefined(state.fontWeight),
    lineHeight: finiteOrUndefined(state.lineHeight),
    textAlign: trimmedOrUndefined(state.textAlign),
    layoutMode: trimmedOrUndefined(state.layoutMode),
    pageTurnMode: trimmedOrUndefined(state.pageTurnMode),
    marginsEnabled: state.marginsEnabled ?? undefined,
    marginPreset: trimmedOrUndefined(state.marginPreset),
    isLandscape: state.isLandscape === true,
    updatedAt: state.updatedAt || fallbackUpdatedAt,
  }
}

/** Domain state — only exists once a valid Location has been stored. */
function sessionStateFromJson(
  bookId: string,
  state: ReadingStateJson,
  fallbackUpdatedAt: string,
): ReadingSessionState | undefined {
  const unpacked = unpackSessionLocation(state.lastReadLocation ?? '')
  if (!unpacked) return undefined

  const record = recordFromState(bookId, state, fallbackUpdatedAt)
  return new ReadingSessionState({
    bookId,
    lastReadLocation: unpacked.location,
    lastReadLabel: unpacked.label,
    percent: record.percent,
    fontFamily: record.fontFamily,
    fontSize: record.fontSize,
    fontWeight: record.fontWeight,
    lineHeight: record.lineHeight,
    textAlign: record.textAlign,
    layoutMode: record.layoutMode,
    pageTurnMode: record.pageTurnMode,
    marginsEnabled: record.marginsEnabled,
    marginPreset: record.marginPreset,
    isLandscape: record.isLandscape,
    updatedAt: record.updatedAt,
  })
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

  /** Reading state lives in `books.reading_state_json` (migration 020) — no separate session table. */
  private readState(
    bookId: string,
  ): { state: ReadingStateJson; bookUpdatedAt: string } | undefined {
    const row = this.db
      .prepare(`SELECT reading_state_json, updated_at FROM books WHERE id = ?`)
      .get(bookId) as ReadingStateRow | undefined
    if (!row) return undefined
    return {
      state: parseReadingState(row.reading_state_json),
      bookUpdatedAt: row.updated_at,
    }
  }

  async getSessionState(bookId: string): Promise<ReadingSessionState | undefined> {
    const id = bookId.trim()
    if (!id) return undefined

    const found = this.readState(id)
    if (!found) return undefined
    return sessionStateFromJson(id, found.state, found.bookUpdatedAt)
  }

  async getSessionRecord(bookId: string): Promise<SessionRecord | undefined> {
    const id = bookId.trim()
    if (!id) return undefined

    const found = this.readState(id)
    if (!found) return undefined
    return recordFromState(id, found.state, found.bookUpdatedAt)
  }

  /**
   * Partial save (settings-only saves must not disturb the location): merge into the stored
   * state with `json_patch` (RFC 7396) — keys present in the patch overwrite, absent keys keep
   * their value. `undefined` members vanish in JSON.stringify, so they mean "keep".
   */
  async saveSessionPreferences(record: SessionRecord): Promise<void> {
    let packedLocation: string | undefined
    if (record.lastReadLocation?.trim()) {
      try {
        packedLocation = packSessionLocation(
          Location.parse(record.lastReadLocation.trim()),
          record.lastReadLabel,
        )
      } catch {
        // A settings-only save must preserve the existing location.
      }
    }

    const patch: ReadingStateJson = {
      updatedAt: record.updatedAt || new Date().toISOString(),
      // Location and percent move together: percent is meaningless without the location it measures.
      lastReadLocation: packedLocation,
      percent:
        packedLocation !== undefined
          ? ReadingSessionState.clampPercent(record.percent)
          : undefined,
      fontFamily: record.fontFamily,
      fontSize: record.fontSize,
      fontWeight: record.fontWeight,
      lineHeight: record.lineHeight,
      textAlign: record.textAlign,
      layoutMode: record.layoutMode,
      pageTurnMode: record.pageTurnMode,
      marginsEnabled: record.marginsEnabled,
      marginPreset: record.marginPreset,
      isLandscape: record.isLandscape,
    }

    this.db
      .prepare(
        `UPDATE books
         SET reading_state_json = json_patch(reading_state_json, @patch),
             updated_at = @now
         WHERE id = @id`,
      )
      .run({
        id: record.bookId,
        patch: JSON.stringify(patch),
        now: new Date().toISOString(),
      })
  }

  /** Full overwrite of the reading state, guarded against out-of-order writes. */
  async saveSessionState(s: ReadingSessionState): Promise<void> {
    const updatedAt = s.updatedAt || new Date().toISOString()
    const state: ReadingStateJson = {
      lastReadLocation: packSessionLocation(s.lastReadLocation, s.lastReadLabel),
      percent: ReadingSessionState.clampPercent(s.percent),
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      textAlign: s.textAlign,
      layoutMode: s.layoutMode,
      pageTurnMode: s.pageTurnMode,
      marginsEnabled: s.marginsEnabled,
      marginPreset: s.marginPreset,
      isLandscape: s.isLandscape === true,
      updatedAt,
    }

    // Renderer-side autosave already serializes writes to a single in-flight IPC call (see
    // useReadingSessionAutosave's inFlightRef chain), so the `AND …` guard below is
    // defense-in-depth, not the primary ordering mechanism: it protects against any future
    // caller that bypasses that hook (a second window, a sync engine) firing two
    // saveSessionState calls whose IPC responses resolve out of send order. updatedAt is an
    // ISO-8601 string (fixed-width, so plain text comparison is chronological); a write older
    // than the state already on disk is silently dropped instead of clobbering it. It compares
    // the state's own updatedAt, not books.updated_at, which metadata edits also bump.
    this.db
      .prepare(
        `UPDATE books
         SET reading_state_json = @json,
             updated_at = @now
         WHERE id = @id
           AND COALESCE(json_extract(reading_state_json, '$.updatedAt'), '') <= @updated_at`,
      )
      .run({
        id: s.bookId,
        json: JSON.stringify(state),
        now: new Date().toISOString(),
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

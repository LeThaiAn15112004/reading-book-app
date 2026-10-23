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
  type PdfAnnotation,
  type PdfInkRecord,
  type PdfInkStroke,
  type SaveBookmarkInput,
  type SaveHighlightInput,
  type MdAnnotation,
  type TxtAnnotation,
} from '@reading-book/book-reader-sdk'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  parseReadingState,
  type ReadingStateJson,
} from '@reading-book/book-reader-sdk'
import {
  audioProgressPatch,
  isAudioFormat,
  parseAudioProgress,
  type AudioProgress,
  type AudioProgressInput,
} from '@reading-book/book-reader-sdk'
import { getDatabase } from './db'
import {
  applyFileFields,
  packPdfHighlightLocator,
  embeddedAnnotationIdentities,
  embeddedAnnotationSourceHash,
  highlightContentHash,
  highlightFromEmbeddedAnnotation,
  syncBase,
  type ExportableHighlight,
  type SyncConflict,
  type TwoWayLedgerEntry,
  type TwoWayPlan,
  packSessionLocation,
  parsePdfAnnotation,
  parsePdfInk,
  parseMdAnnotation,
  parseTxtAnnotation,
  planEmbeddedAnnotationSync,
  unpackSessionLocation,
  type EmbeddedAnnotationLedgerEntry,
  type EmbeddedAnnotationSyncOptions,
  type EmbeddedAnnotationSyncStep,
  type ScannedPdfAnnotation,
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
  AND json_extract(note_json, '$.type') IN ('highlight', 'underline', 'strikethrough', 'squiggly', 'replace', 'insert', 'textbox', 'rectangle', 'ellipse', 'line', 'arrow')
`

/**
 * PDF freehand Ink rows: `notes` rows of type `ink`. Deliberately NOT part of `HIGHLIGHT_TYPE_PREDICATE`,
 * so a stroke never reaches highlight queries, the planner, the sidebar or exports (and a highlight
 * delete/save can never touch one). docs/implementation_plan/pdf_freehand_ink_eraser_plan.md.
 */
const INK_TYPE_PREDICATE = `json_extract(note_json, '$.type') = 'ink'`

function rowToInkRecord(row: NoteRow): PdfInkRecord | undefined {
  let note: INoteState
  try {
    note = JSON.parse(row.note_json) as INoteState
  } catch {
    return undefined
  }
  const locator = note.locatorExtended?.locator
  // Re-validated so a hand-edited / corrupt row can't reach the renderer.
  const ink = note.pdfInk ? parsePdfInk(note.pdfInk) : undefined
  if (!locator || !ink) return undefined
  return {
    id: row.id,
    bookId: row.book_id,
    locator,
    colorHex: note.style?.colorHex?.trim() || '#1E88E5',
    opacity: typeof note.style?.opacity === 'number' ? note.style.opacity : 1,
    ink,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function buildInkNoteJson(input: {
  locator: NoteLocator
  colorHex: string
  opacity: number
  ink: PdfInkStroke
  createdAt: string
  modifiedAt: string
}): string {
  const note: INoteState = {
    schemaVersion: 1,
    type: 'ink',
    group: 'annotation',
    locatorExtended: { locator: input.locator },
    pdfInk: input.ink,
    style: { colorHex: input.colorHex, opacity: input.opacity },
    created: input.createdAt,
    modified: input.modifiedAt,
  }
  return JSON.stringify(note)
}

const HIGHLIGHT_STYLE_KINDS: HighlightStyleKind[] = [
  'highlight',
  'underline',
  'strikethrough',
  'squiggly',
  'replace',
  'insert',
  'textbox',
  // PDF shapes: rows of the same kind of table, list and history (pdf_shape_tools.md)
  'rectangle',
  'ellipse',
  'line',
  'arrow',
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
    // PDF markup geometry; re-validated so a hand-edited / corrupt row can't reach the renderer.
    pdfAnnotation: note.pdfAnnotation ? parsePdfAnnotation(note.pdfAnnotation) : undefined,
    // TXT markup range; same re-validation.
    txtAnnotation: note.txtAnnotation ? parseTxtAnnotation(note.txtAnnotation) : undefined,
    // Markdown markup anchor; same re-validation.
    mdAnnotation: note.mdAnnotation ? parseMdAnnotation(note.mdAnnotation) : undefined,
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
  pdfAnnotation?: PdfAnnotation
  txtAnnotation?: TxtAnnotation
  mdAnnotation?: MdAnnotation
  createdAt: string
  modifiedAt: string
}): string {
  const note: INoteState = {
    schemaVersion: 1,
    type: input.styleKind,
    group: 'annotation',
    locatorExtended: { locator: input.locator, text: input.selectionText },
    pdfAnnotation: input.pdfAnnotation,
    txtAnnotation: input.txtAnnotation,
    mdAnnotation: input.mdAnnotation,
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

  /** Audiobook position / rate of one book; `undefined` when none is saved (or it is not an audiobook). */
  async getAudioProgress(bookId: string): Promise<AudioProgress | undefined> {
    const id = bookId.trim()
    if (!id) return undefined
    const row = this.db
      .prepare('SELECT file_format, reading_state_json FROM books WHERE id = ?')
      .get(id) as { file_format: string; reading_state_json: string } | undefined
    if (!row || !isAudioFormat(row.file_format)) return undefined
    return parseAudioProgress(parseReadingState(row.reading_state_json))
  }

  /**
   * Record listening progress. A `json_patch` merge: only `audioProgress` and `percent` change, so
   * the location, typography and any other key of the reading state survive. Restricted to audio
   * books in SQL itself — a non-audio id matches no row (returns false) and its state is untouched.
   * The book file is never touched.
   */
  async saveAudioProgress(bookId: string, input: AudioProgressInput): Promise<boolean> {
    const id = bookId.trim()
    if (!id) return false
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `UPDATE books
         SET reading_state_json = json_patch(reading_state_json, @patch),
             updated_at = @now
         WHERE id = @id AND file_format IN ('mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus')`,
      )
      .run({ id, patch: JSON.stringify(audioProgressPatch(input, now)), now })
    return Number(result.changes) > 0
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
    return this.writeHighlight(input)
  }

  /**
   * `saveHighlight`'s synchronous body — also run inside the embedded-annotation sync transaction
   * and the TXT commit transaction (`SqliteTxtStore.commit`), which is why it is public.
   */
  writeHighlight(input: SaveHighlightInput): HighlightRecord {
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
      pdfAnnotation: input.pdfAnnotation,
      txtAnnotation: input.txtAnnotation,
      mdAnnotation: input.mdAnnotation,
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
      pdfAnnotation: input.pdfAnnotation,
      txtAnnotation: input.txtAnnotation,
      mdAnnotation: input.mdAnnotation,
      createdAt,
      updatedAt: now,
    }
  }

  async listInk(bookId: string): Promise<PdfInkRecord[]> {
    const id = bookId.trim()
    if (!id) return []
    const rows = this.db
      .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE book_id = ? AND ${INK_TYPE_PREDICATE} ORDER BY created_at ASC, rowid ASC`)
      .all(id) as NoteRow[]
    return rows.map(rowToInkRecord).filter((r): r is PdfInkRecord => r !== undefined)
  }

  /** Insert or update one stroke. Null when `id` belongs to a row that is not an Ink stroke (never converted). */
  async saveInk(input: {
    id?: string
    bookId: string
    locator: NoteLocator
    colorHex: string
    opacity: number
    ink: PdfInkStroke
    createdAt?: string
  }): Promise<PdfInkRecord | null> {
    const bookId = input.bookId.trim()
    if (!bookId) return null
    const now = new Date().toISOString()
    const existingId = input.id?.trim()
    const id = existingId || randomUUID()
    const existingCreatedAt = existingId
      ? (this.db.prepare(`SELECT created_at FROM notes WHERE id = ? AND book_id = ?`).get(existingId, bookId) as { created_at: string } | undefined)?.created_at
      : undefined
    const createdAt = input.createdAt?.trim() || existingCreatedAt || now
    const result = this.db
      .prepare(
        `INSERT INTO notes (id, book_id, note_json, created_at, updated_at)
         VALUES (@id, @book_id, @note_json, @created_at, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
           note_json = @note_json,
           updated_at = @updated_at
         -- An ink write must never convert another kind of row (highlight, bookmark) into a stroke.
         WHERE ${INK_TYPE_PREDICATE} AND book_id = @book_id`,
      )
      .run({
        id,
        book_id: bookId,
        note_json: buildInkNoteJson({ locator: input.locator, colorHex: input.colorHex, opacity: input.opacity, ink: input.ink, createdAt, modifiedAt: now }),
        created_at: createdAt,
        updated_at: now,
      })
    if (result.changes === 0) return null
    return { id, bookId, locator: input.locator, colorHex: input.colorHex, opacity: input.opacity, ink: input.ink, createdAt, updatedAt: now }
  }

  async deleteInk(bookId: string, id: string): Promise<boolean> {
    const book = bookId.trim()
    const noteId = id.trim()
    if (!book || !noteId) return false
    return this.db.prepare(`DELETE FROM notes WHERE id = ? AND book_id = ? AND ${INK_TYPE_PREDICATE}`).run(noteId, book).changes > 0
  }

  async deleteHighlight(bookId: string, id: string): Promise<boolean> {
    return this.deleteHighlightRow(bookId, id)
  }

  /** `deleteHighlight`'s synchronous body (also run inside the TXT commit transaction). */
  deleteHighlightRow(bookId: string, id: string): boolean {
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

  /**
   * Import / refresh the annotations embedded in a PDF file (scanned in Main on open and on every
   * settled change of the file) into `notes`, through the `pdf_embedded_annotations` ledger — see
   * docs/implementation_plan/pdf_embedded_annotation_import.md and pdf_embedded_annotation_live_sync.md.
   * One transaction (all or nothing): re-keys pre-`/NM` ledger rows, inserts new annotations,
   * rewrites rows whose file version changed while the app's copy didn't, and — for a `complete`
   * scan only — deletes imported rows whose annotation left the file and that the user never
   * edited. Never touches a row the user made, or edited, in the app.
   *
   * `items` must already be validated (`parseScannedPdfAnnotation`). Returns null when `bookId` is
   * not a PDF in the library.
   */
  /** Ledger rows with their two-way state (base snapshot, conflict) — pdf_annotation_two_way_sync.md. */
  listTwoWayLedger(bookId: string): TwoWayLedgerEntry[] {
    const rows = this.db
      .prepare(
        `SELECT source_key, note_id, source_hash, note_hash, base_json, conflict_json FROM pdf_embedded_annotations WHERE book_id = ?`,
      )
      .all(bookId.trim()) as Array<{ source_key: string; note_id: string; source_hash: string; note_hash: string; base_json: string | null; conflict_json: string | null }>
    return rows.map((r) => {
      const entry: TwoWayLedgerEntry = { sourceKey: r.source_key, noteId: r.note_id, sourceHash: r.source_hash, noteHash: r.note_hash }
      try {
        if (r.base_json) entry.base = JSON.parse(r.base_json)
        if (r.conflict_json) entry.conflict = JSON.parse(r.conflict_json)
      } catch {
        // A corrupt snapshot just falls back to the hash comparison.
      }
      return entry
    })
  }

  /** Open two-way conflicts of a book (one per note). */
  listPdfAnnotationConflicts(bookId: string): { noteId: string; conflict: SyncConflict }[] {
    return this.listTwoWayLedger(bookId)
      .filter((e) => e.conflict)
      .map((e) => ({ noteId: e.noteId, conflict: e.conflict! }))
  }

  /**
   * Resolve a conflict. `keep-readmate`: the row stays, and the pair's base is set so that only the
   * app side counts as changed — the next sync rewrites (or re-adds) the file annotation.
   * `use-pdf`: the row takes the file's version (or is deleted for `removed-in-file`).
   * Returns the updated row (null when deleted / nothing to do).
   */
  resolvePdfAnnotationConflict(bookId: string, noteId: string, choice: 'keep-readmate' | 'use-pdf'): { updated?: HighlightRecord; deleted?: string } | null {
    const book = bookId.trim()
    const entries = this.listTwoWayLedger(book).filter((e) => e.noteId === noteId && e.conflict)
    if (entries.length === 0) return null
    const current = this.listHighlightRecordsSync(book).find((r) => r.id === noteId)
    const result: { updated?: HighlightRecord; deleted?: string } = {}
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const entry of entries) {
        const conflict = entry.conflict!
        if (choice === 'use-pdf') {
          if (conflict.kind === 'removed-in-file' || !conflict.item) {
            this.db.prepare(`DELETE FROM notes WHERE id = ? AND book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE}`).run(noteId, book)
            this.db.prepare(`DELETE FROM pdf_embedded_annotations WHERE book_id = ? AND source_key = ?`).run(book, entry.sourceKey)
            result.deleted = noteId
            continue
          }
          if (!current) continue
          const next: ExportableHighlight = applyFileFields(current, conflict.item, conflict.fields ?? ['kind', 'color', 'text', 'geometry'])
          const saved = this.writeHighlight({ ...next, tags: [...(next.tags ?? [])], id: noteId, bookId: book, locator: current.locator })
          result.updated = saved
          this.upsertTwoWayLedger(book, entry.sourceKey, noteId, conflict.item, saved, null)
        } else {
          if (!current) continue
          if (conflict.kind === 'removed-in-file') {
            // Forget the link: the row then counts as made in Readmate and is added to the file again.
            this.db.prepare(`DELETE FROM pdf_embedded_annotations WHERE book_id = ? AND source_key = ?`).run(book, entry.sourceKey)
          } else if (conflict.item) {
            // Base = the file as it is now + an app side that differs from the row: the next cycle sees
            // only the app side as changed and rewrites the file annotation from the row.
            const base = syncBase(conflict.item, current)
            const forcedApp = { kind: base.app.kind, color: '\u0000', text: '\u0000', geometry: '\u0000' }
            this.db
              .prepare(`UPDATE pdf_embedded_annotations SET base_json = ?, conflict_json = NULL, synced_at = ? WHERE book_id = ? AND source_key = ?`)
              .run(JSON.stringify({ file: base.file, app: forcedApp }), new Date().toISOString(), book, entry.sourceKey)
          }
          result.updated = current
        }
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return result
  }

  private listHighlightRecordsSync(bookId: string): HighlightRecord[] {
    const rows = this.db
      .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE} ORDER BY created_at ASC`)
      .all(bookId) as NoteRow[]
    return rows.map(rowToHighlightRecord).filter((h): h is HighlightRecord => h !== undefined)
  }

  private upsertTwoWayLedger(
    bookId: string,
    key: string,
    noteId: string,
    item: ScannedPdfAnnotation,
    row: HighlightRecord | ExportableHighlight,
    conflict: SyncConflict | null,
  ): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO pdf_embedded_annotations
           (book_id, source_key, note_id, source_hash, note_hash, base_json, conflict_json, imported_at, synced_at)
         VALUES (@book_id, @source_key, @note_id, @source_hash, @note_hash, @base_json, @conflict_json, @now, @now)
         ON CONFLICT(book_id, source_key) DO UPDATE SET
           note_id = @note_id, source_hash = @source_hash, note_hash = @note_hash,
           base_json = @base_json, conflict_json = @conflict_json, synced_at = @now`,
      )
      .run({
        book_id: bookId,
        source_key: key,
        note_id: noteId,
        source_hash: embeddedAnnotationSourceHash(item),
        note_hash: highlightContentHash(row),
        base_json: JSON.stringify(syncBase(item, row)),
        conflict_json: conflict ? JSON.stringify(conflict) : null,
        now,
      })
  }

  /**
   * Apply a two-way plan (SDK `planTwoWaySync`) in ONE transaction. `items` is the scan the plan was
   * made from; `after` the read-back scan of the file once the plan's file operations were written,
   * or null when nothing was written (write not needed, or it failed — then everything that depends
   * on the write is left for the next cycle). Returns null when `bookId` is not a PDF.
   */
  applyTwoWaySync(bookId: string, plan: TwoWayPlan, items: readonly ScannedPdfAnnotation[], after: readonly ScannedPdfAnnotation[] | null): TwoWaySyncOutcome | null {
    const book = bookId.trim()
    const row = this.db.prepare(`SELECT file_format FROM books WHERE id = ?`).get(book) as { file_format: string } | undefined
    if (!row || row.file_format !== 'pdf') return null
    const outcome: TwoWaySyncOutcome = { inserted: [], updated: [], deleted: [], conflicts: [] }
    const keys = embeddedAnnotationIdentities(items).map((i) => i.key)
    const itemByKey = new Map(keys.map((k, i) => [k, items[i]!]))
    const writtenIds = new Set(plan.writtenRows.map((w) => w.noteId))
    const wrote = after !== null
    const dropLedger = this.db.prepare(`DELETE FROM pdf_embedded_annotations WHERE book_id = ? AND source_key = ?`)

    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const noteId of plan.rowDeletes) {
        if (this.db.prepare(`DELETE FROM notes WHERE id = ? AND book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE}`).run(noteId, book).changes > 0) outcome.deleted.push(noteId)
      }
      for (const key of plan.ledgerDrops) dropLedger.run(book, key)
      if (wrote) for (const key of plan.ledgerDropsAfterWrite) dropLedger.run(book, key)

      const records = new Map(this.listHighlightRecordsSync(book).map((r) => [r.id, r]))
      for (const { noteId, next, expectedHash } of plan.rowUpdates) {
        const current = records.get(noteId)
        // Edited in Readmate while this cycle ran: leave it — the next cycle sees both changes.
        if (!current || highlightContentHash(current) !== expectedHash) continue
        const saved = this.writeHighlight({
          ...next,
          tags: [...(next.tags ?? [])],
          id: noteId,
          bookId: book,
          locator: JSON.parse(packPdfHighlightLocator(next.pdfAnnotation!)) as NoteLocator,
        })
        records.set(noteId, saved)
        outcome.updated.push(saved)
        // Its base moves to (file now, row now) — unless the write it also needed didn't happen.
        if (!writtenIds.has(noteId) || wrote) {
          for (const entry of this.listTwoWayLedger(book).filter((e) => e.noteId === noteId && !e.conflict)) {
            const item = itemByKey.get(entry.sourceKey)
            if (item && !writtenIds.has(noteId)) this.upsertTwoWayLedger(book, entry.sourceKey, noteId, item, saved, null)
          }
        }
      }
      for (const { key, item } of [...plan.inserts, ...plan.restores]) {
        const highlight = highlightFromEmbeddedAnnotation(item)
        const saved = this.writeHighlight({ ...highlight, bookId: book })
        records.set(saved.id, saved)
        outcome.inserted.push(saved)
        this.upsertTwoWayLedger(book, key, saved.id, item, saved, null)
      }
      for (const { key, noteId, item } of plan.links) {
        const current = records.get(noteId)
        if (current) this.upsertTwoWayLedger(book, key, noteId, item, current, null)
      }
      for (const { key, noteId, conflict } of plan.conflicts) {
        this.db.prepare(`UPDATE pdf_embedded_annotations SET conflict_json = ?, synced_at = ? WHERE book_id = ? AND source_key = ?`).run(JSON.stringify(conflict), new Date().toISOString(), book, key)
        outcome.conflicts.push({ noteId, conflict })
      }
      for (const key of plan.conflictsCleared) {
        this.db.prepare(`UPDATE pdf_embedded_annotations SET conflict_json = NULL WHERE book_id = ? AND source_key = ?`).run(book, key)
      }
      for (const { key, noteId, item } of plan.baseRefresh) {
        const current = records.get(noteId)
        if (current) this.upsertTwoWayLedger(book, key, noteId, item, current, null)
      }
      if (wrote) {
        const afterKeys = embeddedAnnotationIdentities(after).map((i) => i.key)
        for (const { noteId, row: written, oldKeys, names } of plan.writtenRows) {
          // Even when the row was deleted while this cycle ran: its entry then is a tombstone, so the
          // next cycle removes the annotation from the file instead of importing it back as a new row.
          for (const key of oldKeys) dropLedger.run(book, key)
          // The base / hash record what was WRITTEN: an edit made meanwhile stays "changed" and is
          // written by the next cycle.
          after.forEach((item, i) => {
            if (item.nm && names.includes(item.nm)) this.upsertTwoWayLedger(book, afterKeys[i]!, noteId, item, written, null)
          })
        }
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return outcome
  }

  /** The book's import-ledger rows (which embedded annotation became which `notes` row). */
  listEmbeddedLedger(bookId: string): EmbeddedAnnotationLedgerEntry[] {
    const rows = this.db
      .prepare(`SELECT source_key, note_id, source_hash, note_hash FROM pdf_embedded_annotations WHERE book_id = ?`)
      .all(bookId.trim()) as Array<{ source_key: string; note_id: string; source_hash: string; note_hash: string }>
    return rows.map((r) => ({ sourceKey: r.source_key, noteId: r.note_id, sourceHash: r.source_hash, noteHash: r.note_hash }))
  }

  syncEmbeddedPdfAnnotations(
    bookId: string,
    items: readonly ScannedPdfAnnotation[],
    options: EmbeddedAnnotationSyncOptions = {},
  ): EmbeddedPdfSyncOutcome | null {
    const book = bookId.trim()
    const row = this.db.prepare(`SELECT file_format FROM books WHERE id = ?`).get(book) as
      | { file_format: string }
      | undefined
    if (!row || row.file_format !== 'pdf') return null

    const outcome: EmbeddedPdfSyncOutcome = {
      inserted: [],
      updated: [],
      unchanged: 0,
      keptAppEdits: 0,
      dismissed: 0,
      managedIndices: [],
      deleted: [],
      rekeyed: 0,
      keptAppEditsOnRemoval: 0,
    }
    // Nothing scanned and nothing that could be deleted: no transaction at all.
    if (items.length === 0 && !options.complete) return outcome

    this.db.exec('BEGIN IMMEDIATE')
    try {
      const ledger = new Map<string, EmbeddedAnnotationLedgerEntry>()
      const ledgerRows = this.db
        .prepare(
          `SELECT source_key, note_id, source_hash, note_hash FROM pdf_embedded_annotations WHERE book_id = ?`,
        )
        .all(book) as Array<{ source_key: string; note_id: string; source_hash: string; note_hash: string }>
      for (const r of ledgerRows) {
        ledger.set(r.source_key, { sourceKey: r.source_key, noteId: r.note_id, sourceHash: r.source_hash, noteHash: r.note_hash })
      }
      const current = new Map<string, HighlightRecord>()
      const noteRows = this.db
        .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE}`)
        .all(book) as NoteRow[]
      for (const noteRow of noteRows) {
        const record = rowToHighlightRecord(noteRow)
        if (record) current.set(record.id, record)
      }

      const plan = planEmbeddedAnnotationSync(
        items,
        ledger,
        (noteId) => {
          const record = current.get(noteId)
          return record ? highlightContentHash(record) : undefined
        },
        options,
      )

      const now = new Date().toISOString()
      const upsertLedger = this.db.prepare(
        `INSERT INTO pdf_embedded_annotations
           (book_id, source_key, note_id, source_hash, note_hash, imported_at, synced_at)
         VALUES (@book_id, @source_key, @note_id, @source_hash, @note_hash, @now, @now)
         ON CONFLICT(book_id, source_key) DO UPDATE SET
           note_id = @note_id,
           source_hash = @source_hash,
           note_hash = @note_hash,
           synced_at = @now`,
      )
      const write = (step: EmbeddedAnnotationSyncStep, noteId: string | undefined): HighlightRecord => {
        const highlight = highlightFromEmbeddedAnnotation(step.item)
        const saved = this.writeHighlight({ ...highlight, id: noteId, bookId: book })
        upsertLedger.run({
          book_id: book,
          source_key: step.key,
          note_id: saved.id,
          source_hash: embeddedAnnotationSourceHash(step.item),
          note_hash: highlightContentHash(saved),
          now,
        })
        return saved
      }
      const rekey = this.db.prepare(
        `UPDATE pdf_embedded_annotations SET source_key = ?, synced_at = ? WHERE book_id = ? AND source_key = ?`,
      )
      for (const { from, to } of plan.rekeys) rekey.run(to, now, book, from)
      for (const step of plan.inserts) outcome.inserted.push(write(step, undefined))
      for (const step of plan.updates) outcome.updated.push(write(step, step.noteId))

      const deleteLedger = this.db.prepare(`DELETE FROM pdf_embedded_annotations WHERE book_id = ? AND source_key = ?`)
      const deleteNote = this.db.prepare(`DELETE FROM notes WHERE id = ? AND book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE}`)
      for (const { key, noteId } of plan.deletions) {
        if (deleteNote.run(noteId, book).changes > 0) outcome.deleted.push(noteId)
        deleteLedger.run(book, key)
      }
      for (const key of plan.tombstonesCleared) deleteLedger.run(book, key)

      outcome.unchanged = plan.unchanged
      outcome.keptAppEdits = plan.keptAppEdits
      outcome.dismissed = plan.dismissed
      outcome.managedIndices = plan.managed
      outcome.rekeyed = plan.rekeys.length
      outcome.keptAppEditsOnRemoval = plan.keptAppEditsOnRemoval
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return outcome
  }
}

/** What `applyTwoWaySync` did (rows for the renderer, conflicts for the UI). */
export type TwoWaySyncOutcome = {
  inserted: HighlightRecord[]
  updated: HighlightRecord[]
  deleted: string[]
  conflicts: { noteId: string; conflict: SyncConflict }[]
}

/** What `syncEmbeddedPdfAnnotations` did. `managedIndices` index into the synced `items`. */
export type EmbeddedPdfSyncOutcome = {
  inserted: HighlightRecord[]
  updated: HighlightRecord[]
  unchanged: number
  keptAppEdits: number
  dismissed: number
  managedIndices: number[]
  /** Note ids deleted because their annotation left the file (complete scans only). */
  deleted: string[]
  /** Ledger rows moved from their anchor key to their `/NM` key. */
  rekeyed: number
  /** Left the file, but edited in the app — kept. */
  keptAppEditsOnRemoval: number
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

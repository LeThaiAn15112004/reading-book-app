/**
 * Mobile's `OverlayStore` (spec 008, T045): reading session state, bookmarks and highlights in the same columns and
 * the same `note_json` as Desktop's `SqliteOverlayStore` (FR-021). Its row layout is copied from Desktop's store,
 * because that code lives in Electron Main and cannot be imported (R7); the contract fixtures prove both write the
 * same thing (`web/tests/contract-conformance.test.ts` here, `spike:contract:fixtures` on Desktop). Parsing and
 * validation are the SDK's, the same functions Desktop's Main uses.
 *
 * This is the one write path for these rows on Mobile, so it also does Main's re-validation of a save (Desktop
 * does it in `overlay:saveHighlight`, before its store): the locator must parse as a `Location`, a PDF / Markdown
 * payload must be valid and agree with the locator, and only the text-markup kinds of the first release are created.
 *
 * Reading: rows of every kind Desktop lists are returned as Desktop returns them; rows of kinds this store does not
 * know (ink, anything newer) are never listed and never touched, so they survive unchanged (forward compatibility).
 *
 * TXT (data-model.md, resolved at M3): a TXT markup row has the same shape as on Desktop and this store reads and
 * writes it like any other. Desktop writes TXT rows only inside `txt:commit`, with a text revision; Mobile has no
 * text revisions because TXT is read-only in the first release, so the bridge refuses a TXT save before the store
 * (as Main refuses `txtAnnotationRef` in `overlay:saveHighlight`), and the store accepts the shape for reads and for
 * the contract.
 */
import {
  Location,
  ReadingSessionState,
  isConsistentMdHighlight,
  isConsistentPdfHighlight,
  packSessionLocation,
  parseMdAnnotation,
  parsePdfAnnotation,
  parseReadingState,
  parseTxtAnnotation,
  unpackSessionLocation,
  type BookmarkRecord,
  type HighlightRecord,
  type HighlightStyleKind,
  type INoteState,
  type MdAnnotation,
  type NoteLocator,
  type NoteSelectionText,
  type OverlayStore,
  type PdfAnnotation,
  type ReadingStateJson,
  type SaveBookmarkInput,
  type SaveHighlightInput,
  type TxtAnnotation,
} from '@reading-book/book-reader-sdk'
import { queryOne, type SqlDriver } from '../db/sql-driver'

interface NoteRow {
  id: string
  book_id: string
  note_json: string
  created_at: string
  updated_at: string
}

const NOTE_COLUMNS = 'id, book_id, note_json, created_at, updated_at'

/** Desktop's `SessionRecord` (sqlite-overlay-store.ts): the DTO-facing reading state of one book. */
export interface SessionRecord {
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

/** Same predicates as Desktop's store, verbatim, so the same rows are selected (and `idx_notes_group` is used). */
const BOOKMARK_GROUP_PREDICATE = `json_extract(note_json, '$.group') = 'bookmark'`
const HIGHLIGHT_TYPE_PREDICATE = `
  (json_extract(note_json, '$.group') IS NULL OR json_extract(note_json, '$.group') = 'annotation')
  AND json_extract(note_json, '$.type') IN ('highlight', 'underline', 'strikethrough', 'squiggly', 'replace', 'insert', 'textbox', 'rectangle', 'ellipse', 'line', 'arrow', 'typewriter', 'attachment')
`
const ANNOTATION_GROUP_GUARD = `(json_extract(note_json, '$.group') IS NULL OR json_extract(note_json, '$.group') = 'annotation')`

/** Every kind Desktop lists (read side). */
const LISTED_STYLE_KINDS: readonly HighlightStyleKind[] = [
  'highlight', 'underline', 'strikethrough', 'squiggly', 'replace', 'insert', 'textbox',
  'rectangle', 'ellipse', 'line', 'arrow', 'typewriter', 'attachment',
]

/** Kinds Mobile creates in the first release: text markup only (contracts/phone-ui.md, scope). */
export const MOBILE_WRITABLE_STYLE_KINDS: readonly HighlightStyleKind[] = ['highlight', 'underline', 'strikethrough', 'squiggly']

const DEFAULT_HIGHLIGHT_COLOR = '#FFEB3B'

export class OverlayValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OverlayValidationError'
  }
}

const newId = () => globalThis.crypto.randomUUID()
const nowIso = () => new Date().toISOString()

function parseNote(row: NoteRow): INoteState | undefined {
  try {
    return JSON.parse(row.note_json) as INoteState
  } catch {
    return undefined
  }
}

function rowToBookmarkRecord(row: NoteRow): BookmarkRecord | undefined {
  const note = parseNote(row)
  const locator = note?.locatorExtended?.locator
  if (!note || !locator) return undefined
  return {
    id: row.id,
    bookId: row.book_id,
    locator,
    label: note.label?.trim() || undefined,
    excerpt: note.textualValue?.trim() || undefined,
    createdAt: row.created_at,
  }
}

function rowToHighlightRecord(row: NoteRow): HighlightRecord | undefined {
  const note = parseNote(row)
  const locator = note?.locatorExtended?.locator
  if (!note || !locator) return undefined
  const styleKind: HighlightStyleKind = LISTED_STYLE_KINDS.includes(note.type as HighlightStyleKind) ? (note.type as HighlightStyleKind) : 'highlight'
  return {
    id: row.id,
    bookId: row.book_id,
    locator,
    styleKind,
    colorHex: note.style?.colorHex?.trim() || DEFAULT_HIGHLIGHT_COLOR,
    note: styleKind === 'typewriter' ? (note.note ?? undefined) : note.note?.trim() || undefined,
    tags: Array.isArray(note.tags) ? note.tags : [],
    selectionText: note.locatorExtended?.text,
    pdfAnnotation: note.pdfAnnotation ? parsePdfAnnotation(note.pdfAnnotation, note.note ?? undefined) : undefined,
    txtAnnotation: note.txtAnnotation ? parseTxtAnnotation(note.txtAnnotation) : undefined,
    mdAnnotation: note.mdAnnotation ? parseMdAnnotation(note.mdAnnotation) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function bookmarkNoteJson(input: { locator: NoteLocator; label?: string; excerpt?: string; createdAt: string; modifiedAt: string }): string {
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

function highlightNoteJson(input: {
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

/** Main's checks of `overlay:saveHighlight`, on the store input; SDK functions only. */
export function validateHighlightInput(input: SaveHighlightInput): void {
  const fail = (message: string): never => {
    throw new OverlayValidationError(message)
  }
  if (!input.bookId?.trim()) fail('saveHighlight requires a bookId')
  try {
    Location.parse(JSON.stringify(input.locator))
  } catch {
    fail('the locator is not a valid Location')
  }
  if (!MOBILE_WRITABLE_STYLE_KINDS.includes(input.styleKind)) fail(`Mobile does not create "${input.styleKind}" annotations`)
  if (typeof input.colorHex !== 'string' || !input.colorHex.trim()) fail('a colour is required')
  if (input.pdfAnnotation !== undefined) {
    const pdf = parsePdfAnnotation(input.pdfAnnotation, input.note)
    if (!pdf || !isConsistentPdfHighlight(input.locator, pdf)) fail('the PDF markup is invalid or does not match its page')
    if (pdf?.attachment || pdf?.shape || pdf?.typewriter) fail('attachments, shapes and typewriter notes are not created on Mobile')
  }
  if (input.mdAnnotation !== undefined) {
    const md = parseMdAnnotation(input.mdAnnotation)
    if (!md || !isConsistentMdHighlight(input.locator, md)) fail('the Markdown anchor is invalid or does not match its location')
    if (input.pdfAnnotation !== undefined) fail('one annotation cannot be both PDF and Markdown markup')
  }
  if (input.txtAnnotation !== undefined && !parseTxtAnnotation(input.txtAnnotation)) fail('the TXT range is invalid')
}

export class MobileOverlayStore implements OverlayStore {
  constructor(private readonly db: SqlDriver) {}

  private async readState(bookId: string): Promise<{ state: ReadingStateJson; bookUpdatedAt: string } | undefined> {
    const row = await queryOne<{ reading_state_json: string; updated_at: string }>(this.db, 'SELECT reading_state_json, updated_at FROM books WHERE id = ?', [bookId])
    return row ? { state: parseReadingState(row.reading_state_json), bookUpdatedAt: row.updated_at } : undefined
  }

  async getSessionState(bookId: string): Promise<ReadingSessionState | undefined> {
    const id = bookId.trim()
    if (!id) return undefined
    const found = await this.readState(id)
    if (!found) return undefined
    const { state, bookUpdatedAt } = found
    const unpacked = unpackSessionLocation(state.lastReadLocation ?? '')
    if (!unpacked) return undefined
    const num = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : undefined)
    const text = (v: string | null | undefined) => v?.trim() || undefined
    return new ReadingSessionState({
      bookId: id,
      lastReadLocation: unpacked.location,
      lastReadLabel: unpacked.label,
      percent: num(state.percent) ?? 0,
      fontFamily: text(state.fontFamily),
      fontSize: num(state.fontSize),
      fontWeight: text(state.fontWeight),
      lineHeight: num(state.lineHeight),
      textAlign: text(state.textAlign),
      layoutMode: text(state.layoutMode),
      pageTurnMode: text(state.pageTurnMode),
      marginsEnabled: state.marginsEnabled ?? undefined,
      marginPreset: text(state.marginPreset),
      isLandscape: state.isLandscape === true,
      updatedAt: state.updatedAt || bookUpdatedAt,
    })
  }

  /** Full overwrite of the reading state; a write older than the stored state is dropped (Desktop's guard). */
  async saveSessionState(s: ReadingSessionState): Promise<void> {
    const updatedAt = s.updatedAt || nowIso()
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
    await this.db.run(
      `UPDATE books SET reading_state_json = ?, updated_at = ?
       WHERE id = ? AND COALESCE(json_extract(reading_state_json, '$.updatedAt'), '') <= ?`,
      [JSON.stringify(state), nowIso(), s.bookId, updatedAt],
    )
  }

  /**
   * What `overlay:getSessionState` answers on Desktop (`getSessionRecord`): the stored state even without a
   * location (typography saved before the first page turn), the location as Location JSON.
   */
  async getSessionRecord(bookId: string): Promise<SessionRecord | undefined> {
    const id = bookId.trim()
    if (!id) return undefined
    const found = await this.readState(id)
    if (!found) return undefined
    const { state, bookUpdatedAt } = found
    const unpacked = unpackSessionLocation(state.lastReadLocation ?? '')
    const num = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : undefined)
    const text = (v: string | null | undefined) => v?.trim() || undefined
    return {
      bookId: id,
      lastReadLocation: unpacked?.location.toString(),
      lastReadLabel: unpacked?.label,
      percent: num(state.percent) ?? 0,
      fontFamily: text(state.fontFamily),
      fontSize: num(state.fontSize),
      fontWeight: text(state.fontWeight),
      lineHeight: num(state.lineHeight),
      textAlign: text(state.textAlign),
      layoutMode: text(state.layoutMode),
      pageTurnMode: text(state.pageTurnMode),
      marginsEnabled: state.marginsEnabled ?? undefined,
      marginPreset: text(state.marginPreset),
      isLandscape: state.isLandscape === true,
      updatedAt: state.updatedAt || bookUpdatedAt,
    }
  }

  /**
   * What `overlay:saveSessionState` does on Desktop (`saveSessionPreferences`): a `json_patch` merge, so a
   * settings-only save keeps the stored location, and location and percent always move together.
   */
  async saveSessionPreferences(record: SessionRecord): Promise<boolean> {
    let packedLocation: string | undefined
    if (record.lastReadLocation?.trim()) {
      try {
        packedLocation = packSessionLocation(Location.parse(record.lastReadLocation.trim()), record.lastReadLabel)
      } catch {
        // A settings-only save must preserve the existing location.
      }
    }
    const patch: ReadingStateJson = {
      updatedAt: record.updatedAt || nowIso(),
      lastReadLocation: packedLocation,
      percent: packedLocation !== undefined ? ReadingSessionState.clampPercent(record.percent) : undefined,
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
    const result = await this.db.run('UPDATE books SET reading_state_json = json_patch(reading_state_json, ?), updated_at = ? WHERE id = ?', [
      JSON.stringify(patch),
      nowIso(),
      record.bookId,
    ])
    return result.changes > 0
  }

  async listBookmarks(bookId: string): Promise<BookmarkRecord[]> {
    const id = bookId.trim()
    if (!id) return []
    const rows = await this.db.query<NoteRow>(`SELECT ${NOTE_COLUMNS} FROM notes WHERE book_id = ? AND ${BOOKMARK_GROUP_PREDICATE} ORDER BY created_at ASC`, [id])
    return rows.map(rowToBookmarkRecord).filter((b): b is BookmarkRecord => b !== undefined)
  }

  async saveBookmark(input: SaveBookmarkInput): Promise<BookmarkRecord> {
    const bookId = input.bookId.trim()
    if (!bookId) throw new OverlayValidationError('saveBookmark requires a bookId')
    try {
      Location.parse(JSON.stringify(input.locator))
    } catch {
      throw new OverlayValidationError('the bookmark locator is not a valid Location')
    }
    const now = nowIso()
    const existingId = input.id?.trim()
    const id = existingId || newId()
    const createdAt = input.createdAt?.trim() || (existingId ? await this.createdAtOf(existingId, bookId) : undefined) || now
    const label = input.label?.trim() || undefined
    const excerpt = input.excerpt?.trim() || undefined
    const noteJson = bookmarkNoteJson({ locator: input.locator, label, excerpt, createdAt, modifiedAt: now })
    const result = await this.db.run(
      `INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET note_json = excluded.note_json, updated_at = excluded.updated_at
       WHERE ${BOOKMARK_GROUP_PREDICATE}`,
      [id, bookId, noteJson, createdAt, now],
    )
    if (result.changes === 0) throw new Error(`saveBookmark: note ${id} exists but is not a bookmark`)
    return { id, bookId, locator: input.locator, label, excerpt, createdAt }
  }

  async deleteBookmark(bookId: string, id: string): Promise<boolean> {
    const book = bookId.trim()
    const noteId = id.trim()
    if (!book || !noteId) return false
    const result = await this.db.run(`DELETE FROM notes WHERE id = ? AND book_id = ? AND ${BOOKMARK_GROUP_PREDICATE}`, [noteId, book])
    return result.changes > 0
  }

  async listHighlights(bookId: string): Promise<HighlightRecord[]> {
    const id = bookId.trim()
    if (!id) return []
    const rows = await this.db.query<NoteRow>(`SELECT ${NOTE_COLUMNS} FROM notes WHERE book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE} ORDER BY created_at ASC`, [id])
    return rows.map(rowToHighlightRecord).filter((h): h is HighlightRecord => h !== undefined)
  }

  async saveHighlight(input: SaveHighlightInput): Promise<HighlightRecord> {
    validateHighlightInput(input)
    const bookId = input.bookId.trim()
    const now = nowIso()
    const existingId = input.id?.trim()
    const id = existingId || newId()
    const createdAt = input.createdAt?.trim() || (existingId ? await this.createdAtOf(existingId, bookId) : undefined) || now
    const colorHex = input.colorHex.trim()
    const note = input.note?.trim() || undefined
    const noteJson = highlightNoteJson({
      locator: input.locator,
      styleKind: input.styleKind,
      colorHex,
      note,
      tags: input.tags,
      selectionText: input.selectionText,
      pdfAnnotation: input.pdfAnnotation,
      txtAnnotation: input.txtAnnotation,
      mdAnnotation: input.mdAnnotation,
      createdAt,
      modifiedAt: now,
    })
    const result = await this.db.run(
      `INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET note_json = excluded.note_json, updated_at = excluded.updated_at
       WHERE ${ANNOTATION_GROUP_GUARD}`,
      [id, bookId, noteJson, createdAt, now],
    )
    if (result.changes === 0) throw new Error(`saveHighlight: note ${id} exists but is not an annotation`)
    return {
      id,
      bookId,
      locator: input.locator,
      styleKind: input.styleKind,
      colorHex,
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

  async deleteHighlight(bookId: string, id: string): Promise<boolean> {
    const book = bookId.trim()
    const noteId = id.trim()
    if (!book || !noteId) return false
    const result = await this.db.run(`DELETE FROM notes WHERE id = ? AND book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE}`, [noteId, book])
    return result.changes > 0
  }

  /** An update keeps the row's first creation time; only an insert dates it. */
  private async createdAtOf(id: string, bookId: string): Promise<string | undefined> {
    return (await queryOne<{ created_at: string }>(this.db, 'SELECT created_at FROM notes WHERE id = ? AND book_id = ?', [id, bookId]))?.created_at
  }
}

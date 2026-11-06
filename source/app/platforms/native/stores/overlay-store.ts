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
  overlayCodec,
  overlayStatements as q,
  packSessionLocation,
  parseMdAnnotation,
  parsePdfAnnotation,
  parseReadingState,
  parseTxtAnnotation,
  type BookmarkRecord,
  type HighlightRecord,
  type HighlightStyleKind,
  type OverlayStore,
  type ReadingStateJson,
  type SaveBookmarkInput,
  type SaveHighlightInput,
} from '@core'
import type { SqlDriver, SqlStatement } from '../db/sql-driver'

// The SQL (core `overlayStatements`) and the `note_json` / reading-state codecs (core `overlayCodec`) are shared with
// Desktop's store (spec 009 T033); this store keeps Mobile's validation and its async control flow.
type NoteRow = overlayCodec.NoteRow
export type SessionRecord = overlayCodec.SessionRecord

const queryOne = async <Row>(db: SqlDriver, statement: SqlStatement): Promise<Row | undefined> =>
  (await db.query<Row>(statement.sql, statement.params))[0]
const queryAll = <Row>(db: SqlDriver, statement: SqlStatement): Promise<Row[]> => db.query<Row>(statement.sql, statement.params)
const runOne = (db: SqlDriver, statement: SqlStatement) => db.run(statement.sql, statement.params)

/** Kinds Mobile creates in the first release: text markup only (contracts/phone-ui.md, scope). */
export const MOBILE_WRITABLE_STYLE_KINDS: readonly HighlightStyleKind[] = ['highlight', 'underline', 'strikethrough', 'squiggly']

export class OverlayValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OverlayValidationError'
  }
}

const newId = () => globalThis.crypto.randomUUID()
const nowIso = () => new Date().toISOString()

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
    const row = await queryOne<{ reading_state_json: string; updated_at: string }>(this.db, q.selectReadingStateRow(bookId))
    return row ? { state: parseReadingState(row.reading_state_json), bookUpdatedAt: row.updated_at } : undefined
  }

  async getSessionState(bookId: string): Promise<ReadingSessionState | undefined> {
    const id = bookId.trim()
    if (!id) return undefined
    const found = await this.readState(id)
    if (!found) return undefined
    return overlayCodec.sessionStateFromReadingState(id, found.state, found.bookUpdatedAt)
  }

  /** Full overwrite of the reading state; a write older than the stored state is dropped (Desktop's guard). */
  async saveSessionState(s: ReadingSessionState): Promise<void> {
    const updatedAt = s.updatedAt || nowIso()
    const state = overlayCodec.readingStateOfSession(s, updatedAt, packSessionLocation(s.lastReadLocation, s.lastReadLabel))
    await runOne(this.db, q.overwriteSessionState(s.bookId, JSON.stringify(state), nowIso(), updatedAt))
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
    return overlayCodec.sessionRecordFromState(id, found.state, found.bookUpdatedAt)
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
    const patch = overlayCodec.preferencesPatch(record, packedLocation, nowIso())
    const result = await runOne(this.db, q.patchSessionPreferences(record.bookId, JSON.stringify(patch), nowIso()))
    return result.changes > 0
  }

  async listBookmarks(bookId: string): Promise<BookmarkRecord[]> {
    const id = bookId.trim()
    if (!id) return []
    const rows = await queryAll<NoteRow>(this.db, q.selectBookmarks(id))
    return rows.map(overlayCodec.bookmarkFromRow).filter((b): b is BookmarkRecord => b !== undefined)
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
    const noteJson = overlayCodec.buildBookmarkNoteJson({ locator: input.locator, label, excerpt, createdAt, modifiedAt: now })
    const result = await runOne(this.db, q.upsertBookmark(id, bookId, noteJson, createdAt, now))
    if (result.changes === 0) throw new Error(`saveBookmark: note ${id} exists but is not a bookmark`)
    return { id, bookId, locator: input.locator, label, excerpt, createdAt }
  }

  async deleteBookmark(bookId: string, id: string): Promise<boolean> {
    const book = bookId.trim()
    const noteId = id.trim()
    if (!book || !noteId) return false
    const result = await runOne(this.db, q.deleteBookmark(noteId, book))
    return result.changes > 0
  }

  async listHighlights(bookId: string): Promise<HighlightRecord[]> {
    const id = bookId.trim()
    if (!id) return []
    const rows = await queryAll<NoteRow>(this.db, q.selectHighlights(id))
    return rows.map(overlayCodec.highlightFromRow).filter((h): h is HighlightRecord => h !== undefined)
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
    const noteJson = overlayCodec.buildHighlightNoteJson({
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
    const result = await runOne(this.db, q.upsertHighlight(id, bookId, noteJson, createdAt, now))
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
    const result = await runOne(this.db, q.deleteHighlight(noteId, book))
    return result.changes > 0
  }

  /** An update keeps the row's first creation time; only an insert dates it. */
  private async createdAtOf(id: string, bookId: string): Promise<string | undefined> {
    return (await queryOne<{ created_at: string }>(this.db, q.selectNoteCreatedAt(id, bookId)))?.created_at
  }
}

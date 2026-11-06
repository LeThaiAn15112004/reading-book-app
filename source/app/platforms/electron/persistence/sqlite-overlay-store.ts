import {
  Location,
  ReadingSessionState,
  overlayCodec,
  overlayStatements as q,
  libraryStatements,
  type BookmarkRecord,
  type HighlightRecord,
  type INoteState,
  type NoteLocator,
  type OverlayStore,
  type PdfInkRecord,
  type PdfInkStroke,
  type SaveBookmarkInput,
  type SaveHighlightInput,
  type SyncSqlDriver,
} from '@core'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import {
  parseReadingState,
  type ReadingStateJson,
} from '@core'
import {
  audioProgressPatch,
  isAudioFormat,
  parseAudioProgress,
  type AudioProgress,
  type AudioProgressInput,
} from '@core'
import { getDatabase } from './db'
import { createSyncSqlDriver } from './sql-driver'
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
  planEmbeddedAnnotationSync,
  type EmbeddedAnnotationLedgerEntry,
  type EmbeddedAnnotationSyncOptions,
  type EmbeddedAnnotationSyncStep,
  type ScannedPdfAnnotation,
} from '@core'

// Row types, codecs and the SQL (core `overlayCodec` / `overlayStatements`, spec 009 T033) are shared with Mobile.
export type SessionRecord = overlayCodec.SessionRecord
type NoteRow = overlayCodec.NoteRow

/** One annotation row as stored, for the annotations file export. */
export interface TransferNoteRow {
  id: string
  bookId: string
  createdAt: string
  updatedAt: string
  note: INoteState
}

/**
 * SQLite OverlayStore — reading session state (T4.3), bookmarks (FR-11), and highlights.
 *
 * Bookmarks live in the unified `notes` table (`note_json.group = 'bookmark'`) since migration
 * 019 dropped the standalone `bookmarks` table. Highlights/underlines live in the same table
 * as `note_json.group = 'annotation'` (or absent) rows with `type` `'highlight'`/`'underline'`.
 */
export class SqliteOverlayStore implements OverlayStore {
  private readonly sql: SyncSqlDriver

  constructor(db: SqliteDatabase = getDatabase()) {
    this.sql = createSyncSqlDriver(db)
  }

  /** Reading state lives in `books.reading_state_json` (migration 020) — no separate session table. */
  private readState(
    bookId: string,
  ): { state: ReadingStateJson; bookUpdatedAt: string } | undefined {
    const row = this.sql.get<{ reading_state_json: string; updated_at: string }>(q.selectReadingStateRow(bookId))
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
    return overlayCodec.sessionStateFromReadingState(id, found.state, found.bookUpdatedAt)
  }

  async getSessionRecord(bookId: string): Promise<SessionRecord | undefined> {
    const id = bookId.trim()
    if (!id) return undefined

    const found = this.readState(id)
    if (!found) return undefined
    return overlayCodec.sessionRecordFromState(id, found.state, found.bookUpdatedAt)
  }

  /** Audiobook position / rate of one book; `undefined` when none is saved (or it is not an audiobook). */
  async getAudioProgress(bookId: string): Promise<AudioProgress | undefined> {
    const id = bookId.trim()
    if (!id) return undefined
    const row = this.sql.get<{ file_format: string; reading_state_json: string }>(q.selectFormatAndReadingState(id))
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
    // A track-relative position is only meaningful together with ITS track: a multi-chapter audiobook needs a `trackId`
    // that belongs to this very book, and a single-file audiobook must not carry one. Anything else is refused here,
    // whatever the renderer sent.
    const multi = this.sql.get(libraryStatements.selectHasAudioChapters(id)) !== undefined
    if (multi) {
      if (!input.trackId) return false
      const owned = this.sql.get(q.selectChapterOfBook(input.trackId, id))
      if (owned === undefined) return false
    } else if (input.trackId !== undefined) {
      return false
    }
    const now = new Date().toISOString()
    const result = this.sql.run(q.updateAudioProgress(id, JSON.stringify(audioProgressPatch(input, now)), now))
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

    const patch = overlayCodec.preferencesPatch(record, packedLocation, new Date().toISOString())

    this.sql.run(q.patchSessionPreferences(record.bookId, JSON.stringify(patch), new Date().toISOString()))
  }

  /** Full overwrite of the reading state, guarded against out-of-order writes. */
  async saveSessionState(s: ReadingSessionState): Promise<void> {
    const updatedAt = s.updatedAt || new Date().toISOString()
    const state = overlayCodec.readingStateOfSession(s, updatedAt, packSessionLocation(s.lastReadLocation, s.lastReadLabel))

    // Renderer-side autosave already serializes writes to a single in-flight IPC call (see
    // useReadingSessionAutosave's inFlightRef chain), so the `AND …` guard below is
    // defense-in-depth, not the primary ordering mechanism: it protects against any future
    // caller that bypasses that hook (a second window, a sync engine) firing two
    // saveSessionState calls whose IPC responses resolve out of send order. updatedAt is an
    // ISO-8601 string (fixed-width, so plain text comparison is chronological); a write older
    // than the state already on disk is silently dropped instead of clobbering it. It compares
    // the state's own updatedAt, not books.updated_at, which metadata edits also bump.
    this.sql.run(q.overwriteSessionState(s.bookId, JSON.stringify(state), new Date().toISOString(), updatedAt))
  }

  async listBookmarks(bookId: string): Promise<BookmarkRecord[]> {
    const id = bookId.trim()
    if (!id) return []

    const rows = this.sql.all<NoteRow>(q.selectBookmarks(id))

    return rows
      .map(overlayCodec.bookmarkFromRow)
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
      ? this.sql.get<{ created_at: string }>(q.selectNoteCreatedAt(existingId, bookId))?.created_at
      : undefined
    const createdAt = input.createdAt?.trim() || existingCreatedAt || now

    const label = input.label?.trim() || undefined
    const excerpt = input.excerpt?.trim() || undefined
    const noteJson = overlayCodec.buildBookmarkNoteJson({
      locator: input.locator,
      label,
      excerpt,
      createdAt,
      modifiedAt: now,
    })

    // The upsert's guard keeps an id that belongs to an annotation row from being converted into a bookmark.
    const result = this.sql.run(q.upsertBookmark(id, bookId, noteJson, createdAt, now))

    if (result.changes === 0) {
      throw new Error(`saveBookmark: note ${id} exists but is not a bookmark`)
    }

    return { id, bookId, locator: input.locator, label, excerpt, createdAt }
  }

  async deleteBookmark(bookId: string, id: string): Promise<boolean> {
    const book = bookId.trim()
    const noteId = id.trim()
    if (!book || !noteId) return false

    const result = this.sql.run(q.deleteBookmark(noteId, book))

    return result.changes > 0
  }

  async listHighlights(bookId: string): Promise<HighlightRecord[]> {
    const id = bookId.trim()
    if (!id) return []

    const rows = this.sql.all<NoteRow>(q.selectHighlights(id))

    return rows
      .map(overlayCodec.highlightFromRow)
      .filter((h): h is HighlightRecord => h !== undefined)
  }

  /**
   * Annotation rows of a book exactly as stored (parsed `note_json`), for export — the same rows as
   * `listHighlights` but without re-validation or reshaping, so every stored field can be carried into
   * the annotations file (specs/006-annotation-import-export). Read-only; rows with unreadable JSON are skipped.
   */
  listAnnotationsForTransfer(bookId: string): TransferNoteRow[] {
    const id = bookId.trim()
    if (!id) return []
    const rows = this.sql.all<NoteRow>(q.selectHighlights(id))
    const out: TransferNoteRow[] = []
    for (const row of rows) {
      try {
        out.push({ id: row.id, bookId: row.book_id, createdAt: row.created_at, updatedAt: row.updated_at, note: JSON.parse(row.note_json) as INoteState })
      } catch {
        // A row whose JSON cannot be read cannot be exported; it stays in the database untouched.
      }
    }
    return out
  }

  /** How many annotation rows a book has (what Export would write) — enables or disables the menu item. */
  countAnnotationsForTransfer(bookId: string): number {
    const id = bookId.trim()
    if (!id) return 0
    const row = this.sql.get<{ n: number }>(q.countHighlights(id)) as { n: number }
    return row.n
  }

  /**
   * A fingerprint of a book's annotation rows — their ids and last-change times, read straight from the columns (no JSON
   * parsing, so it is cheap even for thousands of rows). `writeHighlight` stamps `updated_at` on every save and the sync paths
   * save through it, so an added, removed or edited annotation changes the stamp. The import compares it inside its transaction
   * to prove that nothing changed since the preview.
   */
  annotationStamp(bookId: string): string {
    const id = bookId.trim()
    const hash = createHash('sha256')
    if (!id) return hash.digest('hex')
    const rows = this.sql.all<{ id: string; updated_at: string }>(q.selectHighlightStamps(id))
    for (const r of rows) hash.update(r.id).update('\u0000').update(r.updated_at).update('\n')
    return `${rows.length}:${hash.digest('hex')}`
  }

  /** Which of these note ids already exist in ANY book (a reused id would be overwritten by `writeHighlight`'s upsert). */
  existingNoteIds(ids: readonly string[]): Set<string> {
    const found = new Set<string>()
    for (const id of ids) if (this.sql.get(q.selectNoteIdExists(id))) found.add(id)
    return found
  }

  async saveHighlight(input: SaveHighlightInput): Promise<HighlightRecord> {
    return this.writeHighlight(input)
  }

  /** Is `id` a file-attachment row of `bookId`? Those are written only by the attachment operations and the live sync (specs/007). */
  isAttachmentRow(bookId: string, id: string): boolean {
    return this.sql.get<{ hit: number }>(q.selectIsAttachment(id.trim(), bookId.trim())) !== undefined
  }

  /** Is `id` an annotation row (any kind) of `bookId`? */
  hasAnnotationRow(bookId: string, id: string): boolean {
    return this.sql.get<{ hit: number }>(q.selectIsAnnotation(id.trim(), bookId.trim())) !== undefined
  }

  /** A file-attachment row of `bookId` (specs/007), or undefined. */
  getAttachmentRow(bookId: string, id: string): HighlightRecord | undefined {
    const row = this.sql.get<NoteRow>(q.selectAttachmentRow(id.trim(), bookId.trim()))
    return row ? overlayCodec.highlightFromRow(row) : undefined
  }

  /**
   * After a verified move / delete of a file attachment in the PDF (attachments:change, contracts §2): ONE
   * transaction rewriting the row (move) or removing it with its sync-ledger entries (delete). A moved row keeps
   * its ledger entry; the next sync cycle re-records it from the file, which is authoritative for attachments.
   */
  commitAttachmentChange(bookId: string, rowId: string, change: { op: 'move'; input: SaveHighlightInput } | { op: 'delete' }): HighlightRecord | null {
    const book = bookId.trim()
    const id = rowId.trim()
    return this.sql.transaction(() => {
      let result: HighlightRecord | null = null
      if (change.op === 'move') result = this.writeHighlight({ ...change.input, id, bookId: book })
      else {
        this.sql.run(q.deleteLedgerByNote(book, id))
        this.deleteHighlightRow(book, id)
      }
      return result
    }, 'immediate')
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
      ? this.sql.get<{ created_at: string }>(q.selectNoteCreatedAt(existingId, bookId))?.created_at
      : undefined
    const createdAt = input.createdAt?.trim() || existingCreatedAt || now

    const note = input.styleKind === 'typewriter' ? input.note : input.note?.trim() || undefined
    const noteJson = overlayCodec.buildHighlightNoteJson({
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

    // The upsert's guard keeps an id that belongs to a bookmark row from being converted into a highlight.
    const result = this.sql.run(q.upsertHighlight(id, bookId, noteJson, createdAt, now))

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
    const rows = this.sql.all<NoteRow>(q.selectInk(id))
    return rows.map(overlayCodec.inkFromRow).filter((r): r is PdfInkRecord => r !== undefined)
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
      ? this.sql.get<{ created_at: string }>(q.selectNoteCreatedAt(existingId, bookId))?.created_at
      : undefined
    const createdAt = input.createdAt?.trim() || existingCreatedAt || now
    // The upsert's guard keeps another kind of row (highlight, bookmark) from being converted into a stroke.
    const noteJson = overlayCodec.buildInkNoteJson({ locator: input.locator, colorHex: input.colorHex, opacity: input.opacity, ink: input.ink, createdAt, modifiedAt: now })
    const result = this.sql.run(q.upsertInk(id, bookId, noteJson, createdAt, now))
    if (result.changes === 0) return null
    return { id, bookId, locator: input.locator, colorHex: input.colorHex, opacity: input.opacity, ink: input.ink, createdAt, updatedAt: now }
  }

  async deleteInk(bookId: string, id: string): Promise<boolean> {
    const book = bookId.trim()
    const noteId = id.trim()
    if (!book || !noteId) return false
    return this.sql.run(q.deleteInk(noteId, book)).changes > 0
  }

  async deleteHighlight(bookId: string, id: string): Promise<boolean> {
    return this.deleteHighlightRow(bookId, id)
  }

  /** `deleteHighlight`'s synchronous body (also run inside the TXT commit transaction). */
  deleteHighlightRow(bookId: string, id: string): boolean {
    const book = bookId.trim()
    const noteId = id.trim()
    if (!book || !noteId) return false

    const result = this.sql.run(q.deleteHighlight(noteId, book))

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
    const rows = this.sql.all<{ source_key: string; note_id: string; source_hash: string; note_hash: string; base_json: string | null; conflict_json: string | null }>(
      q.selectTwoWayLedger(bookId.trim()),
    )
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
    this.sql.transaction(() => {
      for (const entry of entries) {
        const conflict = entry.conflict!
        if (choice === 'use-pdf') {
          if (conflict.kind === 'removed-in-file' || !conflict.item) {
            this.sql.run(q.deleteHighlight(noteId, book))
            this.sql.run(q.deleteLedgerByKey(book, entry.sourceKey))
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
            this.sql.run(q.deleteLedgerByKey(book, entry.sourceKey))
          } else if (conflict.item) {
            // Base = the file as it is now + an app side that differs from the row: the next cycle sees
            // only the app side as changed and rewrites the file annotation from the row.
            const base = syncBase(conflict.item, current)
            const forcedApp = { kind: base.app.kind, color: '\u0000', text: '\u0000', geometry: '\u0000' }
            this.sql.run(q.updateLedgerBase(book, entry.sourceKey, JSON.stringify({ file: base.file, app: forcedApp }), new Date().toISOString()))
          }
          result.updated = current
        }
      }
    }, 'immediate')
    return result
  }

  private listHighlightRecordsSync(bookId: string): HighlightRecord[] {
    const rows = this.sql.all<NoteRow>(q.selectHighlights(bookId))
    return rows.map(overlayCodec.highlightFromRow).filter((h): h is HighlightRecord => h !== undefined)
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
    this.sql.run(
      q.upsertTwoWayLedger(
        bookId,
        key,
        noteId,
        embeddedAnnotationSourceHash(item),
        highlightContentHash(row),
        JSON.stringify(syncBase(item, row)),
        conflict ? JSON.stringify(conflict) : null,
        now,
      ),
    )
  }

  /**
   * Apply a two-way plan (SDK `planTwoWaySync`) in ONE transaction. `items` is the scan the plan was
   * made from; `after` the read-back scan of the file once the plan's file operations were written,
   * or null when nothing was written (write not needed, or it failed — then everything that depends
   * on the write is left for the next cycle). Returns null when `bookId` is not a PDF.
   */
  applyTwoWaySync(bookId: string, plan: TwoWayPlan, items: readonly ScannedPdfAnnotation[], after: readonly ScannedPdfAnnotation[] | null): TwoWaySyncOutcome | null {
    const book = bookId.trim()
    const row = this.sql.get<{ file_format: string }>(q.selectBookFormat(book))
    if (!row || row.file_format !== 'pdf') return null
    const outcome: TwoWaySyncOutcome = { inserted: [], updated: [], deleted: [], conflicts: [] }
    const keys = embeddedAnnotationIdentities(items).map((i) => i.key)
    const itemByKey = new Map(keys.map((k, i) => [k, items[i]!]))
    const writtenIds = new Set(plan.writtenRows.map((w) => w.noteId))
    const wrote = after !== null
    const dropLedger = (bookId: string, key: string): void => {
      this.sql.run(q.deleteLedgerByKey(bookId, key))
    }

    this.sql.transaction(() => {
      for (const noteId of plan.rowDeletes) {
        if (this.sql.run(q.deleteHighlight(noteId, book)).changes > 0) outcome.deleted.push(noteId)
      }
      for (const key of plan.ledgerDrops) dropLedger(book, key)
      if (wrote) for (const key of plan.ledgerDropsAfterWrite) dropLedger(book, key)

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
        this.sql.run(q.setLedgerConflict(book, key, JSON.stringify(conflict), new Date().toISOString()))
        outcome.conflicts.push({ noteId, conflict })
      }
      for (const key of plan.conflictsCleared) {
        this.sql.run(q.clearLedgerConflict(book, key))
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
          for (const key of oldKeys) dropLedger(book, key)
          // The base / hash record what was WRITTEN: an edit made meanwhile stays "changed" and is
          // written by the next cycle.
          after.forEach((item, i) => {
            if (item.nm && names.includes(item.nm)) this.upsertTwoWayLedger(book, afterKeys[i]!, noteId, item, written, null)
          })
        }
      }
    }, 'immediate')
    return outcome
  }

  /** The book's import-ledger rows (which embedded annotation became which `notes` row). */
  listEmbeddedLedger(bookId: string): EmbeddedAnnotationLedgerEntry[] {
    const rows = this.sql.all<{ source_key: string; note_id: string; source_hash: string; note_hash: string }>(q.selectEmbeddedLedger(bookId.trim()))
    return rows.map((r) => ({ sourceKey: r.source_key, noteId: r.note_id, sourceHash: r.source_hash, noteHash: r.note_hash }))
  }

  syncEmbeddedPdfAnnotations(
    bookId: string,
    items: readonly ScannedPdfAnnotation[],
    options: EmbeddedAnnotationSyncOptions = {},
  ): EmbeddedPdfSyncOutcome | null {
    const book = bookId.trim()
    const row = this.sql.get<{ file_format: string }>(q.selectBookFormat(book))
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

    this.sql.transaction(() => {
      const ledger = new Map<string, EmbeddedAnnotationLedgerEntry>()
      const ledgerRows = this.sql.all<{ source_key: string; note_id: string; source_hash: string; note_hash: string }>(q.selectEmbeddedLedger(book))
      for (const r of ledgerRows) {
        ledger.set(r.source_key, { sourceKey: r.source_key, noteId: r.note_id, sourceHash: r.source_hash, noteHash: r.note_hash })
      }
      const current = new Map<string, HighlightRecord>()
      const noteRows = this.sql.all<NoteRow>(q.selectHighlightsUnordered(book))
      for (const noteRow of noteRows) {
        const record = overlayCodec.highlightFromRow(noteRow)
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
      const write = (step: EmbeddedAnnotationSyncStep, noteId: string | undefined): HighlightRecord => {
        const highlight = highlightFromEmbeddedAnnotation(step.item)
        const saved = this.writeHighlight({ ...highlight, id: noteId, bookId: book })
        this.sql.run(
          q.upsertEmbeddedLedger(book, step.key, saved.id, embeddedAnnotationSourceHash(step.item), highlightContentHash(saved), now),
        )
        return saved
      }
      for (const { from, to } of plan.rekeys) this.sql.run(q.rekeyLedger(book, from, to, now))
      for (const step of plan.inserts) outcome.inserted.push(write(step, undefined))
      for (const step of plan.updates) outcome.updated.push(write(step, step.noteId))

      for (const { key, noteId } of plan.deletions) {
        if (this.sql.run(q.deleteHighlight(noteId, book)).changes > 0) outcome.deleted.push(noteId)
        this.sql.run(q.deleteLedgerByKey(book, key))
      }
      for (const key of plan.tombstonesCleared) this.sql.run(q.deleteLedgerByKey(book, key))

      outcome.unchanged = plan.unchanged
      outcome.keptAppEdits = plan.keptAppEdits
      outcome.dismissed = plan.dismissed
      outcome.managedIndices = plan.managed
      outcome.rekeyed = plan.rekeys.length
      outcome.keptAppEditsOnRemoval = plan.keptAppEditsOnRemoval
    }, 'immediate')
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

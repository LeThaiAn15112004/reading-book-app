/**
 * SQL of the overlay stores (reading state, bookmarks, highlights, ink, the embedded-annotation ledger) as `Statement`
 * builders with positional `?`, shared by Desktop's `SqliteOverlayStore` and Mobile's `MobileOverlayStore`
 * (spec 009 T033). The stores keep their own control flow, validation and transactions. No driver, no I/O.
 */
import type { SqlValue, Statement } from '../driver.js'

const s = (sql: string, ...params: SqlValue[]): Statement => ({ sql, params })

export const NOTE_COLUMNS = 'id, book_id, note_json, created_at, updated_at'

/**
 * Bookmark rows are `notes` rows whose `note_json.group` is `'bookmark'` (migration 019). A missing `group` means
 * `'annotation'`, and `json_extract` yields NULL there; the text matches the expression index `idx_notes_group`.
 */
export const BOOKMARK_GROUP_PREDICATE = `json_extract(note_json, '$.group') = 'bookmark'`

/** Rows that are annotations (group `annotation` or absent), whatever their type. */
export const ANNOTATION_GROUP_GUARD = `(json_extract(note_json, '$.group') IS NULL OR json_extract(note_json, '$.group') = 'annotation')`

/**
 * Highlight rows: group `'annotation'` (or absent) and a type this feature supports. The explicit `type IN (...)` keeps
 * legacy freehand/textbox/stamp rows out of every highlight query.
 */
export const HIGHLIGHT_TYPE_PREDICATE = `
  (json_extract(note_json, '$.group') IS NULL OR json_extract(note_json, '$.group') = 'annotation')
  AND json_extract(note_json, '$.type') IN ('highlight', 'underline', 'strikethrough', 'squiggly', 'replace', 'insert', 'textbox', 'rectangle', 'ellipse', 'line', 'arrow', 'typewriter', 'attachment')
`

/** PDF freehand Ink rows (`type` `ink`); deliberately not part of `HIGHLIGHT_TYPE_PREDICATE`. */
export const INK_TYPE_PREDICATE = `json_extract(note_json, '$.type') = 'ink'`

const AUDIO_FORMATS_SQL = `('mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus')`

// --- reading state (books.reading_state_json) ----------------------------------------------------------------------

export const selectReadingStateRow = (bookId: string) => s('SELECT reading_state_json, updated_at FROM books WHERE id = ?', bookId)
export const selectFormatAndReadingState = (bookId: string) => s('SELECT file_format, reading_state_json FROM books WHERE id = ?', bookId)
export const selectBookFormat = (bookId: string) => s('SELECT file_format FROM books WHERE id = ?', bookId)
export const selectChapterOfBook = (chapterId: string, bookId: string) =>
  s('SELECT 1 FROM book_audio_chapters WHERE id = ? AND book_id = ?', chapterId, bookId)

/** Listening progress `json_patch`, restricted to audio books in SQL itself. */
export const updateAudioProgress = (bookId: string, patchJson: string, now: string) =>
  s(
    `UPDATE books
     SET reading_state_json = json_patch(reading_state_json, ?),
         updated_at = ?
     WHERE id = ? AND file_format IN ${AUDIO_FORMATS_SQL}`,
    patchJson,
    now,
    bookId,
  )

/** Settings-only / partial save: merge into the stored state (RFC 7396). */
export const patchSessionPreferences = (bookId: string, patchJson: string, now: string) =>
  s('UPDATE books SET reading_state_json = json_patch(reading_state_json, ?), updated_at = ? WHERE id = ?', patchJson, now, bookId)

/** Full overwrite, dropped when older than the stored state's own `updatedAt` (ISO-8601 text compares chronologically). */
export const overwriteSessionState = (bookId: string, stateJson: string, now: string, stateUpdatedAt: string) =>
  s(
    `UPDATE books
     SET reading_state_json = ?,
         updated_at = ?
     WHERE id = ?
       AND COALESCE(json_extract(reading_state_json, '$.updatedAt'), '') <= ?`,
    stateJson,
    now,
    bookId,
    stateUpdatedAt,
  )

// --- notes: reads --------------------------------------------------------------------------------------------------

export const selectNoteCreatedAt = (id: string, bookId: string) => s('SELECT created_at FROM notes WHERE id = ? AND book_id = ?', id, bookId)
export const selectNoteIdExists = (id: string) => s('SELECT id FROM notes WHERE id = ?', id)
export const selectBookmarks = (bookId: string) =>
  s(`SELECT ${NOTE_COLUMNS} FROM notes WHERE book_id = ? AND ${BOOKMARK_GROUP_PREDICATE} ORDER BY created_at ASC`, bookId)
export const selectHighlights = (bookId: string) =>
  s(`SELECT ${NOTE_COLUMNS} FROM notes WHERE book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE} ORDER BY created_at ASC`, bookId)
/** Highlights in table order (the embedded-annotation sync does not care about the order). */
export const selectHighlightsUnordered = (bookId: string) =>
  s(`SELECT ${NOTE_COLUMNS} FROM notes WHERE book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE}`, bookId)
export const countHighlights = (bookId: string) => s(`SELECT COUNT(*) AS n FROM notes WHERE book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE}`, bookId)
export const selectHighlightStamps = (bookId: string) =>
  s(`SELECT id, updated_at FROM notes WHERE book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE} ORDER BY id`, bookId)
export const selectIsAttachment = (id: string, bookId: string) =>
  s(`SELECT 1 AS hit FROM notes WHERE id = ? AND book_id = ? AND json_extract(note_json, '$.type') = 'attachment'`, id, bookId)
export const selectIsAnnotation = (id: string, bookId: string) =>
  s(`SELECT 1 AS hit FROM notes WHERE id = ? AND book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE}`, id, bookId)
export const selectAttachmentRow = (id: string, bookId: string) =>
  s(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ? AND book_id = ? AND json_extract(note_json, '$.type') = 'attachment'`, id, bookId)
export const selectInk = (bookId: string) =>
  s(`SELECT ${NOTE_COLUMNS} FROM notes WHERE book_id = ? AND ${INK_TYPE_PREDICATE} ORDER BY created_at ASC, rowid ASC`, bookId)

// --- notes: writes -------------------------------------------------------------------------------------------------

const upsertNote = (guard: string, id: string, bookId: string, noteJson: string, createdAt: string, updatedAt: string) =>
  s(
    `INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET note_json = excluded.note_json, updated_at = excluded.updated_at
     WHERE ${guard}`,
    id,
    bookId,
    noteJson,
    createdAt,
    updatedAt,
  )

/** Insert or update a bookmark; an id that belongs to an annotation row is never converted (0 changes). */
export const upsertBookmark = (id: string, bookId: string, noteJson: string, createdAt: string, updatedAt: string) =>
  upsertNote(BOOKMARK_GROUP_PREDICATE, id, bookId, noteJson, createdAt, updatedAt)

/** Insert or update an annotation; an id that belongs to a bookmark row is never converted (0 changes). */
export const upsertHighlight = (id: string, bookId: string, noteJson: string, createdAt: string, updatedAt: string) =>
  upsertNote(ANNOTATION_GROUP_GUARD, id, bookId, noteJson, createdAt, updatedAt)

/** Insert or update an ink stroke of THIS book; another kind of row is never converted (0 changes). */
export const upsertInk = (id: string, bookId: string, noteJson: string, createdAt: string, updatedAt: string) =>
  s(
    `INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET note_json = excluded.note_json, updated_at = excluded.updated_at
     WHERE ${INK_TYPE_PREDICATE} AND book_id = ?`,
    id,
    bookId,
    noteJson,
    createdAt,
    updatedAt,
    bookId,
  )

export const deleteBookmark = (id: string, bookId: string) =>
  s(`DELETE FROM notes WHERE id = ? AND book_id = ? AND ${BOOKMARK_GROUP_PREDICATE}`, id, bookId)
export const deleteHighlight = (id: string, bookId: string) =>
  s(`DELETE FROM notes WHERE id = ? AND book_id = ? AND ${HIGHLIGHT_TYPE_PREDICATE}`, id, bookId)
export const deleteInk = (id: string, bookId: string) =>
  s(`DELETE FROM notes WHERE id = ? AND book_id = ? AND ${INK_TYPE_PREDICATE}`, id, bookId)

// --- pdf_embedded_annotations (the sync ledger) --------------------------------------------------------------------

export const selectEmbeddedLedger = (bookId: string) =>
  s('SELECT source_key, note_id, source_hash, note_hash FROM pdf_embedded_annotations WHERE book_id = ?', bookId)
export const selectTwoWayLedger = (bookId: string) =>
  s('SELECT source_key, note_id, source_hash, note_hash, base_json, conflict_json FROM pdf_embedded_annotations WHERE book_id = ?', bookId)
export const deleteLedgerByNote = (bookId: string, noteId: string) =>
  s('DELETE FROM pdf_embedded_annotations WHERE book_id = ? AND note_id = ?', bookId, noteId)
export const deleteLedgerByKey = (bookId: string, sourceKey: string) =>
  s('DELETE FROM pdf_embedded_annotations WHERE book_id = ? AND source_key = ?', bookId, sourceKey)
export const rekeyLedger = (bookId: string, from: string, to: string, now: string) =>
  s('UPDATE pdf_embedded_annotations SET source_key = ?, synced_at = ? WHERE book_id = ? AND source_key = ?', to, now, bookId, from)

/** Import ledger upsert (no two-way base / conflict columns). */
export const upsertEmbeddedLedger = (bookId: string, sourceKey: string, noteId: string, sourceHash: string, noteHash: string, now: string) =>
  s(
    `INSERT INTO pdf_embedded_annotations
       (book_id, source_key, note_id, source_hash, note_hash, imported_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_id, source_key) DO UPDATE SET
       note_id = excluded.note_id,
       source_hash = excluded.source_hash,
       note_hash = excluded.note_hash,
       synced_at = excluded.synced_at`,
    bookId,
    sourceKey,
    noteId,
    sourceHash,
    noteHash,
    now,
    now,
  )

/** Two-way ledger upsert: hashes, the base snapshot and the open conflict (or NULL). */
export const upsertTwoWayLedger = (
  bookId: string,
  sourceKey: string,
  noteId: string,
  sourceHash: string,
  noteHash: string,
  baseJson: string,
  conflictJson: string | null,
  now: string,
) =>
  s(
    `INSERT INTO pdf_embedded_annotations
       (book_id, source_key, note_id, source_hash, note_hash, base_json, conflict_json, imported_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_id, source_key) DO UPDATE SET
       note_id = excluded.note_id, source_hash = excluded.source_hash, note_hash = excluded.note_hash,
       base_json = excluded.base_json, conflict_json = excluded.conflict_json, synced_at = excluded.synced_at`,
    bookId,
    sourceKey,
    noteId,
    sourceHash,
    noteHash,
    baseJson,
    conflictJson,
    now,
    now,
  )

export const updateLedgerBase = (bookId: string, sourceKey: string, baseJson: string, now: string) =>
  s('UPDATE pdf_embedded_annotations SET base_json = ?, conflict_json = NULL, synced_at = ? WHERE book_id = ? AND source_key = ?', baseJson, now, bookId, sourceKey)
export const setLedgerConflict = (bookId: string, sourceKey: string, conflictJson: string, now: string) =>
  s('UPDATE pdf_embedded_annotations SET conflict_json = ?, synced_at = ? WHERE book_id = ? AND source_key = ?', conflictJson, now, bookId, sourceKey)
export const clearLedgerConflict = (bookId: string, sourceKey: string) =>
  s('UPDATE pdf_embedded_annotations SET conflict_json = NULL WHERE book_id = ? AND source_key = ?', bookId, sourceKey)

/**
 * SQL of the TXT edited-copy table (`txt_documents`, migration 025) as `Statement` builders (spec 009 T034). Desktop
 * only: Mobile opens TXT read-only and has no revisions. No driver, no I/O.
 */
import type { SqlValue, Statement } from '../driver.js'
import type { TxtDocumentValues } from './codec.js'

const s = (sql: string, ...params: SqlValue[]): Statement => ({ sql, params })

export const selectTxtDocument = (bookId: string) =>
  s(
    `SELECT book_id, revision, content_sha256, char_count, source_sha256, updated_at
     FROM txt_documents WHERE book_id = ?`,
    bookId,
  )

/**
 * Insert the first revision or move an existing book to the next one. `source_sha256` (the hash of the user's original
 * file) is written once and kept: `COALESCE(txt_documents.source_sha256, ?)`.
 */
export const upsertTxtDocument = (bookId: string, next: TxtDocumentValues, updatedAt: string) =>
  s(
    `INSERT INTO txt_documents (book_id, revision, content_sha256, char_count, source_sha256, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET
       revision = excluded.revision,
       content_sha256 = excluded.content_sha256,
       char_count = excluded.char_count,
       source_sha256 = COALESCE(txt_documents.source_sha256, excluded.source_sha256),
       updated_at = excluded.updated_at`,
    bookId,
    next.revision,
    next.contentSha256,
    next.charCount,
    next.sourceSha256 ?? null,
    updatedAt,
  )

/** Which book a note id belongs to (ownership check before an upsert; ids are global in `notes`). */
export const selectNoteOwner = (noteId: string) => s('SELECT book_id FROM notes WHERE id = ?', noteId)

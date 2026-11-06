import { txtCodec, txtStatements as q, type SaveHighlightInput, type SyncSqlDriver } from '@core'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { getDatabase } from './db'
import { getOverlayStore, type SqliteOverlayStore } from './sqlite-overlay-store'
import { createSyncSqlDriver } from './sql-driver'

/** The committed edited copy of one TXT book (`txt_documents`). */
export type TxtDocumentRow = txtCodec.TxtDocumentRow

/** Thrown inside `commit` when the stored revision isn't the one the caller based its change on. */
export class TxtRevisionConflictError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`TXT revision conflict: expected ${expected}, stored ${actual}`)
    this.name = 'TxtRevisionConflictError'
  }
}

/** Thrown when an annotation id already belongs to another book / a bookmark. */
export class TxtRowOwnershipError extends Error {
  constructor(readonly noteId: string) {
    super(`TXT annotation id ${noteId} belongs to another note`)
    this.name = 'TxtRowOwnershipError'
  }
}

export interface TxtCommitWrite {
  bookId: string
  /** Revision the change is based on; the stored one must still equal it. */
  expectedRevision: number
  /** Present when the text changed: the new current revision's description. */
  nextDocument?: txtCodec.TxtDocumentValues
  upserts: readonly SaveHighlightInput[]
  deletedIds: readonly string[]
}

/**
 * Persistence of TXT edits: which revision of the book's edited copy is current, and the annotation
 * rows (ordinary `notes` rows, written through the overlay store) that refer to it. `commit` moves
 * both in ONE transaction, so the offsets in `notes` always belong to the revision in
 * `txt_documents` — see docs/implementation_plan/txt_reader.md §5.
 */
export class SqliteTxtStore {
  private readonly sql: SyncSqlDriver

  constructor(
    db: SqliteDatabase = getDatabase(),
    private readonly overlays: SqliteOverlayStore = getOverlayStore(),
  ) {
    this.sql = createSyncSqlDriver(db)
  }

  getDocument(bookId: string): TxtDocumentRow | undefined {
    const row = this.sql.get<txtCodec.TxtDocumentSqlRow>(q.selectTxtDocument(bookId))
    return row ? txtCodec.txtDocumentFromRow(row) : undefined
  }

  /** Revision 0 = the original file (no edited copy yet). */
  currentRevision(bookId: string): number {
    return this.getDocument(bookId)?.revision ?? 0
  }

  /** All-or-nothing: the revision row, the upserted annotation rows and the deleted ones. */
  commit(write: TxtCommitWrite): void {
    const { bookId } = write
    this.sql.transaction(() => {
      const actual = this.currentRevision(bookId)
      if (actual !== write.expectedRevision) throw new TxtRevisionConflictError(write.expectedRevision, actual)

      if (write.nextDocument) {
        this.sql.run(q.upsertTxtDocument(bookId, write.nextDocument, new Date().toISOString()))
      }

      for (const input of write.upserts) {
        const existing = input.id ? this.sql.get<{ book_id: string }>(q.selectNoteOwner(input.id)) : undefined
        if (existing && existing.book_id !== bookId) throw new TxtRowOwnershipError(input.id!)
        this.overlays.writeHighlight({ ...input, bookId })
      }
      for (const id of write.deletedIds) this.overlays.deleteHighlightRow(bookId, id)
    }, 'immediate')
  }
}

let txtStore: SqliteTxtStore | null = null

/** Singleton TXT store backed by the open SQLite DB. */
export function getTxtStore(): SqliteTxtStore {
  if (!txtStore) txtStore = new SqliteTxtStore()
  return txtStore
}

import type { SaveHighlightInput } from '@reading-book/book-reader-sdk'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { getDatabase } from './db'
import { getOverlayStore, type SqliteOverlayStore } from './sqlite-overlay-store'

/** The committed edited copy of one TXT book (`txt_documents`). */
export interface TxtDocumentRow {
  bookId: string
  revision: number
  contentSha256: string
  charCount: number
  sourceSha256?: string
  updatedAt: string
}

interface TxtDocumentSqlRow {
  book_id: string
  revision: number
  content_sha256: string
  char_count: number
  source_sha256: string | null
  updated_at: string
}

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
  nextDocument?: Omit<TxtDocumentRow, 'bookId' | 'updatedAt'>
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
  constructor(
    private readonly db: SqliteDatabase = getDatabase(),
    private readonly overlays: SqliteOverlayStore = getOverlayStore(),
  ) {}

  getDocument(bookId: string): TxtDocumentRow | undefined {
    const row = this.db
      .prepare(
        `SELECT book_id, revision, content_sha256, char_count, source_sha256, updated_at
         FROM txt_documents WHERE book_id = ?`,
      )
      .get(bookId) as TxtDocumentSqlRow | undefined
    if (!row) return undefined
    return {
      bookId: row.book_id,
      revision: row.revision,
      contentSha256: row.content_sha256,
      charCount: row.char_count,
      sourceSha256: row.source_sha256 ?? undefined,
      updatedAt: row.updated_at,
    }
  }

  /** Revision 0 = the original file (no edited copy yet). */
  currentRevision(bookId: string): number {
    return this.getDocument(bookId)?.revision ?? 0
  }

  /** All-or-nothing: the revision row, the upserted annotation rows and the deleted ones. */
  commit(write: TxtCommitWrite): void {
    const { bookId } = write
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const actual = this.currentRevision(bookId)
      if (actual !== write.expectedRevision) throw new TxtRevisionConflictError(write.expectedRevision, actual)

      const now = new Date().toISOString()
      if (write.nextDocument) {
        this.db
          .prepare(
            `INSERT INTO txt_documents (book_id, revision, content_sha256, char_count, source_sha256, updated_at)
             VALUES (@book_id, @revision, @content_sha256, @char_count, @source_sha256, @updated_at)
             ON CONFLICT(book_id) DO UPDATE SET
               revision = @revision,
               content_sha256 = @content_sha256,
               char_count = @char_count,
               source_sha256 = COALESCE(txt_documents.source_sha256, @source_sha256),
               updated_at = @updated_at`,
          )
          .run({
            book_id: bookId,
            revision: write.nextDocument.revision,
            content_sha256: write.nextDocument.contentSha256,
            char_count: write.nextDocument.charCount,
            source_sha256: write.nextDocument.sourceSha256 ?? null,
            updated_at: now,
          })
      }

      const owner = this.db.prepare(`SELECT book_id FROM notes WHERE id = ?`)
      for (const input of write.upserts) {
        const existing = input.id ? (owner.get(input.id) as { book_id: string } | undefined) : undefined
        if (existing && existing.book_id !== bookId) throw new TxtRowOwnershipError(input.id!)
        this.overlays.writeHighlight({ ...input, bookId })
      }
      for (const id of write.deletedIds) this.overlays.deleteHighlightRow(bookId, id)

      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }
}

let txtStore: SqliteTxtStore | null = null

/** Singleton TXT store backed by the open SQLite DB. */
export function getTxtStore(): SqliteTxtStore {
  if (!txtStore) txtStore = new SqliteTxtStore()
  return txtStore
}

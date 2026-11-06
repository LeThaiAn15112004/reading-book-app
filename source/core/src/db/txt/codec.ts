/** `txt_documents` row ⇄ domain (spec 009 T034). Pure. */

/** The committed edited copy of one TXT book (`txt_documents`). */
export interface TxtDocumentRow {
  bookId: string
  revision: number
  contentSha256: string
  charCount: number
  sourceSha256?: string
  updatedAt: string
}

/** What a commit writes for the new current revision. */
export type TxtDocumentValues = Omit<TxtDocumentRow, 'bookId' | 'updatedAt'>

export interface TxtDocumentSqlRow {
  book_id: string
  revision: number
  content_sha256: string
  char_count: number
  source_sha256: string | null
  updated_at: string
}

export function txtDocumentFromRow(row: TxtDocumentSqlRow): TxtDocumentRow {
  return {
    bookId: row.book_id,
    revision: row.revision,
    contentSha256: row.content_sha256,
    charCount: row.char_count,
    sourceSha256: row.source_sha256 ?? undefined,
    updatedAt: row.updated_at,
  }
}

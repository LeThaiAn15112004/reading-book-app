import type { Database } from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { countSearchWords } from '@reading-book/book-reader-sdk'
import type { TextChunk } from '@reading-book/book-reader-sdk'

/** Deterministic id: the same book text always yields the same row ids (idempotent re-runs). */
export function chunkId(bookId: string, chunk: TextChunk): string {
  return createHash('sha1')
    .update(bookId)
    .update('\n')
    .update(String(chunk.chunkIndex))
    .update('\n')
    .update(chunk.content)
    .digest('hex')
}

/** Cheap "was this book already chunked?" probe — stops at the first row of the index. */
export function hasBookChunks(db: Database, bookId: string): boolean {
  return db.prepare('SELECT 1 FROM book_chunks WHERE book_id = ? LIMIT 1').get(bookId) !== undefined
}

/**
 * Insert every chunk of a book inside ONE transaction (all-or-nothing, and one fsync instead of
 * one per row). Re-checks emptiness inside the write transaction so two racing workers can never
 * leave a book half-duplicated. Returns the number of rows written (0 when already chunked).
 */
export function insertBookChunks(db: Database, bookId: string, chunks: readonly TextChunk[]): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO book_chunks
       (id, book_id, chunk_index, content, location_start, location_end,
        word_start, word_count, embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  )
  const createdAt = new Date().toISOString()
  // Counted before the write transaction so the lock is held only for the inserts.
  const wordCounts = chunks.map((chunk) => countSearchWords(chunk.content))

  // One transaction, ascending chunk_index: the book's `seq` values come out contiguous and in
  // reading order, which the FTS5 search (electron/search/book-search-query.ts) relies on.
  const write = db.transaction((): number => {
    if (hasBookChunks(db, bookId)) return 0
    let written = 0
    let wordStart = 0
    chunks.forEach((chunk, i) => {
      const wordCount = wordCounts[i] ?? 0
      written += insert.run(
        chunkId(bookId, chunk),
        bookId,
        chunk.chunkIndex,
        chunk.content,
        chunk.locationStart,
        chunk.locationEnd,
        wordStart,
        wordCount,
        createdAt,
      ).changes
      wordStart += wordCount
    })
    return written
  })

  // IMMEDIATE takes the write lock up front, so the emptiness check and the inserts are atomic.
  return write.immediate()
}

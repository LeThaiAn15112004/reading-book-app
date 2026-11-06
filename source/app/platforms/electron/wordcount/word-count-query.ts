/**
 * SQL side of the Word Count tool: streams each chunk's already-extracted `content` out of the
 * same `book_chunks` table search uses (see `../search/book-search-query.ts`, whose
 * `readBookChunkStats` gives the book's word total). No `electron` import, so it can run against
 * any better-sqlite3 connection.
 */
import type { Database, Statement } from 'better-sqlite3'

interface ChunkContentRow {
  content: string
}

const CHUNK_CONTENTS_SQL = `
  SELECT content
  FROM book_chunks
  WHERE book_id = @bookId
  ORDER BY chunk_index`

const statementsByDb = new WeakMap<Database, Statement<{ bookId: string }, ChunkContentRow>>()

function statement(db: Database): Statement<{ bookId: string }, ChunkContentRow> {
  let stmt = statementsByDb.get(db)
  if (!stmt) {
    stmt = db.prepare(CHUNK_CONTENTS_SQL)
    statementsByDb.set(db, stmt)
  }
  return stmt
}

/** Every chunk's text, in reading order — streamed (`.iterate`) rather than loaded all at once. */
export function iterateBookChunkContents(
  db: Database,
  bookId: string,
): IterableIterator<ChunkContentRow> {
  return statement(db).iterate({ bookId })
}

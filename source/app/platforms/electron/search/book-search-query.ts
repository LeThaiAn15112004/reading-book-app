/**
 * SQL side of in-book search: FTS5 narrows a book to candidate chunks, then the shared SDK matcher
 * counts exact occurrences inside them. No `electron` import, so it can run against any
 * better-sqlite3 connection (a worker thread, a script).
 *
 * Why the counting is not done in SQL: FTS5 only exposes per-row hit counts / token offsets
 * through the C auxiliary-function API (`xInstCount` / `xInst`), which better-sqlite3 cannot
 * register, and its index is case/diacritic-folded anyway. So FTS5 answers "which chunks can
 * contain the phrase" (fast, indexed, a superset), and JS answers "exactly where, with the
 * user's Match case / Match diacritics / Whole words options" over just those chunks.
 */
import type { Database, Statement } from 'better-sqlite3'
import {
  countSearchWords,
  createTextMatcher,
  toFts5MatchExpression,
  type TextMatch,
  type TextSearchQuery,
} from '@reading-book/book-reader-sdk'

export interface BookChunkStats {
  chunkCount: number
  minSeq: number | null
  maxSeq: number | null
  totalWords: number
}

/**
 * One exact occurrence. Its word number and snippet are derived later (matchWordIndex / the
 * service), only for the page actually returned — "the" can have 100k+ hits in a long book.
 */
export interface BookMatch {
  /** 1-based, reading order. */
  occurrence: number
  /** Word number of the chunk's first word within the book (`book_chunks.word_start`). */
  chunkWordStart: number
  chunkIndex: number
  chapterIndex: number
  /** 0-based rank among the matches of the same chapter. */
  chapterOccurrence: number
  chapterMatchCount: number
  /** bm25() of the containing chunk (lower = more relevant). */
  score: number
  /** Containing chunk text (shared string, not a copy) and the match's offsets in it. */
  content: string
  start: number
  end: number
}

interface CandidateRow {
  chunkIndex: number
  chapterIndex: number
  wordStart: number
  content: string
  score: number
}

/**
 * Chunk bounds + word total for one book. COUNT/MIN/MAX(seq) are answered from
 * idx_book_chunks_book_index alone (seq is the rowid, so the index covers it); the word total is
 * the last chunk's word_start + word_count — one row, instead of summing the whole book.
 */
const STATS_SQL = `
  SELECT COUNT(*) AS chunkCount,
         MIN(seq) AS minSeq,
         MAX(seq) AS maxSeq,
         COALESCE((
           SELECT last.word_start + last.word_count
           FROM book_chunks AS last
           WHERE last.book_id = @bookId
           ORDER BY last.chunk_index DESC
           LIMIT 1
         ), 0) AS totalWords
  FROM book_chunks
  WHERE book_id = @bookId`

/**
 * Candidate chunks of one book.
 *
 * - `MATCH @match` — the FTS5 phrase (see toFts5MatchExpression), e.g. `"old ma"*`.
 * - `rowid BETWEEN @minSeq AND @maxSeq` — a book's chunks are written in one transaction, so their
 *   `seq` values are contiguous; FTS5 turns a rowid range into a seek on each term's doclist
 *   instead of walking the hits of every book in the library. `c.book_id = @bookId` keeps the
 *   result exact even if a range were ever not contiguous.
 * - `bm25(book_chunks_fts)` — Okapi BM25 of the chunk for this query (negative; lower = better).
 *   Its IDF statistics are library-wide, which still ranks one book's chunks consistently.
 * - `ORDER BY rowid` — FTS5 already yields rowid order, so rows stream with no sort step. Sorting
 *   by `chunk_index` instead made SQLite copy every candidate's full text into a temp B-tree
 *   (measured: tens of ms on a long book). The writer inserts chunks in `chunk_index` order in a
 *   single transaction, so `seq` order IS reading order; findBookMatches re-sorts if not.
 * - `json_valid` guard — one malformed locator must not make json_extract abort the whole query.
 *
 * Cost profile (1M-word Vietnamese book, word present in every chunk): the FTS5 lookup is ~1 ms,
 * bm25 ~5 ms; nearly all the rest is decoding the chunks' UTF-8 text into JS strings.
 */
const CANDIDATES_SQL = `
  SELECT c.chunk_index AS chunkIndex,
         COALESCE(
           CASE WHEN json_valid(c.location_start)
                THEN json_extract(c.location_start, '$.chapterIndex') END,
           0) AS chapterIndex,
         c.word_start AS wordStart,
         c.content AS content,
         bm25(book_chunks_fts) AS score
  FROM book_chunks_fts
  JOIN book_chunks AS c ON c.seq = book_chunks_fts.rowid
  WHERE book_chunks_fts MATCH @match
    AND book_chunks_fts.rowid BETWEEN @minSeq AND @maxSeq
    AND c.book_id = @bookId
  ORDER BY book_chunks_fts.rowid`

interface Statements {
  stats: Statement<{ bookId: string }, BookChunkStats>
  candidates: Statement<
    { bookId: string; match: string; minSeq: number; maxSeq: number },
    CandidateRow
  >
}

const statementsByDb = new WeakMap<Database, Statements>()

function statements(db: Database): Statements {
  let prepared = statementsByDb.get(db)
  if (!prepared) {
    prepared = {
      stats: db.prepare(STATS_SQL),
      candidates: db.prepare(CANDIDATES_SQL),
    }
    statementsByDb.set(db, prepared)
  }
  return prepared
}

export function readBookChunkStats(db: Database, bookId: string): BookChunkStats {
  return (
    statements(db).stats.get({ bookId }) ?? {
      chunkCount: 0,
      minSeq: null,
      maxSeq: null,
      totalWords: 0,
    }
  )
}

/** Every exact occurrence of `query` in the book, in reading order. */
export function findBookMatches(
  db: Database,
  bookId: string,
  query: TextSearchQuery,
  stats: BookChunkStats,
): BookMatch[] {
  if (stats.chunkCount === 0 || stats.minSeq === null || stats.maxSeq === null) return []

  const matcher = createTextMatcher(query)
  const rows = statements(db).candidates.iterate({
    bookId,
    match: toFts5MatchExpression(query),
    minSeq: stats.minSeq,
    maxSeq: stats.maxSeq,
  })

  const hits: Array<{ row: CandidateRow; found: TextMatch[] }> = []
  let inReadingOrder = true
  let previousChunk = -1
  for (const row of rows) {
    if (row.chunkIndex < previousChunk) inReadingOrder = false
    previousChunk = row.chunkIndex
    // Empty when FTS5's folded index matched but the user's exact options (case, diacritics,
    // whole words) don't.
    const found = matcher.find(row.content)
    if (found.length > 0) hits.push({ row, found })
  }
  if (!inReadingOrder) hits.sort((a, b) => a.row.chunkIndex - b.row.chunkIndex)

  const matches: BookMatch[] = []
  const perChapter = new Map<number, number>()
  for (const { row, found } of hits) {
    for (const match of found) {
      const chapterOccurrence = perChapter.get(row.chapterIndex) ?? 0
      perChapter.set(row.chapterIndex, chapterOccurrence + 1)
      matches.push({
        occurrence: matches.length + 1,
        chunkWordStart: row.wordStart,
        chunkIndex: row.chunkIndex,
        chapterIndex: row.chapterIndex,
        chapterOccurrence,
        chapterMatchCount: 0,
        score: row.score,
        content: row.content,
        start: match.start,
        end: match.end,
      })
    }
  }

  for (const match of matches) {
    match.chapterMatchCount = perChapter.get(match.chapterIndex) ?? 0
  }
  return matches
}

/**
 * 1-based word number of the match's first word within the whole book: the chunk's `word_start`
 * plus the words before the match inside the chunk (a match always starts on a word boundary).
 */
export function matchWordIndex(match: BookMatch): number {
  return match.chunkWordStart + countSearchWords(match.content, match.start) + 1
}

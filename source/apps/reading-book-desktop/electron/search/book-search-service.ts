import { parseTextSearchQuery, toFts5MatchExpression } from '@reading-book/book-reader-sdk'
import { ensureBookChunks } from '../chunking/book-chunk-service'
import type {
  BookSearchMatchDto,
  BookSearchRequestDto,
  BookSearchResultDto,
} from '../ipc/api-types'
import { getDatabase } from '../persistence/db'
import {
  findBookMatches,
  matchWordIndex,
  readBookChunkStats,
  type BookMatch,
} from './book-search-query'

const DEFAULT_PAGE_SIZE = 200
const MAX_PAGE_SIZE = 1000
const SNIPPET_BEFORE_CHARS = 48
const SNIPPET_AFTER_CHARS = 80

/**
 * The last computed search, so "load more" pages and switching the sort order don't redo the
 * FTS query + counting. The key includes the book's chunk range: a re-chunked book misses.
 */
let lastSearch: { key: string; matches: BookMatch[]; byRelevance: BookMatch[] | null } | null =
  null

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/** Context around a match, cut on spaces so the edges don't show half words. */
function snippetOf(content: string, start: number, end: number): BookSearchMatchDto['snippet'] {
  let from = Math.max(0, start - SNIPPET_BEFORE_CHARS)
  let to = Math.min(content.length, end + SNIPPET_AFTER_CHARS)
  if (from > 0) {
    const space = content.indexOf(' ', from)
    if (space !== -1 && space < start) from = space + 1
  }
  if (to < content.length) {
    const space = content.lastIndexOf(' ', to)
    if (space > end) to = space
  }
  return {
    before: (from > 0 ? '…' : '') + collapseWhitespace(content.slice(from, start)).trimStart(),
    match: collapseWhitespace(content.slice(start, end)),
    after: collapseWhitespace(content.slice(end, to)).trimEnd() + (to < content.length ? '…' : ''),
  }
}

function toMatchDto(match: BookMatch): BookSearchMatchDto {
  return {
    occurrence: match.occurrence,
    wordIndex: matchWordIndex(match),
    chunkIndex: match.chunkIndex,
    chapterIndex: match.chapterIndex,
    chapterOccurrence: match.chapterOccurrence,
    chapterMatchCount: match.chapterMatchCount,
    snippet: snippetOf(match.content, match.start, match.end),
    score: match.score,
  }
}

/**
 * Search one book. Synchronous SQLite work on Main: FTS5 prunes to candidate chunks via the
 * index, so the cost is proportional to the hits, not the library (see book-search-query.ts).
 *
 * A book that was never chunked starts background chunking and answers `indexing`; the renderer
 * retries when the `bookIndex:status` broadcast reports `done`.
 */
export async function searchBook(request: BookSearchRequestDto): Promise<BookSearchResultDto> {
  const startedAt = performance.now()
  const bookId = request.bookId.trim()
  if (!bookId) return { state: 'error', message: 'Missing book id.' }

  const query = parseTextSearchQuery(request.query, {
    matchCase: request.matchCase === true,
    matchDiacritics: request.matchDiacritics === true,
    wholeWords: request.wholeWords === true,
  })

  const db = getDatabase()
  let stats = readBookChunkStats(db, bookId)
  if (stats.chunkCount === 0) {
    const ensured = await ensureBookChunks(bookId)
    if (ensured.state === 'indexing') return { state: 'indexing' }
    if (ensured.state === 'unsupported') return { state: 'unsupported' }
    if (ensured.state === 'error') {
      return { state: 'error', message: 'This book could not be prepared for search.' }
    }
    // `ready`: chunking finished in the meantime, or the book has no extractable text.
    stats = readBookChunkStats(db, bookId)
  }

  let all: BookMatch[] = []
  let ordered: BookMatch[] = []
  if (query) {
    const { matchCase, matchDiacritics, wholeWords } = query.options
    const key = [
      bookId,
      stats.chunkCount,
      stats.minSeq,
      stats.maxSeq,
      toFts5MatchExpression(query),
      matchCase,
      matchDiacritics,
      wholeWords,
    ].join('\u0000')

    if (lastSearch?.key !== key) {
      lastSearch = { key, matches: findBookMatches(db, bookId, query, stats), byRelevance: null }
    }
    const cached = lastSearch
    all = cached.matches
    if (request.order === 'relevance') {
      // Stable sort: equally relevant chunks keep reading order.
      cached.byRelevance ??= [...all].sort((a, b) => a.score - b.score)
      ordered = cached.byRelevance
    } else {
      ordered = all
    }
  }

  const offset = clampInt(request.offset, 0, ordered.length, 0)
  const limit = clampInt(request.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)
  const page = ordered.slice(offset, offset + limit)

  return {
    state: 'ok',
    totalMatches: all.length,
    totalWords: stats.totalWords,
    offset,
    matches: page.map(toMatchDto),
    hasMore: offset + page.length < ordered.length,
    elapsedMs: Math.round(performance.now() - startedAt),
  }
}

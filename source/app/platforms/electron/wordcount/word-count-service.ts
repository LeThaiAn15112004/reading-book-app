import { ensureBookChunks } from '../chunking/book-chunk-service'
import type { WordCountStatsDto } from '../ipc/api-types'
import { getDatabase } from '../persistence/db'
import { readBookChunkStats } from '../search/book-search-query'
import { accumulateTextStats, createTextStats } from '@reading-book/book-reader-sdk'
import { iterateBookChunkContents } from './word-count-query'

/**
 * Foxit-style Word Count statistics for one book — Words, Characters (with/without spaces),
 * Lines, Non-Asian words, Asian characters — all read straight from the `book_chunks` index that
 * search already maintains (`book_chunks.content`/`word_count`, written once per import in
 * `book-chunk-writer.ts`). Nothing here re-opens or re-parses the original file.
 *
 * A book that was never chunked starts background chunking and answers `indexing`; the renderer
 * retries when the `bookIndex:status` broadcast reports `done` (same flow as `searchBook`).
 */
export async function getWordCountStats(bookId: string): Promise<WordCountStatsDto> {
  const id = bookId.trim()
  if (!id) return { state: 'error', message: 'Missing book id.' }

  const db = getDatabase()
  let stats = readBookChunkStats(db, id)
  if (stats.chunkCount === 0) {
    const ensured = await ensureBookChunks(id)
    if (ensured.state === 'indexing') return { state: 'indexing' }
    if (ensured.state === 'unsupported') return { state: 'unsupported' }
    if (ensured.state === 'error') {
      return { state: 'error', message: 'This book could not be prepared for word count.' }
    }
    // `ready`: chunking finished in the meantime, or the book has no extractable text.
    stats = readBookChunkStats(db, id)
  }

  const textStats = createTextStats()
  for (const row of iterateBookChunkContents(db, id)) {
    accumulateTextStats(textStats, row.content)
  }

  return {
    state: 'ok',
    words: stats.totalWords,
    charactersWithSpaces: textStats.charactersWithSpaces,
    charactersNoSpaces: textStats.charactersNoSpaces,
    lines: textStats.lines,
    nonAsianWords: textStats.nonAsianWords,
    asianCharacters: textStats.asianCharacters,
  }
}

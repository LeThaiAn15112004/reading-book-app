import { ipcMain } from 'electron'
import { searchBook } from '../search/book-search-service'
import type { BookSearchRequestDto, BookSearchResultDto } from './api-types'
import { SearchChannels } from './channels'

/** Longer input is cut; the query itself is capped at TEXT_SEARCH_MAX_TOKENS words. */
const MAX_QUERY_CHARS = 500

/** Renderer input is untrusted: keep only well-typed fields. */
function toSearchRequest(input: unknown): BookSearchRequestDto | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  if (typeof raw.bookId !== 'string' || typeof raw.query !== 'string') return null
  return {
    bookId: raw.bookId,
    query: raw.query.slice(0, MAX_QUERY_CHARS),
    matchCase: raw.matchCase === true,
    matchDiacritics: raw.matchDiacritics === true,
    wholeWords: raw.wholeWords === true,
    order: raw.order === 'relevance' ? 'relevance' : 'position',
    offset: typeof raw.offset === 'number' ? raw.offset : undefined,
    limit: typeof raw.limit === 'number' ? raw.limit : undefined,
  }
}

export function registerSearchIpc(): void {
  ipcMain.handle(
    SearchChannels.searchBook,
    async (_event, input: unknown): Promise<BookSearchResultDto> => {
      const request = toSearchRequest(input)
      if (!request) return { state: 'error', message: 'Invalid search request.' }
      try {
        return await searchBook(request)
      } catch (err) {
        return {
          state: 'error',
          message: err instanceof Error ? err.message : 'Search failed.',
        }
      }
    },
  )
}

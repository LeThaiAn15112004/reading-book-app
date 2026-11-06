/** Typed wrappers for search:* IPC via api. */

import { api } from '../platforms/api'
export type BookSearchRequest = Parameters<typeof api.search.searchBook>[0]
export type BookSearchResult = Awaited<ReturnType<typeof api.search.searchBook>>
export type BookSearchMatch = Extract<BookSearchResult, { state: 'ok' }>['matches'][number]
export type BookSearchOrder = NonNullable<BookSearchRequest['order']>

export const searchApi = {
  searchBook: (...args: Parameters<typeof api.search.searchBook>) =>
    api.search.searchBook(...args),
}

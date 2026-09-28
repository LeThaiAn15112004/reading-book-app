/** Typed wrappers for search:* IPC via window.api. */

export type BookSearchRequest = Parameters<typeof window.api.search.searchBook>[0]
export type BookSearchResult = Awaited<ReturnType<typeof window.api.search.searchBook>>
export type BookSearchMatch = Extract<BookSearchResult, { state: 'ok' }>['matches'][number]
export type BookSearchOrder = NonNullable<BookSearchRequest['order']>

export const searchApi = {
  searchBook: (...args: Parameters<typeof window.api.search.searchBook>) =>
    window.api.search.searchBook(...args),
}

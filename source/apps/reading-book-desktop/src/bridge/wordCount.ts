/** Typed wrappers for wordCount:* IPC via window.api. */

export type WordCountStats = Awaited<ReturnType<typeof window.api.wordCount.getStats>>
export type WordCountStatsOk = Extract<WordCountStats, { state: 'ok' }>

export const wordCountApi = {
  getStats: (bookId: string) => window.api.wordCount.getStats(bookId),
}

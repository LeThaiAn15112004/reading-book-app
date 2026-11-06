/** Typed wrappers for wordCount:* IPC via api. */

import { api } from '../platforms/api'
export type WordCountStats = Awaited<ReturnType<typeof api.wordCount.getStats>>
export type WordCountStatsOk = Extract<WordCountStats, { state: 'ok' }>

export const wordCountApi = {
  getStats: (bookId: string) => api.wordCount.getStats(bookId),
}

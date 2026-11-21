import { waitUntilOpened } from '../perf/reader-opening-gate'
import { ipcMain } from 'electron'
import { getWordCountStats } from '../wordcount/word-count-service'
import type { WordCountStatsDto } from './api-types'
import { WordCountChannels } from './channels'
import { tMain } from '../i18n/main-translate'

export function registerWordCountIpc(): void {
  ipcMain.handle(
    WordCountChannels.getStats,
    async (_event, bookId: unknown): Promise<WordCountStatsDto> => {
      // Spec 016 (FR-015): word count waits for the opening book's first page (≤ 10 s).
      await waitUntilOpened()
      if (typeof bookId !== 'string' || !bookId.trim()) {
        return { state: 'error', message: tMain('main.messages.common.invalidBookId') }
      }
      try {
        return await getWordCountStats(bookId)
      } catch (err) {
        return {
          state: 'error',
          message: err instanceof Error ? err.message : tMain('main.messages.wordCount.failed'),
        }
      }
    },
  )
}

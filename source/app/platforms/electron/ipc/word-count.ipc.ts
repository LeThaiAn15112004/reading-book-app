import { ipcMain } from 'electron'
import { getWordCountStats } from '../wordcount/word-count-service'
import type { WordCountStatsDto } from './api-types'
import { WordCountChannels } from './channels'
import { tMain } from '../i18n/main-translate'

export function registerWordCountIpc(): void {
  ipcMain.handle(
    WordCountChannels.getStats,
    async (_event, bookId: unknown): Promise<WordCountStatsDto> => {
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

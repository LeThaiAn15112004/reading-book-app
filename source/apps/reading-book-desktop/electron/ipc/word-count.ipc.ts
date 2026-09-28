import { ipcMain } from 'electron'
import { getWordCountStats } from '../wordcount/word-count-service'
import type { WordCountStatsDto } from './api-types'
import { WordCountChannels } from './channels'

export function registerWordCountIpc(): void {
  ipcMain.handle(
    WordCountChannels.getStats,
    async (_event, bookId: unknown): Promise<WordCountStatsDto> => {
      if (typeof bookId !== 'string' || !bookId.trim()) {
        return { state: 'error', message: 'Invalid book id.' }
      }
      try {
        return await getWordCountStats(bookId)
      } catch (err) {
        return {
          state: 'error',
          message: err instanceof Error ? err.message : 'Word count failed.',
        }
      }
    },
  )
}

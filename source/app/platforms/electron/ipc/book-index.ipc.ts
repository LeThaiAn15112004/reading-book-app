import { ipcMain } from 'electron'
import { ensureBookChunks } from '../chunking/book-chunk-service'
import type { EnsureBookIndexResult } from './api-types'
import { BookIndexChannels } from './channels'

export function registerBookIndexIpc(): void {
  ipcMain.handle(
    BookIndexChannels.ensure,
    async (_event, bookId: unknown): Promise<EnsureBookIndexResult> => {
      if (typeof bookId !== 'string') return { state: 'error' }
      try {
        return await ensureBookChunks(bookId)
      } catch {
        return { state: 'error' }
      }
    },
  )
}

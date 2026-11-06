import { ipcMain } from 'electron'
import { getTxtDocumentService } from '../txt/txt-runtime'
import type { TxtCommitResult, TxtOpenResult } from './api-types'
import { TxtChannels } from './channels'

/**
 * Handlers for txt:* — the TXT reader's text and annotations (docs/implementation_plan/txt_reader.md).
 * Everything crossing here is data: no paths in, none out, and the original file is only ever read.
 */
export function registerTxtIpc(): void {
  const service = getTxtDocumentService()

  ipcMain.removeHandler(TxtChannels.open)
  ipcMain.handle(TxtChannels.open, async (_event, bookId: unknown): Promise<TxtOpenResult> => {
    void _event
    try {
      return await service.open(bookId)
    } catch (err) {
      console.warn('[txt] open failed', err)
      return {
        ok: false,
        bookId: typeof bookId === 'string' ? bookId : '',
        errorCode: 'read_failed',
        errorMessage: 'Could not read the book file.',
      }
    }
  })

  ipcMain.removeHandler(TxtChannels.commit)
  ipcMain.handle(TxtChannels.commit, async (_event, input: unknown): Promise<TxtCommitResult> => {
    void _event
    try {
      return await service.commit(input)
    } catch (err) {
      console.warn('[txt] commit failed', err)
      return { ok: false, errorCode: 'db_failed', errorMessage: 'Could not save your changes.' }
    }
  })
}

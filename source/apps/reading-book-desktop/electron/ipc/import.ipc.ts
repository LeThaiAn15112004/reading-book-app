import { ipcMain } from 'electron'
import { ImportChannels } from './channels'

/** Stub handlers for import:* — dialog / URL / sandbox wiring comes later. */
export function registerImportIpc(): void {
  ipcMain.removeHandler(ImportChannels.fromFile)
  ipcMain.handle(ImportChannels.fromFile, async () => ({ ok: true, bookId: null }))

  ipcMain.removeHandler(ImportChannels.fromUrl)
  ipcMain.handle(ImportChannels.fromUrl, async (_event, _url: string) => ({
    ok: true,
    bookId: null,
  }))
}

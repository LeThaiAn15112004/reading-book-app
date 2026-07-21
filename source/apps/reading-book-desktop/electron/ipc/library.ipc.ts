import { ipcMain } from 'electron'
import { LibraryChannels } from './channels'

/** Stub handlers for library:* — real SQLite wiring comes in later phases. */
export function registerLibraryIpc(): void {
  ipcMain.removeHandler(LibraryChannels.listBooks)
  ipcMain.handle(LibraryChannels.listBooks, async () => [])

  ipcMain.removeHandler(LibraryChannels.getBook)
  ipcMain.handle(LibraryChannels.getBook, async (_event, _id: string) => null)

  ipcMain.removeHandler(LibraryChannels.deleteBook)
  ipcMain.handle(LibraryChannels.deleteBook, async (_event, _id: string) => ({ ok: true }))
}

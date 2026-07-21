import { ipcMain } from 'electron'
import type { AddHighlightInput, AddNoteInput } from './api-types'
import { OverlayChannels } from './channels'

/** Stub handlers for overlay:* — OverlayStore / SQLite wiring comes later. */
export function registerOverlayIpc(): void {
  ipcMain.removeHandler(OverlayChannels.list)
  ipcMain.handle(OverlayChannels.list, async (_event, _bookId: string) => [])

  ipcMain.removeHandler(OverlayChannels.addHighlight)
  ipcMain.handle(OverlayChannels.addHighlight, async (_event, _input: AddHighlightInput) => ({
    ok: true,
    id: null,
  }))

  ipcMain.removeHandler(OverlayChannels.addNote)
  ipcMain.handle(OverlayChannels.addNote, async (_event, _input: AddNoteInput) => ({
    ok: true,
    id: null,
  }))

  ipcMain.removeHandler(OverlayChannels.listBookmarks)
  ipcMain.handle(OverlayChannels.listBookmarks, async (_event, _bookId: string) => [])
}

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { probeAudioFile } from '../adapters/audio.adapter'
import { ZipImportService, failure } from '../zip-import/zip-import-service'
import type {
  OkResult,
  ZipImportConfirmResult,
  ZipImportCoverResult,
  ZipImportPickResult,
} from './api-types'
import { ZipImportChannels } from './channels'
import { beginCancellable, cancelInFlight, endCancellable } from './import-cancel'

const CANCEL_KEY = 'zip-inspect'

let service: ZipImportService | null = null

function tmpRoot(): string {
  return path.join(app.getPath('userData'), 'zip-import-tmp')
}

function getService(): ZipImportService {
  service ??= new ZipImportService({
    tmpRoot: tmpRoot(),
    probe: async (filePath, format) => {
      const parsed = await probeAudioFile(filePath, format)
      return { durationSeconds: parsed.format.duration }
    },
  })
  return service
}

/** Handlers for zipImport:* — pick + inspect an audiobook ZIP, cover preview, confirm (re-validated), discard. */
export function registerZipImportIpc(): void {
  // Scratch files are removed after every inspection, so anything left here is from a crashed run.
  void fsp.rm(tmpRoot(), { recursive: true, force: true }).catch(() => {})

  ipcMain.removeHandler(ZipImportChannels.pick)
  ipcMain.handle(ZipImportChannels.pick, async (event): Promise<ZipImportPickResult> => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Audiobook ZIP', extensions: ['zip'] }],
    }
    let picked: Electron.OpenDialogReturnValue
    try {
      picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    } catch {
      return failure('unreadable', 'Could not open the file picker.')
    }
    if (picked.canceled || picked.filePaths.length === 0) return failure('cancelled', 'Cancelled.')
    // The path comes from the native dialog, never from the renderer.
    const zipPath = path.resolve(picked.filePaths[0] as string)
    if (!event.sender.isDestroyed()) event.sender.send(ZipImportChannels.inspecting, { archiveName: path.basename(zipPath) })
    const controller = beginCancellable(CANCEL_KEY)
    try {
      return await getService().inspect(zipPath, controller.signal)
    } finally {
      endCancellable(CANCEL_KEY, controller)
    }
  })

  ipcMain.removeHandler(ZipImportChannels.coverPreview)
  ipcMain.handle(ZipImportChannels.coverPreview, (_e, input: unknown): Promise<ZipImportCoverResult> => {
    const { sessionId, entryId } = (input ?? {}) as { sessionId?: unknown; entryId?: unknown }
    return getService().coverPreview(sessionId, entryId)
  })

  ipcMain.removeHandler(ZipImportChannels.confirm)
  ipcMain.handle(ZipImportChannels.confirm, (_e, input: unknown): Promise<ZipImportConfirmResult> => {
    const { sessionId, selection } = (input ?? {}) as { sessionId?: unknown; selection?: unknown }
    return getService().confirm(sessionId, selection)
  })

  ipcMain.removeHandler(ZipImportChannels.discard)
  ipcMain.handle(ZipImportChannels.discard, (_e, sessionId: unknown): OkResult => ({
    ok: getService().discard(sessionId),
  }))

  ipcMain.removeHandler(ZipImportChannels.cancelInspect)
  ipcMain.handle(ZipImportChannels.cancelInspect, (): OkResult => ({ ok: cancelInFlight(CANCEL_KEY) }))
}

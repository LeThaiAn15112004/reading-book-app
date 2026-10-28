import { features } from '@reading-book/config'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { probeAudioFile } from '../adapters/audio.adapter'
import { ensureBooksSandbox, ensureCoversDir, removeCoverFile } from '../files/sandbox'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { createZipAudiobookImporter, sweepPartialBookDirs } from '../zip-import/zip-audiobook-importer'
import { takePickedZip } from '../zip-import/picked-zip'
import { readTrackMetadata } from '../zip-import/track-metadata'
import { ZipImportService, failure } from '../zip-import/zip-import-service'
import type {
  OkResult,
  ZipImportConfirmResult,
  ZipImportCoverResult,
  ZipImportPickResult,
} from './api-types'
import { ZipImportChannels } from './channels'
import { beginCancellable, cancelInFlight, endCancellable } from './import-cancel'
import { importDownloadedFile } from './import.ipc'

const CANCEL_KEY = 'zip-inspect'
const IMPORT_CANCEL_KEY = 'zip-import'

let service: ZipImportService | null = null
/** Resolves once the start-up removal of crashed-run leftovers is done. */
let startupCleanup: Promise<void> = Promise.resolve()

function tmpRoot(): string {
  return path.join(app.getPath('userData'), 'zip-import-tmp')
}

/** Case-insensitive on Windows, like the file system. */
const norm = (p: string): string => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))

async function freeBytes(dir: string): Promise<number | null> {
  try {
    const s = await fsp.statfs(dir)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return null
  }
}

function getService(): ZipImportService {
  service ??= new ZipImportService({
    tmpRoot: tmpRoot(),
    probe: async (filePath, format) => {
      const parsed = await probeAudioFile(filePath, format)
      return { durationSeconds: parsed.format.duration }
    },
    importer: createZipAudiobookImporter({
      tmpRoot: tmpRoot(),
      booksRoot: ensureBooksSandbox,
      coversDir: ensureCoversDir,
      readTrack: readTrackMetadata,
      store: getLibraryStore(),
      importSingleFile: (tempPath) => importDownloadedFile(tempPath),
      removeCover: (p) => removeCoverFile(p),
      freeBytes,
    }),
  })
  return service
}

/** Tell the renderer which archive is being inspected, then inspect it (cancellable). */
async function inspectPath(sender: Electron.WebContents, zipPath: string): Promise<ZipImportPickResult> {
  await startupCleanup
  if (!sender.isDestroyed()) sender.send(ZipImportChannels.inspecting, { archiveName: path.basename(zipPath) })
  const controller = beginCancellable(CANCEL_KEY)
  try {
    return await getService().inspect(zipPath, controller.signal)
  } finally {
    endCancellable(CANCEL_KEY, controller)
  }
}

/**
 * Handlers for zipImport:* — pick + inspect an audiobook ZIP, cover preview, confirm (re-validated, then the real
 * import stage), cancel, discard. Registered only while `features.audiobookZipImportEnabled` is on: until then the
 * renderer cannot reach any of it, whatever the UI does.
 */
export function registerZipImportIpc(): void {
  if (!features.audiobookZipImportEnabled) return

  // Scratch files are removed after every inspection / import, so anything left here is from a crashed run.
  // Every handler waits for this (`startupCleanup`): a sweep that ran concurrently with an inspection could delete its scratch files.
  const registered = new Set(getLibraryStore().bookDirectories().map(norm))
  startupCleanup = (async () => {
    await fsp.rm(tmpRoot(), { recursive: true, force: true }).catch(() => {})
    // A book folder with a `.partial` marker and no book row is an import that crashed before its database commit.
    await sweepPartialBookDirs(ensureBooksSandbox(), (dir) => registered.has(norm(dir))).catch(() => {})
  })()

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
    return inspectPath(event.sender, path.resolve(picked.filePaths[0] as string))
  })

  ipcMain.removeHandler(ZipImportChannels.inspectPicked)
  ipcMain.handle(ZipImportChannels.inspectPicked, async (event): Promise<ZipImportPickResult> => {
    // The ZIP the user chose in the ordinary "Add file" dialog; its path never left Main and is used once.
    const zipPath = takePickedZip()
    if (!zipPath) return failure('unreadable', 'No ZIP file was selected.')
    return inspectPath(event.sender, zipPath)
  })

  ipcMain.removeHandler(ZipImportChannels.coverPreview)
  ipcMain.handle(ZipImportChannels.coverPreview, (_e, input: unknown): Promise<ZipImportCoverResult> => {
    const { sessionId, entryId } = (input ?? {}) as { sessionId?: unknown; entryId?: unknown }
    return getService().coverPreview(sessionId, entryId)
  })

  ipcMain.removeHandler(ZipImportChannels.confirm)
  ipcMain.handle(ZipImportChannels.confirm, async (event, input: unknown): Promise<ZipImportConfirmResult> => {
    const { sessionId, selection } = (input ?? {}) as { sessionId?: unknown; selection?: unknown }
    await startupCleanup
    const controller = beginCancellable(IMPORT_CANCEL_KEY)
    try {
      return await getService().confirm(sessionId, selection, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send(ZipImportChannels.progress, progress)
        },
      })
    } finally {
      endCancellable(IMPORT_CANCEL_KEY, controller)
    }
  })

  ipcMain.removeHandler(ZipImportChannels.discard)
  ipcMain.handle(ZipImportChannels.discard, (_e, sessionId: unknown): OkResult => ({
    ok: getService().discard(sessionId),
  }))

  ipcMain.removeHandler(ZipImportChannels.cancelInspect)
  ipcMain.handle(ZipImportChannels.cancelInspect, (): OkResult => ({ ok: cancelInFlight(CANCEL_KEY) }))

  ipcMain.removeHandler(ZipImportChannels.cancelImport)
  ipcMain.handle(ZipImportChannels.cancelImport, (): OkResult => ({ ok: cancelInFlight(IMPORT_CANCEL_KEY) }))
}

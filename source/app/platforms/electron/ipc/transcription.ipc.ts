import fsp from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { transcriptExportFileName } from '@reading-book/book-reader-sdk'
import { isPathInsideUserData } from '../files/sandbox'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { exportTranscriptToFile } from '../transcription/transcript-export-file'
import { getTranscriptionService } from '../transcription/transcription-runtime'
import type {
  OkResult,
  TranscriptPassageDto,
  TranscriptionDownloadModelResult,
  TranscriptionExportResult,
  TranscriptionInfoDto,
  TranscriptionSearchHitDto,
  TranscriptionStartResult,
} from './api-types'
import { TranscriptionChannels } from './channels'

/**
 * Handlers for transcription:* (spec 004, contracts/ipc-transcription.md). Input is validated by the service (Main owns the
 * rules); the renderer only ever names a book, a track, a model or a job — never a path. The export's save dialog and file write
 * are Main's too: the renderer learns whether it was saved, nothing else.
 */
export function registerTranscriptionIpc(): void {
  ipcMain.removeHandler(TranscriptionChannels.getInfo)
  ipcMain.handle(
    TranscriptionChannels.getInfo,
    (_event, bookId: unknown, appLanguage: unknown): Promise<TranscriptionInfoDto> => getTranscriptionService().getInfo(bookId, appLanguage),
  )

  ipcMain.removeHandler(TranscriptionChannels.start)
  ipcMain.handle(
    TranscriptionChannels.start,
    (_event, request: unknown): Promise<TranscriptionStartResult> => getTranscriptionService().start(request),
  )

  ipcMain.removeHandler(TranscriptionChannels.cancel)
  ipcMain.handle(TranscriptionChannels.cancel, (_event, jobId: unknown): OkResult => getTranscriptionService().cancel(jobId))

  ipcMain.removeHandler(TranscriptionChannels.downloadModel)
  ipcMain.handle(
    TranscriptionChannels.downloadModel,
    (_event, modelId: unknown): Promise<TranscriptionDownloadModelResult> => getTranscriptionService().downloadModel(modelId),
  )

  ipcMain.removeHandler(TranscriptionChannels.getPassages)
  ipcMain.handle(TranscriptionChannels.getPassages, (_event, request: unknown): TranscriptPassageDto[] =>
    getTranscriptionService().getPassages(request),
  )

  ipcMain.removeHandler(TranscriptionChannels.search)
  ipcMain.handle(
    TranscriptionChannels.search,
    (_event, bookId: unknown, query: unknown, limit: unknown): TranscriptionSearchHitDto[] => getTranscriptionService().search(bookId, query, limit),
  )

  ipcMain.removeHandler(TranscriptionChannels.export)
  ipcMain.handle(
    TranscriptionChannels.export,
    async (event, bookId: unknown, options: unknown): Promise<TranscriptionExportResult> => {
      const service = getTranscriptionService()
      const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
      return exportTranscriptToFile(
        {
          build: (id, exportOptions) => service.buildExport(id, exportOptions),
          suggestedName: async (id) => transcriptExportFileName((await getLibraryStore().findById(id))?.title),
          pickFile: async (suggestedName) => {
            const dialogOptions: Electron.SaveDialogOptions = {
              title: 'Export transcript',
              defaultPath: path.join(app.getPath('documents'), suggestedName),
              filters: [{ name: 'Text', extensions: ['txt'] }],
              properties: ['showOverwriteConfirmation', 'createDirectory'],
            }
            const picked = parent ? await dialog.showSaveDialog(parent, dialogOptions) : await dialog.showSaveDialog(dialogOptions)
            return picked.canceled || !picked.filePath ? null : picked.filePath
          },
          isForbiddenTarget: (target) => isPathInsideUserData(target),
          writeFile: (filePath, text) => fsp.writeFile(filePath, text, 'utf8'),
        },
        bookId,
        options,
      )
    },
  )

  ipcMain.removeHandler(TranscriptionChannels.delete)
  ipcMain.handle(TranscriptionChannels.delete, (_event, bookId: unknown): Promise<OkResult> => getTranscriptionService().delete(bookId))
}

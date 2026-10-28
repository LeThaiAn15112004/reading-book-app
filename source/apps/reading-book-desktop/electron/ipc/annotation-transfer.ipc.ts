/**
 * Annotation import / export IPC (specs/006-annotation-import-export, contracts/ipc.md).
 * Phase 2 skeleton: every channel is registered and validated; the export and import services are filled in
 * by the user-story tasks (T013, T021, T022, T047 ...) and until then answer `not_found`.
 * The renderer sends only `bookId` / `sessionId` — never a filesystem path.
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { isPathInsideUserData } from '../files/sandbox'
import { exportRestoreAnnotations, type ExportDeps } from '../annotation-transfer/export-service'
import { writeFileSafely } from '../pdf-sync/pdf-annotation-export'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { getOverlayStore } from '../persistence/sqlite-overlay-store'
import { getTxtStore } from '../persistence/sqlite-txt-store'
import type { AnnotationExportResult, AnnotationImportPreviewResult, AnnotationImportResult, OkResult } from './api-types'
import { AnnotationTransferChannels } from './channels'

/** The formats that carry annotations (audiobooks and unknown formats are never offered the feature). */
const TRANSFER_FORMATS = new Set(['epub', 'pdf', 'txt', 'md'])

const NOT_FOUND = { ok: false, errorCode: 'not_found' } as const

function idOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The book if it exists and its format can have annotations exported / imported. */
export async function findTransferBook(bookId: unknown): Promise<{ id: string; title: string; format: string } | null> {
  const id = idOf(bookId)
  if (!id) return null
  const book = await getLibraryStore().findById(id)
  if (!book || !TRANSFER_FORMATS.has(book.format)) return null
  return { id: book.id, title: book.title, format: book.format }
}

/** The real collaborators of an export: library, overlay and TXT stores, the save dialog and the atomic writer. */
function exportDeps(event: Electron.IpcMainInvokeEvent): ExportDeps {
  const overlays = getOverlayStore()
  return {
    findBook: async (id) => {
      const book = await getLibraryStore().findById(id)
      if (!book) return null
      return { id: book.id, title: book.title, author: book.authorNames() || undefined, format: book.format, sha256: book.sha256, pageCount: book.pageCount }
    },
    listRows: (id) => overlays.listAnnotationsForTransfer(id),
    ledger: (id) => overlays.listEmbeddedLedger(id),
    txtContentSha256: (id) => getTxtStore().getDocument(id)?.contentSha256,
    chooseTarget: async (defaultFileName) => {
      const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const options: Electron.SaveDialogOptions = {
        title: 'Export annotations',
        defaultPath: path.join(app.getPath('documents'), defaultFileName),
        filters: [{ name: 'Readmate annotations (*.readmate-notes.json)', extensions: ['json'] }],
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      }
      const picked = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      return picked.canceled || !picked.filePath ? null : picked.filePath
    },
    isForbiddenTarget: (target) => isPathInsideUserData(target),
    write: writeFileSafely,
    appVersion: app.getVersion(),
  }
}

export function registerAnnotationTransferIpc(): void {
  ipcMain.removeHandler(AnnotationTransferChannels.count)
  ipcMain.handle(AnnotationTransferChannels.count, async (_event, bookId: unknown): Promise<{ count: number }> => {
    const book = await findTransferBook(bookId)
    return { count: book ? getOverlayStore().countAnnotationsForTransfer(book.id) : 0 }
  })

  ipcMain.removeHandler(AnnotationTransferChannels.exportRestore)
  ipcMain.handle(AnnotationTransferChannels.exportRestore, async (event, bookId: unknown): Promise<AnnotationExportResult> => {
    const book = await findTransferBook(bookId)
    if (!book) return NOT_FOUND
    return exportRestoreAnnotations(book.id, exportDeps(event))
  })

  ipcMain.removeHandler(AnnotationTransferChannels.exportReadable)
  ipcMain.handle(AnnotationTransferChannels.exportReadable, async (_event, bookId: unknown): Promise<AnnotationExportResult> => {
    if (!(await findTransferBook(bookId))) return NOT_FOUND
    return NOT_FOUND // T035
  })

  ipcMain.removeHandler(AnnotationTransferChannels.pickFile)
  ipcMain.handle(AnnotationTransferChannels.pickFile, async (_event, input: unknown): Promise<AnnotationImportPreviewResult> => {
    const bookId = input && typeof input === 'object' ? (input as { bookId?: unknown }).bookId : undefined
    if (bookId !== undefined && !(await findTransferBook(bookId))) return NOT_FOUND
    return NOT_FOUND // T021 / T023
  })

  ipcMain.removeHandler(AnnotationTransferChannels.setTarget)
  ipcMain.handle(AnnotationTransferChannels.setTarget, async (_event, sessionId: unknown, bookId: unknown): Promise<AnnotationImportPreviewResult> => {
    if (!idOf(sessionId) || !(await findTransferBook(bookId))) return NOT_FOUND
    return NOT_FOUND // T047
  })

  ipcMain.removeHandler(AnnotationTransferChannels.confirm)
  ipcMain.handle(AnnotationTransferChannels.confirm, async (_event, sessionId: unknown): Promise<AnnotationImportResult> => {
    if (!idOf(sessionId)) return NOT_FOUND
    return NOT_FOUND // T022
  })

  ipcMain.removeHandler(AnnotationTransferChannels.discard)
  ipcMain.handle(AnnotationTransferChannels.discard, async (_event, sessionId: unknown): Promise<OkResult> => {
    return { ok: idOf(sessionId) !== null }
  })

  ipcMain.removeHandler(AnnotationTransferChannels.cancel)
  ipcMain.handle(AnnotationTransferChannels.cancel, async (_event, sessionId: unknown): Promise<OkResult> => {
    return { ok: idOf(sessionId) !== null }
  })
}

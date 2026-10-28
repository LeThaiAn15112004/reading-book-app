/**
 * Annotation import / export IPC (specs/006-annotation-import-export, contracts/ipc.md).
 * Phase 2 skeleton: every channel is registered and validated; the export and import services are filled in
 * by the user-story tasks (T013, T021, T022, T047 ...) and until then answer `not_found`.
 * The renderer sends only `bookId` / `sessionId` — never a filesystem path.
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { isPathInsideUserData, resolveBookFile } from '../files/sandbox'
import { exportReadableAnnotations, exportRestoreAnnotations, type ExportDeps } from '../annotation-transfer/export-service'
import { createImportService, scanKeysOf, type ImportDeps, type ImportService } from '../annotation-transfer/import-service'
import { writeFileSafely } from '../pdf-sync/pdf-annotation-export'
import type { PdfAnnotationScanResult } from '../pdf-sync/pdf-annotation-scan'
import { getDatabase } from '../persistence/db'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { getOverlayStore } from '../persistence/sqlite-overlay-store'
import { getTxtDocumentService } from '../txt/txt-runtime'
import { getTxtStore } from '../persistence/sqlite-txt-store'
import type { AnnotationExportResult, AnnotationImportPreviewResult, AnnotationImportResult, OkResult } from './api-types'
import { AnnotationTransferChannels } from './channels'
import { runInScanWorker } from './overlay.ipc'

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
    chooseTarget: async (defaultFileName, kind) => {
      const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const options: Electron.SaveDialogOptions = {
        title: kind === 'readable' ? 'Export readable copy' : 'Export annotations',
        defaultPath: path.join(app.getPath('documents'), defaultFileName),
        filters:
          kind === 'readable'
            ? [{ name: 'Markdown (*.md)', extensions: ['md'] }]
            : [{ name: 'Readmate annotations (*.readmate-notes.json)', extensions: ['json'] }],
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

/** An annotations file is a few MB at most; anything bigger is not one (and would be read whole into memory). */
const MAX_IMPORT_FILE_BYTES = 64 * 1024 * 1024

/** Where `annotationTransfer:progress` events go: the window that started the running import. */
let progressTarget: Electron.WebContents | null = null

/** The real collaborators of an import: native dialog, file read, stores, the PDF scan worker and the shared SQLite connection. */
function importDeps(): ImportDeps {
  const overlays = getOverlayStore()
  const library = getLibraryStore()
  return {
    pickFilePath: async () => {
      const parent = (progressTarget && BrowserWindow.fromWebContents(progressTarget)) || undefined
      const options: Electron.OpenDialogOptions = {
        title: 'Import annotations',
        properties: ['openFile'],
        filters: [
          { name: 'Annotation files (*.readmate-notes.json)', extensions: ['json'] },
          { name: 'All files', extensions: ['*'] },
        ],
      }
      const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]!
    },
    readText: async (filePath) => {
      const stat = await fsp.stat(filePath)
      if (!stat.isFile() || stat.size > MAX_IMPORT_FILE_BYTES) throw new Error('not a readable annotations file')
      return fsp.readFile(filePath, 'utf8')
    },
    library,
    findBook: async (id) => {
      const book = await library.findById(id)
      if (!book) return null
      return { id: book.id, title: book.title, author: book.authorNames() || undefined, format: book.format, sha256: book.sha256, pageCount: book.pageCount }
    },
    bookFileAvailable: async (id) => {
      const book = await library.findById(id)
      if (!book) return false
      return (await resolveBookFile(book)).ok
    },
    txtText: async (id) => {
      const opened = await getTxtDocumentService().open(id)
      return opened.ok && typeof opened.text === 'string' ? opened.text : null
    },
    scanPdfKeys: async (id) => {
      const book = await library.findById(id)
      if (!book) return null
      const file = await resolveBookFile(book)
      if (!file.ok) return null
      const bytes = await fsp.readFile(file.path)
      const result = await runInScanWorker<PdfAnnotationScanResult>({ kind: 'scan', bytes })
      return scanKeysOf(result.items)
    },
    listRows: (id) => overlays.listAnnotationsForTransfer(id),
    annotationStamp: (id) => overlays.annotationStamp(id),
    existingNoteIds: (ids) => overlays.existingNoteIds(ids),
    bookSha256: (id) => (getDatabase().prepare('SELECT sha256 FROM books WHERE id = ?').get(id) as { sha256: string } | undefined)?.sha256,
    txtState: (id) => {
      const doc = getTxtStore().getDocument(id)
      return { revision: doc?.revision ?? 0, contentSha256: doc?.contentSha256 }
    },
    writeRow: (input) => {
      overlays.writeHighlight(input)
    },
    db: getDatabase(),
    newId: () => randomUUID(),
    progress: (event) => {
      if (progressTarget && !progressTarget.isDestroyed()) progressTarget.send(AnnotationTransferChannels.progress, event)
    },
  }
}

let importService: ImportService | null = null
function getImportService(): ImportService {
  importService ??= createImportService(importDeps())
  return importService
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
  ipcMain.handle(AnnotationTransferChannels.exportReadable, async (event, bookId: unknown): Promise<AnnotationExportResult> => {
    const book = await findTransferBook(bookId)
    if (!book) return NOT_FOUND
    return exportReadableAnnotations(book.id, exportDeps(event))
  })

  ipcMain.removeHandler(AnnotationTransferChannels.pickFile)
  ipcMain.handle(AnnotationTransferChannels.pickFile, async (event, input: unknown): Promise<AnnotationImportPreviewResult> => {
    const bookId = input && typeof input === 'object' ? (input as { bookId?: unknown }).bookId : undefined
    const startedFrom = bookId === undefined ? null : await findTransferBook(bookId)
    if (bookId !== undefined && !startedFrom) return NOT_FOUND
    progressTarget = event.sender
    return getImportService().pickFile({ bookId: startedFrom?.id })
  })

  ipcMain.removeHandler(AnnotationTransferChannels.setTarget)
  ipcMain.handle(AnnotationTransferChannels.setTarget, async (event, sessionId: unknown, bookId: unknown): Promise<AnnotationImportPreviewResult> => {
    const id = idOf(sessionId)
    const book = await findTransferBook(bookId)
    if (!id || !book) return NOT_FOUND
    progressTarget = event.sender
    return getImportService().setTarget(id, book.id)
  })

  ipcMain.removeHandler(AnnotationTransferChannels.confirm)
  ipcMain.handle(AnnotationTransferChannels.confirm, async (event, sessionId: unknown): Promise<AnnotationImportResult> => {
    const id = idOf(sessionId)
    if (!id) return NOT_FOUND
    progressTarget = event.sender
    return getImportService().confirm(id)
  })

  ipcMain.removeHandler(AnnotationTransferChannels.discard)
  ipcMain.handle(AnnotationTransferChannels.discard, async (_event, sessionId: unknown): Promise<OkResult> => {
    const id = idOf(sessionId)
    return id ? getImportService().discard(id) : { ok: false }
  })

  ipcMain.removeHandler(AnnotationTransferChannels.cancel)
  ipcMain.handle(AnnotationTransferChannels.cancel, async (_event, sessionId: unknown): Promise<OkResult> => {
    const id = idOf(sessionId)
    return id ? getImportService().cancel(id) : { ok: false }
  })
}

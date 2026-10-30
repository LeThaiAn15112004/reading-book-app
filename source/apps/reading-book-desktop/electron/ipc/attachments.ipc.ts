import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { createAttachmentService, cleanAttachmentTemp, type AttachmentService } from '../attachments/attachment-service'
import type { PdfAttachmentExtractResult, PdfAttachmentListResult } from '../attachments/pdf-attachments'
import { isPathInsideUserData, resolveBookFile } from '../files/sandbox'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { getOverlayStore } from '../persistence/sqlite-overlay-store'
import type { AttachmentVerifyResult } from '../pdf-sync/pdf-annotation-scan'
import { changePdfAttachment, createPdfAttachment, type AttachmentChangeDeps, type AttachmentOperationDeps } from '../pdf-sync/pdf-attachment-operations'
import type { AttachmentChangeOutput } from '../pdf-sync/pdf-annotation-scan.worker'
import type { AttachmentUpdatePlan } from '../pdf-sync/pdf-incremental-writer'
import type { AttachmentActionResult, ChangePdfAttachmentResultDto, CreatePdfAttachmentResultDto, ListAttachmentsResult } from './api-types'
import { AttachmentChannels } from './channels'
import { pdfFileOperations, runInScanWorker, toHighlightDto } from './overlay.ipc'

/** Main-owned folder for attachments handed to the OS: `{userData}/attachment-tmp/{uuid}/{name}`. */
function attachmentTempRoot(): string {
  return path.join(app.getPath('userData'), 'attachment-tmp')
}

/**
 * Main-owned copies of files being attached to a PDF: `{userData}/attachment-staging/{uuid}/content`
 * (specs/007-pdf-file-attachment research R4). Each is removed when its write ends; the root at startup.
 */
export function attachmentStagingRoot(): string {
  return path.join(app.getPath('userData'), 'attachment-staging')
}

function samePath(a: string, b: string): boolean {
  const resolvedA = path.resolve(a)
  const resolvedB = path.resolve(b)
  return process.platform === 'win32' ? resolvedA.toLowerCase() === resolvedB.toLowerCase() : resolvedA === resolvedB
}

let service: AttachmentService | null = null

/** `senderWindow` picks the dialog's parent; the service itself is window-agnostic. */
function attachmentService(senderWindow: () => BrowserWindow | undefined): AttachmentService {
  service ??= createAttachmentService({
    resolvePdf: async (bookId) => {
      const book = await getLibraryStore().findById(bookId)
      if (!book || book.format !== 'pdf') return { ok: false, code: 'not_found' }
      const file = await resolveBookFile(book)
      if (file.ok) return { ok: true, path: file.path }
      return { ok: false, code: file.code === 'missing_file' ? 'missing_file' : 'read_failed' }
    },
    readFile: async (filePath) => new Uint8Array(await fsp.readFile(filePath)),
    list: (bytes) => runInScanWorker<PdfAttachmentListResult>({ kind: 'attachments-list', bytes }),
    extract: (bytes, attachmentId) =>
      runInScanWorker<PdfAttachmentExtractResult>({ kind: 'attachment-extract', bytes, attachmentId }),
    tempRoot: attachmentTempRoot(),
    openPath: (file) => shell.openPath(file),
    chooseSaveTarget: async (suggestedName) => {
      const parent = senderWindow()
      const options: Electron.SaveDialogOptions = {
        title: 'Save attachment',
        defaultPath: path.join(app.getPath('downloads'), suggestedName),
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      }
      const picked = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      return picked.canceled || !picked.filePath ? null : picked.filePath
    },
    isForbiddenTarget: (target, pdfPath) => isPathInsideUserData(target) || samePath(target, pdfPath),
  })
  return service
}

async function resolvePdfPath(bookId: string): Promise<string | null> {
  const book = await getLibraryStore().findById(bookId)
  if (!book || book.format !== 'pdf') return null
  const file = await resolveBookFile(book)
  return file.ok ? file.path : null
}

/** The real dependencies of the file-attachment operations (specs/007-pdf-file-attachment), for one request. */
function attachmentOperationDeps(sender: Electron.WebContents): AttachmentOperationDeps {
  return {
    resolvePdfPath,
    runFileOperation: (bookId, op) => pdfFileOperations.run(bookId, op, sender),
    checkWritable: pdfFileOperations.checkWritable,
    chooseFile: async () => {
      const parent = BrowserWindow.fromWebContents(sender) ?? undefined
      const options: Electron.OpenDialogOptions = { title: 'Attach a file to this page', properties: ['openFile'] }
      const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      return picked.canceled || !picked.filePaths[0] ? null : picked.filePaths[0]
    },
    scan: pdfFileOperations.scan,
    plan: (bytes, page, annotation, file) => runInScanWorker<AttachmentUpdatePlan>({ kind: 'attachment-plan', bytes, page, annotation, file }),
    verify: (bytes, expect) => runInScanWorker<AttachmentVerifyResult>({ kind: 'attachment-verify', bytes, expect }),
    saveRow: (input) => getOverlayStore().writeHighlight(input),
    stagingRoot: attachmentStagingRoot(),
    log: (message, detail) => console.warn(message, detail ?? ''),
  }
}

/** The real dependencies of attachments:change (move / delete of a Readmate-made attachment). */
function attachmentChangeDeps(sender: Electron.WebContents): AttachmentChangeDeps {
  const base = attachmentOperationDeps(sender)
  const store = getOverlayStore()
  return {
    resolvePdfPath: base.resolvePdfPath,
    runFileOperation: base.runFileOperation,
    checkWritable: base.checkWritable,
    scan: base.scan,
    verify: base.verify,
    log: base.log,
    change: async (bytes, page, change) => (await runInScanWorker<AttachmentChangeOutput>({ kind: 'attachment-change', bytes, page, change })).output,
    getRow: (bookId, rowId) => store.getAttachmentRow(bookId, rowId),
    isOtherRow: (bookId, rowId) => store.getAttachmentRow(bookId, rowId) === undefined && store.hasAnnotationRow(bookId, rowId),
    commit: (bookId, rowId, change) => store.commitAttachmentChange(bookId, rowId, change),
  }
}

/** Handlers for attachments:* — list / open / saveAs of a PDF's embedded files (pdf_attachments.md); create of a page attachment (specs/007). */
export function registerAttachmentsIpc(): void {
  // Leftovers of the previous run. A file an application still holds open survives (and is retried
  // next start); an error here is never fatal.
  void cleanAttachmentTemp(attachmentTempRoot())
  // Copies of files whose attach was interrupted (crash, quit mid-write); nothing is running yet.
  void cleanAttachmentTemp(attachmentStagingRoot())

  let currentWindow: BrowserWindow | undefined
  const svc = () => attachmentService(() => currentWindow)

  ipcMain.removeHandler(AttachmentChannels.list)
  ipcMain.handle(AttachmentChannels.list, async (_event, bookId: unknown): Promise<ListAttachmentsResult> => {
    void _event
    return svc().list(bookId)
  })

  ipcMain.removeHandler(AttachmentChannels.open)
  ipcMain.handle(AttachmentChannels.open, async (event, input: unknown): Promise<AttachmentActionResult> => {
    currentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const { bookId, attachmentId } = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    return svc().open(bookId, attachmentId)
  })

  ipcMain.removeHandler(AttachmentChannels.create)
  ipcMain.handle(AttachmentChannels.create, async (event, input: unknown): Promise<CreatePdfAttachmentResultDto> => {
    try {
      const result = await createPdfAttachment(attachmentOperationDeps(event.sender), input)
      return result.ok ? { ok: true, highlight: toHighlightDto(result.highlight) } : result
    } catch (err) {
      console.warn('[attachments] create failed', err)
      return { ok: false, code: 'write_failed' }
    }
  })

  ipcMain.removeHandler(AttachmentChannels.change)
  ipcMain.handle(AttachmentChannels.change, async (event, input: unknown): Promise<ChangePdfAttachmentResultDto> => {
    try {
      const result = await changePdfAttachment(attachmentChangeDeps(event.sender), input)
      return result.ok ? (result.highlight ? { ok: true, highlight: toHighlightDto(result.highlight) } : { ok: true }) : result
    } catch (err) {
      console.warn('[attachments] change failed', err)
      return { ok: false, code: 'write_failed' }
    }
  })

  ipcMain.removeHandler(AttachmentChannels.saveAs)
  ipcMain.handle(AttachmentChannels.saveAs, async (event, input: unknown): Promise<AttachmentActionResult> => {
    currentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const { bookId, attachmentId } = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    return svc().saveAs(bookId, attachmentId)
  })
}

/**
 * App quit. Windows refuses to delete a file another process has open, so an attachment still in use
 * survives until the next start; elsewhere deleting would pull a file out from under the application
 * that opened it, so nothing is removed at quit and the next start cleans up.
 */
export function disposeAttachmentTemp(): void {
  if (process.platform !== 'win32') return
  try {
    // Synchronous: the process is about to exit and an async removal would never finish.
    fs.rmSync(attachmentTempRoot(), { recursive: true, force: true })
  } catch {
    // A file still open elsewhere stays; the next start retries.
  }
}

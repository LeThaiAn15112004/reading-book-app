import { SUPPORTED_EXTENSIONS, SUPPORTED_FORMATS } from '@reading-book/config'
import {
  Book,
  type BookSignatureInfo,
  type ImportResult as DomainImportResult,
} from '@reading-book/book-reader-sdk'
import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { getDocumentImporter } from '../adapters/importer-registry'
import { httpUrlFetcher, UrlFetchError } from '../adapters/http-url-fetcher'
import {
  assertSupportedExtension,
  assertSupportedUrlPathExtension,
  UnsupportedFormatError,
} from '../files/format-guard'
import { hashFile } from '../files/file-hash'
import {
  copyIntoBooksSandbox,
  isPathInsideUserData,
  removeCoverFile,
  removeManagedBookDir,
} from '../files/sandbox'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { verifyOnImport } from '../signature/book-signature'
import type {
  ImportErrorCode,
  ImportProgressDto,
  ImportResult,
  OkResult,
} from './api-types'
import { ImportChannels } from './channels'
import { beginCancellable, cancelInFlight, endCancellable } from './import-cancel'

/** Cancel key of the (single) in-flight import:fromUrl download. */
const URL_CANCEL_KEY = 'url'

/** Minimum gap between two byte-progress events sent to the renderer. */
const PROGRESS_INTERVAL_MS = 100

function extensionWithoutDot(ext: string): string {
  return ext.startsWith('.') ? ext.slice(1) : ext
}

function openDialogFilters(): Electron.FileFilter[] {
  return [
    {
      name: 'Documents',
      extensions: SUPPORTED_EXTENSIONS.map(extensionWithoutDot),
    },
    ...SUPPORTED_FORMATS.map((descriptor) => ({
      name: descriptor.displayName,
      extensions: descriptor.extensions.map(extensionWithoutDot),
    })),
  ]
}

function dialogParentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

/** A failed import with a stable code. `bookId` is only set for `duplicate`. */
export function importFailure(
  errorCode: ImportErrorCode,
  errorMessage: string,
  bookId: string | null = null,
): ImportResult {
  return { ok: false, bookId, errorCode, errorMessage }
}

function unsupportedResult(err: UnsupportedFormatError): ImportResult {
  return importFailure(err.code, err.message)
}

export function duplicateResult(bookId: string): ImportResult {
  return importFailure(
    'duplicate',
    'This book is already in your local library. Open the existing copy?',
    bookId,
  )
}

export function cancelledResult(): ImportResult {
  return importFailure('cancelled', 'Download cancelled.')
}

function saveFailedResult(): ImportResult {
  return importFailure('save_failed', 'Could not save the book to the library.')
}

function errnoCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object' || !('code' in err)) return undefined
  const code = (err as { code: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * Map a filesystem error raised while reading a book file to `missing_file` / `access_denied`;
 * null when `err` is not one of those.
 */
export function fileAccessFailure(err: unknown): ImportResult | null {
  const code = errnoCode(err)
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return importFailure(
      'missing_file',
      'The file could not be found. It may have been moved or deleted.',
    )
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return importFailure('access_denied', 'No permission to read this file.')
  }
  return null
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = errnoCode(err) ?? ''
  const message = err instanceof Error ? err.message : String(err)
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    message.includes('UNIQUE constraint failed')
  )
}

/** Best-effort progress event; a closed window must never fail the import. */
function sendProgress(sender: WebContents, progress: ImportProgressDto): void {
  try {
    if (!sender.isDestroyed()) sender.send(ImportChannels.progress, progress)
  } catch {
    // Renderer went away mid-import — the import itself still completes.
  }
}

/** Display name for a URL's file (basename only), used in progress events. */
function filenameFromUrl(url: string): string | undefined {
  try {
    const base = path.posix.basename(decodeURIComponent(new URL(url).pathname))
    return base && base.includes('.') ? base : undefined
  } catch {
    return undefined
  }
}

/**
 * BR-03 / T2.7: hash local file; if sha256 already in DB, return duplicate
 * before anything is copied or registered.
 */
export async function rejectIfDuplicate(localPath: string): Promise<ImportResult | null> {
  const { sha256 } = await hashFile(localPath)
  const existing = await getLibraryStore().findBySha256(sha256)
  if (!existing) return null
  return duplicateResult(existing.id)
}

/** Resolve format → extract metadata (T2.6). Reads `filePath`; never writes next to it. */
async function extractMetadata(filePath: string): Promise<DomainImportResult> {
  const format = assertSupportedExtension(filePath)
  return getDocumentImporter(format).import(filePath)
}

export type FinishImportOptions = {
  sourceUrl?: string
  /** Cloud Sources provenance — set when the file was fetched via Download/Read on a linked provider. */
  sourceProvider?: string
  externalId?: string
}

/**
 * T2.8: write books (+ authors + default reading session); return new book id.
 * On failure, the caller discards what the import itself created (see `finishImport`).
 */
function persistImportedBook(
  meta: DomainImportResult,
  options: FinishImportOptions = {},
  signature?: BookSignatureInfo,
): string {
  const now = new Date().toISOString()
  const book = new Book({
    id: randomUUID(),
    title: meta.title,
    filePath: meta.filePath,
    format: meta.format,
    coverPath: meta.coverPath,
    sha256: meta.sha256,
    fileSizeBytes: meta.fileSizeBytes,
    description: meta.description,
    pageCount: meta.pageCount,
    signature,
    sourceUrl: options.sourceUrl,
    sourceProvider: options.sourceProvider,
    externalId: options.externalId,
    addedAt: now,
    updatedAt: now,
  })
  getLibraryStore().persistImportedBook(
    book,
    meta.authorNames ?? [],
    meta.genreNames ?? [],
  )
  return book.id
}

/**
 * Extract metadata and register the book. Never throws: every failure becomes a stable code.
 *
 * `ownsFile` says whether `filePath` is an app-owned sandbox copy this import just made. Only then
 * may a failure delete it: a referenced book's file belongs to the user, and so does its folder.
 * The extracted cover is always app-owned and always cleaned up.
 */
async function finishImport(
  filePath: string,
  options: FinishImportOptions,
  ownsFile: boolean,
): Promise<ImportResult> {
  let coverPath: string | undefined
  const discardImportArtifacts = async (): Promise<void> => {
    if (ownsFile) await removeManagedBookDir(filePath).catch(() => {})
    await removeCoverFile(coverPath).catch(() => {})
  }

  let meta: DomainImportResult
  try {
    meta = await extractMetadata(filePath)
    coverPath = meta.coverPath
  } catch (err) {
    await discardImportArtifacts()
    if (err instanceof UnsupportedFormatError) return unsupportedResult(err)
    const access = fileAccessFailure(err)
    if (access) return access
    console.warn('[import] metadata extraction failed', err)
    return importFailure(
      'corrupted',
      'This file appears to be damaged or is not a valid book file.',
    )
  }

  // Signature status is detected (never created) while the file is at hand; a failure here only
  // leaves the book "not checked yet" and never fails the import.
  const signature = await verifyOnImport(meta.format, filePath, {
    sha256: meta.sha256,
    fileSizeBytes: meta.fileSizeBytes,
  })

  try {
    const bookId = persistImportedBook(meta, options, signature)
    return { ok: true, bookId }
  } catch (err) {
    await discardImportArtifacts()
    if (isUniqueConstraintError(err)) {
      const existing = await getLibraryStore()
        .findBySha256(meta.sha256)
        .catch(() => null)
      if (existing) return duplicateResult(existing.id)
    }
    console.warn('[import] saving the book failed', err)
    return saveFailedResult()
  }
}

/**
 * Register an app-owned sandbox copy (URL / cloud downloads — no lasting file on the user's disk).
 */
function finishImportAfterCopy(
  destPath: string,
  options: FinishImportOptions = {},
): Promise<ImportResult> {
  return finishImport(destPath, options, true)
}

/**
 * Format check → dedup → copy into the sandbox → metadata → persist, for a file just downloaded to
 * `tempPath` (URL or cloud). Shared by import:fromUrl and Cloud Sources download-and-import.
 * Never throws; the caller still owns (and removes) `tempPath`.
 */
export async function importDownloadedFile(
  tempPath: string,
  options: FinishImportOptions = {},
): Promise<ImportResult> {
  try {
    assertSupportedExtension(tempPath)
    const conflict = await rejectIfDuplicate(tempPath)
    if (conflict) return conflict
  } catch (err) {
    if (err instanceof UnsupportedFormatError) return unsupportedResult(err)
    const access = fileAccessFailure(err)
    if (access) return access
    console.warn('[import] reading the downloaded file failed', err)
    return saveFailedResult()
  }

  let destPath: string
  try {
    destPath = await copyIntoBooksSandbox(tempPath)
  } catch (err) {
    console.warn('[import] copying into the library failed', err)
    return saveFailedResult()
  }
  return finishImportAfterCopy(destPath, options)
}

/**
 * Register a file the user picked from their own filesystem, in place: only its absolute path is
 * stored (`books.file_path`). Nothing is copied, and nothing is ever deleted on failure.
 */
function finishImportByReference(
  sourcePath: string,
  options: FinishImportOptions = {},
): Promise<ImportResult> {
  return finishImport(sourcePath, options, false)
}

async function importFromFile(sender: WebContents): Promise<ImportResult> {
  const parent = dialogParentWindow()
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: openDialogFilters(),
  }

  let picked: Electron.OpenDialogReturnValue
  try {
    picked =
      parent !== undefined
        ? await dialog.showOpenDialog(parent, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
  } catch (err) {
    console.warn('[import] file dialog failed', err)
    return { ok: false, bookId: null, errorMessage: 'Could not open the file picker.' }
  }

  if (picked.canceled || picked.filePaths.length === 0) {
    return importFailure('cancelled', 'Import cancelled.')
  }

  // The path comes from the native dialog above, never from the renderer.
  const sourcePath = path.resolve(picked.filePaths[0])
  // Progress starts only now that a file is picked (never while the picker is open).
  sendProgress(sender, { stage: 'importing', filename: path.basename(sourcePath) })

  try {
    assertSupportedExtension(sourcePath)
    if (isPathInsideUserData(sourcePath)) {
      // Would be mistaken for an app-owned copy (and could be deleted as one).
      return importFailure(
        'inside_app_data',
        'Choose a book file outside the app’s own data folder.',
      )
    }
    const conflict = await rejectIfDuplicate(sourcePath)
    if (conflict) return conflict
  } catch (err) {
    if (err instanceof UnsupportedFormatError) return unsupportedResult(err)
    const access = fileAccessFailure(err)
    if (access) return access
    console.warn('[import] reading the selected file failed', err)
    return importFailure('access_denied', 'Could not read the selected file.')
  }

  return finishImportByReference(sourcePath)
}

async function importFromUrl(sender: WebContents, url: unknown): Promise<ImportResult> {
  if (typeof url !== 'string' || !url.trim()) {
    return importFailure('scheme', 'URL is required.')
  }

  const trimmed = url.trim()
  const filename = filenameFromUrl(trimmed)
  const controller = beginCancellable(URL_CANCEL_KEY)
  let tempPath: string | undefined

  try {
    assertSupportedUrlPathExtension(trimmed)

    sendProgress(sender, { stage: 'downloading', filename, receivedBytes: 0, totalBytes: null })
    let lastSentAt = 0
    const fetched = await httpUrlFetcher.fetch(trimmed, {
      signal: controller.signal,
      onProgress: (receivedBytes, totalBytes) => {
        const now = Date.now()
        if (now - lastSentAt < PROGRESS_INTERVAL_MS && receivedBytes !== totalBytes) return
        lastSentAt = now
        sendProgress(sender, { stage: 'downloading', filename, receivedBytes, totalBytes })
      },
    })
    tempPath = fetched.tempPath
    if (controller.signal.aborted) return cancelledResult()

    // The bytes are here: from now on the import is short and no longer cancellable.
    endCancellable(URL_CANCEL_KEY, controller)
    sendProgress(sender, { stage: 'importing', filename: fetched.suggestedFileName ?? filename })
    return await importDownloadedFile(tempPath, { sourceUrl: trimmed })
  } catch (err) {
    if (err instanceof UnsupportedFormatError) return unsupportedResult(err)
    if (err instanceof UrlFetchError) return importFailure(err.code, err.message)
    console.warn('[import] URL import failed', err)
    return importFailure('network', 'Could not download the file.')
  } finally {
    endCancellable(URL_CANCEL_KEY, controller)
    // T2.10: always drop download temp (success copy, duplicate, cancel or error).
    if (tempPath) {
      await fsp.rm(tempPath, { force: true }).catch(() => {})
    }
  }
}

/** Handlers for import:* — fromFile / fromUrl / cancel + dedup + persist (T2.3–T2.8). */
export function registerImportIpc(): void {
  ipcMain.removeHandler(ImportChannels.fromFile)
  ipcMain.handle(ImportChannels.fromFile, (event) => importFromFile(event.sender))

  ipcMain.removeHandler(ImportChannels.fromUrl)
  ipcMain.handle(ImportChannels.fromUrl, (event, url: unknown) =>
    importFromUrl(event.sender, url),
  )

  ipcMain.removeHandler(ImportChannels.cancel)
  ipcMain.handle(
    ImportChannels.cancel,
    (): OkResult => ({ ok: cancelInFlight(URL_CANCEL_KEY) }),
  )
}

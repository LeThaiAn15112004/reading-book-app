import { SUPPORTED_EXTENSIONS, SUPPORTED_FORMATS, features } from '@core/config'
import {
  Book,
  type BookSignatureInfo,
  type ImportResult as DomainImportResult,
} from '@core'
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
import { scheduleSignatureCheck } from '../signature/signature-queue'
import { signatureNeedsFileContent } from '../signature/signature-service'
import { fileTimingContext, mainTimer, timeStep, timingFormatOf } from '../perf/timing-log'
import type { TimingContext } from '@core'
import { holdPickedZip } from '../zip-import/picked-zip'
import type {
  ImportErrorCode,
  ImportProgressDto,
  ImportResult,
  OkResult,
} from './api-types'
import { ImportChannels } from './channels'
import { beginCancellable, cancelInFlight, endCancellable } from './import-cancel'
import { tMain } from '../i18n/main-translate'

/** Cancel key of the (single) in-flight import:fromUrl download. */
const URL_CANCEL_KEY = 'url'

/** Minimum gap between two byte-progress events sent to the renderer. */
const PROGRESS_INTERVAL_MS = 100

function extensionWithoutDot(ext: string): string {
  return ext.startsWith('.') ? ext.slice(1) : ext
}

/** Audiobook ZIPs are offered only while the ZIP import is switched on (`features.audiobookZipImportEnabled`). */
const zipEnabled = (): boolean => features.audiobookZipImportEnabled

function openDialogFilters(): Electron.FileFilter[] {
  const zip = zipEnabled()
  return [
    {
      name: tMain('main.shell.dialogs.documents'),
      extensions: [...SUPPORTED_EXTENSIONS.map(extensionWithoutDot), ...(zip ? ['zip'] : [])],
    },
    ...SUPPORTED_FORMATS.map((descriptor) => ({
      name: descriptor.displayName,
      extensions: descriptor.extensions.map(extensionWithoutDot),
    })),
    ...(zip ? [{ name: tMain('main.shell.dialogs.audiobookZip'), extensions: ['zip'] }] : []),
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
    tMain('main.messages.import.duplicate'),
    bookId,
  )
}

export function cancelledResult(): ImportResult {
  return importFailure('cancelled', tMain('main.messages.import.downloadCancelled'))
}

function saveFailedResult(): ImportResult {
  return importFailure('save_failed', tMain('main.messages.import.saveFailed'))
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
      tMain('main.messages.import.fileMissing'),
    )
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return importFailure('access_denied', tMain('main.messages.import.noPermission'))
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
export async function rejectIfDuplicate(
  localPath: string,
  timing: TimingContext | null = null,
): Promise<ImportResult | null> {
  const checked = await fingerprintAndCheck(localPath, timing)
  return 'conflict' in checked ? checked.conflict : null
}

/**
 * Spec 016 (FR-003, research R2): the file's one fingerprint for this import, plus what it looked like on disk when
 * it was read (size + modified time) so a change before "Saving" can be detected.
 */
export type ImportFingerprint = {
  known: { sha256: string; fileSizeBytes: number }
  onDisk: { size: number; mtimeMs: number }
}

export type FingerprintOptions = {
  signal?: AbortSignal
  onProgress?: (doneBytes: number, totalBytes: number) => void
  pause?: () => Promise<void> | void
}

/** Hashes `localPath` ONCE and checks for a duplicate; the hash is reused for the library entry. */
export async function fingerprintAndCheck(
  localPath: string,
  timing: TimingContext | null = null,
  options: FingerprintOptions = {},
): Promise<{ conflict: ImportResult } | { fingerprint: ImportFingerprint }> {
  const before = await fsp.stat(localPath)
  const { sha256, fileSizeBytes } = await timeStep('import', 'fingerprint', timing, () => hashFile(localPath, options))
  const existing = await timeStep('import', 'duplicate-check', timing, () => getLibraryStore().findBySha256(sha256))
  if (existing) return { conflict: duplicateResult(existing.id) }
  return { fingerprint: { known: { sha256, fileSizeBytes }, onDisk: { size: before.size, mtimeMs: before.mtimeMs } } }
}

/** `true` when the file is no longer the one that was fingerprinted (moved, removed, resized or rewritten). */
async function fileChangedSince(filePath: string, fingerprint: ImportFingerprint): Promise<boolean> {
  try {
    const now = await fsp.stat(filePath)
    return now.size !== fingerprint.onDisk.size || now.mtimeMs !== fingerprint.onDisk.mtimeMs
  } catch {
    return true
  }
}

export function fileChangedResult(): ImportResult {
  return importFailure('file_changed', tMain('main.messages.import.fileChanged'))
}

/** Resolve format → extract metadata (T2.6). Reads `filePath`; never writes next to it. */
async function extractMetadata(
  filePath: string,
  known?: ImportFingerprint['known'],
): Promise<DomainImportResult> {
  const format = assertSupportedExtension(filePath)
  return getDocumentImporter(format).import(filePath, known ? { known } : undefined)
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
  timing: TimingContext | null = null,
  fingerprint?: ImportFingerprint,
): Promise<ImportResult> {
  let coverPath: string | undefined
  const discardImportArtifacts = async (): Promise<void> => {
    if (ownsFile) await removeManagedBookDir(filePath).catch(() => {})
    await removeCoverFile(coverPath).catch(() => {})
  }

  let meta: DomainImportResult
  try {
    meta = await timeStep('import', 'details', timing, () => extractMetadata(filePath, fingerprint?.known))
    coverPath = meta.coverPath
  } catch (err) {
    await discardImportArtifacts()
    if (err instanceof UnsupportedFormatError) return unsupportedResult(err)
    const access = fileAccessFailure(err)
    if (access) return access
    console.warn('[import] metadata extraction failed', err)
    return importFailure(
      'corrupted',
      tMain('main.messages.import.damaged'),
    )
  }

  // Spec 016 (FR-003 / edge case): a referenced file that changed or vanished since it was fingerprinted is not
  // added — its hash would not describe it any more.
  if (fingerprint && !ownsFile && (await fileChangedSince(filePath, fingerprint))) {
    await discardImportArtifacts()
    return fileChangedResult()
  }

  // Spec 016 (FR-005): a format whose signature needs the file's content (PDF) is checked AFTER saving, in the
  // background (`scheduleSignatureCheck` below); until then the book is "not checked yet". Every other format gets
  // its format-only answer now, as before, without reading the file.
  const checkLater = signatureNeedsFileContent(meta.format)
  const signature = checkLater
    ? undefined
    : await timeStep('import', 'signature', timing, () =>
        verifyOnImport(meta.format, filePath, {
          sha256: meta.sha256,
          fileSizeBytes: meta.fileSizeBytes,
        }),
      )

  try {
    const bookId = await timeStep('import', 'save', timing, () => persistImportedBook(meta, options, signature))
    if (checkLater) scheduleSignatureCheck(bookId)
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
  timing: TimingContext | null = null,
  fingerprint?: ImportFingerprint,
): Promise<ImportResult> {
  return finishImport(destPath, options, true, timing, fingerprint)
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
  const timing = await fileTimingContext(tempPath)
  let fingerprint: ImportFingerprint
  try {
    assertSupportedExtension(tempPath)
    const checked = await fingerprintAndCheck(tempPath, timing)
    if ('conflict' in checked) return checked.conflict
    fingerprint = checked.fingerprint
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
  return finishImportAfterCopy(destPath, options, timing, fingerprint)
}

/**
 * Register a file the user picked from their own filesystem, in place: only its absolute path is
 * stored (`books.file_path`). Nothing is copied, and nothing is ever deleted on failure.
 */
function finishImportByReference(
  sourcePath: string,
  options: FinishImportOptions = {},
  timing: TimingContext | null = null,
  fingerprint?: ImportFingerprint,
): Promise<ImportResult> {
  return finishImport(sourcePath, options, false, timing, fingerprint)
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
    return { ok: false, bookId: null, errorMessage: tMain('main.messages.import.pickerFailed') }
  }

  if (picked.canceled || picked.filePaths.length === 0) {
    return importFailure('cancelled', tMain('main.messages.import.cancelled'))
  }

  // The path comes from the native dialog above, never from the renderer.
  const sourcePath = path.resolve(picked.filePaths[0])
  // An audiobook ZIP is not imported here: Main keeps its path for the one follow-up call that opens the preview
  // (the renderer never learns it) and tells the renderer to do that. No progress overlay is shown for it.
  if (zipEnabled() && path.extname(sourcePath).toLowerCase() === '.zip') {
    holdPickedZip(sourcePath)
    return importFailure('audiobook_zip', 'This is an audiobook ZIP; opening its preview.')
  }
  // Progress starts only now that a file is picked (never while the picker is open).
  sendProgress(sender, { stage: 'importing', filename: path.basename(sourcePath) })
  const timing = await fileTimingContext(sourcePath)

  let fingerprint: ImportFingerprint
  try {
    assertSupportedExtension(sourcePath)
    if (isPathInsideUserData(sourcePath)) {
      // Would be mistaken for an app-owned copy (and could be deleted as one).
      return importFailure(
        'inside_app_data',
        tMain('main.messages.import.outsideDataFolder'),
      )
    }
    const checked = await fingerprintAndCheck(sourcePath, timing)
    if ('conflict' in checked) return checked.conflict
    fingerprint = checked.fingerprint
  } catch (err) {
    if (err instanceof UnsupportedFormatError) return unsupportedResult(err)
    const access = fileAccessFailure(err)
    if (access) return access
    console.warn('[import] reading the selected file failed', err)
    return importFailure('access_denied', tMain('main.messages.import.selectedUnreadable'))
  }

  return finishImportByReference(sourcePath, {}, timing, fingerprint)
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
    const downloadStartedAt = Date.now()
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
    const downloaded = await fileTimingContext(tempPath)
    if (downloaded) {
      mainTimer().record('import', 'download', { ...downloaded, format: timingFormatOf(fetched.suggestedFileName ?? tempPath) }, Date.now() - downloadStartedAt)
    }

    // The bytes are here: from now on the import is short and no longer cancellable.
    endCancellable(URL_CANCEL_KEY, controller)
    sendProgress(sender, { stage: 'importing', filename: fetched.suggestedFileName ?? filename })
    return await importDownloadedFile(tempPath, { sourceUrl: trimmed })
  } catch (err) {
    if (err instanceof UnsupportedFormatError) return unsupportedResult(err)
    if (err instanceof UrlFetchError) return importFailure(err.code, err.message)
    console.warn('[import] URL import failed', err)
    return importFailure('network', tMain('main.messages.import.downloadFileFailed'))
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

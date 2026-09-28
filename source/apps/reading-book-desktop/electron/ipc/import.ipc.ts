import { SUPPORTED_EXTENSIONS, SUPPORTED_FORMATS } from '@reading-book/config'
import {
  Book,
  type ImportResult as DomainImportResult,
} from '@reading-book/book-reader-sdk'
import { BrowserWindow, dialog, ipcMain } from 'electron'
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
import type { ImportResult } from './api-types'
import { ImportChannels } from './channels'

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

function unsupportedResult(err: UnsupportedFormatError): ImportResult {
  return {
    ok: false,
    bookId: null,
    errorCode: err.code,
    errorMessage: err.message,
  }
}

function duplicateResult(bookId: string): ImportResult {
  return {
    ok: false,
    bookId,
    errorCode: 'duplicate',
    errorMessage:
      'This book is already in your local library. Open the existing copy?',
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = 'code' in err ? String((err as { code: unknown }).code) : ''
  const message = err instanceof Error ? err.message : String(err)
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    message.includes('UNIQUE constraint failed')
  )
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
 * Extract metadata and register the book.
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
    await removeCoverFile(coverPath)
  }

  try {
    const meta = await extractMetadata(filePath)
    coverPath = meta.coverPath
    try {
      const bookId = persistImportedBook(meta, options)
      return { ok: true, bookId }
    } catch (err) {
      await discardImportArtifacts()
      if (isUniqueConstraintError(err)) {
        const existing = await getLibraryStore().findBySha256(meta.sha256)
        if (existing) return duplicateResult(existing.id)
      }
      return {
        ok: false,
        bookId: null,
        errorCode: 'copy_failed',
        errorMessage: 'Could not save the book to the library.',
      }
    }
  } catch (err) {
    await discardImportArtifacts()
    if (err instanceof UnsupportedFormatError) {
      return unsupportedResult(err)
    }
    return {
      ok: false,
      bookId: null,
      errorCode: 'copy_failed',
      errorMessage: 'Could not read book metadata.',
    }
  }
}

/**
 * Register an app-owned sandbox copy (URL / cloud downloads — no lasting file on the user's disk).
 * Shared by import:fromUrl and Cloud Sources download-and-import.
 */
export function finishImportAfterCopy(
  destPath: string,
  options: FinishImportOptions = {},
): Promise<ImportResult> {
  return finishImport(destPath, options, true)
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

/** Handlers for import:* — fromFile / fromUrl + dedup + persist (T2.3–T2.8). */
export function registerImportIpc(): void {
  ipcMain.removeHandler(ImportChannels.fromFile)
  ipcMain.handle(ImportChannels.fromFile, async (): Promise<ImportResult> => {
    const parent = dialogParentWindow()
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: openDialogFilters(),
    }

    const { canceled, filePaths } =
      parent !== undefined
        ? await dialog.showOpenDialog(parent, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

    if (canceled || filePaths.length === 0) {
      return { ok: false, bookId: null }
    }

    // The path comes from the native dialog above, never from the renderer.
    const sourcePath = path.resolve(filePaths[0])

    try {
      assertSupportedExtension(sourcePath)
      if (isPathInsideUserData(sourcePath)) {
        // Would be mistaken for an app-owned copy (and could be deleted as one).
        return {
          ok: false,
          bookId: null,
          errorCode: 'copy_failed',
          errorMessage: 'Choose a book file outside the app’s own data folder.',
        }
      }
      const conflict = await rejectIfDuplicate(sourcePath)
      if (conflict) return conflict

      return await finishImportByReference(sourcePath)
    } catch (err) {
      if (err instanceof UnsupportedFormatError) {
        return unsupportedResult(err)
      }
      return {
        ok: false,
        bookId: null,
        errorCode: 'copy_failed',
        errorMessage: 'Could not read the selected file.',
      }
    }
  })

  ipcMain.removeHandler(ImportChannels.fromUrl)
  ipcMain.handle(ImportChannels.fromUrl, async (_event, url: unknown): Promise<ImportResult> => {
    if (typeof url !== 'string' || !url.trim()) {
      return {
        ok: false,
        bookId: null,
        errorCode: 'scheme',
        errorMessage: 'URL is required.',
      }
    }

    const trimmed = url.trim()
    let tempPath: string | undefined

    try {
      assertSupportedUrlPathExtension(trimmed)
      const fetched = await httpUrlFetcher.fetch(trimmed)
      tempPath = fetched.tempPath
      assertSupportedExtension(tempPath)

      const conflict = await rejectIfDuplicate(tempPath)
      if (conflict) return conflict

      const destPath = await copyIntoBooksSandbox(tempPath)
      return finishImportAfterCopy(destPath, { sourceUrl: trimmed })
    } catch (err) {
      if (err instanceof UnsupportedFormatError) {
        return unsupportedResult(err)
      }
      if (err instanceof UrlFetchError) {
        return {
          ok: false,
          bookId: null,
          errorCode: err.code,
          errorMessage: err.message,
        }
      }
      return {
        ok: false,
        bookId: null,
        errorCode: 'copy_failed',
        errorMessage: 'Could not save downloaded file.',
      }
    } finally {
      // T2.10: always drop download temp (success copy, duplicate, or error).
      if (tempPath) {
        await fsp.rm(tempPath, { force: true }).catch(() => {})
      }
    }
  })
}

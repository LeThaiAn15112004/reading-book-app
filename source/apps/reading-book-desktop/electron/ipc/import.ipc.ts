import { SUPPORTED_EXTENSIONS, SUPPORTED_FORMATS } from '@reading-book/config'
import {
  Book,
  type ImportResult as DomainImportResult,
} from '@reading-book/domain'
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
import { copyIntoBooksSandbox } from '../files/sandbox'
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

/** Remove `{userData}/books/{uuid}/` folder after a failed persist (T2.8 / T2.10). */
async function removeSandboxBookDir(destFilePath: string): Promise<void> {
  const dir = path.dirname(destFilePath)
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
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
 * without copying into the sandbox.
 */
async function rejectIfDuplicate(localPath: string): Promise<ImportResult | null> {
  const { sha256 } = await hashFile(localPath)
  const existing = await getLibraryStore().findBySha256(sha256)
  if (!existing) return null
  return duplicateResult(existing.id)
}

/** After sandbox copy: resolve format → extract metadata (T2.6). */
async function extractMetadataAfterCopy(
  destPath: string,
): Promise<DomainImportResult> {
  const format = assertSupportedExtension(destPath)
  return getDocumentImporter(format).import(destPath)
}

/**
 * T2.8: write books (+ authors + default reading session); return new book id.
 * On failure, caller should remove the sandbox copy.
 */
function persistImportedBook(
  meta: DomainImportResult,
  options: { sourceUrl?: string } = {},
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
    sourceUrl: options.sourceUrl,
    addedAt: now,
    updatedAt: now,
  })
  getLibraryStore().persistImportedBook(book, meta.authorNames ?? [])
  return book.id
}

async function finishImportAfterCopy(
  destPath: string,
  options: { sourceUrl?: string } = {},
): Promise<ImportResult> {
  try {
    const meta = await extractMetadataAfterCopy(destPath)
    try {
      const bookId = persistImportedBook(meta, options)
      return { ok: true, bookId }
    } catch (err) {
      await removeSandboxBookDir(destPath)
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
    await removeSandboxBookDir(destPath)
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

    const sourcePath = filePaths[0]

    try {
      assertSupportedExtension(sourcePath)
      const conflict = await rejectIfDuplicate(sourcePath)
      if (conflict) return conflict

      const destPath = await copyIntoBooksSandbox(sourcePath)
      return finishImportAfterCopy(destPath)
    } catch (err) {
      if (err instanceof UnsupportedFormatError) {
        return unsupportedResult(err)
      }
      return {
        ok: false,
        bookId: null,
        errorCode: 'copy_failed',
        errorMessage: 'Could not copy file into the library sandbox.',
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

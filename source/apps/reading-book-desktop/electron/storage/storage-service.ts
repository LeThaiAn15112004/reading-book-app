import { app, session, shell } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { clearBookChunkCache, isBookChunkingActive } from '../chunking/book-chunk-service'
import { ensureBooksSandbox, getBooksSandboxPath } from '../files/sandbox'
import { getDatabase } from '../persistence/db'
import {
  getTranslationModelsDir,
  releaseTranslationWorker,
} from '../translation/translation-service'
import type {
  ClearCacheResult,
  OkResult,
  RemoveTranslationModelResult,
  StorageUsageDto,
  TranslationModelDto,
} from '../ipc/api-types'

/**
 * Settings → Storage (SCR-06). Read-only usage figures plus two narrowly scoped deletions:
 *
 * - Clear Cache: Chromium's HTTP cache + the rebuildable `book_chunks` / FTS5 search index.
 * - Remove translation model: one downloaded model folder under `{userData}/models`.
 *
 * Book files, covers, the database's books/notes/sessions/collections and cloud tokens are never
 * deleted here.
 */

/** Recursive size of a directory in bytes; missing / unreadable entries count as 0. */
async function directorySize(dir: string): Promise<number> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) return 0
      if (entry.isDirectory()) return directorySize(full)
      try {
        return (await fsp.stat(full)).size
      } catch {
        return 0
      }
    }),
  )
  return sizes.reduce((sum, size) => sum + size, 0)
}

/**
 * Bytes the search index occupies inside the SQLite file (`book_chunks` + its index + the FTS5
 * shadow tables), via the `dbstat` virtual table. Null when dbstat is unavailable.
 */
function searchIndexBytes(): number | null {
  try {
    const row = getDatabase()
      .prepare(
        `SELECT COALESCE(SUM(pgsize), 0) AS bytes FROM dbstat
          WHERE name LIKE 'book_chunks%'
             OR name = 'idx_book_chunks_book_index'
             OR name LIKE 'sqlite_autoindex_book_chunks%'`,
      )
      .get() as { bytes: number } | undefined
    return row?.bytes ?? 0
  } catch {
    return null
  }
}

async function browserCacheBytes(): Promise<number> {
  try {
    return await session.defaultSession.getCacheSize()
  } catch {
    return 0
  }
}

/** Model ids look like `Xenova/opus-mt-en-vi` (one org folder + one model folder). */
const MODEL_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

async function listTranslationModels(): Promise<TranslationModelDto[]> {
  const root = getTranslationModelsDir()
  let orgs: import('node:fs').Dirent[]
  try {
    orgs = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const models: TranslationModelDto[] = []
  for (const org of orgs) {
    if (!org.isDirectory() || !MODEL_SEGMENT.test(org.name)) continue
    let names: import('node:fs').Dirent[]
    try {
      names = await fsp.readdir(path.join(root, org.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.isDirectory() || !MODEL_SEGMENT.test(name.name)) continue
      const bytes = await directorySize(path.join(root, org.name, name.name))
      models.push({ id: `${org.name}/${name.name}`, bytes })
    }
  }
  return models.sort((a, b) => a.id.localeCompare(b.id))
}

export async function getStorageUsage(): Promise<StorageUsageDto> {
  const userData = app.getPath('userData')
  const [totalUserData, booksBytes, browserCache, translationModels] = await Promise.all([
    directorySize(userData),
    directorySize(getBooksSandboxPath()),
    browserCacheBytes(),
    listTranslationModels(),
  ])
  const searchIndex = searchIndexBytes()
  const translationModelsBytes = translationModels.reduce((sum, m) => sum + m.bytes, 0)
  const cacheBytes = browserCache + (searchIndex ?? 0)
  const otherBytes = Math.max(0, totalUserData - booksBytes - translationModelsBytes - cacheBytes)

  return {
    booksFolderPath: getBooksSandboxPath(),
    booksBytes,
    cacheBytes,
    browserCacheBytes: browserCache,
    searchIndexBytes: searchIndex,
    translationModelsBytes,
    otherBytes,
    totalBytes: booksBytes + cacheBytes + translationModelsBytes + otherBytes,
    translationModels,
  }
}

/** Clear Chromium's HTTP cache and the rebuildable search index; nothing else. */
export async function clearCache(): Promise<ClearCacheResult> {
  if (isBookChunkingActive()) {
    return {
      ok: false,
      errorCode: 'busy',
      errorMessage: 'A book is being indexed right now. Try again in a moment.',
    }
  }
  try {
    if (!clearBookChunkCache()) {
      return {
        ok: false,
        errorCode: 'busy',
        errorMessage: 'A book is being indexed right now. Try again in a moment.',
      }
    }
    await session.defaultSession.clearCache()
    // Give the freed pages back to the file system (the index can be large).
    getDatabase().exec('VACUUM')
    return { ok: true }
  } catch (err) {
    console.warn('[storage] clear cache failed', err)
    return { ok: false, errorCode: 'failed', errorMessage: 'Could not clear the cache.' }
  }
}

/** Delete one downloaded translation model folder. The id must match a listed model. */
export async function removeTranslationModel(
  modelId: unknown,
): Promise<RemoveTranslationModelResult> {
  if (typeof modelId !== 'string') {
    return { ok: false, errorCode: 'not_found', errorMessage: 'Unknown translation model.' }
  }
  const [org, name, ...rest] = modelId.split('/')
  if (!org || !name || rest.length > 0 || !MODEL_SEGMENT.test(org) || !MODEL_SEGMENT.test(name)) {
    return { ok: false, errorCode: 'not_found', errorMessage: 'Unknown translation model.' }
  }
  const models = await listTranslationModels()
  if (!models.some((m) => m.id === modelId)) {
    return { ok: false, errorCode: 'not_found', errorMessage: 'This model is no longer on disk.' }
  }
  if (!releaseTranslationWorker()) {
    return {
      ok: false,
      errorCode: 'busy',
      errorMessage: 'A translation is in progress. Try again when it finishes.',
    }
  }
  const root = getTranslationModelsDir()
  const target = path.resolve(root, org, name)
  if (path.dirname(path.dirname(target)) !== path.resolve(root)) {
    return { ok: false, errorCode: 'not_found', errorMessage: 'Unknown translation model.' }
  }
  try {
    await fsp.rm(target, { recursive: true, force: true })
    // Drop the org folder once its last model is gone.
    await fsp.rmdir(path.dirname(target)).catch(() => {})
    return { ok: true }
  } catch (err) {
    console.warn('[storage] removing translation model failed', err)
    return { ok: false, errorCode: 'failed', errorMessage: 'Could not remove the model.' }
  }
}

/** Open the managed-books folder in the OS file manager (path never comes from the renderer). */
export async function openBooksFolder(): Promise<OkResult> {
  try {
    const error = await shell.openPath(ensureBooksSandbox())
    return { ok: error === '' }
  } catch {
    return { ok: false }
  }
}

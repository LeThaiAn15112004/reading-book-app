/**
 * Electron MAIN process composition root.
 *
 * Split of responsibilities in Electron:
 *  - MAIN owns an SDK instance with real I/O (SQLite, fs, zip) → library import/delete, and it is
 *    what the `overlay:*` IPC handlers call.
 *  - RENDERER owns another SDK instance whose storage forwards over IPC (renderer/ipc-storage.ts)
 *    → the reactive stores the Reader UI binds to.
 * Both run the same SDK code; only the injected adapters differ.
 *
 * The SDK is imported by relative path. In the desktop app that is
 * `../../../book-reader-sdk/dist/index.mjs` from `electron/sdk/`, or add a
 * `@reading-book/book-reader-sdk` alias in tsconfig `paths` + vite `resolve.alias`.
 */
import Database from 'better-sqlite3'
import { join } from 'node:path'
import {
  createBookReaderSdk,
  createSqlNoteRepositories,
  isSdkError,
  type BookReaderSdk,
} from '../../../dist/index.mjs'
import { createDesktopLibraryRepository, createDesktopSessionRepository } from './desktop-sqlite-storage.js'
import { betterSqliteDatabase, jszipArchive, nodeFileSystem, nodeHash, nodeIds } from './node-adapters.js'

export async function createMainProcessSdk(userDataDir: string): Promise<{ sdk: BookReaderSdk; close(): void }> {
  const db = new Database(join(userDataDir, 'reading-book.db'))
  db.pragma('foreign_keys = ON')
  const sql = betterSqliteDatabase(db)
  const notes = createSqlNoteRepositories(sql)

  const sdk = createBookReaderSdk({
    adapters: {
      storage: {
        library: createDesktopLibraryRepository(sql, nodeIds),
        sessions: createDesktopSessionRepository(sql),
        annotations: notes.annotations,
        bookmarks: notes.bookmarks,
      },
      fileSystem: await nodeFileSystem(join(userDataDir, 'library')),
      archive: jszipArchive,
      hash: nodeHash,
      ids: nodeIds,
    },
  })

  sdk.events.on('error', ({ scope, operation, error }) => {
    console.error(`[sdk] ${scope}.${operation}: ${error.code} ${error.message}`)
  })

  return {
    sdk,
    close: () => {
      void sdk.dispose().finally(() => db.close())
    },
  }
}

/**
 * What an IPC handler looks like once it delegates to the SDK (compare with the current
 * `electron/ipc/import.ipc.ts`): validation, dedupe, metadata and rollback live in the SDK.
 *
 *   ipcMain.handle(ImportChannels.importFile, (_e, path: string) => importViaSdk(sdk, path))
 */
export async function importViaSdk(sdk: BookReaderSdk, sourcePath: string) {
  try {
    const outcome = await sdk.services.library.importFile({ sourceRef: sourcePath })
    return { ok: true, bookId: outcome.book.id, duplicate: outcome.status === 'duplicate' }
  } catch (err) {
    return {
      ok: false,
      bookId: null,
      errorCode: isSdkError(err) ? err.code : 'UNKNOWN',
      errorMessage: err instanceof Error ? err.message : String(err),
    }
  }
}

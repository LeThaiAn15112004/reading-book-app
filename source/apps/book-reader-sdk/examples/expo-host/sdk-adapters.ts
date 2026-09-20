/**
 * Expo / React Native host — TEMPLATE, not compiled in this repo (expo-* packages are not
 * installed here). Shows that the same SDK runs on mobile with only the adapters swapped.
 *
 * Host dependencies: expo-sqlite, expo-file-system, expo-crypto, fflate.
 * Metro must be allowed to read the SDK folder — see metro.config.js next to this file.
 */
import * as Crypto from 'expo-crypto'
import * as FileSystem from 'expo-file-system/legacy'
import * as SQLite from 'expo-sqlite'
import { unzipSync } from 'fflate'
import { useSyncExternalStore } from 'react'
import {
  createBookReaderSdk,
  createSqlNoteRepositories,
  createStoreHook,
  ensureNotesSchema,
  type ArchiveAdapter,
  type FileSystemAdapter,
  type ReadingSessionRepository,
  type LibraryRepository,
  type SqlDatabase,
} from '@reading-book/book-reader-sdk' // alias → ../book-reader-sdk (metro.config.js + tsconfig paths)

const SANDBOX = `${FileSystem.documentDirectory}library/`

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function expoSqlDatabase(db: SQLite.SQLiteDatabase): SqlDatabase {
  return {
    async run(sql, params = []) {
      const result = await db.runAsync(sql, [...params])
      return { changes: result.changes }
    },
    all: (sql, params = []) => db.getAllAsync(sql, [...params]),
  }
}

export const expoFileSystem: FileSystemAdapter = {
  readBytes: async (uri) => fromBase64(await FileSystem.readAsStringAsync(uri, { encoding: 'base64' })),
  async copyToSandbox(source, targetName) {
    await FileSystem.makeDirectoryAsync(SANDBOX, { intermediates: true })
    const to = SANDBOX + targetName
    await FileSystem.copyAsync({ from: source, to })
    return to
  },
  async writeSandboxFile(targetName, bytes) {
    await FileSystem.makeDirectoryAsync(SANDBOX, { intermediates: true })
    const to = SANDBOX + targetName
    await FileSystem.writeAsStringAsync(to, toBase64(bytes), { encoding: 'base64' })
    return to
  },
  async removeSandboxFile(uri) {
    if (!uri.startsWith(SANDBOX)) throw new Error(`Refusing to delete outside the sandbox: ${uri}`)
    await FileSystem.deleteAsync(uri, { idempotent: true })
  },
  exists: async (uri) => (await FileSystem.getInfoAsync(uri)).exists,
}

export const fflateArchive: ArchiveAdapter = {
  async open(bytes) {
    const entries = unzipSync(bytes)
    return {
      listEntries: () => Object.keys(entries),
      readBytes: async (path) => entries[path] ?? null,
      readText: async (path) => (entries[path] ? new TextDecoder().decode(entries[path]) : null),
    }
  },
}

export async function createMobileSdk(repos: { library: LibraryRepository; sessions: ReadingSessionRepository }) {
  const db = await SQLite.openDatabaseAsync('reading-book.db')
  const sql = expoSqlDatabase(db)
  await ensureNotesSchema(sql) // fresh install: the SDK owns the `notes` DDL
  const notes = createSqlNoteRepositories(sql)

  const sdk = createBookReaderSdk({
    adapters: {
      storage: { ...repos, annotations: notes.annotations, bookmarks: notes.bookmarks },
      fileSystem: expoFileSystem,
      archive: fflateArchive,
      // React Native has no crypto.subtle / randomUUID → these two MUST be injected.
      hash: {
        sha256Hex: async (bytes) => {
          const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)
          return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
        },
      },
      ids: { newId: () => Crypto.randomUUID() },
    },
  })

  return {
    sdk,
    useAnnotations: createStoreHook(sdk.stores.annotations, useSyncExternalStore),
    useSession: createStoreHook(sdk.stores.session, useSyncExternalStore),
  }
}

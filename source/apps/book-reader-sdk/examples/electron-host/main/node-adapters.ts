/**
 * Electron MAIN process — Node-only implementations of the SDK ports.
 * `better-sqlite3`, `node:fs`, `node:crypto` and `jszip` are imported HERE, by the host, never by
 * the SDK. Drop-in location in the desktop app: `electron/sdk/`.
 */
import type BetterSqlite3 from 'better-sqlite3'
import JSZip from 'jszip'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type {
  ArchiveAdapter,
  FileSystemAdapter,
  HashAdapter,
  IdGenerator,
  SqlDatabase,
  SqlValue,
} from '../../../dist/index.mjs'

/** better-sqlite3 is synchronous; the port is async so IPC/expo drivers fit the same contract. */
export function betterSqliteDatabase(db: BetterSqlite3.Database): SqlDatabase {
  const bind = (params: readonly SqlValue[] | undefined) => (params ?? []).map((p) => (p instanceof Uint8Array ? Buffer.from(p) : p))
  return {
    async run(sql, params) {
      const { changes } = db.prepare(sql).run(...bind(params))
      return { changes }
    },
    async all<Row>(sql: string, params?: readonly SqlValue[]) {
      return db.prepare(sql).all(...bind(params)) as Row[]
    },
  }
}

/**
 * Sandbox = `<userData>/library`. `removeSandboxFile` refuses anything outside it, so even a
 * corrupted `fileRef` row can never make the SDK delete a user's original file.
 */
export async function nodeFileSystem(sandboxDir: string): Promise<FileSystemAdapter> {
  const sandbox = resolve(sandboxDir)
  await mkdir(sandbox, { recursive: true })
  const insideSandbox = (ref: string) => resolve(ref).startsWith(sandbox + sep)

  return {
    readBytes: async (ref) => new Uint8Array(await readFile(ref)),
    async copyToSandbox(source, targetName) {
      const target = join(sandbox, targetName)
      await copyFile(source, target)
      return target
    },
    async writeSandboxFile(targetName, bytes) {
      const target = join(sandbox, targetName)
      await writeFile(target, bytes)
      return target
    },
    async removeSandboxFile(ref) {
      if (!insideSandbox(ref)) throw new Error(`Refusing to delete outside the sandbox: ${ref}`)
      await rm(ref, { force: true })
    },
    exists: (ref) =>
      stat(ref).then(
        () => true,
        () => false,
      ),
  }
}

export const jszipArchive: ArchiveAdapter = {
  async open(bytes) {
    const zip = await JSZip.loadAsync(bytes)
    const file = (path: string) => zip.file(path.replace(/^\/+/, ''))
    return {
      listEntries: () => Object.keys(zip.files).filter((name) => !zip.files[name]?.dir),
      readText: async (path) => (await file(path)?.async('string')) ?? null,
      readBytes: async (path) => (await file(path)?.async('uint8array')) ?? null,
    }
  },
}

/** Faster than WebCrypto for large files in main, and avoids copying into an ArrayBuffer. */
export const nodeHash: HashAdapter = {
  sha256Hex: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
}

export const nodeIds: IdGenerator = { newId: () => randomUUID() }

/**
 * A host for the bridge tests (spec 008, T047–T049): the REAL dispatcher, `sql` / `files` / `app` services of
 * `src/host/`, over `node:sqlite` and an in-memory file system, joined to the REAL bridge by an in-memory transport
 * that crosses the same JSON boundary as `postMessage` / `injectJavaScript`. Only the device parts are fakes: the
 * picker (a queue of files), the disk (a map, with injectable failures), the opener and the local server.
 */
import { DatabaseSync } from 'node:sqlite'
import { createAppService } from '../host/app-service'
import { createFileService, type ByteReader, type HostFs, type PickedDocument } from '../host/file-service'
import { RPC_VERSION, type BootValues, type HostEvent, type ImportProgressPayload } from '../host/protocol'
import { createRpcDispatcher } from '../host/rpc'
import { createSqlService, type SqlEngine, type SqlEngineConnection, type SqlParam } from '../host/sql-service'
import { createMobileApi, prepareMobileStorage, type DesktopApi } from '../bridge'
import type { BridgeContext } from '../bridge/context'
import { createHostClient, type HostTransport } from '../bridge/host-client'

export const UI_ORIGIN = 'http://192.168.1.20:8081'

export class MemoryFs implements HostFs {
  readonly files = new Map<string, Uint8Array>()
  readonly dirs = new Set<string>()
  readonly picks: Array<{ name: string; bytes: Uint8Array } | null> = []
  private readonly cache = new Map<string, Uint8Array>()
  private uriCounter = 0
  available = 10 * 1024 * 1024 * 1024
  /** Makes the Nth write of a copy (1-based) throw this message, e.g. `ENOSPC: no space left on device`. */
  failWriteAt: { count: number; message: string } | null = null
  failMove = false
  private writes = 0

  queuePick(name: string, bytes: Uint8Array | string) {
    this.picks.push({ name, bytes: typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes })
  }
  queueCancelledPick() {
    this.picks.push(null)
  }
  cacheUris(): string[] {
    return [...this.cache.keys()]
  }
  paths(): string[] {
    return [...this.files.keys()].sort()
  }

  async pickDocument(): Promise<PickedDocument | null> {
    const next = this.picks.shift()
    if (!next) return null
    const uri = `file:///cache/DocumentPicker/${++this.uriCounter}-${next.name}`
    this.cache.set(uri, next.bytes)
    return { uri, name: next.name, size: next.bytes.length }
  }
  availableBytes() {
    return this.available
  }
  exists(rel: string) {
    return this.files.has(rel) || this.dirs.has(rel)
  }
  fileSize(rel: string) {
    return this.files.get(rel)?.length
  }
  list(rel: string) {
    const prefix = `${rel}/`
    const names = new Set<string>()
    for (const p of [...this.files.keys(), ...this.dirs]) if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0]!)
    return [...names]
  }
  mkdirp(rel: string) {
    const parts = rel.split('/')
    for (let i = 1; i <= parts.length; i++) this.dirs.add(parts.slice(0, i).join('/'))
  }
  remove(rel: string) {
    this.files.delete(rel)
    this.dirs.delete(rel)
    for (const p of [...this.files.keys()]) if (p.startsWith(`${rel}/`)) this.files.delete(p)
    for (const d of [...this.dirs]) if (d.startsWith(`${rel}/`)) this.dirs.delete(d)
  }
  async move(fromRel: string, toRel: string) {
    if (this.failMove) throw new Error('EIO: move failed')
    const bytes = this.files.get(fromRel)
    if (!bytes) throw new Error(`ENOENT: ${fromRel}`)
    this.files.delete(fromRel)
    this.files.set(toRel, bytes)
  }
  private reader(bytes: Uint8Array): ByteReader {
    let at = 0
    return {
      read: (length) => {
        const out = bytes.subarray(at, Math.min(bytes.length, at + length))
        at += out.length
        return out.slice()
      },
      close: () => {},
    }
  }
  openRead(rel: string) {
    const bytes = this.files.get(rel)
    if (!bytes) throw new Error(`ENOENT: ${rel}`)
    return this.reader(bytes)
  }
  openReadUri(uri: string) {
    const bytes = this.cache.get(uri)
    if (!bytes) throw new Error(`ENOENT: ${uri}`)
    return this.reader(bytes)
  }
  openWrite(rel: string) {
    const parts: Uint8Array[] = []
    this.files.set(rel, new Uint8Array(0))
    return {
      write: (bytes: Uint8Array) => {
        this.writes++
        if (this.failWriteAt && this.writes >= this.failWriteAt.count) throw new Error(this.failWriteAt.message)
        parts.push(bytes.slice())
        const total = parts.reduce((n, p) => n + p.length, 0)
        const out = new Uint8Array(total)
        let at = 0
        for (const p of parts) {
          out.set(p, at)
          at += p.length
        }
        this.files.set(rel, out)
      },
      close: () => {},
    }
  }
  writeFile(rel: string, bytes: Uint8Array) {
    this.files.set(rel, bytes.slice())
  }
  readRange(rel: string, offset: number, length: number) {
    const bytes = this.files.get(rel)
    if (!bytes) throw new Error(`ENOENT: ${rel}`)
    return bytes.slice(offset, offset + length)
  }
  discardUri(uri: string) {
    this.cache.delete(uri)
  }
}

/** `SqlEngine` on node:sqlite. Transactions are BEGIN IMMEDIATE … COMMIT, like the host's exclusive transaction. */
export function createNodeSqlEngine(db = new DatabaseSync(':memory:')) {
  /** Fails the next transaction whose statements match, once (simulates a commit failure). */
  let failNextTransaction: RegExp | null = null
  const connection: SqlEngineConnection = {
    all: async (sql: string, params: SqlParam[]) => db.prepare(sql).all(...params) as Record<string, unknown>[],
    run: async (sql: string, params: SqlParam[]) => {
      const r = db.prepare(sql).run(...params)
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) }
    },
  }
  const engine: SqlEngine = {
    ...connection,
    async exclusiveTransaction(task) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const guarded: SqlEngineConnection = {
          all: connection.all,
          run: async (sql, params) => {
            if (failNextTransaction?.test(sql)) {
              failNextTransaction = null
              throw new Error('SQLITE_FULL: database or disk is full')
            }
            return connection.run(sql, params)
          },
        }
        const result = await task(guarded)
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
  return {
    engine,
    db,
    failNextTransactionMatching(pattern: RegExp) {
      failNextTransaction = pattern
    },
  }
}

export interface FakeHostOptions {
  /** Expo Go mode: no local server, `files.readChunk` / `files.readCover`. Default true. */
  devChunks?: boolean
  fs?: MemoryFs
}

export interface FakeHost {
  api: DesktopApi
  ctx: BridgeContext
  fs: MemoryFs
  sql: ReturnType<typeof createNodeSqlEngine>
  boot: BootValues
  /** Raw requests the bridge sent, as `service.method`. */
  requests: string[]
  /** Sends a host event, as the app does with `injectJavaScript`. */
  emit(event: HostEvent['event'], payload: unknown): void
  /** Lets every queued message cross the boundary. */
  settle(): Promise<void>
}

let uuidCounter = 0
/** Deterministic version-4 UUIDs, so tests can name paths. */
export function testUuid(): string {
  const n = (++uuidCounter).toString(16).padStart(12, '0')
  return `00000000-0000-4000-8000-${n}`
}

export async function createFakeHost(options: FakeHostOptions = {}): Promise<FakeHost> {
  const fs = options.fs ?? new MemoryFs()
  const devChunks = options.devChunks ?? true
  const sql = createNodeSqlEngine()
  sql.db.exec('PRAGMA foreign_keys = ON')
  const requests: string[] = []
  let receive: (json: string) => void = () => {}
  const deliver = (message: unknown) => {
    const json = JSON.stringify(message)
    setTimeout(() => receive(json), 0)
  }
  const dispatcher = createRpcDispatcher({
    allowedOrigin: UI_ORIGIN,
    services: {
      sql: createSqlService(sql.engine),
      files: createFileService({
        fs,
        devChunks,
        emitProgress: (payload: ImportProgressPayload) => deliver({ v: RPC_VERSION, event: 'importProgress', payload }),
        yieldToEvents: () => new Promise((resolve) => setTimeout(resolve, 0)),
      }),
      app: createAppService({ info: { version: '1.0.0', platform: 'android', osVersion: '15' }, openUrl: async () => {} }),
    },
  })
  const transport: HostTransport = {
    post(json) {
      const parsed = JSON.parse(json) as { service: string; method: string }
      requests.push(`${parsed.service}.${parsed.method}`)
      void dispatcher.handle(json, `${UI_ORIGIN}/readmate-ui/index.html`).then((response) => {
        if (response) deliver(response)
      })
    },
    listen(handler) {
      receive = handler
    },
  }
  const boot: BootValues = { v: 1, platform: 'android', osVersion: '15', appVersion: '1.0.0', baseUrl: null, token: null, devChunks }
  const client = createHostClient(transport, testUuid)
  const { api, ctx } = createMobileApi({ client, boot, newId: testUuid })
  await prepareMobileStorage(ctx)
  return {
    api,
    ctx,
    fs,
    sql,
    boot,
    requests,
    emit: (event, payload) => deliver({ v: RPC_VERSION, event, payload }),
    settle: () => new Promise((resolve) => setTimeout(resolve, 5)),
  }
}

export function count(host: FakeHost, table: string): number {
  return Number((host.sql.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n)
}

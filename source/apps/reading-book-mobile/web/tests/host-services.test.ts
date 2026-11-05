/**
 * Host services on their own (spec 008, T050–T053, T091): the RPC envelope and origin check, the SQL rules, the
 * development-only chunk route, links, and the hash and base64 helpers the host uses instead of a crypto module.
 */
import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createAppService, externalHostOf } from '../../src/host/app-service'
import { base64ToBytes, bytesToBase64 } from '../../src/host/encoding'
import { createFileService } from '../../src/host/file-service'
import { DEV_CHUNK_MAX_BYTES, HostServiceError } from '../../src/host/protocol'
import { createRpcDispatcher, originOf } from '../../src/host/rpc'
import { Sha256 } from '../../src/host/sha256'
import { createSqlService, isReadOnlyQuery, isSingleStatement } from '../../src/host/sql-service'
import { createNodeSqlEngine, MemoryFs, testUuid } from './fake-host'

const ORIGIN = 'http://127.0.0.1:47821'
const request = (body: object) => JSON.stringify({ v: 1, id: 'r1', args: {}, ...body })

describe('RPC dispatcher', () => {
  const dispatcher = createRpcDispatcher({
    allowedOrigin: ORIGIN,
    services: {
      app: { echo: (args) => args, boom: () => { throw new Error('secret detail') }, typed: () => { throw new HostServiceError('NO_SPACE', 'full') } },
    },
  })

  it('answers the v: 1 envelope', async () => {
    expect(await dispatcher.handle(request({ service: 'app', method: 'echo', args: { a: 1 } }), `${ORIGIN}/index.html#/library`)).toEqual({ v: 1, id: 'r1', ok: true, result: { a: 1 } })
  })

  it('ignores messages from any other origin', async () => {
    for (const url of ['http://evil.example/index.html', 'http://127.0.0.1:47822/', 'about:blank', undefined, 'file:///android_asset/x']) {
      expect(await dispatcher.handle(request({ service: 'app', method: 'echo' }), url)).toBeNull()
    }
  })

  it('answers UNKNOWN_METHOD for unknown services, methods and prototype names', async () => {
    for (const [service, method] of [['nope', 'x'], ['app', 'missing'], ['app', '__proto__'], ['app', 'toString'], ['__proto__', 'constructor'], ['app', 'hasOwnProperty']]) {
      const res = await dispatcher.handle(request({ service, method }), ORIGIN + '/')
      expect(res, `${service}.${method}`).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } })
    }
  })

  it('refuses a wrong version, keeps typed errors, and hides unexpected ones', async () => {
    expect(await dispatcher.handle(JSON.stringify({ v: 2, id: 'r1', service: 'app', method: 'echo' }), ORIGIN)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(await dispatcher.handle(request({ service: 'app', method: 'typed' }), ORIGIN)).toMatchObject({ error: { code: 'NO_SPACE', message: 'full' } })
    const hidden = await dispatcher.handle(request({ service: 'app', method: 'boom' }), ORIGIN)
    expect(hidden).toMatchObject({ error: { code: 'INTERNAL' } })
    expect(JSON.stringify(hidden)).not.toContain('secret detail')
    expect(await dispatcher.handle('not json', ORIGIN)).toBeNull()
  })

  it('accepts the Metro origin in Expo Go (T091)', async () => {
    const metro = createRpcDispatcher({ allowedOrigin: 'http://192.168.1.20:8081', services: { app: { echo: () => 1 } } })
    expect(await metro.handle(request({ service: 'app', method: 'echo' }), 'http://192.168.1.20:8081/readmate-ui/index.html')).toMatchObject({ ok: true })
    expect(originOf('HTTP://Example.COM:80/x')).toBe('http://example.com:80')
  })
})

describe('sql service rules', () => {
  const make = () => {
    const { engine, db } = createNodeSqlEngine()
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT UNIQUE)')
    return { sql: createSqlService(engine), db }
  }

  it('query is read only', async () => {
    const { sql } = make()
    await expect(sql.query({ sql: 'SELECT * FROM t' })).resolves.toEqual([])
    for (const bad of ['DELETE FROM t', 'WITH x AS (SELECT 1) DELETE FROM t', 'SELECT 1; DELETE FROM t', 'PRAGMA writable_schema = 1']) {
      await expect(sql.query({ sql: bad }), bad).rejects.toMatchObject({ code: 'NOT_ALLOWED' })
    }
    expect(isReadOnlyQuery("SELECT 'DELETE' AS updated_at")).toBe(true)
  })

  it('run is exactly one statement, with plain parameters', async () => {
    const { sql } = make()
    await expect(sql.run({ sql: 'INSERT INTO t (v) VALUES (?)', params: ['a;b'] })).resolves.toMatchObject({ changes: 1 })
    await expect(sql.run({ sql: "INSERT INTO t (v) VALUES ('x'); DROP TABLE t" })).rejects.toMatchObject({ code: 'NOT_ALLOWED' })
    await expect(sql.run({ sql: 'INSERT INTO t (v) VALUES (?)', params: [{ evil: 1 }] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(sql.run({ sql: 'INSERT INTO t (v) VALUES (?)', params: [Number.NaN] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(isSingleStatement('CREATE TRIGGER x AFTER INSERT ON t BEGIN SELECT 1; END', true)).toBe(true)
  })

  it('transaction is all or nothing, and may not manage the transaction itself', async () => {
    const { sql, db } = make()
    await expect(
      sql.transaction({ statements: [{ sql: 'INSERT INTO t (v) VALUES (?)', params: ['a'] }, { sql: 'INSERT INTO t (v) VALUES (?)', params: ['a'] }] }),
    ).rejects.toMatchObject({ code: 'SQL_FAILED', message: expect.stringMatching(/UNIQUE/) })
    expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 })
    await expect(sql.transaction({ statements: [{ sql: 'COMMIT' }] })).rejects.toMatchObject({ code: 'NOT_ALLOWED' })
    await expect(sql.transaction({ statements: [] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})

describe('files.readChunk (development only, T091)', () => {
  it('exists only in Expo Go mode', () => {
    expect(createFileService({ fs: new MemoryFs(), devChunks: false }).readChunk).toBeUndefined()
    expect(createFileService({ fs: new MemoryFs(), devChunks: true }).readChunk).toBeTypeOf('function')
  })

  it('reads at most 1 MiB of an app-private book, by UUID only', () => {
    const fs = new MemoryFs()
    const id = testUuid()
    const bytes = randomBytes(1500)
    fs.writeFile(`books/${id}/file`, bytes)
    const files = createFileService({ fs, devChunks: true })
    const first = files.readChunk!({ bookId: id, offset: 0, length: 1000 }) as { base64: string; eof: boolean; size: number }
    const rest = files.readChunk!({ bookId: id, offset: 1000, length: 1000 }) as { base64: string; eof: boolean }
    expect([first.eof, rest.eof, first.size]).toEqual([false, true, 1500])
    expect(Buffer.concat([base64ToBytes(first.base64)!, base64ToBytes(rest.base64)!])).toEqual(bytes)
    const code = (args: object) => {
      try {
        files.readChunk!(args)
        return 'ok'
      } catch (e) {
        return (e as HostServiceError).code
      }
    }
    expect(code({ bookId: id, offset: 0, length: DEV_CHUNK_MAX_BYTES + 1 })).toBe('INVALID_ARGUMENT')
    expect(code({ bookId: '../readmate.db', offset: 0, length: 10 })).toBe('INVALID_ARGUMENT')
    expect(code({ bookId: testUuid(), offset: 0, length: 10 })).toBe('NOT_FOUND')
    expect(code({ bookId: id, offset: 2000, length: 10 })).toBe('INVALID_ARGUMENT')
  })
})

describe('app service', () => {
  it('opens https links to public hosts only', async () => {
    const opened: string[] = []
    const app = createAppService({ info: { version: '1', platform: 'android', osVersion: '15' }, openUrl: async (u) => void opened.push(u) })
    await expect(app.openExternal({ url: 'https://vi.wikipedia.org/wiki/Sách' })).resolves.toEqual({ opened: true })
    for (const url of ['http://example.com', 'javascript:alert(1)', 'https://localhost/x', 'https://127.0.0.1/x', 'https://user:pw@example.com', 'file:///etc', 'https://intranet/x', 42]) {
      await expect(app.openExternal({ url }), String(url)).rejects.toMatchObject({ code: 'NOT_ALLOWED' })
    }
    expect(opened).toEqual(['https://vi.wikipedia.org/wiki/Sách'])
    expect(externalHostOf('https://Example.com:443/a?b#c')).toBe('example.com')
  })
})

describe('hash and base64 helpers', () => {
  it('Sha256 equals node:crypto for any chunking', () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 1000, 200_003]) {
      const data = randomBytes(size)
      const expected = createHash('sha256').update(data).digest('hex')
      const oneShot = new Sha256().update(data).digestHex()
      const chunked = new Sha256()
      for (let i = 0; i < data.length; i += 37) chunked.update(data.subarray(i, i + 37))
      expect([oneShot, chunked.digestHex()], `size ${size}`).toEqual([expected, expected])
    }
  })

  it('base64 round-trips and refuses malformed input', () => {
    for (const size of [0, 1, 2, 3, 4, 1000]) {
      const data = randomBytes(size)
      expect(bytesToBase64(data)).toBe(data.toString('base64'))
      expect(Buffer.from(base64ToBytes(data.toString('base64'))!)).toEqual(data)
    }
    for (const bad of ['abc', 'ab=c', 'a b=', '****']) expect(base64ToBytes(bad), bad).toBeUndefined()
  })
})

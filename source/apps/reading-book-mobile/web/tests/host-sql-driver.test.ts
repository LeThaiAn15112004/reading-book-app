/**
 * `createHostAsyncSqlDriver` (spec 009 T028): the core's `AsyncSqlDriver` port over the REAL host `sql.*` services
 * (dispatcher + rules over `node:sqlite`, through the same JSON boundary as `postMessage`).
 */
import { describe, expect, it } from 'vitest'
import { createHostAsyncSqlDriver } from '../src/bridge/host-sql-driver'
import { createFakeHost } from './fake-host'

const stmt = (sql: string, ...params: (string | number | bigint | null | Uint8Array)[]) => ({ sql, params })

async function setup() {
  const host = await createFakeHost()
  host.sql.db.exec('CREATE TABLE drv (id INTEGER PRIMARY KEY, v TEXT NOT NULL)')
  return { host, driver: createHostAsyncSqlDriver(host.ctx.client) }
}

describe('createHostAsyncSqlDriver', () => {
  it('run reports changes and the new row id; all reads rows back with positional parameters', async () => {
    const { driver } = await setup()
    const first = await driver.run(stmt('INSERT INTO drv (v) VALUES (?)', 'a'))
    expect(first.changes).toBe(1)
    const id = first.lastInsertRowId
    await driver.run(stmt('INSERT INTO drv (v) VALUES (?)', 'b'))
    expect(await driver.all<{ v: string }>(stmt('SELECT v FROM drv WHERE id = ?', id))).toEqual([{ v: 'a' }])
    expect(await driver.all(stmt('SELECT id FROM drv'))).toHaveLength(2)
  })

  it('transaction applies the batch all or nothing', async () => {
    const { driver } = await setup()
    await driver.transaction([stmt('INSERT INTO drv (v) VALUES (?)', 'a'), stmt('INSERT INTO drv (v) VALUES (?)', 'b')])
    await expect(driver.transaction([stmt('INSERT INTO drv (v) VALUES (?)', 'c'), stmt('INSERT INTO drv (v) VALUES (?)', null)])).rejects.toThrow()
    expect((await driver.all<{ v: string }>(stmt('SELECT v FROM drv ORDER BY id'))).map((r) => r.v)).toEqual(['a', 'b'])
  })

  it('a safe bigint is bound as a number; an unsafe bigint and binary data are refused before any RPC', async () => {
    const { host, driver } = await setup()
    await driver.run(stmt('INSERT INTO drv (id, v) VALUES (?, ?)', 5n, 'five'))
    expect(await driver.all<{ v: string }>(stmt('SELECT v FROM drv WHERE id = ?', 5))).toEqual([{ v: 'five' }])
    const sent = host.requests.length
    expect(() => driver.run(stmt('SELECT ?', 2n ** 60n))).toThrow(/safe integer/)
    expect(() => driver.all(stmt('SELECT ?', new Uint8Array([1])))).toThrow(/binary/)
    expect(host.requests.length).toBe(sent)
  })

  it('the host rules still apply: query is read only, run is one statement', async () => {
    const { driver } = await setup()
    await expect(driver.all(stmt('DELETE FROM drv'))).rejects.toThrow()
    await expect(driver.run(stmt('INSERT INTO drv (v) VALUES (?); DELETE FROM drv', 'x'))).rejects.toThrow()
  })
})

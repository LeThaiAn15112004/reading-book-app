/**
 * `SyncSqlDriver` over the REAL better-sqlite3 (spec 009 T027): run / get / all, `transaction` commit and rollback in
 * deferred and immediate mode, a nested transaction as a savepoint, the refusal of an async body, and the same
 * connection seeing the writes (the stores keep using `getDatabase()` next to the driver).
 *
 * better-sqlite3 is built for Electron's Node ABI, so this re-launches itself with the app's Electron binary in
 * `ELECTRON_RUN_AS_NODE` mode (no window, in-memory database), like `spike:audio:migration`.
 *
 * Run: npm run spike:sql:driver
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

if (!process.versions.electron) {
  const electron = require('electron')
  const r = spawnSync(electron, [fileURLToPath(import.meta.url)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true })
  process.exit(r.status ?? 1)
}

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-sql-driver-')), 'sql-driver.mjs')
await require('esbuild').build({
  entryPoints: [path.join(here, '../../persistence/sql-driver.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  external: ['@core'], // type-only import
})
const { createSyncSqlDriver } = await import(pathToFileURL(out).href)

const Database = require('better-sqlite3')
const db = new Database(':memory:')
db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL, b BLOB)')
const d = createSyncSqlDriver(db)
const s = (sql, ...params) => ({ sql, params })
const count = () => d.get(s('SELECT COUNT(*) n FROM t')).n

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

check('run reports changes and the new row id; get / all bind positional parameters', () => {
  assert.deepEqual(d.run(s('INSERT INTO t (v) VALUES (?)', 'a')), { changes: 1, lastInsertRowid: 1 })
  d.run(s('INSERT INTO t (v, b) VALUES (?, ?)', 'b', new Uint8Array([1, 2])))
  assert.equal(d.get(s('SELECT v FROM t WHERE id = ?', 2)).v, 'b')
  assert.equal(d.get(s('SELECT v FROM t WHERE id = ?', 99)), undefined)
  assert.deepEqual(d.all(s('SELECT id FROM t ORDER BY id')).map((r) => r.id), [1, 2])
  assert.equal(d.run(s('UPDATE t SET v = ? WHERE id > ?', 'z', 0)).changes, 2)
})
check('transaction commits and returns the result (deferred and immediate)', () => {
  assert.equal(d.transaction(() => { d.run(s('INSERT INTO t (v) VALUES (?)', 'c')); return 7 }), 7)
  assert.equal(d.transaction(() => { d.run(s('INSERT INTO t (v) VALUES (?)', 'd')); return 8 }, 'immediate'), 8)
  assert.equal(count(), 4)
})
check('immediate mode takes the write lock at BEGIN: a second connection cannot write meanwhile', () => {
  const file = path.join(path.dirname(out), 'lock.db')
  const a = new Database(file)
  a.exec('CREATE TABLE x (n INTEGER)')
  const b = new Database(file, { timeout: 50 })
  const da = createSyncSqlDriver(a)
  da.transaction(() => {
    assert.throws(() => b.prepare('INSERT INTO x VALUES (1)').run(), /locked|busy/i)
  }, 'immediate')
  b.prepare('INSERT INTO x VALUES (1)').run() // after COMMIT it works
  a.close(); b.close()
})
check('a throw rolls everything back and the error reaches the caller', () => {
  const before = count()
  assert.throws(() => d.transaction(() => { d.run(s('INSERT INTO t (v) VALUES (?)', 'e')); d.run(s('INSERT INTO t (v) VALUES (?)', null)) }), /NOT NULL/)
  assert.equal(count(), before)
})
check('a nested transaction is a savepoint: the inner failure undoes only the inner work', () => {
  const before = count()
  d.transaction(() => {
    d.run(s('INSERT INTO t (v) VALUES (?)', 'outer'))
    assert.throws(() => d.transaction(() => { d.run(s('INSERT INTO t (v) VALUES (?)', 'inner')); throw new Error('boom') }), /boom/)
  })
  assert.equal(count(), before + 1)
})
check('an async body is refused and rolled back', () => {
  const before = count()
  assert.throws(() => d.transaction(async () => { d.run(s('INSERT INTO t (v) VALUES (?)', 'late')) }), /synchronous/)
  assert.equal(count(), before)
})
check('the driver shares the connection: a write through it is visible to db.prepare and back', () => {
  d.run(s('INSERT INTO t (v) VALUES (?)', 'shared'))
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM t WHERE v = 'shared'`).get().n, 1)
  db.prepare(`INSERT INTO t (v) VALUES ('direct')`).run()
  assert.equal(d.get(s(`SELECT COUNT(*) n FROM t WHERE v = 'direct'`)).n, 1)
})

db.close()
console.log(`\n${passed} checks passed`)

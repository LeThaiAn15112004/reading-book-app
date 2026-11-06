import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { AsyncSqlDriver, SqlValue, Statement, SyncSqlDriver } from '../../src/index.js'

// The ports are exercised on node:sqlite, the engine the Mobile tests use; Desktop's better-sqlite3 follows the same shape.
function syncDriver(db: DatabaseSync): SyncSqlDriver {
  return {
    run: (s) => {
      const r = db.prepare(s.sql).run(...(s.params as SqlValue[]))
      return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid }
    },
    all: <Row>(s: Statement) => db.prepare(s.sql).all(...(s.params as SqlValue[])) as Row[],
    get: <Row>(s: Statement) => db.prepare(s.sql).get(...(s.params as SqlValue[])) as Row | undefined,
    transaction: <T>(work: () => T, mode: 'deferred' | 'immediate' = 'deferred'): T => {
      db.exec(mode === 'immediate' ? 'BEGIN IMMEDIATE' : 'BEGIN')
      try {
        const result = work()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}

function asyncDriver(db: DatabaseSync): AsyncSqlDriver {
  const sync = syncDriver(db)
  return {
    run: async (s) => {
      const r = sync.run(s)
      return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) }
    },
    all: async <Row>(s: Statement) => sync.all<Row>(s),
    transaction: async (statements) => {
      sync.transaction(() => {
        for (const s of statements) sync.run(s)
      })
    },
  }
}

const stmt = (sql: string, ...params: SqlValue[]): Statement => ({ sql, params })
const fresh = () => {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL, b BLOB)')
  return db
}

describe('SyncSqlDriver', () => {
  it('run / get / all bind positional parameters and report changes', () => {
    const d = syncDriver(fresh())
    expect(d.run(stmt('INSERT INTO t (v) VALUES (?)', 'a'))).toEqual({ changes: 1, lastInsertRowid: 1 })
    d.run(stmt('INSERT INTO t (v, b) VALUES (?, ?)', 'b', new Uint8Array([1, 2])))
    expect(d.get<{ v: string }>(stmt('SELECT v FROM t WHERE id = ?', 2))?.v).toBe('b')
    expect(d.get(stmt('SELECT v FROM t WHERE id = ?', 99))).toBeUndefined()
    expect(d.all<{ id: number }>(stmt('SELECT id FROM t ORDER BY id')).map((r) => r.id)).toEqual([1, 2])
  })

  it('transaction commits the work and returns its result', () => {
    const d = syncDriver(fresh())
    const n = d.transaction(() => {
      d.run(stmt('INSERT INTO t (v) VALUES (?)', 'x'))
      d.run(stmt('INSERT INTO t (v) VALUES (?)', 'y'))
      return 2
    }, 'immediate')
    expect(n).toBe(2)
    expect(d.all(stmt('SELECT id FROM t'))).toHaveLength(2)
  })

  it('transaction rolls everything back when the work throws', () => {
    const d = syncDriver(fresh())
    expect(() =>
      d.transaction(() => {
        d.run(stmt('INSERT INTO t (v) VALUES (?)', 'x'))
        d.run(stmt('INSERT INTO t (v) VALUES (?)', null))
      }),
    ).toThrow()
    expect(d.all(stmt('SELECT id FROM t'))).toHaveLength(0)
  })
})

describe('AsyncSqlDriver', () => {
  it('run and all work through promises', async () => {
    const d = asyncDriver(fresh())
    expect(await d.run(stmt('INSERT INTO t (v) VALUES (?)', 'a'))).toEqual({ changes: 1, lastInsertRowId: 1 })
    expect(await d.all<{ v: string }>(stmt('SELECT v FROM t'))).toEqual([{ v: 'a' }])
  })

  it('transaction applies a batch all or nothing', async () => {
    const d = asyncDriver(fresh())
    await d.transaction([stmt('INSERT INTO t (v) VALUES (?)', 'a'), stmt('INSERT INTO t (v) VALUES (?)', 'b')])
    await expect(
      d.transaction([stmt('INSERT INTO t (v) VALUES (?)', 'c'), stmt('INSERT INTO t (v) VALUES (?)', null)]),
    ).rejects.toThrow()
    expect((await d.all<{ v: string }>(stmt('SELECT v FROM t ORDER BY id'))).map((r) => r.v)).toEqual(['a', 'b'])
  })
})

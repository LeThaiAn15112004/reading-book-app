import type { Database as SqliteDatabase, Statement as SqliteStatement } from 'better-sqlite3'
import type { SqlValue, Statement, SyncSqlDriver } from '@reading-book/book-reader-sdk'

/**
 * `SyncSqlDriver` (core port, spec 009 contracts/sql-drivers.md) over the app's one better-sqlite3 connection.
 * Kept free of `electron` so the spikes can run it on a real database; `db.ts` hands it out as `getSqlDriver()`.
 *
 * The spikes also hand it a `node:sqlite` stand-in, which has no `transaction()`: there `transaction` is explicit
 * `BEGIN [IMMEDIATE]` / `COMMIT` / `ROLLBACK` (a nested call is a savepoint), the same thing better-sqlite3 does.
 */
export function createSyncSqlDriver(db: SqliteDatabase): SyncSqlDriver {
  const bind = (statement: Statement): SqlValue[] => statement.params as SqlValue[]
  const refuseAsync = <T>(result: T): T => {
    // An async body would commit before its awaits finish and let other handlers' writes in: refuse it.
    if (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') {
      throw new TypeError('SyncSqlDriver.transaction: the work must be synchronous (no await inside)')
    }
    return result
  }
  // Prepared statements are reusable: a loop that runs the same SQL (ledger rows, author links, ids) compiles it once.
  const prepared = new Map<string, SqliteStatement<SqlValue[]>>()
  const prepare = (sql: string) => {
    let statement = prepared.get(sql)
    if (!statement) {
      if (prepared.size >= 256) prepared.clear()
      statement = db.prepare<SqlValue[]>(sql)
      prepared.set(sql, statement)
    }
    return statement
  }
  let depth = 0
  return {
    run(statement) {
      const result = prepare(statement.sql).run(...bind(statement))
      return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid }
    },
    all<Row>(statement: Statement): Row[] {
      return prepare(statement.sql).all(...bind(statement)) as Row[]
    },
    get<Row>(statement: Statement): Row | undefined {
      return prepare(statement.sql).get(...bind(statement)) as Row | undefined
    },
    transaction<T>(work: () => T, mode: 'deferred' | 'immediate' = 'deferred'): T {
      if (typeof db.transaction === 'function') {
        // `BEGIN [IMMEDIATE]` … `COMMIT`, `ROLLBACK` when `work` throws; inside another transaction it is a savepoint.
        const run = db.transaction(() => refuseAsync(work()))
        return mode === 'immediate' ? run.immediate() : run()
      }
      const outer = depth === 0
      const savepoint = `rb_sp_${depth}`
      db.exec(outer ? (mode === 'immediate' ? 'BEGIN IMMEDIATE' : 'BEGIN') : `SAVEPOINT ${savepoint}`)
      depth++
      try {
        const result = refuseAsync(work())
        db.exec(outer ? 'COMMIT' : `RELEASE ${savepoint}`)
        return result
      } catch (error) {
        db.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
        throw error
      } finally {
        depth--
      }
    },
  }
}

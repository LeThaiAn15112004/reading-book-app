import type { Database as SqliteDatabase } from 'better-sqlite3'
import type { SqlValue, Statement, SyncSqlDriver } from '@reading-book/book-reader-sdk'

/**
 * `SyncSqlDriver` (core port, spec 009 contracts/sql-drivers.md) over the app's one better-sqlite3 connection.
 * Kept free of `electron` so the spikes can run it on a real database; `db.ts` hands it out as `getSqlDriver()`.
 */
export function createSyncSqlDriver(db: SqliteDatabase): SyncSqlDriver {
  const bind = (statement: Statement): SqlValue[] => statement.params as SqlValue[]
  return {
    run(statement) {
      const result = db.prepare(statement.sql).run(...bind(statement))
      return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid }
    },
    all<Row>(statement: Statement): Row[] {
      return db.prepare(statement.sql).all(...bind(statement)) as Row[]
    },
    get<Row>(statement: Statement): Row | undefined {
      return db.prepare(statement.sql).get(...bind(statement)) as Row | undefined
    },
    transaction<T>(work: () => T, mode: 'deferred' | 'immediate' = 'deferred'): T {
      // `BEGIN [IMMEDIATE]` … `COMMIT`, `ROLLBACK` when `work` throws; inside another transaction it is a savepoint.
      const run = db.transaction(() => {
        const result = work()
        // An async body would commit before its awaits finish and let other handlers' writes in: refuse it.
        if (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') {
          throw new TypeError('SyncSqlDriver.transaction: the work must be synchronous (no await inside)')
        }
        return result
      })
      return mode === 'immediate' ? run.immediate() : run()
    },
  }
}

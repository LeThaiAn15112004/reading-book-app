/**
 * `SqlDriver` on Node's built-in `node:sqlite` (spec 008, T043): the test stand-in for the host's `expo-sqlite`.
 * Foreign keys are on, as the host opens its database (T051). A transaction is the batch form of the host's
 * `sql.transaction`: all statements or none.
 */
import { DatabaseSync } from 'node:sqlite'
import type { SqlDriver, SqlParam, SqlRunResult, SqlStatement } from '../db/sql-driver'

export interface NodeSqliteDriver extends SqlDriver {
  raw: DatabaseSync
  close(): void
}

export function createNodeSqliteDriver(file = ':memory:'): NodeSqliteDriver {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  const runOne = (sql: string, params: readonly SqlParam[] = []): SqlRunResult => {
    const r = db.prepare(sql).run(...params)
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) }
  }
  return {
    raw: db,
    async query<Row>(sql: string, params: readonly SqlParam[] = []) {
      return db.prepare(sql).all(...params) as Row[]
    },
    async run(sql, params) {
      return runOne(sql, params)
    },
    async transaction(statements: readonly SqlStatement[]) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map((s) => runOne(s.sql, s.params))
        db.exec('COMMIT')
        return results
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    close() {
      db.close()
    },
  }
}

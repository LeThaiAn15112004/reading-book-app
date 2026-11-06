/**
 * `SqlEngine` on `expo-sqlite` (spec 008, T051; Expo 57 docs, `sdk/sqlite`). WAL lets the main connection keep
 * reading while `withExclusiveTransactionAsync` writes on its own connection; the bridge's single write queue keeps
 * two batches from meeting ("database is locked"). Foreign keys are on for the main connection only: the docs say the
 * pragma does not reach the transaction connection, which is why the stores never rely on cascades.
 */
import * as SQLite from 'expo-sqlite'

import type { SqlEngine, SqlEngineConnection, SqlParam, SqlRow } from './sql-service'

export const DATABASE_NAME = 'readmate.db'

function connection(db: SQLite.SQLiteDatabase): SqlEngineConnection {
  return {
    all: (sql: string, params: SqlParam[]) => db.getAllAsync<SqlRow>(sql, params),
    run: async (sql: string, params: SqlParam[]) => {
      const r = await db.runAsync(sql, params)
      return { changes: r.changes, lastInsertRowId: r.lastInsertRowId }
    },
  }
}

export async function openExpoSqliteEngine(name = DATABASE_NAME): Promise<SqlEngine> {
  const db = await SQLite.openDatabaseAsync(name)
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  const main = connection(db)
  return {
    ...main,
    async exclusiveTransaction<T>(task: (txn: SqlEngineConnection) => Promise<T>): Promise<T> {
      let result: T | undefined
      await db.withExclusiveTransactionAsync(async (txn) => {
        result = await task(connection(txn))
      })
      return result as T
    },
  }
}

import Database from 'better-sqlite3'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'
import type { SyncSqlDriver } from '@core'
import { migrate } from './migrate'
import { createSyncSqlDriver } from './sql-driver'

let db: SqliteDatabase | null = null
let driver: SyncSqlDriver | null = null

function defaultDbPath(): string {
  return path.join(app.getPath('userData'), 'reading-book.db')
}

/**
 * Open (or create) the SQLite DB under Electron userData and run migrations.
 */
export function openDatabase(dbPath?: string): SqliteDatabase {
  if (db) return db

  const resolved = dbPath ?? defaultDbPath()
  const instance = new Database(resolved)
  instance.pragma('foreign_keys = ON')
  instance.pragma('journal_mode = WAL')
  migrate(instance)
  db = instance
  return instance
}

/** Return the open DB singleton. Call openDatabase() first. */
export function getDatabase(): SqliteDatabase {
  if (!db) {
    throw new Error('Database is not open — call openDatabase() first')
  }
  return db
}

/** The open connection as the core's `SyncSqlDriver` port (same connection, same transactions). */
export function getSqlDriver(): SyncSqlDriver {
  driver ??= createSyncSqlDriver(getDatabase())
  return driver
}

export function closeDatabase(): void {
  if (!db) return
  db.close()
  db = null
  driver = null
}

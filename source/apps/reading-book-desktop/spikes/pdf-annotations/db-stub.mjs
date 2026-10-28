/**
 * Stand-in for `electron/persistence/db.ts`: an in-memory node:sqlite database with every numbered
 * migration applied (except 021 and 029, FTS5 indexes node:sqlite can't build and that never touch
 * `notes`; 029's transcript tables — and 030, which only adds a column to them — are checked on the real
 * better-sqlite3 by `spike:transcription:main`). node:sqlite's prepare/get/all/run with bare named parameters is the subset of the
 * better-sqlite3 API `SqliteOverlayStore` uses.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../electron/persistence/migrations')

export function createMigratedDatabase() {
  const db = new DatabaseSync(':memory:')
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && !f.startsWith('021_') && !f.startsWith('029_') && !f.startsWith('030_')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }
  return db
}

let db = null

export function getDatabase() {
  db ??= createMigratedDatabase()
  return db
}

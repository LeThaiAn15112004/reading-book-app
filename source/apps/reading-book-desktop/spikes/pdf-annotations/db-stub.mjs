/**
 * Stand-in for `electron/persistence/db.ts`: an in-memory node:sqlite database with every numbered
 * migration applied (except 021, an FTS5 index node:sqlite can't build and that never touches
 * `notes`). node:sqlite's prepare/get/all/run with bare named parameters is the subset of the
 * better-sqlite3 API `SqliteOverlayStore` uses.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../electron/persistence/migrations')

export function createMigratedDatabase() {
  const db = new DatabaseSync(':memory:')
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && !f.startsWith('021_')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }
  return db
}

let db = null

export function getDatabase() {
  db ??= createMigratedDatabase()
  return db
}

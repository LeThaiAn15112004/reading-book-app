/**
 * Stand-in for `electron/persistence/db.ts` backed by the REAL better-sqlite3 (the library the app ships), on a temp file in
 * WAL mode like the app, with every numbered migration applied (FTS5 included, so nothing is skipped). Only usable inside the
 * app's Electron binary run as Node (`ELECTRON_RUN_AS_NODE=1`): better-sqlite3 is built for Electron's ABI.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../electron/persistence/migrations')

let db = null
let dir = null

export function getDatabase() {
  if (db) return db
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-annotations-perf-'))
  db = new Database(path.join(dir, 'perf.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }
  db.pragma('foreign_keys = ON')
  return db
}

export function closeAndRemove() {
  db?.close()
  db = null
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
}

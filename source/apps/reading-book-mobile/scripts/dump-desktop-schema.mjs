#!/usr/bin/env node
// Dumps the real schema of a fully migrated Desktop database (spec 008, T040), as the source for Mobile's baseline
// (`web/src/db/migrations/001_baseline.sql`, T041). The column lists come from SQLite itself, not from reading
// migration text, because many tables were rebuilt across Desktop's migrations.
//
//   node scripts/dump-desktop-schema.mjs                      # apply Desktop's migrations to :memory: and dump
//   node scripts/dump-desktop-schema.mjs --from <file.db>     # dump an existing migrated database, opened read-only
//   ... --tables books,notes                                  # only these tables (and their indexes)
//   ... --out <file>                                          # write instead of printing
//
// node:sqlite has no FTS5, so migrations that need it are skipped and listed in the header (021 full-text chunks,
// 029/030 audio transcripts: none is a first-release table). `--from` on a database Desktop migrated has them all.
// Desktop's migrations are only read, never changed; the database is in memory or opened read-only.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.resolve(here, '../../reading-book-desktop/electron/persistence/migrations')
const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

export function migratedDesktopDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)')
  const applied = []
  const skipped = []
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8')
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, 'dump')
      db.exec('COMMIT')
      applied.push(file)
    } catch (error) {
      db.exec('ROLLBACK')
      const message = String(error?.message ?? error)
      // Only an FTS5-only migration, or one that alters what such a migration created, may be skipped.
      if (/fts5|no such table: audio_transcript/i.test(message)) skipped.push(`${file} (${message})`)
      else throw new Error(`${file}: ${message}`)
    } finally {
      db.exec('PRAGMA foreign_keys = ON')
    }
  }
  return { db, applied, skipped }
}

/** `CREATE` statements of the given tables (all when empty) and their indexes and triggers, in a stable order. */
export function schemaOf(db, tables = []) {
  const rows = db
    .prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts_%'
       ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, tbl_name, name`,
    )
    .all()
  return rows.filter((r) => tables.length === 0 || tables.includes(r.tbl_name))
}

export function columnsOf(db, table) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => ({ name: c.name, type: c.type, notnull: c.notnull, dflt: c.dflt_value, pk: c.pk }))
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const from = option('--from')
  const tables = (option('--tables') ?? '').split(',').map((t) => t.trim()).filter(Boolean)
  let db
  const header = []
  if (from) {
    db = new DatabaseSync(from, { readOnly: true })
    header.push(`-- Source: ${path.basename(from)} (read-only)`)
  } else {
    const result = migratedDesktopDatabase()
    db = result.db
    header.push(`-- Source: Desktop migrations ${result.applied[0]} to ${result.applied.at(-1)} applied to :memory: (node:sqlite)`)
    header.push(`-- Applied: ${result.applied.length}`)
    for (const s of result.skipped) header.push(`-- Skipped (no FTS5 in node:sqlite, not a first-release table): ${s}`)
  }
  const last = db.prepare('SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1').get()?.name
  header.push(`-- Last migration recorded: ${last ?? 'none'}`, `-- SQLite ${db.prepare('SELECT sqlite_version() AS v').get().v}`)
  if (tables.length) header.push(`-- Tables: ${tables.join(', ')}`)
  const body = schemaOf(db, tables).map((r) => `${r.sql.trim()};`).join('\n\n')
  const text = `${header.join('\n')}\n\n${body}\n`
  db.close()
  if (option('--out')) writeFileSync(option('--out'), text)
  else process.stdout.write(text)
}

/**
 * Migration 026 (`books.file_format` accepts 'mp3') on a populated database, with the REAL better-sqlite3
 * and the REAL SQLite FTS5 that ship with Electron.
 *
 * better-sqlite3 is built for Electron's Node ABI, so plain `node` cannot load it. This script
 * re-launches itself with the app's own Electron binary in `ELECTRON_RUN_AS_NODE` mode: that is Node
 * with Electron's ABI — no window, no GUI, no focus, no user data (the database is `:memory:`).
 *
 * It applies migrations 001–025 exactly like `migrate.ts` (one transaction each, foreign keys OFF at
 * connection level), fills every table that references `books`, snapshots, applies 026, and proves:
 *   - every row of every table is unchanged (counts + content hashes), books included,
 *   - indexes / triggers / FTS are intact and FTS still answers,
 *   - `PRAGMA foreign_key_check` and `integrity_check` are clean,
 *   - ON DELETE CASCADE still works from the rebuilt `books` (children + FTS triggers),
 *   - 'mp3' now inserts; unknown formats / bad status / invalid JSON / duplicate SHA are still rejected,
 *   - the runner is idempotent (026 is not applied twice).
 *
 * Run: npm run spike:audio:migration
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

if (!process.versions.electron) {
  const electron = require('electron') // path to the binary
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  const r = spawnSync(electron, [fileURLToPath(import.meta.url)], { env, stdio: 'inherit', windowsHide: true })
  process.exit(r.status ?? 1)
}

const Database = require('better-sqlite3')
const migrationsDir = path.join(here, '../../electron/persistence/migrations')
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

// The runner must know about 026 (static check on migrate.ts, which cannot be imported: Vite `?raw`).
const migrateSource = fs.readFileSync(path.join(here, '../../electron/persistence/migrate.ts'), 'utf8')
assert.ok(files.includes('026_books_audio_format.sql'), '026 file exists')
assert.ok(migrateSource.includes("'026_books_audio_format.sql'") && migrateSource.includes('./migrations/026_books_audio_format.sql?raw'), 'migrate.ts lists 026')
const listed = [...migrateSource.matchAll(/name: '(\d{3}_[a-z0-9_]+\.sql)'/g)].map((m) => m[1])
assert.deepEqual(listed, files, 'migrate.ts MIGRATIONS list == files on disk, in order')

/** Same semantics as migrate.ts. */
function applyMigration(db, file) {
  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString())
    })()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const sha = (s) => createHash('sha256').update(s).digest('hex')

const db = new Database(':memory:')
db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)')
for (const f of files.filter((f) => f < '026')) applyMigration(db, f)
console.log(`SQLite ${db.prepare('select sqlite_version() v').get().v}, Electron-as-Node ${process.versions.node}; applied 001–025`)

// ---- populate every table that references books ----
const insBook = db.prepare(
  `INSERT INTO books (id, title, file_path, normalized_path, file_format, cover_path, sha256, is_favorite, reading_status,
     source_provider, external_id, source_url, metadata_json, genres_json, reading_state_json, added_at, updated_at)
   VALUES (@id, @title, @fp, @np, @fmt, @cover, @sha, @fav, @status, @prov, @ext, @url, @meta, @genres, @state, @added, @upd)`,
)
const formats = ['epub', 'pdf', 'txt', 'md', 'docx']
formats.forEach((fmt, i) => {
  insBook.run({
    id: `b-${fmt}`, title: `Book ${fmt} é`, fp: `C:\\books\\${fmt}\\file.${fmt}`, np: i % 2 ? `n-${fmt}` : null, fmt,
    cover: i % 2 ? `C:\\covers\\${fmt}.png` : null, sha: `sha-${fmt}`, fav: i % 2, status: ['reading', 'completed', 'not-started'][i % 3],
    prov: i === 0 ? 'dropbox' : null, ext: i === 0 ? 'ext-1' : null, url: i === 1 ? 'https://example.com/a.pdf' : null,
    meta: JSON.stringify({ fileSizeBytes: 1000 + i, pageCount: 10 * i, description: `desc ${fmt}`, signatureStatus: 'unsigned' }),
    genres: JSON.stringify(['Fantasy', 'Classics']),
    state: JSON.stringify({ lastReadLocation: `loc-${fmt}`, percent: 10 * i, fontSize: 18, updatedAt: `2026-01-0${i + 1}T00:00:00.000Z`, extra: { k: [1, 2, 3] } }),
    added: '2026-01-01T00:00:00.000Z', upd: `2026-02-0${i + 1}T00:00:00.000Z`,
  })
})
db.prepare(`INSERT INTO authors (id, name, sort_name, created_at) VALUES ('au1','Ann','Ann','t'),('au2','Bob','Bob','t')`).run()
db.prepare(`INSERT INTO book_authors (book_id, author_id, sort_order) VALUES ('b-epub','au1',0),('b-epub','au2',1),('b-pdf','au2',0),('b-txt','au1',0)`).run()
db.prepare(`INSERT INTO collections (id, name, description, created_at, updated_at) VALUES ('c1','Shelf','d','t','t')`).run()
db.prepare(`INSERT INTO collection_books (collection_id, book_id, sort_order, added_at) VALUES ('c1','b-epub',0,'t'),('c1','b-md',1,'t')`).run()
db.prepare(`INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES ('n1','b-epub','{"kind":"highlight","text":"call me Ishmael"}','t','t'),('n2','b-txt','{"kind":"bookmark"}','t','t'),('n3','b-pdf','{}','t','t')`).run()
const insChunk = db.prepare(`INSERT INTO book_chunks (id, book_id, chunk_index, content, word_start, word_count, created_at) VALUES (?, ?, ?, ?, ?, ?, 't')`)
insChunk.run('ch1', 'b-epub', 0, 'Call me Ishmael. Some years ago the whale appeared.', 0, 9)
insChunk.run('ch2', 'b-epub', 1, 'The white whale swam away.', 9, 5)
insChunk.run('ch3', 'b-txt', 0, 'A plain text with a different word: lighthouse.', 0, 8)
db.prepare(`INSERT INTO txt_documents (book_id, revision, content_sha256, char_count, source_sha256, updated_at) VALUES ('b-txt', 2, 'abc', 123, 'def', 't')`).run()
db.prepare(`INSERT INTO pdf_embedded_annotations (book_id, source_key, note_id, source_hash, note_hash, imported_at, synced_at) VALUES ('b-pdf','k','n3','h1','h2','t','t')`).run()
db.prepare(`INSERT INTO pdf_annotation_write_back (book_id, enabled, updated_at) VALUES ('b-pdf', 1, 't')`).run()

const TABLES = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'book_chunks_fts%' AND name <> 'schema_migrations' ORDER BY name`)
  .all()
  .map((r) => r.name)
function snapshot() {
  const out = { counts: {}, hashes: {}, schema: {} }
  for (const t of TABLES) {
    const rows = db.prepare(`SELECT * FROM "${t}" ORDER BY 1, 2`).all()
    out.counts[t] = rows.length
    out.hashes[t] = sha(JSON.stringify(rows))
  }
  out.schema.indexes = db
    .prepare(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name`)
    .all()
  out.schema.triggers = db.prepare(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name`).all()
  out.fts = db.prepare(`SELECT seq FROM book_chunks b JOIN book_chunks_fts f ON f.rowid = b.seq WHERE book_chunks_fts MATCH 'whale' ORDER BY seq`).all().map((r) => r.seq)
  out.ftsRows = db.prepare(`SELECT count(*) n FROM book_chunks_fts`).get().n
  return out
}
console.log('before 026')
const before = snapshot()
check(`populated ${TABLES.length} tables (${Object.entries(before.counts).filter(([, n]) => n).map(([t, n]) => `${t}:${n}`).join(' ')})`, () => {
  assert.equal(before.counts.books, 5)
  assert.deepEqual(before.fts.length, 2)
})
check('the old constraint rejects mp3 (so 026 is really needed)', () => {
  assert.throws(() => insBook.run({ id: 'x', title: 't', fp: 'p', np: null, fmt: 'mp3', cover: null, sha: 'x', fav: 0, status: 'reading', prov: null, ext: null, url: null, meta: '{}', genres: '[]', state: '{}', added: 'a', upd: 'u' }), /CHECK constraint/)
})

// ---- apply 026 ----
applyMigration(db, '026_books_audio_format.sql')
console.log('after 026')
const after = snapshot()

check('every table: same row count and identical content (books included)', () => {
  assert.deepEqual(after.counts, before.counts)
  assert.deepEqual(after.hashes, before.hashes)
})
check('indexes (books and every other table) and triggers are intact', () => {
  const key = (x) => JSON.stringify(x)
  assert.equal(key(after.schema.indexes), key(before.schema.indexes))
  assert.equal(key(after.schema.triggers), key(before.schema.triggers))
  assert.deepEqual(
    after.schema.indexes.filter((i) => i.tbl_name === 'books').map((i) => i.name),
    ['idx_books_favorite', 'idx_books_reading_status', 'idx_books_sha256', 'idx_books_source', 'idx_books_updated_at'],
  )
})
check('FTS5 index still answers with the same hits, row count unchanged', () => {
  assert.deepEqual(after.fts, before.fts)
  assert.equal(after.ftsRows, before.ftsRows)
})
check('PRAGMA foreign_key_check and integrity_check are clean', () => {
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  assert.deepEqual(db.pragma('integrity_check'), [{ integrity_check: 'ok' }])
})
check('the books CHECK now lists mp3 and keeps docx / doc; other columns unchanged', () => {
  const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='books'`).get().sql
  assert.match(sql, /'epub', 'pdf', 'txt', 'md', 'docx', 'doc', 'mp3'/)
  const cols = db.pragma('table_info(books)').map((c) => c.name)
  assert.deepEqual(cols, ['id', 'title', 'file_path', 'normalized_path', 'file_format', 'cover_path', 'sha256', 'is_favorite', 'reading_status', 'source_provider', 'external_id', 'source_url', 'metadata_json', 'genres_json', 'reading_state_json', 'added_at', 'updated_at'])
})
check('mp3 inserts; unknown format, bad status, invalid JSON and duplicate SHA are still rejected', () => {
  const base = { title: 't', fp: 'p', np: null, cover: null, fav: 0, status: 'reading', prov: null, ext: null, url: null, meta: '{}', genres: '[]', state: '{}', added: 'a', upd: 'u' }
  insBook.run({ ...base, id: 'b-mp3', fmt: 'mp3', sha: 'sha-mp3' })
  assert.equal(db.prepare(`SELECT file_format FROM books WHERE id='b-mp3'`).get().file_format, 'mp3')
  assert.throws(() => insBook.run({ ...base, id: 'b-bad', fmt: 'xyz', sha: 'sha-bad' }), /CHECK constraint/)
  assert.throws(() => insBook.run({ ...base, id: 'b-m4b', fmt: 'm4b', sha: 'sha-m4b' }), /CHECK constraint/)
  assert.throws(() => insBook.run({ ...base, id: 'b-st', fmt: 'mp3', sha: 'sha-st', status: 'nope' }), /CHECK constraint/)
  assert.throws(() => insBook.run({ ...base, id: 'b-js', fmt: 'mp3', sha: 'sha-js', state: '{oops' }), /CHECK constraint/)
  assert.throws(() => insBook.run({ ...base, id: 'b-dup', fmt: 'mp3', sha: 'sha-mp3' }), /UNIQUE/)
  insBook.run({ ...base, id: 'b-doc', fmt: 'doc', sha: 'sha-doc' })
})
check('foreign keys are enforced against the rebuilt books table', () => {
  assert.throws(() => db.prepare(`INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES ('nx','ghost','{}','t','t')`).run(), /FOREIGN KEY/)
  db.prepare(`INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES ('nm','b-mp3','{}','t','t')`).run()
})
check('ON DELETE CASCADE still works from the new books (children + FTS triggers); other books untouched', () => {
  db.pragma('foreign_keys = ON')
  const n = (t, id) => db.prepare(`SELECT count(*) n FROM ${t} WHERE book_id = ?`).get(id).n
  assert.equal(n('notes', 'b-epub'), 1)
  assert.equal(n('book_chunks', 'b-epub'), 2)
  assert.equal(n('book_authors', 'b-epub'), 2)
  db.prepare(`DELETE FROM books WHERE id = 'b-epub'`).run()
  for (const t of ['notes', 'book_chunks', 'book_authors']) assert.equal(n(t, 'b-epub'), 0, t)
  assert.equal(db.prepare(`SELECT count(*) n FROM collection_books WHERE book_id = 'b-epub'`).get().n, 0)
  assert.equal(db.prepare(`SELECT count(*) n FROM book_chunks_fts WHERE book_chunks_fts MATCH 'whale'`).get().n, 0, 'FTS entries removed by the cascade triggers')
  assert.equal(n('notes', 'b-txt'), 1)
  assert.equal(n('book_chunks', 'b-txt'), 1)
  assert.equal(db.prepare(`SELECT count(*) n FROM book_chunks_fts WHERE book_chunks_fts MATCH 'lighthouse'`).get().n, 1)
  assert.equal(n('txt_documents', 'b-txt'), 1)
  assert.equal(n('pdf_embedded_annotations', 'b-pdf'), 1)
})
check('the runner is idempotent: schema_migrations has 026 once', () => {
  const applied = db.prepare(`SELECT name FROM schema_migrations WHERE name LIKE '026%'`).all()
  assert.equal(applied.length, 1)
  assert.throws(() => applyMigration(db, '026_books_audio_format.sql'), /UNIQUE/) // a second run is refused by schema_migrations, as migrate() skips it
})
check('a fresh database migrated 001–026 in one go ends in the same schema', () => {
  const fresh = new Database(':memory:')
  fresh.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)')
  for (const f of files) applyMigration(fresh, f)
  const s = (d) => d.prepare(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'book_chunks_fts_%' ORDER BY type, name`).all().map((r) => ({ ...r, sql: (r.sql ?? '').replace(/\s+/g, ' ') }))
  assert.deepEqual(s(fresh), s(db))
  fresh.close()
})

db.close()
console.log(`\n${passed} checks passed`)

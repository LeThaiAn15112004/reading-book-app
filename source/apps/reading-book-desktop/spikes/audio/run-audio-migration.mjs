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
 * It then applies 027 and 028 (`book_audio_chapters`, multi-chapter audiobooks) and proves for 028: no existing table
 * changes, every CHECK / UNIQUE / FOREIGN KEY holds, deleting a book cascades its chapters, and — with the REAL
 * better-sqlite3 `json_patch` — a multi-chapter progress save deletes a stale `percent` / `durationSeconds` /
 * `chapterId` while single-file saves keep today's behaviour (SDK `audioProgressPatch`, built bundle).
 *
 * Run: npm run spike:audio:migration
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
// ---- apply 027 (more audio formats) on top ----
assert.ok(files.includes('027_books_more_audio_formats.sql') && migrateSource.includes('./migrations/027_books_more_audio_formats.sql?raw'), '027 exists and is listed')
const before27 = snapshot() // earlier checks changed rows (cascade test), so compare against the state right before 027
applyMigration(db, '027_books_more_audio_formats.sql')
console.log('after 027')
const after27 = snapshot()
check('027: every table keeps its row count and content; indexes, triggers and FTS intact', () => {
  assert.deepEqual(after27.counts, before27.counts)
  assert.deepEqual(after27.hashes, before27.hashes)
  assert.equal(JSON.stringify(after27.schema.indexes), JSON.stringify(before27.schema.indexes))
  assert.equal(JSON.stringify(after27.schema.triggers), JSON.stringify(before27.schema.triggers))
  assert.deepEqual(after27.fts, before27.fts)
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  assert.deepEqual(db.pragma('integrity_check'), [{ integrity_check: 'ok' }])
})
check('027: m4a m4b aac wav flac ogg opus insert; aiff / aif / zip / xyz are still refused', () => {
  let i = 0
  const row = (fmt) => ({ id: `n27-${fmt}`, title: 't', fp: `p${i}`, np: null, fmt, cover: null, sha: `s27-${i++}-${fmt}`, fav: 0, status: 'reading', prov: null, ext: null, url: null, meta: '{}', genres: '[]', state: '{}', added: 'a', upd: 'u' })
  for (const f of ['m4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus']) insBook.run(row(f))
  for (const f of ['aiff', 'aif', 'zip', 'xyz']) assert.throws(() => insBook.run(row(f)), /CHECK constraint/, f)
  db.prepare(`DELETE FROM books WHERE id LIKE 'n27-%'`).run()
})
// ---- apply 028 (multi-chapter audiobooks) on top ----
assert.ok(files.includes('028_book_audio_chapters.sql') && migrateSource.includes('./migrations/028_book_audio_chapters.sql?raw'), '028 exists and is listed')
const before28 = snapshot()
applyMigration(db, '028_book_audio_chapters.sql')
console.log('after 028')
const after28 = snapshot()
check('028: no existing table changes (counts + content), indexes / triggers / FTS intact, integrity clean', () => {
  assert.deepEqual(after28.counts, before28.counts)
  assert.deepEqual(after28.hashes, before28.hashes)
  assert.equal(JSON.stringify(after28.schema.triggers), JSON.stringify(before28.schema.triggers))
  assert.deepEqual(after28.fts, before28.fts)
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  assert.deepEqual(db.pragma('integrity_check'), [{ integrity_check: 'ok' }])
})
check('028: books keeps its format list and its indexes (it was not rebuilt)', () => {
  const sqlOf = (d) => d.prepare(`SELECT sql FROM sqlite_master WHERE name = 'books'`).get().sql
  assert.ok(sqlOf(db).includes("'opus'"))
  assert.equal(after28.schema.indexes.filter((i) => i.tbl_name === 'books').length, before28.schema.indexes.filter((i) => i.tbl_name === 'books').length)
})
check('028: table, columns and index exist', () => {
  const cols = db.prepare(`PRAGMA table_info(book_audio_chapters)`).all().map((c) => c.name)
  assert.deepEqual(cols, ['id', 'book_id', 'position', 'title', 'file_name', 'source_path', 'file_format', 'size_bytes', 'sha256', 'duration_seconds'])
  assert.ok(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_book_audio_chapters_book'`).get())
})
const mkAudioBook = (id, fmt = 'mp3') =>
  insBook.run({ id, title: id, fp: `/books/${id}/0000-aaaaaaaa.${fmt}`, np: null, fmt, cover: null, sha: `mc-sha-${id}`, fav: 0, status: 'reading', prov: null, ext: null, url: null, meta: '{}', genres: '[]', state: '{}', added: 'a', upd: 'u' })
const chapter = (over) => ({ id: `ch-${Math.random()}`, book_id: 'mc-1', position: 0, title: 'Chapter', file_name: '0000-aaaaaaaa.mp3', source_path: 'CD1/01.mp3', file_format: 'mp3', size_bytes: 10, sha256: 'h', duration_seconds: null, ...over })
const insCh = db.prepare(`INSERT INTO book_audio_chapters (id, book_id, position, title, file_name, source_path, file_format, size_bytes, sha256, duration_seconds)
  VALUES (@id, @book_id, @position, @title, @file_name, @source_path, @file_format, @size_bytes, @sha256, @duration_seconds)`)
mkAudioBook('mc-1')
mkAudioBook('mc-2', 'm4b')
check('028: valid chapters insert — mixed formats, NULL and real durations, the same basename from different folders', () => {
  insCh.run(chapter({ position: 0, file_name: '0000-aaaaaaaa.mp3', source_path: 'CD1/01.mp3', duration_seconds: 61.5 }))
  insCh.run(chapter({ position: 1, file_name: '0001-bbbbbbbb.m4b', source_path: 'CD2/01.mp3', file_format: 'm4b', duration_seconds: null }))
  for (const f of ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus']) insCh.run(chapter({ book_id: 'mc-2', position: 10 + ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus'].indexOf(f), file_name: `00${10 + ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus'].indexOf(f)}-cccccccc.${f}`, file_format: f }))
  assert.equal(db.prepare(`SELECT count(*) n FROM book_audio_chapters WHERE book_id='mc-1'`).get().n, 2)
  assert.equal(db.prepare(`SELECT duration_seconds d FROM book_audio_chapters WHERE book_id='mc-1' AND position=1`).get().d, null)
})
check('028: every CHECK rejects bad rows (format, position, size, duration, file_name not a basename)', () => {
  const bad = (over, re = /CHECK constraint/) => assert.throws(() => insCh.run(chapter({ position: 50, file_name: 'ok-50.mp3', ...over })), re, JSON.stringify(over))
  bad({ file_format: 'aiff' })
  bad({ file_format: 'zip' })
  bad({ file_format: 'epub' })
  bad({ position: -1 })
  bad({ size_bytes: -1 })
  bad({ duration_seconds: 0 })
  bad({ duration_seconds: -3 })
  for (const name of ['', '.', '..', 'a/b.mp3', '../x.mp3', 'a\\b.mp3', '/abs.mp3', 'C:\\x.mp3']) bad({ file_name: name })
})
check('028: UNIQUE (book, position), UNIQUE (book, file_name), primary key, and the foreign key', () => {
  assert.throws(() => insCh.run(chapter({ position: 0, file_name: 'other.mp3' })), /UNIQUE/)
  assert.throws(() => insCh.run(chapter({ position: 60, file_name: '0000-aaaaaaaa.mp3' })), /UNIQUE/)
  const id = db.prepare(`SELECT id FROM book_audio_chapters WHERE book_id='mc-1' LIMIT 1`).get().id
  assert.throws(() => insCh.run(chapter({ id, position: 61, file_name: 'x61.mp3' })), /UNIQUE|PRIMARY/)
  assert.throws(() => insCh.run(chapter({ book_id: 'no-such-book', position: 0 })), /FOREIGN KEY/)
  // the same file name / position in ANOTHER book is fine (uniqueness is per book)
  insCh.run(chapter({ book_id: 'mc-2', position: 0, file_name: '0000-aaaaaaaa.mp3' }))
})
check('028: deleting the parent book cascades its chapters only', () => {
  const n = (b) => db.prepare(`SELECT count(*) n FROM book_audio_chapters WHERE book_id=?`).get(b).n
  assert.equal(n('mc-1'), 2)
  const other = n('mc-2')
  db.prepare(`DELETE FROM books WHERE id='mc-1'`).run()
  assert.equal(n('mc-1'), 0)
  assert.equal(n('mc-2'), other)
  assert.deepEqual(db.pragma('foreign_key_check'), [])
})

// JSON merge-patch against the real engine, driven by the SDK's own patch builder (built bundle).
const sdk = await import(pathToFileURL(path.join(here, '../../../book-reader-sdk/dist/index.mjs')).href)
const NOW = '2026-01-01T00:00:00.000Z'
const stateOf = (id) => JSON.parse(db.prepare(`SELECT reading_state_json s FROM books WHERE id=?`).get(id).s)
const applyProgress = (id, input) =>
  db.prepare(`UPDATE books SET reading_state_json = json_patch(reading_state_json, @patch) WHERE id = @id`).run({ id, patch: JSON.stringify(sdk.audioProgressPatch(input, NOW)) })
const seedState = () => ({
  percent: 42,
  lastReadLocation: 'x',
  updatedAt: 'state-updated',
  audioBookmarks: [{ id: 'n1', positionSeconds: 3 }],
  audioProgress: { positionSeconds: 100, durationSeconds: 3600, playbackRate: 1.5, scope: 'book', chapterId: 'old-chapter', updatedAt: 'old' },
})
check('json_patch (real engine): a trackId save DELETES stale percent / durationSeconds / chapterId and keeps the rest', () => {
  mkAudioBook('jp-multi')
  db.prepare(`UPDATE books SET reading_state_json=? WHERE id='jp-multi'`).run(JSON.stringify(seedState()))
  applyProgress('jp-multi', { positionSeconds: 5, playbackRate: 1, trackId: 't1', scope: 'chapter', durationSeconds: 90, chapterId: 'c9' })
  const st = stateOf('jp-multi')
  assert.equal('percent' in st, false)
  assert.equal('durationSeconds' in st.audioProgress, false)
  assert.equal('chapterId' in st.audioProgress, false)
  assert.deepEqual(st.audioProgress, { positionSeconds: 5, playbackRate: 1, scope: 'chapter', trackId: 't1', updatedAt: NOW })
  assert.equal(st.lastReadLocation, 'x')
  assert.equal(st.updatedAt, 'state-updated')
  assert.deepEqual(st.audioBookmarks, [{ id: 'n1', positionSeconds: 3 }])
  applyProgress('jp-multi', { positionSeconds: 9, playbackRate: 1, trackId: 't2' })
  const again = stateOf('jp-multi')
  assert.equal('percent' in again, false)
  assert.equal('durationSeconds' in again.audioProgress, false)
  assert.equal(again.audioProgress.trackId, 't2')
})
check('json_patch (real engine): omission would have left them (why the patch uses explicit nulls)', () => {
  mkAudioBook('jp-omit')
  db.prepare(`UPDATE books SET reading_state_json=? WHERE id='jp-omit'`).run(JSON.stringify(seedState()))
  db.prepare(`UPDATE books SET reading_state_json = json_patch(reading_state_json, ?) WHERE id='jp-omit'`).run(JSON.stringify({ audioProgress: { positionSeconds: 5, trackId: 't1' } }))
  const st = stateOf('jp-omit')
  assert.equal(st.percent, 42)
  assert.equal(st.audioProgress.durationSeconds, 3600)
})
check('json_patch (real engine): a single-file save (no trackId) behaves exactly as before', () => {
  mkAudioBook('jp-single')
  db.prepare(`UPDATE books SET reading_state_json=? WHERE id='jp-single'`).run(JSON.stringify(seedState()))
  applyProgress('jp-single', { positionSeconds: 30, playbackRate: 1.25, durationSeconds: 120, scope: 'book' })
  const st = stateOf('jp-single')
  assert.equal(st.percent, 25)
  assert.deepEqual(st.audioProgress, { positionSeconds: 30, durationSeconds: 120, playbackRate: 1.25, scope: 'book', chapterId: 'old-chapter', updatedAt: NOW })
  assert.equal('trackId' in st.audioProgress, false)
  assert.deepEqual(st.audioBookmarks, [{ id: 'n1', positionSeconds: 3 }])
})
db.prepare(`DELETE FROM books WHERE id IN ('jp-multi','jp-omit','jp-single','mc-2')`).run()
check('the runner is idempotent: schema_migrations has 026 once', () => {
  const applied = db.prepare(`SELECT name FROM schema_migrations WHERE name LIKE '026%'`).all()
  assert.equal(applied.length, 1)
  assert.throws(() => applyMigration(db, '026_books_audio_format.sql'), /UNIQUE/) // a second run is refused by schema_migrations, as migrate() skips it
})
check('a fresh database migrated through the latest in one go ends in the same schema', () => {
  // `db` stopped at 028 for the checks above; bring it to the latest (029+, not touched by this spike) first.
  for (const f of files.filter((f) => f.slice(0, 3) > '028')) applyMigration(db, f)
  const fresh = new Database(':memory:')
  fresh.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)')
  for (const f of files) applyMigration(fresh, f)
  const s = (d) => d.prepare(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'book_chunks_fts_%' ORDER BY type, name`).all().map((r) => ({ ...r, sql: (r.sql ?? '').replace(/\s+/g, ' ') }))
  assert.deepEqual(s(fresh), s(db))
  fresh.close()
})

db.close()
console.log(`\n${passed} checks passed`)

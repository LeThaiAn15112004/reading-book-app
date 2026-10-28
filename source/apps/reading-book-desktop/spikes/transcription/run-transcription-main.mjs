/**
 * Audiobook transcription, Main side (spec 004) — what exists so far, checked on the REAL better-sqlite3 and the
 * REAL SQLite FTS5 that ship with Electron.
 *
 *   A. migration 029   schema, CHECK / UNIQUE / FOREIGN KEY rules, FTS5 triggers, ON DELETE CASCADE from `books` and
 *                      from `book_audio_chapters`, integrity — on a database migrated through every file
 *   A2. 029 on an existing populated database (001–028 first): nothing that existed changes (schema byte-identical, rows,
 *                      book_chunks_fts answers), exactly the expected new objects, old features still behave after it
 *   B. SqliteTranscriptStore  ensure / commitWindow (one transaction, overlap rule, refusals, rollback) / playback
 *                      order from `book_audio_chapters.position` / paging / search / job state / replace / delete /
 *                      idempotent startup recovery (never `complete`, text kept)
 *   D. model manager   pinned-catalog download, per-file size + SHA-256 gate, cleanup on every failure, DISK_FULL, abort,
 *                      tamper detection and atomic repair — with fake downloads (the real catalog runs live in the smoke spike)
 *   C. audio decoder   with a FAKE process only (no FFmpeg binary exists yet — tasks T001a/T001b): unavailable on Linux
 *                      and while no artifact is verified, SHA-256 gate before any spawn, argv array without a shell,
 *                      PCM parsing, errors, abort, output cap, cached verdict
 *
 * Section E covers the speech-process host watchdog (T015); section F the transcription service (queue / cancel / resume / failure / recovery after a REAL process kill). Not covered: the
 * IPC handlers, and any real FFmpeg binary. Real-binary decoding is task T001a.
 *
 * better-sqlite3 is built for Electron's Node ABI, so this script re-launches itself with the app's own Electron binary in
 * `ELECTRON_RUN_AS_NODE` mode — Node with Electron's ABI, no window, no GUI, no user data (databases are `:memory:`).
 * The TypeScript under test is bundled with esbuild into a temp folder first (the SDK from its built `dist/`).
 *
 * Run: npm run spike:transcription:main   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { spawn as spawnChild, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const desktop = path.resolve(here, '../..')

if (!process.versions.electron) {
  // ---- phase 1 (plain node): bundle the TypeScript under test, then re-launch under Electron's Node ----
  const esbuild = require('esbuild')
  const sdk = path.resolve(desktop, '../book-reader-sdk/dist/index.mjs')
  assert.ok(fs.existsSync(sdk), 'build the SDK first (the npm script does)')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-transcription-spike-'))
  const plugin = {
    name: 'spike-aliases',
    setup(build) {
      build.onResolve({ filter: /^@reading-book\/book-reader-sdk$/ }, () => ({ path: sdk }))
      // `./db` pulls in Electron's `app`; the stores take the database as a constructor argument here.
      build.onResolve({ filter: /^\.\/db$/ }, () => ({ path: 'db-stub', namespace: 'stub' }))
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export function getDatabase() { throw new Error("db stub: pass a database") }',
        loader: 'js',
      }))
    },
  }
  const bundles = {
    store: path.join(out, 'transcript-store.mjs'),
    decoder: path.join(out, 'audio-decoder.mjs'),
    manager: path.join(out, 'model-manager.mjs'),
    host: path.join(out, 'speech-process-host.mjs'),
    service: path.join(out, 'transcription-service.mjs'),
    langtag: path.join(out, 'audio-language-tag.mjs'),
    exportfile: path.join(out, 'transcript-export-file.mjs'),
    modelusage: path.join(out, 'speech-model-usage.mjs'),
    artifacts: path.join(out, 'ffmpeg-artifacts.mjs'),
  }
  await esbuild.build({
    entryPoints: [path.join(desktop, 'electron/persistence/sqlite-transcript-store.ts')],
    outfile: bundles.store, bundle: true, platform: 'node', format: 'esm', external: ['better-sqlite3', 'electron'],
    plugins: [plugin], logLevel: 'error',
  })
  await esbuild.build({
    entryPoints: [path.join(desktop, 'electron/transcription/audio-decoder.ts')],
    outfile: bundles.decoder, bundle: true, platform: 'node', format: 'esm', external: ['electron'],
    plugins: [plugin], logLevel: 'error',
  })
  await esbuild.build({
    entryPoints: [path.join(desktop, 'electron/transcription/model-manager.ts')],
    outfile: bundles.manager, bundle: true, platform: 'node', format: 'esm', external: ['electron'],
    plugins: [plugin], logLevel: 'error',
  })
  await esbuild.build({
    entryPoints: [path.join(desktop, 'electron/transcription/speech-process-host.ts')],
    outfile: bundles.host, bundle: true, platform: 'node', format: 'esm', external: ['electron'],
    plugins: [plugin], logLevel: 'error',
  })
  await esbuild.build({
    entryPoints: [path.join(desktop, 'electron/transcription/transcription-service.ts')],
    outfile: bundles.service, bundle: true, platform: 'node', format: 'esm', external: ['electron'],
    plugins: [plugin], logLevel: 'error',
  })
  await esbuild.build({
    entryPoints: [path.join(desktop, 'electron/transcription/audio-language-tag.ts')],
    outfile: bundles.langtag, bundle: true, platform: 'node', format: 'esm', external: ['electron'],
    plugins: [plugin], logLevel: 'error',
  })
  await esbuild.build({
    entryPoints: [path.join(desktop, 'electron/transcription/transcript-export-file.ts')],
    outfile: bundles.exportfile, bundle: true, platform: 'node', format: 'esm', external: ['electron'],
    plugins: [plugin], logLevel: 'error',
  })
  await esbuild.build({
    entryPoints: [path.join(desktop, 'electron/transcription/speech-model-usage.ts')],
    outfile: bundles.modelusage, bundle: true, platform: 'node', format: 'esm', external: ['electron'],
    plugins: [plugin], logLevel: 'error',
  })
  await esbuild.build({
    entryPoints: [path.join(desktop, 'electron/transcription/ffmpeg-artifacts.ts')],
    outfile: bundles.artifacts, bundle: true, platform: 'node', format: 'esm', external: ['electron'],
    plugins: [plugin], logLevel: 'error',
  })
  const electron = require('electron') // path to the binary
  const env = {
    ...process.env, ELECTRON_RUN_AS_NODE: '1',
    TRANSCRIPTION_SPIKE_STORE: bundles.store, TRANSCRIPTION_SPIKE_DECODER: bundles.decoder, TRANSCRIPTION_SPIKE_MANAGER: bundles.manager, TRANSCRIPTION_SPIKE_HOST: bundles.host, TRANSCRIPTION_SPIKE_SERVICE: bundles.service, TRANSCRIPTION_SPIKE_LANGTAG: bundles.langtag, TRANSCRIPTION_SPIKE_EXPORTFILE: bundles.exportfile, TRANSCRIPTION_SPIKE_MODELUSAGE: bundles.modelusage, TRANSCRIPTION_SPIKE_ARTIFACTS: bundles.artifacts,
  }
  const r = spawnSync(electron, [fileURLToPath(import.meta.url)], { env, stdio: 'inherit', windowsHide: true })
  fs.rmSync(out, { recursive: true, force: true })
  process.exit(r.status ?? 1)
}

// ---- phase 2 (Electron's Node, real better-sqlite3) ----
const Database = require('better-sqlite3')
const { SqliteTranscriptStore, buildFtsQuery } = await import(pathToFileURL(process.env.TRANSCRIPTION_SPIKE_STORE).href)
const { createAudioDecoder, buildFfmpegArgs, DecodeError, SELF_TEST_ARGS } = await import(pathToFileURL(process.env.TRANSCRIPTION_SPIKE_DECODER).href)
const { createSpeechProcessHost, SpeechProcessError } = await import(pathToFileURL(process.env.TRANSCRIPTION_SPIKE_HOST).href)
const { createTranscriptionService } = await import(pathToFileURL(process.env.TRANSCRIPTION_SPIKE_SERVICE).href)
const { readAudioLanguageTag, createLanguageTagCache } = await import(pathToFileURL(process.env.TRANSCRIPTION_SPIKE_LANGTAG).href)
const { exportTranscriptToFile } = await import(pathToFileURL(process.env.TRANSCRIPTION_SPIKE_EXPORTFILE).href)
const { listSpeechModelUsage } = await import(pathToFileURL(process.env.TRANSCRIPTION_SPIKE_MODELUSAGE).href)

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}


// ---- fakes shared by the service tests (section F), the store spike and the child process of the crash-recovery test ----
const { makeFakeWorld, makeService: makeServiceWith, sleepMs, until, lastJobState } = await import(pathToFileURL(path.join(desktop, 'spikes/transcription/fake-world.mjs')).href)
const makeService = (world, store, extra) => makeServiceWith(createTranscriptionService, world, store, extra)
// ---- child process of the crash-recovery test: a REAL process that is killed mid-job ----
if (process.env.TRANSCRIPTION_SPIKE_CHILD) {
  const { dbFile, hangAt } = JSON.parse(process.env.TRANSCRIPTION_SPIKE_CHILD)
  const childDb = new Database(dbFile)
  childDb.pragma('foreign_keys = ON')
  const childWorld = makeFakeWorld({ books: { crash: { format: 'mp3', durationMs: 75_000 } } })
  childWorld.onSpeech = async (call) => {
    if (call === hangAt) {
      process.stdout.write('HUNG\n')   // from here on only a kill ends this process
      setInterval(() => {}, 1000)       // keep the event loop alive: the process must not be able to end by itself
      await new Promise(() => {})
    }
  }
  const childService = makeService(childWorld, new SqliteTranscriptStore(childDb))
  const started = await childService.start({ bookId: 'crash', scope: { kind: 'whole' }, language: 'en', modelId: 'whisper-tiny' })
  process.stdout.write(`STARTED ${started.ok}\n`)
  setInterval(() => {}, 1000)
  await new Promise(() => {})
}

const migrationsDir = path.join(desktop, 'electron/persistence/migrations')
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
const migrateSource = fs.readFileSync(path.join(desktop, 'electron/persistence/migrate.ts'), 'utf8')

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
function freshDb() {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)')
  for (const f of files) applyMigration(db, f)
  db.pragma('foreign_keys = ON')
  return db
}

console.log(`SQLite ${new Database(':memory:').prepare('select sqlite_version() v').get().v}, Electron-as-Node ${process.versions.node}`)

const db = freshDb()
const insBook = db.prepare(
  `INSERT INTO books (id, title, file_path, normalized_path, file_format, cover_path, sha256, is_favorite, reading_status,
     source_provider, external_id, source_url, metadata_json, genres_json, reading_state_json, added_at, updated_at)
   VALUES (@id, @title, @fp, NULL, @fmt, NULL, @sha, 0, 'reading', NULL, NULL, NULL, '{}', '[]', '{}', 'a', 'u')`,
)
const mkBook = (id, fmt = 'mp3') => insBook.run({ id, title: id, fp: `/books/${id}/0000-aaaaaaaa.${fmt}`, fmt, sha: `sha-${id}` })
const insChapter = db.prepare(
  `INSERT INTO book_audio_chapters (id, book_id, position, title, file_name, source_path, file_format, size_bytes, sha256, duration_seconds)
   VALUES (?, ?, ?, ?, ?, 'x.mp3', 'mp3', 10, 'h', 60)`,
)
const mkChapter = (id, bookId, position) => insChapter.run(id, bookId, position, `Chapter ${position}`, `${String(position).padStart(4, '0')}-${id.slice(0, 8).padEnd(8, 'x')}.mp3`)
const count = (table, where = '1=1') => db.prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).get().n
const P = (startMs, endMs, text, trackId) => (trackId ? { startMs, endMs, text, trackId } : { startMs, endMs, text })
const NOW = '2026-01-01T00:00:00.000Z'
const insTranscript = db.prepare(
  `INSERT INTO audio_transcripts (id, book_id, language, model_id, status, job_state, last_error, covered_json, created_at, updated_at)
   VALUES (@id, @book_id, 'en', 'whisper-tiny', @status, @job_state, @last_error, @covered_json, '${NOW}', '${NOW}')`,
)
const rawTranscript = (over) => ({ id: `t-${Math.random()}`, book_id: 'm-1', status: 'partial', job_state: null, last_error: null, covered_json: '{}', ...over })
const insPassageRaw = db.prepare('INSERT INTO audio_transcript_passages (transcript_id, track_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?)')

// =====================================================================================================================
console.log('\nA. migration 029')
// =====================================================================================================================
await check('migrate.ts lists 029 and its file, in order, like every other migration', () => {
  assert.ok(files.includes('029_audio_transcripts.sql'))
  assert.ok(migrateSource.includes("'029_audio_transcripts.sql'") && migrateSource.includes('./migrations/029_audio_transcripts.sql?raw'))
  const listed = [...migrateSource.matchAll(/name: '(\d{3}_[a-z0-9_]+\.sql)'/g)].map((m) => m[1])
  assert.deepEqual(listed, files)
})
await check('tables, columns, index and FTS exist; a database migrated through 029 is clean', () => {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
  assert.deepEqual(cols('audio_transcripts'), ['id', 'book_id', 'language', 'model_id', 'status', 'job_state', 'last_error', 'covered_json', 'created_at', 'updated_at', 'scope_json'])
  assert.deepEqual(cols('audio_transcript_passages'), ['id', 'transcript_id', 'track_id', 'start_ms', 'end_ms', 'text'])
  assert.ok(!cols('audio_transcript_passages').some((c) => /position|order/.test(c)), 'no ordering column of its own')
  assert.ok(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_audio_transcript_passages_pos'`).get())
  assert.ok(db.prepare(`SELECT 1 FROM sqlite_master WHERE name='audio_transcript_fts'`).get())
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  assert.deepEqual(db.pragma('integrity_check'), [{ integrity_check: 'ok' }])
})
mkBook('m-1')
await check('029: valid rows insert; UNIQUE(book_id), status / job_state / last_error / covered_json CHECKs hold', () => {
  insTranscript.run(rawTranscript({ id: 't-ok', status: 'partial', job_state: 'running', last_error: 'ABORTED', covered_json: '{"main":[[0,10]]}' }))
  assert.throws(() => insTranscript.run(rawTranscript()), /UNIQUE/)
  mkBook('m-x')
  assert.throws(() => insTranscript.run(rawTranscript({ book_id: 'm-x', status: 'none' })), /CHECK/)
  assert.throws(() => insTranscript.run(rawTranscript({ book_id: 'm-x', job_state: 'done' })), /CHECK/)
  assert.throws(() => insTranscript.run(rawTranscript({ book_id: 'm-x', last_error: 'WHATEVER' })), /CHECK/)
  assert.throws(() => insTranscript.run(rawTranscript({ book_id: 'm-x', covered_json: '{nope' })), /CHECK/)
  assert.throws(() => insTranscript.run(rawTranscript({ book_id: 'no-such-book' })), /FOREIGN KEY/)
  for (const code of ['INTERRUPTED', 'INTEGRITY_FAILED']) {
    db.prepare('UPDATE audio_transcripts SET last_error = ? WHERE id = ?').run(code, 't-ok')
  }
})
await check('029: passage rules — start < end, start >= 0, trimmed non-empty text, existing transcript and chapter', () => {
  insPassageRaw.run('t-ok', null, 0, 1000, 'hello')
  assert.throws(() => insPassageRaw.run('t-ok', null, 1000, 1000, 'x'), /CHECK/)
  assert.throws(() => insPassageRaw.run('t-ok', null, 2000, 1000, 'x'), /CHECK/)
  assert.throws(() => insPassageRaw.run('t-ok', null, -1, 1000, 'x'), /CHECK/)
  assert.throws(() => insPassageRaw.run('t-ok', null, 0, 1000, ''), /CHECK/)
  assert.throws(() => insPassageRaw.run('t-ok', null, 0, 1000, ' padded '), /CHECK/)
  assert.throws(() => insPassageRaw.run('ghost', null, 0, 1000, 'x'), /FOREIGN KEY/)
  assert.throws(() => insPassageRaw.run('t-ok', 'ghost-chapter', 0, 1000, 'x'), /FOREIGN KEY/)
})
await check('029: FTS5 follows insert / update / delete and is diacritic- and case-insensitive', () => {
  insPassageRaw.run('t-ok', null, 2000, 3000, 'Xin chào Việt Nam')
  const hit = (q) => db.prepare(`SELECT count(*) n FROM audio_transcript_fts WHERE audio_transcript_fts MATCH ?`).get(q).n
  assert.equal(hit('viet'), 1)
  assert.equal(hit('VIỆT'), 1)
  assert.equal(hit('vie*'), 1)
  db.prepare(`UPDATE audio_transcript_passages SET text = 'Hello world' WHERE text LIKE 'Xin%'`).run()
  assert.equal(hit('viet'), 0)
  assert.equal(hit('world'), 1)
  db.prepare(`DELETE FROM audio_transcript_passages WHERE text = 'Hello world'`).run()
  assert.equal(hit('world'), 0)
})
await check('029: deleting a book cascades its transcript, passages and FTS entries; deleting a chapter cascades its passages', () => {
  mkBook('mc-1'); mkChapter('chap-a', 'mc-1', 0); mkChapter('chap-b', 'mc-1', 1)
  insTranscript.run(rawTranscript({ id: 't-mc', book_id: 'mc-1' }))
  insPassageRaw.run('t-mc', 'chap-a', 0, 1000, 'alpha uniqueword')
  insPassageRaw.run('t-mc', 'chap-b', 0, 1000, 'beta')
  db.prepare('DELETE FROM book_audio_chapters WHERE id = ?').run('chap-b')
  assert.equal(count('audio_transcript_passages', `transcript_id='t-mc'`), 1)
  db.prepare('DELETE FROM books WHERE id = ?').run('mc-1')
  assert.equal(count('audio_transcripts', `id='t-mc'`), 0)
  assert.equal(count('audio_transcript_passages', `transcript_id='t-mc'`), 0)
  assert.equal(db.prepare(`SELECT count(*) n FROM audio_transcript_fts WHERE audio_transcript_fts MATCH 'uniqueword'`).get().n, 0)
  assert.deepEqual(db.pragma('foreign_key_check'), [])
})

// =====================================================================================================================
console.log('\nA2. migration 029 on an EXISTING, populated database (001–028 applied first; real better-sqlite3 + FTS5)')
// =====================================================================================================================
{
  const old = new Database(':memory:')
  old.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)')
  for (const f of files.filter((f) => f.slice(0, 3) < '029')) applyMigration(old, f)
  old.pragma('foreign_keys = ON')
  const oBook = old.prepare(
    `INSERT INTO books (id, title, file_path, normalized_path, file_format, cover_path, sha256, is_favorite, reading_status,
       source_provider, external_id, source_url, metadata_json, genres_json, reading_state_json, added_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, NULL, ?, 0, 'reading', NULL, NULL, NULL, '{}', '[]', '{"percent":42}', 'a', 'u')`,
  )
  for (const [id, fmt] of [['o-epub', 'epub'], ['o-pdf', 'pdf'], ['o-txt', 'txt'], ['o-md', 'md'], ['o-mp3', 'mp3'], ['o-m4b', 'm4b']]) {
    oBook.run(id, `Book ${id} é`, `/books/${id}/file.${fmt}`, fmt, `sha-${id}`)
  }
  old.prepare(`INSERT INTO book_audio_chapters (id, book_id, position, title, file_name, source_path, file_format, size_bytes, sha256, duration_seconds)
    VALUES ('o-ch0', 'o-m4b', 0, 'One', '0000-aaaaaaaa.m4b', 'a.m4b', 'm4b', 10, 'h', 60), ('o-ch1', 'o-m4b', 1, 'Two', '0001-bbbbbbbb.m4b', 'b.m4b', 'm4b', 10, 'h', NULL)`).run()
  const oChunk = old.prepare(`INSERT INTO book_chunks (id, book_id, chunk_index, content, location_start, location_end, word_start, word_count, created_at)
    VALUES (?, 'o-epub', ?, ?, NULL, NULL, 0, 3, 'now')`)
  oChunk.run('c0', 0, 'old chunk about dragons'); oChunk.run('c1', 1, 'another chunk about knights')

  /** Everything that exists before 029, as the database itself describes it, plus the rows that matter. */
  const snapshot = (d) => ({
    schema: d.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all(),
    books: d.prepare('SELECT * FROM books ORDER BY id').all(),
    chapters: d.prepare('SELECT * FROM book_audio_chapters ORDER BY id').all(),
    chunks: d.prepare('SELECT seq, id, book_id, content FROM book_chunks ORDER BY seq').all(),
    fts: d.prepare(`SELECT rowid FROM book_chunks_fts WHERE book_chunks_fts MATCH 'dragons OR knights' ORDER BY rowid`).all(),
    migrations: d.prepare('SELECT name FROM schema_migrations ORDER BY id').all().map((r) => r.name),
    userVersion: d.pragma('user_version', { simple: true }),
  })
  const before = snapshot(old)
  await check('before 029: the populated database is healthy and has no transcript objects', () => {
    assert.ok(before.books.length === 6 && before.chapters.length === 2 && before.chunks.length === 2 && before.fts.length === 2)
    assert.ok(!before.schema.some((o) => /audio_transcript/.test(o.name)))
    assert.deepEqual(old.pragma('foreign_key_check'), [])
  })

  applyMigration(old, files.find((f) => f.startsWith('029_')))
  const after = snapshot(old)
  await check('029 changes nothing that existed: every old table, index, trigger, view and FTS definition is byte-identical', () => {
    const was = new Map(before.schema.map((o) => [`${o.type}:${o.name}`, o]))
    for (const o of before.schema) assert.deepEqual(after.schema.find((x) => x.type === o.type && x.name === o.name), o, `${o.type} ${o.name} changed`)
    assert.equal(was.size, before.schema.length)
  })
  await check('029 adds exactly the transcript objects (tables, one index, the FTS5 table + its shadow tables, three triggers) and nothing else', () => {
    const had = new Set(before.schema.map((o) => `${o.type}:${o.name}`))
    const added = after.schema.filter((o) => !had.has(`${o.type}:${o.name}`)).map((o) => `${o.type}:${o.name}`).sort()
    assert.deepEqual(added, [
      'index:idx_audio_transcript_passages_pos',
      'table:audio_transcript_fts',
      'table:audio_transcript_fts_config',
      'table:audio_transcript_fts_data',
      'table:audio_transcript_fts_docsize',
      'table:audio_transcript_fts_idx',
      'table:audio_transcript_passages',
      'table:audio_transcripts',
      'trigger:audio_transcript_fts_after_delete',
      'trigger:audio_transcript_fts_after_insert',
      'trigger:audio_transcript_fts_after_update',
    ])
  })
  await check('029 leaves every existing row untouched (books, chapters, chunks) and book_chunks_fts answers the same query', () => {
    assert.deepEqual(after.books, before.books)
    assert.deepEqual(after.chapters, before.chapters)
    assert.deepEqual(after.chunks, before.chunks)
    assert.deepEqual(after.fts, before.fts)
    assert.equal(after.userVersion, before.userVersion)
  })
  await check('the migration is recorded once, after 028, and only 029 was added to schema_migrations', () => {
    assert.deepEqual(after.migrations, [...before.migrations, '029_audio_transcripts.sql'])
    assert.equal(before.migrations.at(-1), '028_book_audio_chapters.sql')
  })
  await check('after 029 the OLD features still behave: new chunks are indexed by book_chunks_fts, deleting a book cascades chunks + FTS + chapters, FK / integrity clean', () => {
    old.prepare(`INSERT INTO book_chunks (id, book_id, chunk_index, content, word_start, word_count, created_at) VALUES ('c2', 'o-epub', 2, 'freshly added phoenix', 3, 3, 'now')`).run()
    assert.equal(old.prepare(`SELECT count(*) n FROM book_chunks_fts WHERE book_chunks_fts MATCH 'phoenix'`).get().n, 1)
    old.prepare('DELETE FROM books WHERE id = ?').run('o-epub')
    assert.equal(old.prepare(`SELECT count(*) n FROM book_chunks_fts WHERE book_chunks_fts MATCH 'dragons OR phoenix'`).get().n, 0)
    old.prepare('DELETE FROM books WHERE id = ?').run('o-m4b')
    assert.equal(old.prepare('SELECT count(*) n FROM book_audio_chapters').get().n, 0)
    assert.deepEqual(old.pragma('foreign_key_check'), [])
    assert.deepEqual(old.pragma('integrity_check'), [{ integrity_check: 'ok' }])
  })
  await check('029 is idempotent as SQL (IF NOT EXISTS): applying the file again changes no definition', () => {
    const snap = () => JSON.stringify(old.prepare(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all())
    const s1 = snap()
    old.exec(fs.readFileSync(path.join(migrationsDir, files.find((f) => f.startsWith('029_'))), 'utf8'))
    assert.equal(snap(), s1)
  })
  old.close()
}

// =====================================================================================================================
console.log('\nB. SqliteTranscriptStore')
// =====================================================================================================================
const sdb = freshDb()
const insB = sdb.prepare(
  `INSERT INTO books (id, title, file_path, normalized_path, file_format, cover_path, sha256, is_favorite, reading_status,
     source_provider, external_id, source_url, metadata_json, genres_json, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, NULL, 'mp3', NULL, ?, 0, 'reading', NULL, NULL, NULL, '{}', '[]', '{}', 'a', 'u')`,
)
const sBook = (id) => insB.run(id, id, `/books/${id}/f.mp3`, `sha-${id}`)
const sChapter = (id, bookId, position) =>
  sdb.prepare(`INSERT INTO book_audio_chapters (id, book_id, position, title, file_name, source_path, file_format, size_bytes, sha256, duration_seconds)
    VALUES (?, ?, ?, ?, ?, 'x.mp3', 'mp3', 10, 'h', 600)`).run(id, bookId, position, `Ch ${position}`, `${String(position).padStart(4, '0')}-${id.slice(0, 8).padEnd(8, 'x')}.mp3`)
const store = new SqliteTranscriptStore(sdb)
const sCount = (table, where = '1=1') => sdb.prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).get().n

sBook('single'); sBook('multi'); sBook('other')
// Track ids sort OPPOSITE to their positions, so ordering by track_id would be wrong.
sChapter('zz-first', 'multi', 0); sChapter('mm-second', 'multi', 1); sChapter('aa-third', 'multi', 2)

await check('ensure: unknown book → null; creates a partial transcript with nothing covered; keeps text on a second call', () => {
  assert.equal(store.ensure('nope', { language: 'en', modelId: 'whisper-tiny' }), null)
  assert.equal(store.ensure('single', { language: ' ', modelId: 'whisper-tiny' }), null)
  const t = store.ensure('single', { language: 'en', modelId: 'whisper-tiny' })
  assert.equal(t.status, 'partial'); assert.equal(t.passageCount, 0); assert.equal(t.coveredMs, 0)
  assert.equal(t.jobState, null); assert.equal(t.lastError, null); assert.deepEqual(t.covered, {})
  assert.equal(store.get('nobody'), null)
  const again = store.ensure('single', { language: 'vi', modelId: 'whisper-base' })
  assert.equal(again.id, t.id); assert.equal(again.language, 'vi'); assert.equal(again.modelId, 'whisper-base')
})
await check('commitWindow (single file): passages + covered interval together; coverage merges across windows', () => {
  const r1 = store.commitWindow('single', [P(0, 4000, 'one'), P(4000, 9000, 'two')], { startMs: 0, endMs: 30000 })
  assert.deepEqual(r1, { inserted: 2, superseded: 0 })
  assert.deepEqual(store.get('single').covered, { main: [[0, 30000]] })
  store.commitWindow('single', [P(40000, 45000, 'later')], { startMs: 40000, endMs: 60000 })
  assert.deepEqual(store.get('single').covered, { main: [[0, 30000], [40000, 60000]] })
  store.commitWindow('single', [], { startMs: 30000, endMs: 40000 }) // an empty window still counts as covered
  const t = store.get('single')
  assert.deepEqual(t.covered, { main: [[0, 60000]] })
  assert.equal(t.coveredMs, 60000); assert.equal(t.passageCount, 3)
})
await check('commitWindow refuses (nothing written) a bad interval, a bad / out-of-interval / wrong-track passage, or no transcript', () => {
  const before = { passages: sCount('audio_transcript_passages'), covered: store.get('single').covered }
  assert.equal(store.commitWindow('single', [], { startMs: 10, endMs: 10 }), null)
  assert.equal(store.commitWindow('single', [P(0, 100, '')], { startMs: 0, endMs: 1000 }), null)
  assert.equal(store.commitWindow('single', [P(0, 100, ' x')], { startMs: 0, endMs: 1000 }), null)
  assert.equal(store.commitWindow('single', [P(100, 100, 'x')], { startMs: 0, endMs: 1000 }), null)
  assert.equal(store.commitWindow('single', [P(0, 2000, 'x')], { startMs: 0, endMs: 1000 }), null)
  assert.equal(store.commitWindow('single', [P(0, 100, 'x', 'zz-first')], { startMs: 0, endMs: 1000 }), null)
  assert.equal(store.commitWindow('single', [P(0, 100, 'x')], { trackId: 'zz-first', startMs: 0, endMs: 1000 }), null)
  assert.equal(store.commitWindow('single', [P(0.5, 100, 'x')], { startMs: 0, endMs: 1000 }), null)
  assert.equal(store.commitWindow('other', [P(0, 100, 'x')], { startMs: 0, endMs: 1000 }), null) // no transcript yet
  assert.equal(sCount('audio_transcript_passages'), before.passages)
  assert.deepEqual(store.get('single').covered, before.covered)
})
await check('commitWindow overlap rule: the later window supersedes earlier passages overlapped by more than half', () => {
  store.ensure('other', { language: 'en', modelId: 'whisper-tiny' })
  store.commitWindow('other', [P(0, 20000, 'long a'), P(26000, 30000, 'tail old')], { startMs: 0, endMs: 30000 })
  const r = store.commitWindow('other', [P(28000, 31000, 'tail new'), P(31000, 40000, 'next')], { startMs: 28000, endMs: 58000 })
  // 'tail old' (26000–30000) overlaps 'tail new' (28000–31000) by 2000 of the shorter 3000 (> half) → superseded; 'long a' is untouched
  assert.deepEqual(r, { inserted: 2, superseded: 1 })
  assert.deepEqual(store.getPassages('other').map((p) => p.text), ['long a', 'tail new', 'next'])
})
await check('commitWindow is atomic: a failure while inserting rolls back the removal of superseded passages and the coverage', () => {
  store.ensure('other', { language: 'en', modelId: 'whisper-tiny' })
  const before = { texts: store.getPassages('other').map((p) => p.text), covered: store.get('other').covered }
  const flaky = new Proxy(sdb, {
    get(target, prop) {
      if (prop === 'prepare') {
        return (sql) => (sql.startsWith('INSERT INTO audio_transcript_passages') ? { run() { throw new Error('boom') } } : target.prepare(sql))
      }
      const value = target[prop]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const flakyStore = new SqliteTranscriptStore(flaky)
  assert.throws(() => flakyStore.commitWindow('other', [P(28000, 31000, 'replacement')], { startMs: 28000, endMs: 58000 }), /boom/)
  assert.deepEqual(store.getPassages('other').map((p) => p.text), before.texts)
  assert.deepEqual(store.get('other').covered, before.covered)
})
await check('multi-track: playback order follows book_audio_chapters.position, NOT track id; per-track coverage', () => {
  store.ensure('multi', { language: 'en', modelId: 'whisper-tiny' })
  // committed in a scrambled order on purpose
  store.commitWindow('multi', [P(5000, 6000, 'third track', 'aa-third')], { trackId: 'aa-third', startMs: 0, endMs: 30000 })
  store.commitWindow('multi', [P(8000, 9000, 'first b', 'zz-first'), P(1000, 2000, 'first a', 'zz-first')], { trackId: 'zz-first', startMs: 0, endMs: 30000 })
  store.commitWindow('multi', [P(0, 1000, 'second track', 'mm-second')], { trackId: 'mm-second', startMs: 0, endMs: 30000 })
  const all = store.getPassages('multi')
  assert.deepEqual(all.map((p) => p.text), ['first a', 'first b', 'second track', 'third track'])
  assert.deepEqual(all.map((p) => p.trackId), ['zz-first', 'zz-first', 'mm-second', 'aa-third'])
  assert.deepEqual(Object.keys(store.get('multi').covered).sort(), ['aa-third', 'mm-second', 'zz-first'])
  assert.deepEqual(store.getPassages('multi', { trackId: 'mm-second' }).map((p) => p.text), ['second track'])
  // a track that is not a chapter of anything is refused by the foreign key (nothing is written)
  const before = sCount('audio_transcript_passages')
  assert.throws(() => store.commitWindow('multi', [P(0, 100, 'x', 'ghost')], { trackId: 'ghost', startMs: 0, endMs: 1000 }), /FOREIGN KEY/)
  assert.equal(sCount('audio_transcript_passages'), before)
})
await check('getPassages: time window, default 500 and the 2000 cap, ordering by time inside a track', () => {
  assert.deepEqual(store.getPassages('single', { fromMs: 4000, toMs: 9000 }).map((p) => p.text), ['two'])
  assert.deepEqual(store.getPassages('single', { fromMs: 8999, toMs: 9001 }).map((p) => p.text), ['two'])
  assert.deepEqual(store.getPassages('single', { fromMs: 0, toMs: 4000 }).map((p) => p.text), ['one'])
  assert.deepEqual(store.getPassages('nobody'), [])
  sBook('big'); store.ensure('big', { language: 'en', modelId: 'whisper-tiny' })
  const many = Array.from({ length: 2100 }, (_, i) => P(i * 10, i * 10 + 10, `p${i}`))
  assert.deepEqual(store.commitWindow('big', many, { startMs: 0, endMs: 21000 }), { inserted: 2100, superseded: 0 })
  assert.equal(store.getPassages('big').length, 500)
  assert.equal(store.getPassages('big', { limit: 100000 }).length, 2000)
  assert.equal(store.getPassages('big', { limit: 0 }).length, 1)
  assert.equal(store.getPassages('big', { limit: 5 })[4].text, 'p4')
})
await check('search: diacritics, prefix, all words, FTS operators are plain text, other books never leak, hits in playback order', () => {
  sBook('vn'); store.ensure('vn', { language: 'vi', modelId: 'whisper-tiny' })
  store.commitWindow('vn', [P(0, 1000, 'Xin chào Việt Nam'), P(1000, 2000, 'AND OR NEAR "quoted" - word:colon')], { startMs: 0, endMs: 30000 })
  const hits = (q, book = 'vn') => store.search(book, q)
  assert.equal(hits('viet').length, 1)
  assert.equal(hits('VIỆT nam').length, 1)
  assert.equal(hits('chao vi').length, 1)            // last word is a prefix match
  assert.equal(hits('chao xyz').length, 0)           // all words must match
  assert.equal(hits('AND').length, 1)                // an operator word is just a word
  assert.equal(hits('"quoted"').length, 1)
  assert.equal(hits('word:colon').length, 1)
  assert.equal(hits('   ').length, 0)
  assert.equal(hits('').length, 0)
  assert.equal(hits('hello', 'nope').length, 0)
  assert.equal(hits('two', 'vn').length, 0)           // 'two' belongs to book "single"
  assert.equal(store.search('single', 'two').length, 1)
  const h = hits('viet')[0]
  assert.equal(h.startMs, 0); assert.ok(h.snippet.includes('Việt')); assert.equal(h.trackId, undefined)
  const multi = store.search('multi', 'track')
  assert.deepEqual(multi.map((x) => x.trackId), ['mm-second', 'aa-third'], 'playback order, not track id order')
  assert.equal(store.search('big', 'p', 3).length, 3)
  assert.equal(buildFtsQuery(' a  "b" '), '"a" "b"*')
  assert.equal(buildFtsQuery('""'), null)
})
await check('job state, endJob, setStatus: state is set, cleared with the outcome in one statement, last_error only changes when given', () => {
  assert.equal(store.setJobState('single', 'queued'), true)
  assert.equal(store.get('single').jobState, 'queued')
  store.setJobState('single', 'running')
  assert.equal(store.get('single').jobState, 'running')
  assert.equal(store.endJob('single', 'cancelled', 'ABORTED'), true)
  let t = store.get('single')
  assert.equal(t.jobState, null); assert.equal(t.status, 'cancelled'); assert.equal(t.lastError, 'ABORTED')
  store.setStatus('single', 'complete')
  t = store.get('single')
  assert.equal(t.status, 'complete'); assert.equal(t.lastError, 'ABORTED', 'undefined leaves last_error alone')
  store.setStatus('single', 'complete', null)
  assert.equal(store.get('single').lastError, null)
  assert.equal(store.setJobState('nobody', 'running'), false)
  assert.equal(store.endJob('nobody', 'failed', null), false)
})
await check('recoverInterrupted: running/queued → partial (text kept) or failed (nothing), INTERRUPTED, never complete, idempotent', () => {
  sBook('r-text'); sBook('r-empty'); sBook('r-done'); sBook('r-queued-text')
  for (const id of ['r-text', 'r-empty', 'r-done', 'r-queued-text']) store.ensure(id, { language: 'en', modelId: 'whisper-tiny' })
  store.commitWindow('r-text', [P(0, 1000, 'kept words')], { startMs: 0, endMs: 30000 })
  store.commitWindow('r-queued-text', [], { startMs: 0, endMs: 30000 }) // coverage only, no passage text
  store.endJob('r-done', 'complete', null)
  // a previously COMPLETE transcript that was extended and then interrupted must not stay "complete"
  store.setJobState('single', 'running', null); store.setStatus('single', 'complete')
  store.setJobState('r-text', 'running'); store.setJobState('r-empty', 'running'); store.setJobState('r-queued-text', 'queued')
  const textBefore = store.getPassages('r-text').map((p) => p.text)
  const coveredBefore = store.get('r-text').covered

  assert.equal(store.recoverInterrupted(), 4)
  for (const id of ['r-text', 'r-empty', 'r-queued-text', 'single']) {
    const t = store.get(id)
    assert.equal(t.jobState, null, id); assert.equal(t.lastError, 'INTERRUPTED', id)
    assert.notEqual(t.status, 'complete', id)
  }
  assert.equal(store.get('r-text').status, 'partial')
  assert.equal(store.get('r-queued-text').status, 'partial')
  assert.equal(store.get('single').status, 'partial')
  assert.equal(store.get('r-empty').status, 'failed')
  assert.equal(store.get('r-done').status, 'complete'); assert.equal(store.get('r-done').lastError, null)
  assert.deepEqual(store.getPassages('r-text').map((p) => p.text), textBefore, 'completed windows kept')
  assert.deepEqual(store.get('r-text').covered, coveredBefore)

  const snapshot = JSON.stringify(sdb.prepare('SELECT id, status, job_state, last_error, covered_json, updated_at FROM audio_transcripts ORDER BY id').all().map(({ updated_at, ...rest }) => rest))
  assert.equal(store.recoverInterrupted(), 0, 'a second run finds nothing')
  const after = JSON.stringify(sdb.prepare('SELECT id, status, job_state, last_error, covered_json, updated_at FROM audio_transcripts ORDER BY id').all().map(({ updated_at, ...rest }) => rest))
  assert.equal(after, snapshot)
})
await check('replace drops text and coverage but keeps the row; deleteForBook removes everything incl. FTS; deleting the book cascades', () => {
  assert.equal(store.replace('vn'), true)
  const t = store.get('vn')
  assert.equal(t.passageCount, 0); assert.deepEqual(t.covered, {}); assert.equal(t.status, 'partial'); assert.equal(t.lastError, null)
  assert.equal(store.search('vn', 'viet').length, 0)
  assert.equal(store.replace('nobody'), false)
  assert.equal(store.deleteForBook('r-text'), true)
  assert.equal(store.get('r-text'), null)
  assert.equal(store.deleteForBook('r-text'), false)
  assert.equal(store.search('r-text', 'kept').length, 0)
  sdb.prepare('DELETE FROM books WHERE id = ?').run('multi')
  assert.equal(store.get('multi'), null)
  assert.equal(sCount('audio_transcript_passages', `track_id IN ('zz-first','mm-second','aa-third')`), 0)
  assert.deepEqual(sdb.pragma('foreign_key_check'), [])
  assert.deepEqual(sdb.pragma('integrity_check'), [{ integrity_check: 'ok' }])
})

// =====================================================================================================================
console.log('\nC. audio decoder (fake process — the real binary is exercised by spike:transcription:ffmpeg)')
// =====================================================================================================================
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const resourcesDir = path.join(os.tmpdir(), 'fake-resources')
const artifacts = { 'win32-x64': { executable: 'ffmpeg.exe', files: [{ name: 'ffmpeg.exe', sha256: SHA_A }, { name: 'avcodec.dll', sha256: SHA_B }] } }
const audioFile = path.join(os.tmpdir(), `readmate-fake-audio-${process.pid}.mp3`)
fs.writeFileSync(audioFile, 'not really audio')

/**
 * A stand-in for child_process.spawn: scripted output, records every decode call. The availability self-test
 * (`SELF_TEST_ARGS`) is answered by `probe` (default: a binary that has the f32le muxer) and recorded in `probes`.
 */
function fakeSpawn(script, probe = (child) => { child.stdout.write('Muxer f32le [PCM 32-bit floating-point little-endian]:\n'); child.stdout.end(); child.emit('close', 0) }) {
  const calls = []
  const probes = []
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.killed = []
    child.kill = (sig) => { child.killed.push(sig); setImmediate(() => child.emit('close', null)); return true }
    const isProbe = args.join(' ') === SELF_TEST_ARGS.join(' ')
    ;(isProbe ? probes : calls).push({ command, args, options, child })
    setImmediate(() => (isProbe ? probe : script)(child))
    return child
  }
  spawnProcess.calls = calls
  spawnProcess.probes = probes
  return spawnProcess
}
const floats = (...values) => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b }
const okScript = (buf, code = 0) => (child) => { child.stdout.write(buf); child.stdout.end(); child.emit('close', code) }
const hashes = (map) => async (file) => { const name = path.basename(file); if (!(name in map)) throw new Error('ENOENT'); return map[name] }
const decoder = (over = {}) => createAudioDecoder({
  resourcesDir, platform: 'win32', arch: 'x64', artifacts, hashFile: hashes({ 'ffmpeg.exe': SHA_A, 'avcodec.dll': SHA_B }), ...over,
})
const win = { filePath: audioFile, startMs: 12345, lengthMs: 30000 }

await check('unavailable, and nothing is spawned: shipped table with its files absent, no entry (macOS), Linux, malformed hash entries', async () => {
  const spawnProcess = fakeSpawn(okScript(floats(1)))
  // The shipped table has win32-x64; this resources folder does not contain it (real hashing → ENOENT).
  const shipped = createAudioDecoder({ resourcesDir, platform: 'win32', arch: 'x64', spawnProcess })
  assert.deepEqual(await shipped.availability(), { available: false, reason: 'NOT_BUNDLED', detail: 'win32-x64: ffmpeg.exe is missing' })
  await assert.rejects(shipped.decodeWindow(win), (e) => e instanceof DecodeError && e.code === 'DECODE_FAILED')
  for (const arch of ['arm64', 'x64']) {
    assert.deepEqual(await createAudioDecoder({ resourcesDir, platform: 'darwin', arch, spawnProcess }).availability(), { available: false, reason: 'NOT_BUNDLED', detail: `darwin-${arch}` })
  }
  for (const [platform, arch] of [['linux', 'x64'], ['win32', 'arm64'], ['freebsd', 'x64']]) {
    const d = decoder({ platform, arch, spawnProcess })
    const a = await d.availability()
    assert.equal(a.available, false); assert.equal(a.reason, 'UNSUPPORTED_PLATFORM')
  }
  const unverified = decoder({ spawnProcess, artifacts: { 'win32-x64': { executable: 'ffmpeg.exe', files: [{ name: 'ffmpeg.exe', sha256: 'UNVERIFIED' }] } } })
  assert.equal((await unverified.availability()).reason, 'NOT_BUNDLED')
  const traversal = decoder({ spawnProcess, artifacts: { 'win32-x64': { executable: 'ffmpeg.exe', files: [{ name: 'ffmpeg.exe', sha256: SHA_A }, { name: '../evil.dll', sha256: SHA_B }] } } })
  assert.equal((await traversal.availability()).reason, 'NOT_BUNDLED')
  assert.equal(spawnProcess.calls.length, 0)
})
await check('SHA-256 gate: a mismatching or unreadable file makes the decoder unavailable (INTEGRITY_FAILED) before any spawn', async () => {
  const spawnProcess = fakeSpawn(okScript(floats(1)))
  const tampered = decoder({ spawnProcess, hashFile: hashes({ 'ffmpeg.exe': SHA_A, 'avcodec.dll': 'c'.repeat(64) }) })
  const a = await tampered.availability()
  assert.equal(a.available, false); assert.equal(a.reason, 'INTEGRITY_FAILED'); assert.match(a.detail, /avcodec\.dll/)
  await assert.rejects(tampered.decodeWindow(win), (e) => e.code === 'INTEGRITY_FAILED')
  const unreadable = decoder({ spawnProcess, hashFile: hashes({ 'ffmpeg.exe': SHA_A }) })
  assert.equal((await unreadable.availability()).reason, 'INTEGRITY_FAILED')
  const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
  const missing = decoder({ spawnProcess, hashFile: async (f) => { if (path.basename(f) === 'avcodec.dll') throw enoent; return SHA_A } })
  assert.deepEqual(await missing.availability(), { available: false, reason: 'NOT_BUNDLED', detail: 'win32-x64: avcodec.dll is missing' })
  assert.equal(spawnProcess.calls.length, 0); assert.equal(spawnProcess.probes.length, 0)
})
await check('self-test: a verified binary that cannot load (missing DLL), cannot be started, or lacks f32le is NOT_RUNNABLE; no decode is spawned', async () => {
  const cases = [
    [(c) => { c.stdout.end(); c.emit('close', 3221225781) }, /required DLL was not found \(exit 0xc0000135\)/],
    [(c) => { c.stdout.end(); c.emit('close', -1073741515) }, /required DLL was not found/], // the same NTSTATUS, signed
    [(c) => c.emit('error', Object.assign(new Error('spawn EPERM'), { code: 'EPERM' })), /could not be started: spawn EPERM/],
    [(c) => { c.stderr.write("Unknown format 'f32le'"); c.stdout.end(); c.emit('close', 0) }, /cannot write raw float PCM/],
    [(c) => { c.stdout.end(); c.emit('close', 1) }, /exit code 1/],
  ]
  for (const [probe, detail] of cases) {
    const spawnProcess = fakeSpawn(okScript(floats(1)), probe)
    const d = decoder({ spawnProcess })
    const a = await d.availability()
    assert.equal(a.available, false); assert.equal(a.reason, 'NOT_RUNNABLE'); assert.match(a.detail, detail)
    await assert.rejects(d.decodeWindow(win), (e) => e.code === 'DECODE_FAILED' && /NOT_RUNNABLE/.test(e.message))
    assert.equal(spawnProcess.calls.length, 0)
    assert.equal(spawnProcess.probes.length, 1, 'the verdict is cached: one self-test')
    assert.deepEqual(spawnProcess.probes[0].args, [...SELF_TEST_ARGS]); assert.equal(spawnProcess.probes[0].options.shell, false)
  }
  const hang = fakeSpawn(okScript(floats(1)), () => {})
  const slow = await decoder({ spawnProcess: hang, timeoutMs: 50 }).availability()
  assert.equal(slow.reason, 'NOT_RUNNABLE'); assert.match(slow.detail, /did not answer in time/)
  assert.deepEqual(hang.probes[0].child.killed, ['SIGKILL'])
})
await check('spawns OUR executable from resources/ffmpeg/<platform>-<arch>/ with an argv array and no shell; verdict is cached', async () => {
  let hashed = 0
  const spawnProcess = fakeSpawn(okScript(floats(0.5, -0.25, 1)))
  const d = decoder({ spawnProcess, hashFile: async (f) => { hashed += 1; return hashes({ 'ffmpeg.exe': SHA_A, 'avcodec.dll': SHA_B })(f) } })
  const out1 = await d.decodeWindow(win)
  const out2 = await d.decodeWindow({ ...win, startMs: 0, lengthMs: 1000 })
  assert.deepEqual([...out1], [0.5, -0.25, 1]); assert.deepEqual([...out2], [0.5, -0.25, 1])
  assert.equal(hashed, 2, 'each artifact file is hashed once, not per decode')
  const { command, args, options } = spawnProcess.calls[0]
  assert.equal(command, path.join(resourcesDir, 'ffmpeg', 'win32-x64', 'ffmpeg.exe'))
  assert.ok(command.startsWith(resourcesDir), 'never a binary from PATH')
  assert.equal(options.shell, false); assert.equal(options.windowsHide, true)
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe'])
  assert.ok(Array.isArray(args) && args.every((x) => typeof x === 'string'))
  assert.deepEqual(args, buildFfmpegArgs(audioFile, 12345, 30000))
  assert.equal(args[args.indexOf('-i') + 1], audioFile, 'the file path is exactly one argument after -i')
  assert.equal(args[args.indexOf('-ss') + 1], '12.345'); assert.equal(args[args.indexOf('-t') + 1], '30.000')
  assert.equal(args[args.indexOf('-ar') + 1], '16000'); assert.equal(args[args.indexOf('-ac') + 1], '1')
  assert.equal(args[args.indexOf('-f') + 1], 'f32le'); assert.equal(args.at(-1), 'pipe:1')
  assert.ok(args.includes('-nostdin') && args.includes('-vn') && args.includes('-map'))
})
await check('a path with spaces, quotes or a leading dash stays one argument (no shell parsing)', () => {
  for (const p of ['C:\\My Books\\a b.mp3', `/x/it's "quoted"; rm -rf.mp3`, '-i evil.mp3']) {
    const args = buildFfmpegArgs(p, 0, 1000)
    assert.equal(args[args.indexOf('-i') + 1], p)
    assert.equal(args.filter((a) => a === p).length, 1)
  }
})
await check('PCM parsing: whole samples only, an empty result is empty, not an error', async () => {
  const half = Buffer.concat([floats(0.25, 0.75), Buffer.from([1, 2])]) // 2 trailing bytes are not a sample
  assert.deepEqual([...(await decoder({ spawnProcess: fakeSpawn(okScript(half)) }).decodeWindow(win))], [0.25, 0.75])
  const empty = await decoder({ spawnProcess: fakeSpawn(okScript(Buffer.alloc(0))) }).decodeWindow(win)
  assert.equal(empty.length, 0)
})
await check('errors: invalid window, missing file, spawn error, non-zero exit (stderr kept), output over the cap, timeout', async () => {
  const d = decoder({ spawnProcess: fakeSpawn(okScript(floats(1))) })
  for (const bad of [{ startMs: -1, lengthMs: 1000 }, { startMs: 0, lengthMs: 0 }, { startMs: NaN, lengthMs: 1000 }]) {
    await assert.rejects(d.decodeWindow({ filePath: audioFile, ...bad }), (e) => e.code === 'DECODE_FAILED')
  }
  await assert.rejects(d.decodeWindow({ ...win, filePath: path.join(os.tmpdir(), 'does-not-exist.mp3') }), (e) => e.code === 'FILE_MISSING')
  const spawnError = decoder({ spawnProcess: fakeSpawn((c) => c.emit('error', new Error('spawn ENOENT'))) })
  await assert.rejects(spawnError.decodeWindow(win), (e) => e.code === 'DECODE_FAILED' && /ENOENT/.test(e.message))
  const failing = decoder({ spawnProcess: fakeSpawn((c) => { c.stderr.write('Invalid data found'); c.emit('close', 1) }) })
  await assert.rejects(failing.decodeWindow(win), (e) => e.code === 'DECODE_FAILED' && /Invalid data found/.test(e.message))
  // 1 s requested → 64000 expected bytes + 2 s of slack; 200 000 bytes is over the cap → killed
  const flood = fakeSpawn((c) => { c.stdout.write(Buffer.alloc(200_000)) })
  await assert.rejects(decoder({ spawnProcess: flood }).decodeWindow({ ...win, lengthMs: 1000 }), (e) => e.code === 'DECODE_FAILED' && /more audio/.test(e.message))
  assert.deepEqual(flood.calls[0].child.killed, ['SIGKILL'])
  const hang = fakeSpawn(() => {})
  await assert.rejects(decoder({ spawnProcess: hang, timeoutMs: 50 }).decodeWindow(win), (e) => e.code === 'DECODE_FAILED' && /timed out/.test(e.message))
  assert.deepEqual(hang.calls[0].child.killed, ['SIGKILL'])
})
await check('abort: kills the process promptly (well under 5 s) and rejects ABORTED; an already aborted signal never spawns', async () => {
  const hang = fakeSpawn(() => {})
  const ctl = new AbortController()
  const started = Date.now()
  const pending = decoder({ spawnProcess: hang }).decodeWindow({ ...win, signal: ctl.signal })
  setTimeout(() => ctl.abort(), 20)
  await assert.rejects(pending, (e) => e instanceof DecodeError && e.code === 'ABORTED')
  assert.ok(Date.now() - started < 2000)
  assert.deepEqual(hang.calls[0].child.killed, ['SIGKILL'])
  const never = fakeSpawn(okScript(floats(1)))
  const done = new AbortController(); done.abort()
  await assert.rejects(decoder({ spawnProcess: never }).decodeWindow({ ...win, signal: done.signal }), (e) => e.code === 'ABORTED')
  assert.equal(never.calls.length, 0)
})

// =====================================================================================================================
console.log('\nD. model manager (T013) — fake downloads; the real catalog is exercised live by the smoke test spike')
// =====================================================================================================================
{
  const { createModelManager, ModelError } = await import(pathToFileURL(process.env.TRANSCRIPTION_SPIKE_MANAGER).href)
  const { createHash } = await import('node:crypto')
  const sha256 = (b) => createHash('sha256').update(b).digest('hex')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-model-manager-'))

  const bodies = { 'config.json': Buffer.from('{"model_type":"whisper"}'), 'onnx/encoder.bin': Buffer.alloc(300_000, 7), 'onnx/decoder.bin': Buffer.alloc(500_000, 9) }
  const spec = {
    id: 'whisper-tiny', label: 'Fake', repo: 'fake/repo', revision: 'a'.repeat(40), dtype: 'q8',
    files: Object.entries(bodies).map(([p, b]) => ({ path: p, bytes: b.length, sha256: sha256(b) })),
    totalBytes: Object.values(bodies).reduce((n, b) => n + b.length, 0),
  }
  const urlFor = (s, f) => `https://models.invalid/${s.repo}/${s.revision}/${f.path}`
  const makeFetch = (over = {}) => {
    const calls = []
    const fn = async (url, init) => {
      calls.push(String(url))
      const rel = String(url).split(`${spec.revision}/`)[1]
      if (over.fail?.(rel)) throw new Error('network down')
      if (over.status?.(rel)) return new Response('nope', { status: over.status(rel) })
      const body = over.body?.(rel, bodies[rel]) ?? bodies[rel]
      if (over.slow) {
        let offset = 0
        const stream = new ReadableStream({
          async pull(controller) {
            await new Promise((r) => setTimeout(r, 20))
            if (init?.signal?.aborted) { controller.error(new DOMException('aborted', 'AbortError')); return }
            const chunk = body.subarray(offset, offset + 20_000)
            offset += chunk.length
            if (chunk.length === 0) controller.close()
            else controller.enqueue(new Uint8Array(chunk))
          },
        })
        return new Response(stream)
      }
      return new Response(body)
    }
    fn.calls = calls
    return fn
  }
  const mk = (dirName, over = {}, extra = {}) => {
    const fetchFile = makeFetch(over)
    const m = createModelManager({ modelsDir: path.join(root, dirName), catalog: [spec], fetchFile, urlFor, freeBytes: async () => 10 ** 12, ...extra })
    return { m, fetchFile, dir: path.join(root, dirName) }
  }
  const leftovers = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.startsWith('.partial')) : [])
  const rejectsWith = (promise, code) => assert.rejects(promise, (e) => e instanceof ModelError && e.code === code, `expected ${code}`)

  await check('real catalog (the one the app ships): 3 models, pinned 40-hex revisions, 7 files each, and it equals model-manifest.md', async () => {
    const real = createModelManager({ modelsDir: path.join(root, 'real') })
    assert.deepEqual(real.catalog.map((m) => m.id), ['whisper-tiny', 'whisper-base', 'whisper-small'])
    const manifest = fs.readFileSync(path.resolve(desktop, '../../../specs/004-audiobook-transcription/model-manifest.md'), 'utf8')
    for (const m of real.catalog) {
      assert.match(m.revision, /^[0-9a-f]{40}$/); assert.equal(m.dtype, 'q8'); assert.equal(m.files.length, 7)
      assert.equal(m.totalBytes, m.files.reduce((n, f) => n + f.bytes, 0))
      assert.ok(manifest.includes(m.revision), `${m.id} revision is in the manifest`)
      assert.deepEqual(m.files.map((f) => f.path).sort(), ['config.json', 'generation_config.json', 'onnx/decoder_model_merged_quantized.onnx', 'onnx/encoder_model_quantized.onnx', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json'])
      for (const f of m.files) {
        assert.match(f.sha256, /^[0-9a-f]{64}$/); assert.ok(f.bytes > 0)
        assert.ok(!f.path.includes('..') && !f.path.startsWith('/'))
        assert.ok(manifest.includes(f.sha256), `${m.id}/${f.path} SHA-256 is in the manifest`)
      }
    }
    assert.deepEqual((await real.list()).map((i) => i.installed), [false, false, false])
  })
  await check('download: files land with their repository paths, nothing partial is left, progress reaches the total, only the pinned URLs are used', async () => {
    const { m, fetchFile, dir } = mk('ok')
    assert.deepEqual(await m.list(), [{ id: 'whisper-tiny', label: 'Fake', sizeBytes: spec.totalBytes, installed: false }])
    const seen = []
    await m.download('whisper-tiny', { onProgress: (p) => seen.push(p.loadedBytes) })
    assert.equal(await m.isInstalled('whisper-tiny'), true)
    assert.deepEqual(await m.verifyInstalled('whisper-tiny'), { ok: true })
    for (const [rel, b] of Object.entries(bodies)) assert.ok(fs.readFileSync(path.join(dir, 'whisper-tiny', ...rel.split('/'))).equals(b))
    assert.deepEqual(leftovers(dir), [])
    assert.equal(seen.at(-1), spec.totalBytes); assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]))
    assert.equal(fetchFile.calls.length, 3)
    assert.ok(fetchFile.calls.every((u) => u.includes(`/${spec.revision}/`) && !u.includes('/main/')))
    await m.download('whisper-tiny')
    assert.equal(fetchFile.calls.length, 3, 'an installed, verified model is not downloaded again')
  })
  await check('integrity: wrong bytes of the right size → INTEGRITY_FAILED, nothing installed, no partial folder, even when it is the LAST file', async () => {
    for (const bad of ['config.json', 'onnx/decoder.bin']) {
      const { m, dir } = mk(`tamper-${bad.replace(/\W/g, '_')}`, { body: (rel, b) => (rel === bad ? Buffer.alloc(b.length, 1) : b) })
      await rejectsWith(m.download('whisper-tiny'), 'INTEGRITY_FAILED')
      assert.equal(await m.isInstalled('whisper-tiny'), false)
      assert.equal(fs.existsSync(path.join(dir, 'whisper-tiny')), false, 'no half-installed folder')
      assert.deepEqual(leftovers(dir), [])
    }
  })
  await check('integrity: too short or too long (stopped as soon as it exceeds the pinned size) → INTEGRITY_FAILED', async () => {
    const shorter = (rel, b) => (rel === 'onnx/encoder.bin' ? b.subarray(0, b.length - 1) : b)
    const longer = (rel, b) => (rel === 'onnx/encoder.bin' ? Buffer.concat([b, Buffer.alloc(10)]) : b)
    for (const [name, body] of [['short', shorter], ['long', longer]]) {
      const { m, dir } = mk(`size-${name}`, { body })
      await rejectsWith(m.download('whisper-tiny'), 'INTEGRITY_FAILED')
      assert.equal(fs.existsSync(path.join(dir, 'whisper-tiny')), false); assert.deepEqual(leftovers(dir), [])
    }
  })
  await check('network failure / HTTP error → MODEL_MISSING (model still missing), cleaned up', async () => {
    for (const [name, over] of [['throw', { fail: (rel) => rel === 'onnx/encoder.bin' }], ['404', { status: () => 404 }]]) {
      const { m, dir } = mk(`net-${name}`, over)
      await rejectsWith(m.download('whisper-tiny'), 'MODEL_MISSING')
      assert.equal(await m.isInstalled('whisper-tiny'), false); assert.deepEqual(leftovers(dir), [])
    }
  })
  await check('not enough disk space → DISK_FULL before a single byte is requested', async () => {
    const { m, fetchFile } = mk('disk', {}, { freeBytes: async () => spec.totalBytes })   // needs 10 % headroom
    await rejectsWith(m.download('whisper-tiny'), 'DISK_FULL')
    assert.equal(fetchFile.calls.length, 0)
    const enough = mk('disk2', {}, { freeBytes: async () => Math.ceil(spec.totalBytes * 1.1) })
    await enough.m.download('whisper-tiny'); assert.equal(await enough.m.isInstalled('whisper-tiny'), true)
  })
  await check('abort mid-download → ABORTED, partial folder removed, nothing installed', async () => {
    const { m, dir } = mk('abort', { slow: true })
    const ctl = new AbortController()
    const pending = m.download('whisper-tiny', { signal: ctl.signal })
    setTimeout(() => ctl.abort(), 80)
    await rejectsWith(pending, 'ABORTED')
    assert.equal(await m.isInstalled('whisper-tiny'), false); assert.deepEqual(leftovers(dir), [])
  })
  await check('an installed model that was tampered with later: verifyInstalled flags it, and download() repairs it atomically', async () => {
    const { m, dir } = mk('repair')
    await m.download('whisper-tiny')
    const victim = path.join(dir, 'whisper-tiny', 'onnx', 'decoder.bin')
    const evil = Buffer.from(bodies['onnx/decoder.bin']); evil[10] ^= 0xff; fs.writeFileSync(victim, evil)
    assert.equal(await m.isInstalled('whisper-tiny'), true, 'the cheap size check cannot see it — which is why loaders call verifyInstalled')
    assert.deepEqual(await m.verifyInstalled('whisper-tiny'), { ok: false, file: 'onnx/decoder.bin', reason: 'sha256' })
    fs.unlinkSync(path.join(dir, 'whisper-tiny', 'config.json'))
    assert.deepEqual(await m.verifyInstalled('whisper-tiny'), { ok: false, file: 'config.json', reason: 'missing' })
    await m.download('whisper-tiny')
    assert.deepEqual(await m.verifyInstalled('whisper-tiny'), { ok: true }); assert.deepEqual(leftovers(dir), [])
    assert.deepEqual(fs.readdirSync(dir), ['whisper-tiny'])
  })
  await check('a failed re-download never destroys an existing model; concurrent calls share one download; unknown ids are refused; remove works', async () => {
    const good = mk('keep')
    await good.m.download('whisper-tiny')
    const bad = createModelManager({ modelsDir: good.dir, catalog: [spec], urlFor, freeBytes: async () => 10 ** 12, fetchFile: makeFetch({ status: () => 500 }) })
    fs.appendFileSync(path.join(good.dir, 'whisper-tiny', 'config.json'), ' ')   // makes it unverifiable, so a download is attempted
    await rejectsWith(bad.download('whisper-tiny'), 'MODEL_MISSING')
    assert.ok(fs.existsSync(path.join(good.dir, 'whisper-tiny', 'onnx', 'encoder.bin')), 'the previous copy is still there')

    const { m, fetchFile } = mk('concurrent', { slow: true })
    await Promise.all([m.download('whisper-tiny'), m.download('whisper-tiny')])
    assert.equal(fetchFile.calls.length, 3, 'one download served both callers')
    await assert.rejects(m.download('nope'), (e) => e instanceof ModelError && e.code === 'INVALID_ARGUMENT')
    await m.remove('whisper-tiny'); assert.equal(await m.isInstalled('whisper-tiny'), false)
  })
  fs.rmSync(root, { recursive: true, force: true })
}

// =====================================================================================================================
console.log('\nE. speech process host WATCHDOG (T015, research R12) — fake child processes, real (short) timers')
// =====================================================================================================================
{
  const { getEventListeners } = await import('node:events')
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const SAMPLES = new Float32Array(16)
  const req = { modelId: 'whisper-tiny', language: 'en', samples: SAMPLES }
  const okResult = (id) => ({ type: 'result', id, modelId: 'whisper-tiny', segments: [{ startMs: 0, endMs: 500, text: 'hi' }], loadMs: 1, transcribeMs: 1 })

  /** A scripted stand-in for the forked speech process. `script(handle, message)` reacts to each request. */
  function fakeLauncher(script) {
    const launched = []
    const launch = () => {
      const h = {
        pid: 9000 + launched.length, killed: 0, sent: [], alive: true, msg: [], exit: [],
        send(m) { this.sent.push(m); script?.(this, m) },
        onMessage(f) { this.msg.push(f) },
        onExit(f) { this.exit.push(f) },
        isAlive() { return this.alive },
        kill() { this.killed += 1; this.alive = false },          // like the OS: no exit event is delivered to an ignored handle
        say(m) { for (const f of this.msg) f(m) },
        die(code, cause) { this.alive = false; for (const f of this.exit) f(code, cause) },
      }
      launched.push(h)
      return h
    }
    launch.launched = launched
    return launch
  }
  const mkHost = (launch, extra = {}) => createSpeechProcessHost({ launch, modelsDir: 'x', cancelGraceMs: 60, livenessIntervalMs: 15, loadTimeoutMs: 120, windowTimeoutMs: 120, ...extra })
  const failure = async (promise) => {
    try { await promise } catch (e) { return e }
    assert.fail('expected the request to fail')
  }
  const isSpeechError = (e, code, reason) => { assert.ok(e instanceof SpeechProcessError, String(e)); assert.equal(e.code, code); assert.equal(e.reason, reason, e.message) }

  await check('a process that never answers: DECODE_FAILED / timeout, process killed, the queued request runs on a fresh process', async () => {
    const launch = fakeLauncher((h, m) => { if (h.pid > 9000) h.say(okResult(m.id)) })   // only the FIRST process hangs
    const host = mkHost(launch)
    const first = host.transcribe(req)
    const second = host.transcribe(req)                                                  // queued behind the hung one
    const started = Date.now()
    isSpeechError(await failure(first), 'DECODE_FAILED', 'timeout')
    assert.ok(Date.now() - started >= 100 && Date.now() - started < 600, 'ended by the 120 ms watchdog, not by luck')
    assert.equal(launch.launched[0].killed, 1)
    assert.equal((await second).segments[0].text, 'hi')
    assert.equal(launch.launched.length, 2, 'a fresh process served the next request')
    host.dispose()
  })

  await check('progress messages restart the clock: a slow load that keeps reporting is NOT a hang; a silent transcribing phase is', async () => {
    const launch = fakeLauncher((h, m) => {
      if (m.id === 'req-1') {                                  // reports every 70 ms for 350 ms (> 120 ms total), then finishes
        let n = 0
        const t = setInterval(() => { n += 1; h.say({ type: 'stage', id: m.id, stage: 'loading' }); if (n === 5) { clearInterval(t); h.say(okResult(m.id)) } }, 70)
      } else {                                                 // says "transcribing" then goes silent
        h.say({ type: 'stage', id: m.id, stage: 'transcribing' })
      }
    })
    const host = mkHost(launch)
    const stages = []
    assert.equal((await host.transcribe(req, { onStage: (s) => stages.push(s) })).segments.length, 1)
    assert.deepEqual(stages, ['loading', 'loading', 'loading', 'loading', 'loading'])
    const e = await failure(host.transcribe(req))
    isSpeechError(e, 'DECODE_FAILED', 'timeout')
    assert.match(e.message, /did not respond/)
    host.dispose()
  })

  await check('the process exits unexpectedly: only that request fails (process-exit); the next request starts a fresh process', async () => {
    const launch = fakeLauncher((h, m) => { if (h.pid === 9000) setTimeout(() => h.die(1), 20); else h.say(okResult(m.id)) })
    const host = mkHost(launch)
    isSpeechError(await failure(host.transcribe(req)), 'DECODE_FAILED', 'process-exit')
    assert.equal(host.isRunning(), false)
    assert.equal((await host.transcribe(req)).segments.length, 1)
    assert.equal(launch.launched.length, 2)
    host.dispose()
  })

  await check('the exit event never arrives (seen under CPU load): the liveness probe ends the request long before the watchdog', async () => {
    const launch = fakeLauncher((h) => { setTimeout(() => { h.alive = false }, 20) })      // dies silently
    const host = mkHost(launch, { loadTimeoutMs: 5000 })
    const started = Date.now()
    isSpeechError(await failure(host.transcribe(req)), 'DECODE_FAILED', 'process-exit')
    assert.ok(Date.now() - started < 500, `probe interval 15 ms, took ${Date.now() - started} ms`)
    assert.equal(launch.launched[0].killed, 1)
    host.dispose()
  })

  await check('the IPC channel closes while the process may still run: ipc-lost, and the process is killed rather than left running', async () => {
    const launch = fakeLauncher((h) => { setTimeout(() => h.die(null, 'ipc-lost'), 10) })
    const host = mkHost(launch, { loadTimeoutMs: 5000 })
    isSpeechError(await failure(host.transcribe(req)), 'DECODE_FAILED', 'ipc-lost')
    assert.equal(launch.launched[0].killed, 1)
    host.dispose()
  })

  await check('a cancel disarms the watchdog: a silent process that is cancelled ends ABORTED (never "timeout"), even though the grace period outlasts the watchdog', async () => {
    const launch = fakeLauncher(() => {})                                                   // silent forever
    const host = mkHost(launch, { loadTimeoutMs: 100, cancelGraceMs: 300 })
    const ac = new AbortController()
    const pending = host.transcribe(req, { signal: ac.signal })
    setTimeout(() => ac.abort(), 30)                                                        // before the 100 ms watchdog
    const started = Date.now()
    isSpeechError(await failure(pending), 'ABORTED', 'cancel-unanswered')
    const took = Date.now() - started
    assert.ok(took >= 250 && took < 700, `the 300 ms grace decided, not the 100 ms watchdog (took ${took} ms)`)
    assert.deepEqual(launch.launched[0].sent.map((m) => m.type), ['transcribe', 'cancel'])
    assert.equal(launch.launched[0].killed, 1)
    host.dispose()
  })

  await check('a cancel the process answers: ABORTED from the process (cancelled); an already aborted signal never starts a process', async () => {
    const launch = fakeLauncher((h, m) => { if (m.type === 'cancel') h.say({ type: 'error', id: m.id, code: 'ABORTED', message: 'stopped' }) })
    const host = mkHost(launch)
    const ac = new AbortController()
    const pending = host.transcribe(req, { signal: ac.signal })
    setTimeout(() => ac.abort(), 20)
    isSpeechError(await failure(pending), 'ABORTED', 'cancelled')
    assert.equal(launch.launched[0].killed, 0, 'answered in time: the process is kept')
    const pre = new AbortController(); pre.abort()
    isSpeechError(await failure(host.transcribe(req, { signal: pre.signal })), 'ABORTED', 'cancelled')
    assert.equal(launch.launched.length, 1)
    host.dispose()
  })

  await check('a result just before the deadline wins; the old timer cannot touch the next request or the process', async () => {
    const launch = fakeLauncher((h, m) => { setTimeout(() => h.say(okResult(m.id)), m.id === 'req-1' ? 100 : 10) })   // 100 ms < 120 ms watchdog
    const host = mkHost(launch)
    assert.equal((await host.transcribe(req)).segments.length, 1)
    await sleep(200)                                                                         // past the old deadline
    assert.equal(launch.launched[0].killed, 0, 'the stale watchdog did not kill the healthy process')
    assert.equal((await host.transcribe(req)).segments.length, 1)
    assert.equal(launch.launched.length, 1, 'the same process served both')
    host.dispose()
  })

  await check('a request that timed out cannot be resolved or failed by its old process afterwards; a newer request is unaffected', async () => {
    const launch = fakeLauncher((h, m) => { if (h.pid > 9000) setTimeout(() => h.say(okResult(m.id)), 30) })
    const host = mkHost(launch)
    const e = await failure(host.transcribe(req))
    isSpeechError(e, 'DECODE_FAILED', 'timeout')
    const next = host.transcribe(req)
    const old = launch.launched[0]
    old.say(okResult('req-1')); old.say({ type: 'error', id: 'req-2', code: 'DECODE_FAILED', message: 'ghost' }); old.die(1)   // late noise from the killed process
    assert.equal((await next).segments[0].text, 'hi')
    host.dispose()
  })

  await check('cleanup: after every way out no timer is left to fire and the abort listener is removed; disposing mid-request fails it ABORTED / disposed', async () => {
    const launch = fakeLauncher((h, m) => { if (m.id === 'req-1') h.say(okResult(m.id)) })
    const host = mkHost(launch)
    const ac = new AbortController()
    await host.transcribe(req, { signal: ac.signal })
    assert.equal(getEventListeners(ac.signal, 'abort').length, 0, 'listener removed after success')
    await sleep(250)                                                                         // longer than every limit: nothing fires
    assert.equal(launch.launched[0].killed, 0)
    assert.deepEqual(launch.launched[0].sent.map((m) => m.type), ['transcribe'], 'no stray cancel / dispose messages')

    const hung = host.transcribe(req, { signal: ac.signal })                                 // req-2: silent
    setTimeout(() => host.dispose(), 20)
    isSpeechError(await failure(hung), 'ABORTED', 'disposed')
    assert.equal(getEventListeners(ac.signal, 'abort').length, 0, 'listener removed after dispose')
    await sleep(200)
    assert.equal(launch.launched.length, 1, 'no process was started by a leftover timer')
    isSpeechError(await failure(host.transcribe(req)), 'ABORTED', 'disposed')
  })

  await check('a failing send (the channel is already closed) fails only that request (send-failed) and kills the process', async () => {
    const launch = fakeLauncher((h) => { throw new Error('channel closed') })
    const host = mkHost(launch)
    isSpeechError(await failure(host.transcribe(req)), 'DECODE_FAILED', 'send-failed')
    assert.equal(launch.launched[0].killed, 1)
    host.dispose()
  })

  await check('stop(): ends an idle process WITHOUT disposing the host (the next request starts a fresh one); refused while a request is in flight', async () => {
    let silent = false
    const launch = fakeLauncher((h, m) => { if (!silent) h.say(okResult(m.id)) })
    const host = mkHost(launch, { loadTimeoutMs: 5000 })
    assert.equal(host.stop(), true, 'nothing running: nothing to stop')
    await host.transcribe(req)
    assert.equal(host.isRunning(), true)
    assert.equal(host.stop(), true); assert.equal(launch.launched[0].killed, 1); assert.equal(host.isRunning(), false)
    await host.transcribe(req)
    assert.equal(launch.launched.length, 2, 'after stop() the next request starts a fresh process')
    silent = true
    const inFlight = host.transcribe(req)                       // never answered
    await sleep(30)
    assert.equal(host.stop(), false, 'a request is in flight: refused'); assert.equal(launch.launched[1].killed, 0)
    host.dispose()
    isSpeechError(await failure(inFlight), 'ABORTED', 'disposed')
  })

  await check('an error the engine itself reports keeps its code (e.g. MODEL_MISSING) and reason engine — not mistaken for a stall', async () => {
    const launch = fakeLauncher((h, m) => h.say({ type: 'error', id: m.id, code: 'MODEL_MISSING', message: 'no model' }))
    const host = mkHost(launch)
    isSpeechError(await failure(host.transcribe(req)), 'MODEL_MISSING', 'engine')
    host.dispose()
  })
}

// =====================================================================================================================
console.log('\nF. transcription service (T015 / T015a / T016 / T022) — real SQLite on the migrated schema; fake decoder, speech process and library')
// =====================================================================================================================
{
  const BOOK_SQL = `INSERT INTO books (id, title, file_path, normalized_path, file_format, cover_path, sha256, is_favorite, reading_status,
     source_provider, external_id, source_url, metadata_json, genres_json, reading_state_json, added_at, updated_at)
   VALUES (@id, @title, @fp, NULL, @fmt, NULL, @sha, 0, 'reading', NULL, NULL, NULL, '{}', '[]', '{}', 'a', 'u')`
  const CHAPTER_SQL = `INSERT INTO book_audio_chapters (id, book_id, position, title, file_name, source_path, file_format, size_bytes, sha256, duration_seconds)
   VALUES (?, ?, ?, ?, ?, 'x.mp3', 'mp3', 10, 'h', 60)`
  function dbWith(books) {
    const d = freshDb()
    for (const [id, b] of Object.entries(books)) {
      d.prepare(BOOK_SQL).run({ id, title: id, fp: `/books/${id}/0000-aaaaaaaa.${b.format}`, fmt: b.format, sha: `sha-${id}` })
      ;(b.tracks ?? []).forEach((t, position) =>
        d.prepare(CHAPTER_SQL).run(t.id, id, position, t.title, `${String(position).padStart(4, '0')}-${t.id.slice(0, 8).padEnd(8, 'x')}.mp3`))
    }
    return d
  }
  const SINGLE = { format: 'mp3', durationMs: 75_000 }
  // ids sort differently from playback order on purpose: zz (pos 0), aa (pos 1), mm (pos 2)
  const MULTI = { format: 'mp3', durationMs: 0, tracks: [{ id: 'zz-track', title: 'One', durationMs: 40_000 }, { id: 'aa-track', title: 'Two', durationMs: 35_000 }, { id: 'mm-track', title: 'Three', durationMs: 20_000 }] }
  const req = (bookId, over = {}) => ({ bookId, scope: { kind: 'whole' }, language: 'en', modelId: 'whisper-tiny', ...over })
  const finished = (world, bookId) => until(() => ['done', 'failed', 'cancelled'].includes(lastJobState(world, bookId)?.state), `job of ${bookId} to finish`)
  const noOverlap = (passages) => passages.every((p, i) => i === 0 || passages[i - 1].trackId !== p.trackId || passages[i - 1].endMs <= p.startMs)

  await check('T016 validation: every bad input is refused with its contract code and leaves nothing behind', async () => {
    const d = dbWith({ one: SINGLE, multi: MULTI, doc: { format: 'epub', durationMs: 0 } })
    const world = makeFakeWorld({ books: { one: SINGLE, multi: MULTI, doc: { format: 'epub', durationMs: 0 } } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    const code = async (r) => { const out = await svc.start(r); assert.equal(out.ok, false, JSON.stringify(r)); return out.errorCode }
    assert.equal(await code(null), 'INVALID_ARGUMENT')
    assert.equal(await code({ bookId: 'one' }), 'INVALID_ARGUMENT')
    assert.equal(await code(req('nope')), 'INVALID_ARGUMENT', 'unknown book')
    assert.equal(await code(req('doc')), 'INVALID_ARGUMENT', 'not an audiobook')
    assert.equal(await code(req('one', { scope: { kind: 'range', startMs: 5000, endMs: 5000 } })), 'INVALID_ARGUMENT', 'start >= end')
    assert.equal(await code(req('one', { scope: { kind: 'range', startMs: 9000, endMs: 1000 } })), 'INVALID_ARGUMENT')
    assert.equal(await code(req('one', { scope: { kind: 'range', startMs: -1, endMs: 1000 } })), 'INVALID_ARGUMENT')
    assert.equal(await code(req('one', { scope: { kind: 'range', startMs: NaN, endMs: 1000 } })), 'INVALID_ARGUMENT')
    assert.equal(await code(req('one', { scope: { kind: 'track', trackId: 'zz-track' } })), 'INVALID_ARGUMENT', 'trackId on a single-file book')
    assert.equal(await code(req('one', { scope: { kind: 'range', trackId: 'zz-track', startMs: 0, endMs: 10 } })), 'INVALID_ARGUMENT')
    assert.equal(await code(req('multi', { scope: { kind: 'track', trackId: 'someone-elses' } })), 'INVALID_ARGUMENT', 'track of another book')
    assert.equal(await code(req('multi', { scope: { kind: 'range', startMs: 0, endMs: 10 } })), 'INVALID_ARGUMENT', 'range of a multi-track book needs a track')
    assert.equal(await code(req('one', { scope: { kind: 'sideways' } })), 'INVALID_ARGUMENT')
    assert.equal(await code(req('one', { language: 'klingon' })), 'UNSUPPORTED_LANGUAGE')
    assert.equal(await code(req('one', { modelId: 'whisper-huge' })), 'INVALID_ARGUMENT', 'unknown model')
    assert.equal(await code(req('one', { modelId: 'whisper-base' })), 'MODEL_MISSING', 'known but not downloaded')
    assert.equal(await code(req('one', { replace: 'yes' })), 'INVALID_ARGUMENT')
    world.decoderAvailable = { available: false, reason: 'NOT_BUNDLED' }
    assert.equal(await code(req('one')), 'DECODE_FAILED', 'no decoder → a clear error, not a silent job')
    world.decoderAvailable = { available: true, executablePath: '/ffmpeg' }
    assert.equal(store.get('one'), null, 'a refused start created no transcript row')
    assert.equal(world.decodeCalls.length + world.speechCalls.length, 0)
    assert.equal((await svc.start(req('one', { language: 'auto' }))).ok, true, 'auto is a valid language')
    await finished(world, 'one')
    await svc.shutdown()
  })

  await check('single-file whole book: windows → decode → speech → commit; coverage, status complete, job marker cleared, passages in time order', async () => {
    const d = dbWith({ one: SINGLE })
    const world = makeFakeWorld({ books: { one: SINGLE } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    const out = await svc.start(req('one'))
    assert.equal(out.ok, true)
    assert.ok(['queued', 'running'].includes(store.get('one').jobState), 'the marker recovery relies on is set by the time start() returns')
    await finished(world, 'one')
    assert.deepEqual(world.decodeCalls.map((c) => [c.startMs, c.lengthMs]), [[0, 30000], [28000, 30000], [56000, 19000]], '30 s windows, 2 s overlap, the last one as long as what is left')
    assert.ok(world.speechCalls.every((c) => c.language === 'en' && c.modelId === 'whisper-tiny'))
    const rec = store.get('one')
    assert.equal(rec.status, 'complete'); assert.equal(rec.jobState, null); assert.equal(rec.lastError, null)
    assert.deepEqual(rec.covered, { main: [[0, 75000]] })
    const passages = svc.getPassages({ bookId: 'one' })
    assert.deepEqual(passages.map((p) => [p.startMs, p.endMs, p.text]), [[0, 5000, 'seg1'], [28000, 33000, 'seg2'], [56000, 61000, 'seg3']])
    assert.ok(passages.every((p) => p.trackId === undefined && typeof p.id === 'number'))
    const states = world.events.progress.map((j) => j.state)
    assert.deepEqual([states[0], states[1], states[2], states.at(-1)], ['queued', 'preparing', 'running', 'done'])
    assert.equal(world.events.progress.at(-1).doneMs, 75000); assert.equal(world.events.progress.at(-1).totalMs, 75000)
    assert.ok(world.events.progress.every((j) => j.trackId === undefined && j.trackDoneMs === undefined), 'single-file progress has no track fields')
    assert.deepEqual(world.events.passagesAdded.map((a) => [a.fromMs, a.toMs]), [[0, 30000], [28000, 58000], [56000, 75000]])
    assert.ok(world.events.passagesAdded.every((a) => a.bookId === 'one' && a.trackId === undefined))
    assert.equal(world.maxConcurrent, 1)
    await svc.shutdown()
  })

  await check('overlap windows: a later window supersedes the passages of the shared 2 s (no duplicated text, no overlapping passages)', async () => {
    const d = dbWith({ one: SINGLE })
    const world = makeFakeWorld({
      books: { one: SINGLE },
      speechPlan: (call, windowMs) => [{ startMs: 0, endMs: 3000, text: `head${call}` }, { startMs: windowMs - 3000, endMs: windowMs, text: `tail${call}` }],
    })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    await svc.start(req('one')); await finished(world, 'one')
    const texts = svc.getPassages({ bookId: 'one' }).map((p) => p.text)
    assert.ok(!texts.includes('tail1'), 'window 1 tail [27000,30000) is replaced by window 2 head [28000,31000)')
    assert.ok(texts.includes('head2') && texts.includes('tail3'))
    assert.ok(noOverlap(svc.getPassages({ bookId: 'one' })))
    await svc.shutdown()
  })

  await check('progress is throttled (≤ 4 per second of the clock) while every state change is delivered; the final snapshot is exact', async () => {
    const book = { format: 'mp3', durationMs: 600_000 }   // 22 windows
    const d = dbWith({ one: book })
    const world = makeFakeWorld({ books: { one: book } })
    const svc = makeService(world, new SqliteTranscriptStore(d), { progressIntervalMs: 250 })
    await svc.start(req('one')); await finished(world, 'one')
    const running = world.events.progress.filter((j) => j.state === 'running')
    for (let i = 2; i < running.length; i += 1) assert.ok(running[i].at - running[i - 1].at >= 250 || running[i].doneMs === running[i - 1].doneMs, 'no two throttled snapshots closer than 250 ms')
    assert.ok(running.length < 22 + 2, `fewer snapshots than windows (${running.length})`)
    const done = running.map((j) => j.doneMs); assert.deepEqual(done, [...done].sort((a, b) => a - b), 'progress never goes backwards')
    assert.equal(world.events.progress.at(-1).state, 'done'); assert.equal(world.events.progress.at(-1).doneMs, 600_000)
    await svc.shutdown()
  })

  await check('multi-track whole book: tracks in playback order (not id order), per-track progress fields, coverage per track, ordered reads', async () => {
    const d = dbWith({ multi: MULTI })
    const world = makeFakeWorld({ books: { multi: MULTI } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    await svc.start(req('multi')); await finished(world, 'multi')
    const order = [...new Set(world.decodeCalls.map((c) => c.filePath.split('/')[3]))]
    assert.deepEqual(order, ['zz-track', 'aa-track', 'mm-track'], 'playback order = chapter position')
    const rec = store.get('multi')
    assert.equal(rec.status, 'complete'); assert.deepEqual(rec.covered, { 'zz-track': [[0, 40000]], 'aa-track': [[0, 35000]], 'mm-track': [[0, 20000]] })
    const run = world.events.progress.filter((j) => j.state === 'running')
    assert.ok(run.every((j) => typeof j.trackId === 'string' && typeof j.trackDoneMs === 'number' && typeof j.trackTotalMs === 'number' && j.totalMs === 95000))
    assert.ok(run.some((j) => j.trackId === 'aa-track' && j.trackTotalMs === 35000))
    assert.equal(world.events.progress.at(-1).doneMs, 95000)
    const passages = svc.getPassages({ bookId: 'multi' })
    assert.deepEqual([...new Set(passages.map((p) => p.trackId))], ['zz-track', 'aa-track', 'mm-track'], 'reads come back in playback order even though ids sort differently')
    assert.deepEqual(svc.getPassages({ bookId: 'multi', trackId: 'aa-track' }).map((p) => p.trackId), ['aa-track', 'aa-track'])
    assert.deepEqual(world.events.passagesAdded.filter((a) => a.trackId === 'mm-track').map((a) => [a.fromMs, a.toMs]), [[0, 20000]])
    await svc.shutdown()
  })

  await check('a track scope processes only that track; a range adds its span without recomputing what is already covered', async () => {
    const d = dbWith({ multi: MULTI, one: SINGLE })
    const world = makeFakeWorld({ books: { multi: MULTI, one: SINGLE } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    await svc.start(req('multi', { scope: { kind: 'track', trackId: 'aa-track' } })); await finished(world, 'multi')
    assert.ok(world.decodeCalls.every((c) => c.filePath.endsWith('/aa-track')))
    assert.deepEqual(store.get('multi').covered, { 'aa-track': [[0, 35000]] })

    await svc.start(req('one', { scope: { kind: 'range', startMs: 0, endMs: 30000 } })); await finished(world, 'one')
    assert.deepEqual(store.get('one').covered, { main: [[0, 30000]] })
    const before = svc.getPassages({ bookId: 'one' }).map((p) => p.id)
    world.decodeCalls.length = 0
    await svc.start(req('one', { scope: { kind: 'range', startMs: 60000, endMs: 75000 } })); await finished(world, 'one')
    assert.deepEqual(world.decodeCalls.map((c) => [c.startMs, c.lengthMs]), [[60000, 15000]], 'only the new range was decoded')
    assert.deepEqual(store.get('one').covered, { main: [[0, 30000], [60000, 75000]] })
    assert.deepEqual(svc.getPassages({ bookId: 'one' }).map((p) => p.id).slice(0, before.length), before, 'earlier passages untouched')
    world.decodeCalls.length = 0
    await svc.start(req('one', { scope: { kind: 'range', startMs: 5000, endMs: 20000 } })); await finished(world, 'one')
    assert.equal(world.decodeCalls.length, 0, 'a covered range costs nothing')
    assert.equal(lastJobState(world, 'one').state, 'done')
    await svc.shutdown()
  })

  await check('cancel: stops within a second, keeps the finished windows, status cancelled, marker cleared; Resume skips the covered interval and finishes', async () => {
    const d = dbWith({ one: SINGLE })
    const world = makeFakeWorld({ books: { one: SINGLE } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    world.speechGate = null
    world.onSpeech = async (call) => { if (call === 2) world.speechGate = { promise: new Promise(() => {}) } }   // the second window hangs
    const started = await svc.start(req('one'))
    await until(() => world.speechCalls.length === 2, 'the second window to be in flight')
    const t0 = Date.now()
    assert.deepEqual(svc.cancel(started.jobId), { ok: true })
    await finished(world, 'one')
    assert.ok(Date.now() - t0 < 1000, `cancelled in ${Date.now() - t0} ms (SC-006 allows 5 s)`)
    const rec = store.get('one')
    assert.equal(rec.status, 'cancelled'); assert.equal(rec.jobState, null); assert.deepEqual(rec.covered, { main: [[0, 30000]] })
    assert.equal(svc.getPassages({ bookId: 'one' }).length, 1, 'the finished window is kept')
    assert.deepEqual(svc.cancel('no-such-job'), { ok: false })

    world.speechGate = null; world.onSpeech = null; world.decodeCalls.length = 0
    await svc.start(req('one'))
    await until(() => store.get('one').status === 'complete', 'the resumed job to finish')
    assert.equal(world.decodeCalls[0].startMs, 30000, 'the covered window is not decoded again')
    assert.deepEqual(world.events.progress.find((j) => j.state === 'running' && j.jobId !== started.jobId).doneMs, 30000, 'resumed progress starts at what was already done')
    assert.deepEqual(store.get('one').covered, { main: [[0, 75000]] })
    await svc.shutdown()
  })

  await check('queue: one active job at a time, the others wait as queued and run in order; a queued job can be cancelled; a second job for the same book is refused', async () => {
    const d = dbWith({ a: SINGLE, b: SINGLE, c: SINGLE })
    const world = makeFakeWorld({ books: { a: SINGLE, b: SINGLE, c: SINGLE } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    let release; world.speechGate = { promise: new Promise((r) => { release = r }) }
    const ja = await svc.start(req('a')); const jb = await svc.start(req('b')); const jc = await svc.start(req('c'))
    assert.ok(ja.ok && jb.ok && jc.ok)
    await until(() => world.speechCalls.length === 1, 'the first job to reach the speech process')
    assert.equal((await svc.getInfo('b')).job.state, 'queued'); assert.equal((await svc.getInfo('a')).job.state, 'running')
    assert.equal(store.get('b').jobState, 'queued')
    assert.equal((await svc.start(req('b'))).errorCode, 'INVALID_ARGUMENT', 'duplicate for a queued book')
    assert.equal((await svc.start(req('a'))).errorCode, 'INVALID_ARGUMENT', 'duplicate for the running book')
    assert.deepEqual(svc.cancel(jc.jobId), { ok: true })
    assert.equal(store.get('c'), null, 'a queued job that never ran leaves no transcript row behind')
    assert.equal(lastJobState(world, 'c').state, 'cancelled')
    world.speechGate = null; release()
    await finished(world, 'a'); await finished(world, 'b')
    const firstDecode = (id) => world.decodeCalls.findIndex((c) => c.filePath.includes(`/${id}/`))
    assert.ok(firstDecode('a') < firstDecode('b'), 'first come, first served'); assert.equal(firstDecode('c'), -1)
    assert.equal(world.maxConcurrent, 1, 'never two jobs at once')
    assert.equal(store.get('a').status, 'complete'); assert.equal(store.get('b').status, 'complete')
    await svc.shutdown()
  })

  await check('failures never leave a transcript complete: committed windows stay (partial), nothing committed → failed, with the real error code and the marker cleared', async () => {
    const d = dbWith({ one: SINGLE, two: SINGLE, three: SINGLE, gone: { ...SINGLE, missingFile: true } })
    const world = makeFakeWorld({ books: { one: SINGLE, two: SINGLE, three: SINGLE, gone: { ...SINGLE, missingFile: true } } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    world.onSpeech = async (call) => { if (call === 2) throw Object.assign(new Error('engine exploded'), { code: 'DECODE_FAILED' }) }
    await svc.start(req('one')); await finished(world, 'one')
    let rec = store.get('one')
    assert.equal(rec.status, 'partial'); assert.equal(rec.lastError, 'DECODE_FAILED'); assert.equal(rec.jobState, null)
    assert.deepEqual(rec.covered, { main: [[0, 30000]] }); assert.equal(rec.passageCount, 1)
    assert.equal(lastJobState(world, 'one').state, 'failed'); assert.equal(lastJobState(world, 'one').error, 'DECODE_FAILED')

    world.onSpeech = async () => { throw Object.assign(new Error('model file changed'), { code: 'INTEGRITY_FAILED' }) }
    await svc.start(req('two')); await finished(world, 'two')
    rec = store.get('two')
    assert.equal(rec.status, 'failed'); assert.equal(rec.lastError, 'INTEGRITY_FAILED'); assert.equal(rec.passageCount, 0); assert.deepEqual(rec.covered, {})

    world.onSpeech = async () => { throw new Error('plain error') }
    await svc.start(req('three')); await finished(world, 'three')
    assert.equal(store.get('three').lastError, 'DECODE_FAILED', 'an unknown error maps to DECODE_FAILED')

    world.onSpeech = null
    await svc.start(req('gone')); await finished(world, 'gone')
    assert.equal(store.get('gone').status, 'failed'); assert.equal(store.get('gone').lastError, 'FILE_MISSING')
    for (const id of ['one', 'two', 'three', 'gone']) assert.notEqual(store.get(id).status, 'complete')
    await svc.shutdown()
  })

  await check('NO_SPEECH: a finished scope with no passages is complete with NO_SPEECH and zero text (not an error state, not silently empty)', async () => {
    const d = dbWith({ one: { format: 'mp3', durationMs: 40_000 } })
    const world = makeFakeWorld({ books: { one: { format: 'mp3', durationMs: 40_000 } }, speechPlan: () => 'none' })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    await svc.start(req('one')); await finished(world, 'one')
    const rec = store.get('one')
    assert.equal(rec.status, 'complete'); assert.equal(rec.lastError, 'NO_SPEECH'); assert.equal(rec.passageCount, 0); assert.deepEqual(rec.covered, { main: [[0, 40000]] })
    const last = lastJobState(world, 'one'); assert.equal(last.state, 'done'); assert.equal(last.error, 'NO_SPEECH')
    const info = await svc.getInfo('one'); assert.equal(info.transcript.lastError, 'NO_SPEECH')
    await svc.shutdown()
  })

  await check('getInfo: summary, job, models and the default language (book tag → app language → auto); passages DTOs are plain; limit is clamped', async () => {
    const tagged = { ...SINGLE, languageTag: 'fra' }
    const d = dbWith({ one: SINGLE, tagged })
    const world = makeFakeWorld({ books: { one: SINGLE, tagged } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    let info = await svc.getInfo('one')
    assert.equal(info.transcript, null); assert.equal(info.job, null); assert.equal(info.defaultLanguage, 'auto')
    assert.deepEqual(info.models.map((m) => [m.id, m.installed]), [['whisper-tiny', true], ['whisper-base', false]])
    assert.equal((await svc.getInfo('one', 'vi-VN')).defaultLanguage, 'vi')
    assert.equal((await svc.getInfo('tagged', 'vi')).defaultLanguage, 'fr', 'the audiobook\'s own tag wins')
    assert.equal((await svc.getInfo(42)).transcript, null)
    await svc.start(req('one', { language: 'vi' })); await finished(world, 'one')
    info = await svc.getInfo('one')
    assert.deepEqual({ ...info.transcript }, { status: 'complete', language: 'vi', modelId: 'whisper-tiny', coveredMs: 75000, totalMs: 75000, passageCount: 3, scope: { kind: 'whole' } })
    assert.equal(info.job, null, 'no job once it is over')
    assert.deepEqual(svc.getPassages({ bookId: 'one', limit: 1 }).length, 1)
    assert.deepEqual(svc.getPassages({ bookId: '' }), []); assert.deepEqual(svc.getPassages(null), [])
    await svc.shutdown()
  })

  await check('delete removes the transcript (rows and FTS) and first cancels the book\'s running job; download reports progress and the real error code', async () => {
    const d = dbWith({ one: SINGLE })
    const world = makeFakeWorld({ books: { one: SINGLE } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    world.speechGate = { promise: new Promise(() => {}) }
    await svc.start(req('one'))
    await until(() => world.speechCalls.length === 1, 'the job to be running')
    assert.deepEqual(await svc.delete('one'), { ok: true })
    assert.equal(store.get('one'), null); assert.equal(d.prepare('SELECT count(*) n FROM audio_transcript_passages').get().n, 0)
    assert.equal((await svc.getInfo('one')).job, null)
    world.speechGate = null
    assert.deepEqual(await svc.delete(''), { ok: false })

    assert.deepEqual(await svc.downloadModel('whisper-base'), { ok: true })
    assert.deepEqual(world.events.modelProgress, [{ modelId: 'whisper-base', loadedBytes: 1, totalBytes: 2 }])
    assert.equal((await svc.getInfo('one')).models.find((m) => m.id === 'whisper-base').installed, true)
    assert.equal((await svc.downloadModel('whisper-huge')).errorCode, 'INVALID_ARGUMENT')
    world.downloadError = Object.assign(new Error('flipped byte'), { code: 'INTEGRITY_FAILED' })
    const bad = await svc.downloadModel('whisper-tiny'); assert.equal(bad.ok, false); assert.equal(bad.errorCode, 'INTEGRITY_FAILED')
    await svc.shutdown()
  })

  await check('shutdown cancels the running job and the queue, disposes the speech process, and refuses new work', async () => {
    const d = dbWith({ a: SINGLE, b: SINGLE })
    const world = makeFakeWorld({ books: { a: SINGLE, b: SINGLE } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    world.onSpeech = async (call) => { if (call === 2) world.speechGate = { promise: new Promise(() => {}) } }   // window 1 commits, window 2 hangs
    await svc.start(req('a')); await svc.start(req('b'))
    await until(() => world.speechCalls.length === 2, 'job a to be inside its second window')
    await svc.shutdown()
    assert.equal(world.disposed, 1)
    assert.equal(store.get('a').jobState, null); assert.equal(store.get('a').status, 'cancelled'); assert.equal(store.get('a').passageCount, 1, 'the committed window survives the shutdown')
    assert.equal(store.get('b'), null)
    assert.equal((await svc.start(req('a'))).errorCode, 'ABORTED')
  })

  await check('T037: a book removed while its transcription runs — cancel + wait (what library.ipc does), then the rows go: the job ends cancelled, nothing is left, the queue carries on', async () => {
    const d = dbWith({ one: SINGLE, two: SINGLE })
    const world = makeFakeWorld({ books: { one: SINGLE, two: SINGLE } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    world.onSpeech = async (call) => { if (call === 2) world.speechGate = { promise: new Promise(() => {}) } }   // book one: window 1 commits, window 2 hangs
    await svc.start(req('one')); await svc.start(req('two'))                                                   // book two waits in the queue
    await until(() => world.speechCalls.length === 2, 'book one to be inside its second window')
    await svc.delete('one')                                                                                    // cancelTranscriptionOfBook
    assert.equal(lastJobState(world, 'one').state, 'cancelled')
    d.prepare('DELETE FROM books WHERE id = ?').run('one')                                                     // the library removes the book
    assert.equal(store.get('one'), null)
    assert.equal(d.prepare(`SELECT count(*) n FROM audio_transcripts WHERE job_state IS NOT NULL AND book_id = 'one'`).get().n, 0, 'no orphan job marker')
    assert.equal(d.prepare('SELECT count(*) n FROM audio_transcript_passages').get().n, 0, 'no orphan passages')
    world.speechGate = null; world.onSpeech = null
    await finished(world, 'two')
    assert.equal(store.get('two').status, 'complete', 'the queued job of another book ran normally')
    assert.deepEqual(await svc.delete('nothing-here'), { ok: true }, 'a book without a transcript or job is harmless')
    await svc.shutdown()
  })

  await check('T037 (why the hook is needed): the rows of a book removed under a running job end that job as failed, never as complete, and never throw', async () => {
    const d = dbWith({ one: SINGLE })
    const world = makeFakeWorld({ books: { one: SINGLE } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    let release; const gate = new Promise((r) => { release = r })
    world.onSpeech = async (call) => { if (call === 2) world.speechGate = { promise: gate } }
    await svc.start(req('one'))
    await until(() => world.speechCalls.length === 2, 'window 2 in flight')
    d.prepare('DELETE FROM books WHERE id = ?').run('one')                                                     // removed WITHOUT cancelling
    world.speechGate = null; release()
    await finished(world, 'one')
    assert.equal(lastJobState(world, 'one').state, 'failed')
    assert.equal(store.get('one'), null)
    await svc.shutdown()
  })

  await check('T038: the job scope is stored with the transcript and kept when the job ends; getInfo reports it; Resume with it decodes only that scope; an unusable stored scope is just "unknown"', async () => {
    const d = dbWith({ multi: MULTI, one: SINGLE })
    const world = makeFakeWorld({ books: { multi: MULTI, one: SINGLE } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)
    world.onSpeech = async (call) => { if (call === 2) world.speechGate = { promise: new Promise(() => {}) } }   // the second window of the track hangs
    const scope = { kind: 'track', trackId: 'zz-track' }                                                       // 40 s = 2 windows
    const started = await svc.start(req('multi', { scope }))
    await until(() => world.speechCalls.length === 2, 'the second window to be in flight')
    assert.deepEqual(store.get('multi').scope, scope, 'stored while the job runs')
    svc.cancel(started.jobId); await finished(world, 'multi')
    assert.deepEqual(store.get('multi').scope, scope, 'kept when the job ends')
    const info = await svc.getInfo('multi')
    assert.deepEqual(info.transcript.scope, scope)

    world.speechGate = null; world.onSpeech = null; world.decodeCalls.length = 0
    await svc.start(req('multi', { scope: info.transcript.scope })); await finished(world, 'multi')
    assert.ok(world.decodeCalls.length > 0 && world.decodeCalls.every((c) => c.filePath.endsWith('/zz-track')), 'Resume with the stored scope touched only that track')
    assert.deepEqual(store.get('multi').covered, { 'zz-track': [[0, 40000]] })

    const range = { kind: 'range', startMs: 1000, endMs: 20000 }
    await svc.start(req('one', { scope: range })); await finished(world, 'one')
    assert.deepEqual((await svc.getInfo('one')).transcript.scope, range)
    const ranged = { kind: 'range', trackId: 'aa-track', startMs: 0, endMs: 5000 }
    await svc.start(req('multi', { scope: ranged })); await finished(world, 'multi')
    assert.deepEqual(store.get('multi').scope, ranged, 'the newest job\'s scope replaces the older one')

    const setRaw = (json) => d.prepare(`UPDATE audio_transcripts SET scope_json = ? WHERE book_id = 'one'`).run(json)
    for (const bad of ['{"kind":"track"}', '{"kind":"range","startMs":5,"endMs":2}', '{"kind":"sideways"}', '[1]', '"x"', 'null']) {
      setRaw(bad); assert.equal(store.get('one').scope, null, `unusable scope ${bad} reads as unknown`)
    }
    assert.throws(() => setRaw('not json'), /CHECK/, 'the column only holds valid JSON')
    setRaw(null); assert.equal(store.get('one').scope, null)
    assert.equal(store.setScope('nobody', { kind: 'whole' }), false)
    assert.equal(store.setScope('one', { kind: 'whole' }), true); assert.deepEqual(store.get('one').scope, { kind: 'whole' })
    assert.equal(store.setScope('one', null), true); assert.equal(store.get('one').scope, null)
    await svc.shutdown()
  })

  await check('migration 030 is additive: an existing transcript row is untouched and gets scope_json NULL; the column only holds valid JSON; it is registered after 029', () => {
    const old = new Database(':memory:')
    old.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)')
    for (const f of files.filter((name) => name < '030')) applyMigration(old, f)
    old.pragma('foreign_keys = ON')
    old.prepare(BOOK_SQL).run({ id: 'b', title: 'b', fp: '/books/b/0000-aaaaaaaa.mp3', fmt: 'mp3', sha: 'sha-b' })
    old.prepare(`INSERT INTO audio_transcripts (id, book_id, language, model_id, status, covered_json, created_at, updated_at)
                 VALUES ('t', 'b', 'en', 'whisper-tiny', 'partial', '{"main":[[0,5]]}', 'x', 'y')`).run()
    const before = old.prepare('SELECT * FROM audio_transcripts').all()
    applyMigration(old, '030_audio_transcript_scope.sql')
    assert.deepEqual(old.prepare('SELECT * FROM audio_transcripts').all(), before.map((row) => ({ ...row, scope_json: null })))
    assert.throws(() => old.prepare(`UPDATE audio_transcripts SET scope_json = 'not json'`).run(), /CHECK/)
    assert.equal(files.at(-1), '030_audio_transcript_scope.sql')
    assert.ok(migrateSource.includes("'030_audio_transcript_scope.sql'") && migrateSource.includes('./migrations/030_audio_transcript_scope.sql?raw'))
    assert.deepEqual(old.pragma('foreign_key_check'), []); assert.deepEqual(old.pragma('integrity_check'), [{ integrity_check: 'ok' }])
    old.close()
  })

  await check('T039: the audiobook\'s own language tag becomes the default language — tag reader, per-book cache, async source; unreadable or unmapped tags fall back', async () => {
    const parse = (tags) => async () => tags
    assert.equal(await readAudioLanguageTag('/x', parse({ common: { language: 'eng' } })), 'en')
    assert.equal(await readAudioLanguageTag('/x', parse({ common: { language: 'vie' } })), 'vi')
    assert.equal(await readAudioLanguageTag('/x', parse({ common: { languages: ['zzz', 'fra'] } })), 'fr', 'the first MAPPED tag wins')
    assert.equal(await readAudioLanguageTag('/x', parse({ common: {} })), null)
    assert.equal(await readAudioLanguageTag('/x', parse({ common: { language: 'tlh' } })), null)
    assert.equal(await readAudioLanguageTag('/x', async () => { throw new Error('damaged tags') }), null)

    let reads = 0
    const cache = createLanguageTagCache({ resolveFile: async (id) => (id === 'none' ? null : `/f/${id}`), parse: async () => { reads += 1; return { common: { language: 'deu' } } } })
    assert.equal(await cache.get('b1'), 'de'); assert.equal(await cache.get('b1'), 'de'); assert.equal(reads, 1, 'read once per book')
    assert.equal(await cache.get('none'), null); assert.equal(reads, 1, 'no file, no read')
    cache.forget('b1'); await cache.get('b1'); assert.equal(reads, 2)

    const d = dbWith({ one: SINGLE })
    const world = makeFakeWorld({ books: { one: SINGLE } })
    const svc = makeService(world, new SqliteTranscriptStore(d))
    world.source.languageTag = async () => 'fra'
    assert.equal((await svc.getInfo('one', 'vi')).defaultLanguage, 'fr', 'the book\'s tag beats the app language')
    world.source.languageTag = async () => { throw new Error('tags unreadable') }
    assert.equal((await svc.getInfo('one', 'vi')).defaultLanguage, 'vi', 'an unreadable tag falls back to the app language')
    world.source.languageTag = async () => 'tlh'
    assert.equal((await svc.getInfo('one')).defaultLanguage, 'auto', 'an unmapped tag and no app language → auto-detect')
    await svc.shutdown()
  })

  await check('T040: getPassages pages by offset in playback order (no overlap, no gap); past the end is empty; a bad offset counts as 0', async () => {
    const d = dbWith({ multi: MULTI })
    const world = makeFakeWorld({ books: { multi: MULTI }, speechPlan: (call) => [{ startMs: 0, endMs: 1000, text: `a${call}` }, { startMs: 2000, endMs: 3000, text: `b${call}` }] })
    const svc = makeService(world, new SqliteTranscriptStore(d))
    await svc.start(req('multi')); await finished(world, 'multi')
    const all = svc.getPassages({ bookId: 'multi', limit: 2000 })
    assert.ok(all.length >= 8, `enough passages to page (${all.length})`)
    const paged = []
    for (let offset = 0; offset < all.length; offset += 3) paged.push(...svc.getPassages({ bookId: 'multi', limit: 3, offset }))
    assert.deepEqual(paged.map((p) => p.id), all.map((p) => p.id), 'pages concatenate to exactly the full list')
    assert.deepEqual(svc.getPassages({ bookId: 'multi', limit: 5, offset: all.length }), [])
    const first3 = all.slice(0, 3).map((p) => p.id)
    assert.deepEqual(svc.getPassages({ bookId: 'multi', limit: 3, offset: -4 }).map((p) => p.id), first3)
    assert.deepEqual(svc.getPassages({ bookId: 'multi', limit: 3, offset: NaN }).map((p) => p.id), first3)
    assert.deepEqual(svc.getPassages({ bookId: 'multi', limit: 3, offset: 'x' }).map((p) => p.id), first3)
    assert.deepEqual(svc.getPassages({ bookId: 'multi', limit: 3, offset: 2.9 }).map((p) => p.id), all.slice(2, 5).map((p) => p.id), 'a fractional offset is floored')
    assert.deepEqual(svc.getPassages({ bookId: 'multi', trackId: 'aa-track', limit: 1, offset: 1 }).map((p) => p.text), [svc.getPassages({ bookId: 'multi', trackId: 'aa-track' })[1].text], 'offset works inside one track too')
    await svc.shutdown()
  })

  await check('T031 search: hits come back in PLAYBACK order (not id order) with the start to jump to; diacritics, case and prefix are ignored; all words must match; operators are plain text; other books never leak; limit and bad input are safe', async () => {
    const TEXTS = [
      'The forest was quiet and Việt Nam seemed far',   // call 1: zz window 1
      'A river crossed the forest again',                // call 2: zz window 2
      'Nothing but the river',                           // call 3: aa window 1
      'Deep in the forest',                              // call 4: aa window 2
      'Forest fires and river floods',                   // call 5: mm
    ]
    const spec = { books: { multi: MULTI, one: SINGLE }, speechPlan: (call) => [{ startMs: 1000, endMs: 4000, text: TEXTS[call - 1] }] }
    const d = dbWith({ multi: MULTI, one: SINGLE })
    const world = makeFakeWorld(spec)
    const svc = makeService(world, new SqliteTranscriptStore(d))
    await svc.start(req('multi')); await finished(world, 'multi')
    spec.speechPlan = () => [{ startMs: 500, endMs: 3000, text: 'An old forest in another book' }]
    await svc.start(req('one')); await finished(world, 'one')

    const where = (hits) => hits.map((h) => [h.trackId, h.startMs])
    const forest = svc.search('multi', 'forest')
    assert.deepEqual(where(forest), [['zz-track', 1000], ['zz-track', 29000], ['aa-track', 29000], ['mm-track', 1000]], 'zz, aa, mm = chapter position, although the ids sort aa < mm < zz')
    assert.ok(forest.every((h) => /forest/i.test(h.snippet) && typeof h.passageId === 'number'), 'each hit has a snippet containing the word and the passage id')
    assert.deepEqual(where(svc.search('multi', 'river')), [['zz-track', 29000], ['aa-track', 1000], ['mm-track', 1000]])
    assert.deepEqual(where(svc.search('multi', 'forest river')), [['zz-track', 29000], ['mm-track', 1000]], 'every word must match')
    assert.deepEqual(where(svc.search('multi', 'fore')), where(forest), 'the last word is a prefix match')
    assert.deepEqual(where(svc.search('multi', 'FOREST')), where(forest), 'case-insensitive')
    assert.deepEqual(where(svc.search('multi', 'viet')), [['zz-track', 1000]], 'diacritics-insensitive: "viet" finds "Việt"')
    assert.deepEqual(where(svc.search('multi', 'VIỆT')), [['zz-track', 1000]])
    assert.deepEqual(svc.search('multi', 'forest OR river'), [], 'OR is a word here, not an operator')
    assert.deepEqual(svc.search('multi', 'forest NOT river'), [])
    assert.deepEqual(svc.search('multi', '"quoted" -minus NEAR(a b) *'), [], 'FTS syntax cannot break the query')

    const single = svc.search('one', 'forest')
    assert.deepEqual(single.map((h) => h.startMs), [500, 28500, 56500], 'one hit per window, in time order'); assert.ok(single.every((h) => !('trackId' in h)), 'a single-file hit has no track')
    assert.ok(!svc.search('multi', 'another').length, 'the other book\'s text does not leak into this one')

    assert.equal(svc.search('multi', 'forest', 2).length, 2, 'limit is honoured')
    assert.equal(svc.search('multi', 'forest', 0).length, 1, 'a limit below 1 counts as 1')
    assert.equal(svc.search('multi', 'forest', NaN).length, 4, 'a limit that is not a number is the default')
    for (const bad of [undefined, null, 42, {}, '', '   ']) assert.deepEqual(svc.search('multi', bad), [])
    assert.deepEqual(svc.search('', 'forest'), []); assert.deepEqual(svc.search(null, 'forest'), []); assert.deepEqual(svc.search('nobody', 'forest'), [])
    assert.doesNotThrow(() => svc.search('multi', `forest ${'x'.repeat(5000)}`), 'an over-long query is cut, not an error')
    await svc.shutdown()
  })

  await check('T031 export text: single file and multi-track (headings in playback order, optional timestamps), EVERY passage past the 2000-per-read cap, and clear errors', async () => {
    const LONG_BOOK = { format: 'mp3', durationMs: 600_000 }
    const spec = { books: { one: SINGLE, multi: MULTI, long: LONG_BOOK, quiet: SINGLE, bare: SINGLE } }
    const d = dbWith({ one: SINGLE, multi: MULTI, long: LONG_BOOK, quiet: SINGLE, bare: SINGLE })
    const world = makeFakeWorld(spec)
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)

    await svc.start(req('one')); await finished(world, 'one')
    assert.deepEqual(await svc.buildExport('one'), { ok: true, text: 'seg1\nseg2\nseg3\n', passageCount: 3 })
    assert.equal((await svc.buildExport('one', { timestamps: true })).text, '[00:00:00] seg1\n[00:00:28] seg2\n[00:00:56] seg3\n')
    assert.equal((await svc.buildExport('one', { timestamps: 'yes' })).text, 'seg1\nseg2\nseg3\n', 'only a real true turns timestamps on')

    spec.speechPlan = (call) => [{ startMs: 1000, endMs: 2000, text: `part${call}` }]
    await svc.start(req('multi')); await finished(world, 'multi')
    const multi = await svc.buildExport('multi')
    assert.equal(multi.text, 'Track 1 — One\npart4\npart5\n\nTrack 2 — Two\npart6\npart7\n\nTrack 3 — Three\npart8\n', 'headings follow playback order (zz, aa, mm), not id order')
    assert.equal(multi.passageCount, 5)
    assert.match((await svc.buildExport('multi', { timestamps: true })).text, /^Track 1 — One\n\[00:00:01\] part4\n\[00:00:29\] part5\n/)

    spec.speechPlan = () => Array.from({ length: 120 }, (_, i) => ({ startMs: i * 200, endMs: i * 200 + 150, text: `line${i}` }))
    await svc.start(req('long')); await finished(world, 'long')
    const many = await svc.buildExport('long')
    assert.equal(many.passageCount, 2580, 'a transcript longer than one read page is exported whole')
    assert.equal(many.text.split('\n').length - 1, 2580); assert.ok(many.text.endsWith('\n'))
    assert.ok(many.passageCount > 2000)

    spec.speechPlan = () => 'none'
    await svc.start(req('quiet')); await finished(world, 'quiet')
    const quiet = await svc.buildExport('quiet'); assert.equal(quiet.ok, false); assert.equal(quiet.errorCode, 'NO_SPEECH')
    const bare = await svc.buildExport('bare'); assert.equal(bare.ok, false); assert.equal(bare.errorCode, 'INVALID_ARGUMENT')
    for (const bad of [undefined, null, '', 42]) assert.equal((await svc.buildExport(bad)).errorCode, 'INVALID_ARGUMENT')
    await svc.shutdown()
  })

  await check('T031 export file: Main-owned dialog and write — exact content on disk, the renderer gets only {saved}, cancel writes nothing, the app\'s own data folder and write errors are refused', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-export-'))
    const text = 'Dế Mèn phiêu lưu ký — chương 1\nXin chào, thế giới\n'
    const log = { picked: [], written: [], names: [] }
    const mk = (over = {}) => ({
      build: async () => ({ ok: true, text, passageCount: 2 }),
      suggestedName: async (id) => { log.names.push(id); return 'Dế Mèn phiêu lưu ký.txt' },
      pickFile: async (name) => { log.picked.push(name); return path.join(tmp, 'out.txt') },
      isForbiddenTarget: (target) => target.includes('userData'),
      writeFile: async (file, body) => { log.written.push(file); await fs.promises.writeFile(file, body, 'utf8') },
      ...over,
    })
    const reset = () => { log.picked.length = 0; log.written.length = 0; log.names.length = 0 }

    let result = await exportTranscriptToFile(mk(), ' book-1 ', { timestamps: true })
    assert.deepEqual(result, { saved: true }, 'the renderer learns whether it was saved — never a path')
    assert.equal(fs.readFileSync(path.join(tmp, 'out.txt'), 'utf8'), text, 'exact UTF-8 content on disk')
    assert.deepEqual(log.names, ['book-1']); assert.deepEqual(log.picked, ['Dế Mèn phiêu lưu ký.txt'])

    reset()
    let seenOptions
    result = await exportTranscriptToFile(mk({ build: async (id, options) => { seenOptions = options; return { ok: true, text, passageCount: 2 } } }), 'b', { timestamps: true })
    assert.deepEqual(seenOptions, { timestamps: true })
    await exportTranscriptToFile(mk({ build: async (id, options) => { seenOptions = options; return { ok: true, text, passageCount: 2 } } }), 'b', { timestamps: 1 })
    assert.deepEqual(seenOptions, { timestamps: false }, 'only a real true turns timestamps on')

    reset()
    result = await exportTranscriptToFile(mk({ pickFile: async () => null }), 'b', {})
    assert.deepEqual(result, { saved: false }, 'cancel is not an error'); assert.deepEqual(log.written, [])

    reset()
    await exportTranscriptToFile(mk({ pickFile: async () => path.join(tmp, 'no-extension') }), 'b', {})
    assert.deepEqual(log.written, [path.join(tmp, 'no-extension.txt')], 'a name without an extension gets .txt')
    reset()
    await exportTranscriptToFile(mk({ pickFile: async () => path.join(tmp, 'notes.md') }), 'b', {})
    assert.deepEqual(log.written, [path.join(tmp, 'notes.md')], 'a name the person typed with an extension is kept')

    reset()
    result = await exportTranscriptToFile(mk({ pickFile: async () => path.join(tmp, 'userData', 'x.txt') }), 'b', {})
    assert.equal(result.saved, false); assert.equal(result.errorCode, 'INVALID_ARGUMENT'); assert.match(result.errorMessage, /outside/); assert.deepEqual(log.written, [])

    result = await exportTranscriptToFile(mk({ writeFile: async () => { throw new Error('EACCES: permission denied') } }), 'b', {})
    assert.equal(result.saved, false); assert.match(result.errorMessage, /could not be saved.*EACCES/)
    assert.ok(!('errorCode' in result) && !JSON.stringify(result).includes(tmp), 'no path in an error either')

    reset()
    result = await exportTranscriptToFile(mk({ build: async () => ({ ok: false, errorCode: 'NO_SPEECH', errorMessage: 'The transcript has no text to export' }) }), 'b', {})
    assert.deepEqual(result, { saved: false, errorCode: 'NO_SPEECH', errorMessage: 'The transcript has no text to export' })
    assert.deepEqual(log.picked, [], 'nothing to export: the dialog is never opened')

    result = await exportTranscriptToFile(mk({ pickFile: async () => { throw new Error('no window') } }), 'b', {})
    assert.equal(result.saved, false); assert.match(result.errorMessage, /dialog could not be opened/)
    for (const bad of [undefined, null, '', '  ', 7]) assert.equal((await exportTranscriptToFile(mk(), bad, {})).saved, false)
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })   // Windows may still hold the file for a moment
    } catch {
      /* a temp folder left behind is not a failure of the export */
    }
  })

  await check('T034 usage: only catalog models that are really folders on disk are listed, with their recursive size; leftovers, stray files and a missing folder are not', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-speech-usage-'))
    const catalog = [{ id: 'whisper-tiny', label: 'Tiny' }, { id: 'whisper-base', label: 'Base' }, { id: 'whisper-small', label: 'Small' }]
    fs.mkdirSync(path.join(root, 'whisper-tiny', 'onnx'), { recursive: true })
    fs.writeFileSync(path.join(root, 'whisper-tiny', 'onnx', 'model.bin'), Buffer.alloc(1000))
    fs.writeFileSync(path.join(root, 'whisper-tiny', 'config.json'), Buffer.alloc(10))
    fs.writeFileSync(path.join(root, 'whisper-base'), 'a FILE with a model name is not a model')
    fs.mkdirSync(path.join(root, 'whisper-small.partial'), { recursive: true })
    fs.writeFileSync(path.join(root, 'whisper-small.partial', 'half.bin'), Buffer.alloc(500))
    fs.mkdirSync(path.join(root, 'stray-folder'))
    assert.deepEqual(await listSpeechModelUsage(root, catalog), [{ id: 'whisper-tiny', label: 'Tiny', bytes: 1010 }])
    assert.deepEqual((await listSpeechModelUsage(root)).map((m) => m.id), ['whisper-tiny'], 'the shipped catalog gives the same answer')
    fs.mkdirSync(path.join(root, 'whisper-small'))
    assert.deepEqual((await listSpeechModelUsage(root, catalog)).map((m) => [m.id, m.bytes]), [['whisper-tiny', 1010], ['whisper-small', 0]], 'catalog order; an empty folder is 0 bytes')
    assert.deepEqual(await listSpeechModelUsage(path.join(root, 'nope'), catalog), [], 'no models folder yet is just "none"')
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      /* a temp folder left behind is not a failure */
    }
  })

  await check('T034 remove: refused while a transcription is queued or running (nothing touched), stops the speech process first, only catalog models, transcripts stay, failures reported', async () => {
    const BOOKS3 = { one: SINGLE, two: SINGLE, three: SINGLE }
    const d = dbWith(BOOKS3)
    const world = makeFakeWorld({ books: BOOKS3 })
    world.installed.add('whisper-base')
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)

    for (const bad of [undefined, null, 42, '', 'whisper-huge', '../etc', 'whisper-tiny/..']) {
      const r = await svc.removeModel(bad); assert.equal(r.ok, false); assert.equal(r.errorCode, 'not_found')
    }
    assert.deepEqual(world.removed, []); assert.equal(world.stops, 0)

    await svc.start(req('one')); await finished(world, 'one')                      // a finished transcript that must survive
    assert.equal(store.get('one').passageCount, 3)

    world.onSpeech = async (call) => { if (call === 4) world.speechGate = { promise: new Promise(() => {}) } }   // book two hangs on its first window
    await svc.start(req('two')); await svc.start(req('three'))                   // three waits in the queue
    await until(() => world.speechCalls.length === 4, 'book two to be running')
    assert.equal(svc.isBusy(), true)
    let r = await svc.removeModel('whisper-base')
    assert.equal(r.ok, false); assert.equal(r.errorCode, 'busy'); assert.match(r.errorMessage, /in progress/)
    assert.deepEqual(world.removed, [], 'nothing was deleted'); assert.equal(world.stops, 0, 'the speech process was not stopped')
    await svc.delete('two'); await svc.delete('three')
    world.speechGate = null; world.onSpeech = null
    assert.equal(svc.isBusy(), false)

    world.stopRefused = true                                                        // the host says a request is still in flight
    r = await svc.removeModel('whisper-base'); assert.equal(r.errorCode, 'busy'); assert.deepEqual(world.removed, [])
    world.stopRefused = false

    r = await svc.removeModel('whisper-base')
    assert.deepEqual(r, { ok: true }); assert.deepEqual(world.removed, ['whisper-base']); assert.ok(world.stops >= 1, 'the speech process was stopped before the files went')
    assert.equal((await world.models.isInstalled('whisper-base')), false)
    assert.equal(store.get('one').passageCount, 3, 'transcripts are text in the database: removing a model leaves them alone')
    assert.equal((await svc.start(req('three', { modelId: 'whisper-base' }))).errorCode, 'MODEL_MISSING', 'it downloads again when chosen next')

    world.removeError = new Error('EBUSY: resource busy or locked')
    r = await svc.removeModel('whisper-tiny')
    assert.equal(r.ok, false); assert.equal(r.errorCode, 'failed'); assert.match(r.errorMessage, /EBUSY/)
    await svc.shutdown()
  })

  await check('FR-017: transcription is offered only where a usable decoder artifact ships — win32-x64 yes; macOS, Linux, win32-arm64 and a broken entry no', async () => {
    const { isTranscriptionPlatformSupported, FFMPEG_ARTIFACTS } = await import(pathToFileURL(process.env.TRANSCRIPTION_SPIKE_ARTIFACTS).href)
    assert.equal(isTranscriptionPlatformSupported('win32', 'x64'), true)
    for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64'], ['win32', 'arm64']]) {
      assert.equal(isTranscriptionPlatformSupported(platform, arch), false, `${platform}-${arch}`)
    }
    const good = FFMPEG_ARTIFACTS['win32-x64']
    assert.equal(isTranscriptionPlatformSupported('darwin', 'arm64', { 'darwin-arm64': good }), true, 'a usable entry enables that platform')
    assert.equal(isTranscriptionPlatformSupported('darwin', 'arm64', { 'darwin-arm64': { executable: 'ffmpeg', files: [{ name: 'ffmpeg', sha256: 'x' }] } }), false, 'a malformed hash is not an artifact')
  })

  await check('T033 release gate: with the feature OFF, start and downloadModel answer FEATURE_DISABLED before anything is validated, checked, downloaded, persisted or queued; reading, cancel, delete and model removal keep working; ON works', async () => {
    const d = dbWith({ one: SINGLE })
    const world = makeFakeWorld({ books: { one: SINGLE } })
    world.installed.add('whisper-base')
    const store = new SqliteTranscriptStore(d)
    let on = false
    const svc = makeService(world, store, { isEnabled: () => on })
    let decoderChecks = 0
    const realAvailability = world.decoder.availability
    world.decoder.availability = async () => { decoderChecks += 1; return realAvailability() }

    for (const bad of [undefined, null, {}, req('one'), req('nope'), req('one', { language: 'klingon' }), req('one', { modelId: 'whisper-base' })]) {
      const r = await svc.start(bad)
      assert.equal(r.ok, false); assert.equal(r.errorCode, 'FEATURE_DISABLED', 'the gate answers first, even to input that would fail validation')
    }
    assert.match((await svc.start(req('one'))).errorMessage, /not available/)
    for (const id of ['whisper-tiny', 'whisper-base', 'whisper-huge', undefined, 42]) assert.equal((await svc.downloadModel(id)).errorCode, 'FEATURE_DISABLED')
    assert.deepEqual(world.downloads, [], 'no model was downloaded'); assert.equal(store.get('one'), null, 'nothing persisted')
    assert.equal(world.decodeCalls.length + world.speechCalls.length, 0); assert.equal(svc.isBusy(), false)
    assert.equal(decoderChecks, 0, 'the decoder is not even looked at while the feature is off')

    const info = await svc.getInfo('one')                                   // reading and cleaning up stay available
    assert.equal(info.transcript, null); assert.equal(info.models.length, 2)
    assert.deepEqual(svc.cancel('nope'), { ok: false }); assert.deepEqual(svc.search('one', 'x'), []); assert.deepEqual(svc.getPassages({ bookId: 'one' }), [])
    assert.deepEqual(await svc.delete('one'), { ok: true })
    assert.deepEqual(await svc.removeModel('whisper-base'), { ok: true }, 'a model downloaded earlier can still be removed')

    on = true                                                                // ON: the same service works
    assert.equal((await svc.start(req('one'))).ok, true)
    await finished(world, 'one')
    assert.equal(store.get('one').status, 'complete')
    on = false
    assert.equal((await svc.start(req('one'))).errorCode, 'FEATURE_DISABLED', 'the gate is read at every call')
    await svc.shutdown()
  })

  await check('T033 decoder first: with no decoder nothing is offered or downloaded — downloadModel and start answer DECODE_FAILED (not MODEL_MISSING) and getInfo reports the decoder', async () => {
    const d = dbWith({ one: SINGLE })
    const world = makeFakeWorld({ books: { one: SINGLE } })
    const store = new SqliteTranscriptStore(d)
    const svc = makeService(world, store)

    world.decoderAvailable = { available: false, reason: 'NOT_BUNDLED' }
    assert.deepEqual((await svc.getInfo('one')).decoder, { available: false, reason: 'NOT_BUNDLED' })
    assert.deepEqual((await svc.getInfo(42)).decoder, { available: false, reason: 'NOT_BUNDLED' })
    const download = await svc.downloadModel('whisper-base')
    assert.equal(download.ok, false); assert.equal(download.errorCode, 'DECODE_FAILED'); assert.match(download.errorMessage, /NOT_BUNDLED/)
    assert.deepEqual(world.downloads, [], 'no large download for a transcription that cannot run')
    const start = await svc.start(req('one', { modelId: 'whisper-base' }))   // the model is NOT installed either
    assert.equal(start.errorCode, 'DECODE_FAILED', 'told the decoder is missing — not sent off to download a model')
    assert.equal(store.get('one'), null)

    world.decoderAvailable = { available: true, executablePath: '/ffmpeg' }
    assert.deepEqual((await svc.getInfo('one')).decoder, { available: true })
    assert.equal((await svc.start(req('one', { modelId: 'whisper-base' }))).errorCode, 'MODEL_MISSING', 'with a decoder the missing model is the next thing to fix')
    assert.deepEqual(await svc.downloadModel('whisper-base'), { ok: true }); assert.deepEqual(world.downloads, ['whisper-base'])

    world.decoder.availability = async () => { throw new Error('probe exploded') }
    assert.deepEqual((await svc.getInfo('one')).decoder, { available: false, reason: 'UNKNOWN' }, 'a probe that throws is "unavailable", not a crash')
    await svc.shutdown()
  })

  const crashRun = async (hangAt) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-crash-'))
    const dbFile = path.join(dir, 'crash.db')
    const seed = new Database(dbFile)
    seed.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)')
    for (const f of files) applyMigration(seed, f)
    seed.prepare(BOOK_SQL).run({ id: 'crash', title: 'crash', fp: '/books/crash/0000-aaaaaaaa.mp3', fmt: 'mp3', sha: 'sha-crash' })
    seed.close()
    const child = spawnChild(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, TRANSCRIPTION_SPIKE_CHILD: JSON.stringify({ dbFile, hangAt }) }, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
    })
    let out = ''; child.stdout.on('data', (b) => { out += b.toString() })
    const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })))
    await until(() => out.includes('HUNG'), 'the child process to be inside a window', 20000)
    assert.ok(child.exitCode === null && child.signalCode === null, 'the child is still running right before the kill (it did not end by itself)')
    child.kill('SIGKILL')                                  // a REAL process death: no cleanup handler, no shutdown, no flag
    const exit = await exited
    assert.ok(exit.signal === 'SIGKILL' || (exit.code !== 0 && exit.code !== null), `the child died from the kill (code ${exit.code}, signal ${exit.signal})`)
    return { dir, dbFile }
  }

  await check('T015a recovery after a REAL process kill mid-window: INTERRUPTED + partial, committed text intact, never complete, idempotent; Resume skips covered windows and finishes', async () => {
    const { dir, dbFile } = await crashRun(2)              // killed while window 2 is in flight (window 1 is committed)
    const crashDb = new Database(dbFile); crashDb.pragma('foreign_keys = ON')
    const store = new SqliteTranscriptStore(crashDb)
    let rec = store.get('crash')
    assert.equal(rec.jobState, 'running', 'the dead process left its marker')
    assert.equal(rec.status, 'partial'); assert.equal(rec.passageCount, 1); assert.deepEqual(rec.covered, { main: [[0, 30000]] })

    assert.equal(store.recoverInterrupted(), 1)
    rec = store.get('crash')
    assert.equal(rec.jobState, null); assert.equal(rec.lastError, 'INTERRUPTED'); assert.equal(rec.status, 'partial')
    assert.equal(rec.passageCount, 1, 'committed passages intact'); assert.deepEqual(rec.covered, { main: [[0, 30000]] })
    assert.equal(store.recoverInterrupted(), 0, 'running it twice changes nothing')
    assert.equal(store.get('crash').updatedAt, rec.updatedAt)
    assert.notEqual(store.get('crash').status, 'complete')

    // nothing restarts by itself: a fresh service does not touch the transcript until the user resumes
    const world = makeFakeWorld({ books: { crash: { format: 'mp3', durationMs: 75_000 } } })
    const svc = makeService(world, store)
    await sleepMs(50); assert.equal(world.decodeCalls.length, 0)
    assert.equal((await svc.getInfo('crash')).transcript.lastError, 'INTERRUPTED')
    await svc.start(req('crash'))
    await until(() => store.get('crash').status === 'complete', 'the resumed job to finish')
    assert.equal(world.decodeCalls[0].startMs, 30000, 'Resume skipped the covered interval')
    assert.deepEqual(store.get('crash').covered, { main: [[0, 75000]] }); assert.equal(store.get('crash').lastError, null)
    await svc.shutdown(); crashDb.close(); fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('T015a: a job killed before anything was committed becomes failed + INTERRUPTED (not partial, not complete)', async () => {
    const { dir, dbFile } = await crashRun(1)              // killed while window 1 is in flight
    const crashDb = new Database(dbFile); crashDb.pragma('foreign_keys = ON')
    const store = new SqliteTranscriptStore(crashDb)
    assert.equal(store.get('crash').jobState, 'running'); assert.equal(store.get('crash').passageCount, 0)
    assert.equal(store.recoverInterrupted(), 1)
    const rec = store.get('crash')
    assert.equal(rec.status, 'failed'); assert.equal(rec.lastError, 'INTERRUPTED'); assert.equal(rec.jobState, null)
    assert.equal(store.recoverInterrupted(), 0)
    crashDb.close(); fs.rmSync(dir, { recursive: true, force: true })
  })
}

fs.rmSync(audioFile, { force: true })
db.close(); sdb.close()
console.log(`\n${passed} checks passed`)

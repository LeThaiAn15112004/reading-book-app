/**
 * Integration checks (spec 004, task T023): the renderer's REAL transcript store (the zustand store behind the Transcript panel
 * and the Transcribe dialog) against the REAL Main-side transcription service on real SQLite (better-sqlite3, the migrated
 * schema, FTS5 and all). Fake: the IPC hop (a direct call with structured-clone copies and event listeners), the audio decoder,
 * the speech process and the library — the same fakes as `spike:transcription:main`.
 *
 *   1. bind       summary, models, default language; "no transcript" is not "unreadable"
 *   2. progress   job snapshots, partial passages readable while the job runs, final refresh
 *   3. errors     refused starts become `actionError`; model download with progress
 *   4. cancel     cancel keeps the finished windows; Resume finishes without recomputing
 *   5. multi-track  per-track progress, passages in playback order
 *   6. switching  one book at a time: late answers and events of the old book never leak into the new one
 *   7. read failures  "unavailable", never an empty list written back; refresh recovers
 *   8. delete / unbind / coalescing
 *
 * Not covered (needs a DOM and a window, i.e. Electron, which this check never launches): React rendering of the panel and the
 * dialog — see the manual checks in specs/004-audiobook-transcription/quickstart.md.
 *
 * better-sqlite3 is built for Electron's Node ABI, so this script re-launches itself with the app's Electron binary in
 * `ELECTRON_RUN_AS_NODE` mode (no window). The TypeScript under test is bundled with esbuild first.
 *
 * Run: npm run spike:transcription:store   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const desktop = path.resolve(here, '../..')

if (!process.versions.electron) {
  // ---- phase 1 (plain node): bundle the TypeScript under test, then re-launch under Electron's Node ----
  const esbuild = require('esbuild')
  const sdk = path.resolve(desktop, '../book-reader-sdk/dist/index.mjs')
  assert.ok(fs.existsSync(sdk), 'build the SDK first (the npm script does)')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-transcription-store-spike-'))
  const plugin = {
    name: 'spike-aliases',
    setup(build) {
      build.onResolve({ filter: /^@reading-book\/book-reader-sdk$/ }, () => ({ path: sdk }))
      build.onResolve({ filter: /^\.\/db$/ }, () => ({ path: 'db-stub', namespace: 'stub' }))
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export function getDatabase() { throw new Error("db stub: pass a database") }', loader: 'js' }))
    },
  }
  const bundles = {
    dbStore: path.join(out, 'transcript-store.mjs'),
    service: path.join(out, 'transcription-service.mjs'),
    exportFile: path.join(out, 'transcript-export-file.mjs'),
    renderer: path.join(out, 'renderer-store.mjs'),
  }
  const common = { bundle: true, platform: 'node', format: 'esm', plugins: [plugin], logLevel: 'error' }
  await esbuild.build({ ...common, entryPoints: [path.join(desktop, 'electron/persistence/sqlite-transcript-store.ts')], outfile: bundles.dbStore, external: ['better-sqlite3', 'electron'] })
  await esbuild.build({ ...common, entryPoints: [path.join(desktop, 'electron/transcription/transcription-service.ts')], outfile: bundles.service, external: ['electron'] })
  // the renderer's own store, with the real bridge and zustand (no DOM is touched at import time)
  await esbuild.build({ ...common, entryPoints: [path.join(here, 'renderer-entry.mjs')], outfile: bundles.renderer, nodePaths: [path.join(desktop, 'node_modules'), path.join(desktop, '../../node_modules')] })
  await esbuild.build({ ...common, entryPoints: [path.join(desktop, 'electron/transcription/transcript-export-file.ts')], outfile: bundles.exportFile, external: ['electron'] })
  const electron = require('electron')
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', TRANSCRIPTION_STORE_SPIKE_DB: bundles.dbStore, TRANSCRIPTION_STORE_SPIKE_SERVICE: bundles.service, TRANSCRIPTION_STORE_SPIKE_RENDERER: bundles.renderer, TRANSCRIPTION_STORE_SPIKE_EXPORTFILE: bundles.exportFile }
  const r = spawnSync(electron, [fileURLToPath(import.meta.url)], { env, stdio: 'inherit', windowsHide: true })
  fs.rmSync(out, { recursive: true, force: true })
  process.exit(r.status ?? 1)
}

// ---- phase 2 (Electron's Node, real better-sqlite3) ----
const Database = require('better-sqlite3')
const { SqliteTranscriptStore } = await import(pathToFileURL(process.env.TRANSCRIPTION_STORE_SPIKE_DB).href)
const { createTranscriptionService } = await import(pathToFileURL(process.env.TRANSCRIPTION_STORE_SPIKE_SERVICE).href)
const { exportTranscriptToFile } = await import(pathToFileURL(process.env.TRANSCRIPTION_STORE_SPIKE_EXPORTFILE).href)
const { makeFakeWorld, makeService, sleepMs, until } = await import(pathToFileURL(path.join(here, 'fake-world.mjs')).href)

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const migrationsDir = path.join(desktop, 'electron/persistence/migrations')
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
function freshDb(books) {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)')
  for (const f of files) {
    db.pragma('foreign_keys = OFF')
    db.transaction(() => {
      db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString())
    })()
    db.pragma('foreign_keys = ON')
  }
  const insBook = db.prepare(
    `INSERT INTO books (id, title, file_path, normalized_path, file_format, cover_path, sha256, is_favorite, reading_status,
       source_provider, external_id, source_url, metadata_json, genres_json, reading_state_json, added_at, updated_at)
     VALUES (@id, @title, @fp, NULL, @fmt, NULL, @sha, 0, 'reading', NULL, NULL, NULL, '{}', '[]', '{}', 'a', 'u')`,
  )
  const insChapter = db.prepare(
    `INSERT INTO book_audio_chapters (id, book_id, position, title, file_name, source_path, file_format, size_bytes, sha256, duration_seconds)
     VALUES (?, ?, ?, ?, ?, 'x.mp3', 'mp3', 10, 'h', 60)`,
  )
  for (const [id, b] of Object.entries(books)) {
    insBook.run({ id, title: id, fp: `/books/${id}/0000-aaaaaaaa.${b.format}`, fmt: b.format, sha: `sha-${id}` })
    ;(b.tracks ?? []).forEach((t, position) => insChapter.run(t.id, id, position, t.title, `${String(position).padStart(4, '0')}-${t.id.slice(0, 8).padEnd(8, 'x')}.mp3`))
  }
  return db
}

const SINGLE = { format: 'mp3', durationMs: 75_000 }
const MULTI = { format: 'mp3', durationMs: 0, tracks: [{ id: 'zz-track', title: 'One', durationMs: 40_000 }, { id: 'aa-track', title: 'Two', durationMs: 35_000 }, { id: 'mm-track', title: 'Three', durationMs: 20_000 }] }
const LONG = { format: 'mp3', durationMs: 600_000 }
const BOOKS = { a: SINGLE, b: SINGLE, one: SINGLE, multi: MULTI, long: LONG, other: SINGLE }

// ---- the real Main service on real SQLite, behind a fake `window.api` (IPC = direct call + structured-clone copies) ----
const db = freshDb(BOOKS)
const dbStore = new SqliteTranscriptStore(db)
const SPEC = { books: BOOKS }                                  // `speechPlan` is set per test
const world = makeFakeWorld(SPEC)
const listeners = { progress: new Set(), added: new Set(), model: new Set() }
const counts = { added: 0 }
const fan = (set, payload) => { for (const handler of [...set]) handler(structuredClone(payload)) }
const service = makeService(createTranscriptionService, world, dbStore, {
  progressIntervalMs: 0,                                      // the throttle itself is checked by spike:transcription:main
  events: { progress: (j) => fan(listeners.progress, j), passagesAdded: (a) => { counts.added += 1; fan(listeners.added, a) }, modelProgress: (p) => fan(listeners.model, p) },
})
const hooks = { getPassages: null, getInfo: null, passageReads: 0, search: null, searches: [] }
// The export's save dialog and file write are Main's: here the dialog answers with a path in a temp folder (or cancels).
const exportTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-store-export-'))
const exportState = { target: path.join(exportTmp, 'transcript.txt'), forbidden: false, delayMs: 0 }
const exportDeps = {
  build: (id, options) => service.buildExport(id, options),
  suggestedName: async () => 'name.txt',
  pickFile: async () => { if (exportState.delayMs) await sleepMs(exportState.delayMs); return exportState.target },
  isForbiddenTarget: () => exportState.forbidden,
  writeFile: (file, text) => fs.promises.writeFile(file, text, 'utf8'),
}
globalThis.window = {
  api: {
    transcription: {
      getInfo: async (bookId, appLanguage) => { await hooks.getInfo?.(bookId); return structuredClone(await service.getInfo(bookId, appLanguage)) },
      start: async (request) => structuredClone(await service.start(structuredClone(request))),
      cancel: async (jobId) => structuredClone(service.cancel(jobId)),
      downloadModel: async (modelId) => structuredClone(await service.downloadModel(modelId)),
      getPassages: async (request) => { hooks.passageReads += 1; await hooks.getPassages?.(request); return structuredClone(service.getPassages(structuredClone(request))) },
      delete: async (bookId) => structuredClone(await service.delete(bookId)),
      search: async (bookId, query, limit) => { hooks.searches.push({ bookId, query, limit }); await hooks.search?.(query); return structuredClone(service.search(bookId, query, limit)) },
      export: async (bookId, options) => structuredClone(await exportTranscriptToFile(exportDeps, bookId, options)),
      onProgress: (handler) => { listeners.progress.add(handler); return () => listeners.progress.delete(handler) },
      onPassagesAdded: (handler) => { listeners.added.add(handler); return () => listeners.added.delete(handler) },
      onModelProgress: (handler) => { listeners.model.add(handler); return () => listeners.model.delete(handler) },
    },
  },
}

// ---- the audio player store's collaborators: a scriptable stand-in for the media element (as in spike:audio:store), and a
// minimal library / audio / overlay API (the Main side of those is covered by spike:audio:main and spike:audio:store) ----
const elements = []
class FakeAudio extends EventTarget {
  constructor() {
    super()
    this._src = ''; this.preload = ''; this.currentTime = 0; this.duration = NaN; this._rate = 1; this.defaultPlaybackRate = 1
    this.volume = 1; this.paused = true; this.ended = false; this.error = null; this.released = false
    elements.push(this)
  }
  get playbackRate() { return this._rate }
  set playbackRate(v) { const changed = v !== this._rate; this._rate = v; if (changed) queueMicrotask(() => this.fire('ratechange')) }
  get src() { return this._src }
  set src(v) { this._src = v }
  removeAttribute(name) { if (name === 'src') this._src = '' }
  load() { this.released = true }
  fire(type) { this.dispatchEvent(new Event(type)) }
  async play() { this.paused = false; this.ended = false; queueMicrotask(() => this.fire('playing')) }
  pause() { if (!this.paused) { this.paused = true; this.fire('pause') } }
  /** The element reports its metadata: what the browser does once the stream answered. */
  loaded(duration) { this.duration = duration; this.fire('durationchange'); this.fire('loadedmetadata') }
}
globalThis.Audio = FakeAudio
const memory = new Map()
globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)) }
const playerTracks = { multi: MULTI.tracks.map((t) => ({ id: t.id, title: t.title, durationSeconds: t.durationMs / 1000 })) }
Object.assign(globalThis.window.api, {
  library: { getBook: async (id) => ({ id, title: `Title ${id}`, format: 'mp3', author: 'Author' }), openBookContent: async () => ({ ok: true }), markAsReading: async () => ({ ok: true }) },
  audio: {
    getTracks: async (id) => ({ ok: true, tracks: playerTracks[id] ?? [] }),
    getChapters: async () => ({ ok: true, chapters: [] }),
    getBookmarks: async () => [],
    saveBookmarks: async () => ({ ok: true }),
  },
  overlay: { getAudioProgress: async () => null, saveAudioProgress: async () => ({ ok: true }) },
})

const { useTranscriptStore, useAudioPlayerStore, isActiveJob, PASSAGE_FETCH_LIMIT, SEARCH_HIT_LIMIT } = await import(pathToFileURL(process.env.TRANSCRIPTION_STORE_SPIKE_RENDERER).href)
const S = () => useTranscriptStore.getState()
const whole = { scope: { kind: 'whole' }, language: 'en', modelId: 'whisper-tiny' }
const settle = (label) => until(() => S().infoStatus !== 'loading' && S().passagesStatus !== 'idle' && S().passagesStatus !== 'loading', label)
/** Never-resolving gate for the fake speech process; `release()` lets every waiting window go. */
function holdFrom(call) {
  let release
  const gate = new Promise((r) => { release = r })
  world.onSpeech = async (n) => { if (n >= call) world.speechGate = { promise: gate } }
  return () => { world.speechGate = null; release() }
}
async function reset() {
  S().unbind()
  for (const id of Object.keys(BOOKS)) await service.delete(id)
  world.speechCalls.length = 0; world.decodeCalls.length = 0; world.onSpeech = null; world.speechGate = null
  hooks.getPassages = null; hooks.getInfo = null; hooks.passageReads = 0; hooks.search = null; hooks.searches.length = 0
  exportState.target = path.join(exportTmp, 'transcript.txt'); exportState.forbidden = false; exportState.delayMs = 0
  world.events.progress.length = 0; world.events.passagesAdded.length = 0; counts.added = 0
  world.installed.clear(); world.installed.add('whisper-tiny'); world.downloadError = null
  delete SPEC.speechPlan
}

// =====================================================================================================================
console.log('\n1. bind')
// =====================================================================================================================
await check('bind reads summary, models and the default language; an untouched book is "no transcript", not "unreadable"', async () => {
  await reset()
  S().bind('one', 'vi-VN')
  await settle('first read')
  assert.equal(S().bookId, 'one'); assert.equal(S().infoStatus, 'ready'); assert.equal(S().passagesStatus, 'ready')
  assert.equal(S().info.transcript, null); assert.equal(S().job, null); assert.deepEqual(S().passages, [])
  assert.equal(S().info.defaultLanguage, 'vi')
  assert.deepEqual(S().info.models.map((m) => [m.id, m.installed]), [['whisper-tiny', true], ['whisper-base', false]])
  assert.equal(listeners.progress.size, 1); assert.equal(listeners.added.size, 1); assert.equal(listeners.model.size, 1)
  S().bind('one', 'vi-VN')                                   // same book again: nothing is re-subscribed
  assert.equal(listeners.progress.size, 1)
})

// =====================================================================================================================
console.log('\n2. progress')
// =====================================================================================================================
await check('start → the job mirrors Main, partial text is readable while it runs, the end refreshes summary and passages', async () => {
  await reset()
  S().bind('one'); await settle('first read')
  const release = holdFrom(2)                                // window 1 commits, window 2 hangs
  assert.equal(await S().start(whole), true)
  await until(() => S().passages.length === 1 && isActiveJob(S().job) && S().job.state === 'running', 'the first window to show up while the job runs')
  assert.equal(S().passages[0].text, 'seg1')
  assert.equal(S().job.totalMs, 75000); assert.ok(S().job.doneMs > 0 && S().job.doneMs < 75000)
  assert.equal(S().info.transcript.status, 'partial', 'the summary says partial while the job is not over')
  assert.equal(S().info.transcript.language, 'en'); assert.equal(S().actionError, null)
  release()
  await until(() => S().job === null && S().info.transcript?.status === 'complete' && S().passages.length === 3, 'the job to finish and the panel to refresh')
  assert.deepEqual(S().passages.map((p) => p.text), ['seg1', 'seg2', 'seg3'])
  assert.equal(S().info.transcript.coveredMs, 75000); assert.equal(S().info.transcript.totalMs, 75000)
  assert.equal(S().passagesTruncated, false)
})

// =====================================================================================================================
console.log('\n3. errors')
// =====================================================================================================================
await check('a refused start becomes actionError (and false); MODEL_MISSING for a model not on the device; the download reports progress and installs', async () => {
  await reset()
  S().bind('one'); await settle('first read')
  assert.equal(await S().start({ ...whole, language: 'klingon' }), false)
  assert.equal(S().actionError.code, 'UNSUPPORTED_LANGUAGE')
  S().clearError(); assert.equal(S().actionError, null)
  assert.equal(await S().start({ ...whole, modelId: 'whisper-base' }), false)
  assert.equal(S().actionError.code, 'MODEL_MISSING')
  assert.equal(S().job, null); assert.equal(S().info.transcript, null, 'a refused start leaves no transcript behind')

  const seen = []
  const off = useTranscriptStore.subscribe((s) => seen.push(s.downloading ? { ...s.downloading } : null))
  assert.equal(await S().downloadModel('whisper-base'), true)
  off()
  assert.ok(seen.some((d) => d && d.modelId === 'whisper-base'), 'downloading was visible while it ran')
  assert.deepEqual(seen.find((d) => d && d.totalBytes === 2), { modelId: 'whisper-base', loadedBytes: 1, totalBytes: 2 }, 'progress events reach the store')
  assert.equal(S().downloading, null)
  assert.equal(S().info.models.find((m) => m.id === 'whisper-base').installed, true)

  world.downloadError = Object.assign(new Error('flipped byte'), { code: 'INTEGRITY_FAILED' })
  assert.equal(await S().downloadModel('whisper-tiny'), false)
  assert.equal(S().actionError.code, 'INTEGRITY_FAILED'); assert.equal(S().downloading, null)
})

// =====================================================================================================================
console.log('\n4. cancel / resume')
// =====================================================================================================================
await check('cancel keeps the finished windows (status cancelled); Resume finishes without decoding them again', async () => {
  await reset()
  S().bind('one'); await settle('first read')
  holdFrom(2)
  await S().start(whole)
  await until(() => S().passages.length === 1 && S().job?.state === 'running', 'window 1 committed, window 2 in flight')
  await S().cancel()
  await until(() => S().job === null && S().info.transcript?.status === 'cancelled', 'the job to end cancelled')
  assert.equal(S().passages.length, 1, 'the finished window is kept'); assert.equal(S().info.transcript.coveredMs, 30000)
  world.decodeCalls.length = 0; world.onSpeech = null; world.speechGate = null
  assert.equal(await S().start(whole), true)
  await until(() => S().job === null && S().info.transcript?.status === 'complete' && S().passages.length === 3, 'the resumed job to finish')
  assert.equal(world.decodeCalls[0].startMs, 30000, 'the covered interval was skipped')
})

// =====================================================================================================================
console.log('\n5. multi-track')
// =====================================================================================================================
await check('multi-track: the job carries the current track and its own progress; passages arrive in playback order', async () => {
  await reset()
  S().bind('multi'); await settle('first read')
  const jobs = []
  const off = useTranscriptStore.subscribe((s) => { if (s.job) jobs.push({ ...s.job }) })
  await S().start(whole)
  await until(() => S().job === null && S().info.transcript?.status === 'complete', 'the multi-track job to finish')
  off()
  assert.ok(jobs.some((j) => j.trackId === 'aa-track' && j.trackTotalMs === 35000), 'a snapshot named the second track with its length')
  assert.ok(jobs.filter((j) => j.state === 'running').every((j) => j.trackId !== undefined && typeof j.trackDoneMs === 'number'), 'every running snapshot names its track')
  assert.deepEqual([...new Set(S().passages.map((p) => p.trackId))], ['zz-track', 'aa-track', 'mm-track'], 'reading order = chapter position, not id order')
  assert.equal(S().info.transcript.totalMs, 95000)
})

// =====================================================================================================================
console.log('\n6. switching books')
// =====================================================================================================================
await check('one book at a time: state resets on bind; the old book\'s events and late answers never reach the new one', async () => {
  await reset()
  S().bind('a'); await settle('first read')
  const release = holdFrom(2)
  await S().start(whole)
  await until(() => S().passages.length === 1, 'book a to have text')
  S().bind('b'); await settle('book b first read')
  assert.equal(S().bookId, 'b'); assert.deepEqual(S().passages, []); assert.equal(S().job, null); assert.equal(S().info.transcript, null)
  assert.equal(listeners.progress.size, 1, 'the old book\'s subscriptions were dropped')
  release()
  await until(() => dbStore.get('a')?.status === 'complete', 'book a\'s job to finish in Main')
  await sleepMs(60)
  assert.equal(S().bookId, 'b'); assert.equal(S().job, null); assert.deepEqual(S().passages, []); assert.equal(S().info.transcript, null)

  // a slow read of book a answered AFTER the switch is dropped (a has 3 passages now — they must not appear under b)
  hooks.getPassages = async (request) => { if (request.bookId === 'a') await sleepMs(80) }
  S().bind('a')
  S().bind('b')
  await sleepMs(250)
  assert.equal(S().bookId, 'b'); assert.deepEqual(S().passages, []); assert.equal(S().passagesStatus, 'ready')
})

// =====================================================================================================================
console.log('\n7. read failures')
// =====================================================================================================================
await check('a failed read leaves "unavailable" and never turns what was loaded into an empty list; refresh recovers', async () => {
  await reset()
  await service.start({ bookId: 'one', scope: { kind: 'whole' }, language: 'en', modelId: 'whisper-tiny' })
  await until(() => dbStore.get('one')?.status === 'complete', 'a finished transcript to exist')
  S().bind('one'); await settle('first read')
  assert.equal(S().passages.length, 3)
  hooks.getPassages = async () => { throw new Error('disk on fire') }
  await S().refresh()
  assert.equal(S().passagesStatus, 'unavailable'); assert.equal(S().passages.length, 3, 'the list that was shown is kept, not replaced by an empty one')
  hooks.getInfo = async () => { throw new Error('ipc down') }
  await S().refresh()
  assert.equal(S().infoStatus, 'unavailable'); assert.equal(S().info.transcript.status, 'complete', 'the summary that was shown is kept too')
  hooks.getPassages = null; hooks.getInfo = null
  await S().refresh()
  assert.equal(S().infoStatus, 'ready'); assert.equal(S().passagesStatus, 'ready'); assert.equal(S().passages.length, 3)

  // a book whose very first read fails is "unavailable", NOT "no transcript"
  S().unbind()
  hooks.getPassages = async () => { throw new Error('nope') }
  S().bind('one'); await until(() => S().passagesStatus === 'unavailable', 'the first read to fail')
  assert.deepEqual(S().passages, []); assert.notEqual(S().passagesStatus, 'ready')
})

// =====================================================================================================================
console.log('\n8. delete / unbind / coalescing')
// =====================================================================================================================
await check('delete empties the panel state; deleting while a job runs cancels it first', async () => {
  await reset()
  S().bind('one'); await settle('first read')
  holdFrom(2)
  await S().start(whole)
  await until(() => S().passages.length === 1 && S().job?.state === 'running', 'a running job with one window')
  assert.equal(await S().remove(), true)
  assert.equal(S().job, null); assert.deepEqual(S().passages, []); assert.equal(S().info.transcript, null)
  assert.equal(dbStore.get('one'), null)
  await sleepMs(40)
  assert.equal(S().job, null, 'no late snapshot of the deleted job')
})

await check('passagesAdded refetches are coalesced (far fewer reads than events, never fewer than needed); unbind unsubscribes and forgets the book', async () => {
  await reset()
  S().bind('long'); await settle('first read')
  hooks.passageReads = 0
  hooks.getPassages = async () => { await sleepMs(15) }       // a slow read: events pile up behind it
  await S().start(whole)
  await until(() => S().job === null && S().info.transcript?.status === 'complete' && S().passages.length >= 22, 'the long job to finish')
  const events = counts.added
  assert.equal(events, 22)
  assert.ok(hooks.passageReads < events + 3, `reads (${hooks.passageReads}) did not exceed events (${events}) by more than the start/end reads`)
  assert.equal(S().passages.length, dbStore.getPassages('long', { limit: 2000 }).length, 'the final list is complete')
  assert.ok(PASSAGE_FETCH_LIMIT >= 2000)
  S().unbind()
  assert.equal(S().bookId, null); assert.deepEqual(S().passages, [])
  assert.equal(listeners.progress.size + listeners.added.size + listeners.model.size, 0, 'nothing stays subscribed')
})

// =====================================================================================================================
console.log('\n9. long transcripts (paging) and Resume scope')
// =====================================================================================================================
await check('T040: a transcript longer than one page is read page by page — more is offered, a refresh never shrinks the list, no duplicates', async () => {
  await reset()
  SPEC.speechPlan = (call) => Array.from({ length: 120 }, (_, i) => ({ startMs: i * 200, endMs: i * 200 + 150, text: `s${call}-${i}` }))   // 21 windows × 120 + the short last one (12 s → 60) = 2580 passages
  S().bind('long'); await settle('first read')
  await S().start(whole)
  await until(() => S().job === null && S().info.transcript?.status === 'complete' && S().passages.length >= PASSAGE_FETCH_LIMIT, 'the long job to finish')
  const inDb = dbStore.getPassages('long', { limit: 2000 }).length + dbStore.getPassages('long', { limit: 2000, offset: 2000 }).length
  assert.equal(inDb, 2580)
  assert.equal(S().passages.length, PASSAGE_FETCH_LIMIT, 'the first page'); assert.equal(S().passagesTruncated, true, 'more is on offer')
  const reads = hooks.passageReads
  await S().loadMore()
  assert.equal(S().passages.length, 2580); assert.equal(S().passagesTruncated, false)
  assert.equal(new Set(S().passages.map((p) => p.id)).size, 2580, 'no passage shown twice')
  await S().loadMore()
  assert.equal(hooks.passageReads, reads + 1, 'nothing more to read: no further request')
  await S().refresh()
  assert.equal(S().passages.length, 2580, 'a refresh re-reads every page that was shown'); assert.equal(S().passagesTruncated, false)
  const times = S().passages.map((p) => p.startMs)
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'still in playback order across the pages')
})

await check('T038: the summary carries the last job\'s scope, so the panel can Resume exactly that scope', async () => {
  await reset()
  S().bind('multi'); await settle('first read')
  holdFrom(2)
  const scope = { kind: 'track', trackId: 'aa-track' }
  assert.equal(await S().start({ ...whole, scope }), true)
  await until(() => S().info?.transcript?.scope && S().passages.length >= 1 && S().job?.state === 'running', 'the first window of the track')
  assert.deepEqual(S().info.transcript.scope, scope)
  await S().cancel()
  await until(() => S().job === null && S().info.transcript?.status === 'cancelled', 'the job to end cancelled')
  assert.deepEqual(S().info.transcript.scope, scope, 'kept after the job ends')
  world.decodeCalls.length = 0; world.onSpeech = null; world.speechGate = null
  assert.equal(await S().start({ ...whole, scope: S().info.transcript.scope }), true)
  await until(() => S().job === null && S().info.transcript?.status === 'complete', 'the resumed job to finish')
  assert.ok(world.decodeCalls.every((c) => c.filePath.endsWith('/aa-track')), 'Resume touched only the same track')
})

// =====================================================================================================================
console.log('\n10. follow and seek (the REAL audio player store with a scriptable media element)')
// =====================================================================================================================
const P = () => useAudioPlayerStore.getState()
const alive = () => elements.filter((e) => !e.released).at(-1)
async function resetAll() {
  await P().dispose()
  await reset()
  elements.length = 0
}
async function loadPlayer(bookId, duration) {
  await P().load(bookId)
  await until(() => alive() !== undefined, 'a media element')
  alive().loaded(duration)
  await until(() => P().status === 'ready' && !P().switching, 'the player to be ready')
}
/** The media element reports a new position (what `timeupdate` does while playing or after a seek). */
const at = (seconds) => { alive().currentTime = seconds; alive().fire('timeupdate') }
async function transcribe(bookId, plan) {
  if (plan) SPEC.speechPlan = plan
  assert.equal((await service.start({ bookId, scope: { kind: 'whole' }, language: 'en', modelId: 'whisper-tiny' })).ok, true)
  await until(() => dbStore.get(bookId)?.status === 'complete' && dbStore.get(bookId)?.jobState === null, `the transcript of ${bookId} to finish`)
}

await check('T025: single file — the active passage follows the player (nearest previous in a gap, unchanged inside a passage); seekToPassage moves the player; unbind stops following', async () => {
  await resetAll()
  await transcribe('one')                                      // default plan: [0,5000) [28000,33000) [56000,61000)
  S().bind('one'); await settle('first read')
  await loadPlayer('one', 75)
  const [p1, p2, p3] = S().passages
  assert.equal(S().passages.length, 3)
  assert.equal(S().activePassageId, p1.id, 'position 0 is inside the first passage')
  const changes = []
  const off = useTranscriptStore.subscribe((s, prev) => { if (s.activePassageId !== prev.activePassageId) changes.push(s.activePassageId) })
  for (const seconds of [1, 3, 4.9]) at(seconds)
  assert.deepEqual(changes, [], 'moving inside one passage changes nothing')
  at(10); assert.equal(S().activePassageId, p1.id, 'in a gap the nearest previous passage stays active')
  at(28); assert.equal(S().activePassageId, p2.id)
  for (const seconds of [32.9, 40, 55.9]) at(seconds)
  assert.equal(S().activePassageId, p2.id)
  at(56); assert.equal(S().activePassageId, p3.id)
  at(74.9); assert.equal(S().activePassageId, p3.id, 'after the last passage the last one stays')
  at(0); assert.equal(S().activePassageId, p1.id)
  assert.deepEqual(changes, [p2.id, p3.id, p1.id], 'one change per passage actually entered')

  S().seekToPassage(p2)
  assert.equal(P().positionSeconds, 28); assert.equal(alive().currentTime, 28, 'the media element itself was moved')
  assert.equal(S().activePassageId, p2.id)
  off(); S().unbind()
  at(60); assert.equal(S().activePassageId, null, 'unbound: nothing follows the player any more')
})

await check('T025: multi-track — looked up in the CURRENT track only; seekToPassage opens the other track at the exact second, keeps play / pause, and returns to the origin (paused) when the target cannot be played', async () => {
  await resetAll()
  await transcribe('multi', (call) => [{ startMs: 2000, endMs: 5000, text: `m${call}` }])   // one passage 2 s into every window
  S().bind('multi'); await settle('first read')
  await loadPlayer('multi', 40)                                // track 1 of 3 (zz), position 0
  const nth = (trackId, n) => S().passages.filter((p) => p.trackId === trackId)[n]
  assert.equal(S().passages.length, 5)
  assert.equal(S().activePassageId, null, 'before the first passage of the track nothing is active')
  at(1); assert.equal(S().activePassageId, null)
  at(3); assert.equal(S().activePassageId, nth('zz-track', 0).id)
  at(31); assert.equal(S().activePassageId, nth('zz-track', 1).id)

  P().goToTrack(1); alive().loaded(35)
  await until(() => P().trackIndex === 1 && !P().switching, 'the second track')
  assert.equal(S().activePassageId, null, 'a new track starts before ITS first passage — not the previous track\'s last passage')
  at(31); assert.equal(S().activePassageId, nth('aa-track', 1).id)

  // playing: play from a passage of ANOTHER track — exact second, keeps playing
  P().play(); await until(() => P().playing === true, 'playing')
  const target = nth('mm-track', 0)
  S().seekToPassage(target)
  await until(() => P().trackIndex === 2, 'the third track to open')
  alive().loaded(20)
  await until(() => !P().switching && P().playing, 'the jump to settle, still playing')
  assert.equal(P().positionSeconds, 2, 'the exact second of the passage'); assert.equal(S().activePassageId, target.id)

  // paused: stays paused
  P().pause(); await until(() => !P().playing, 'paused')
  S().seekToPassage(nth('zz-track', 1))
  await until(() => P().trackIndex === 0, 'the first track to open')
  alive().loaded(40)
  await until(() => !P().switching, 'the jump to settle')
  assert.equal(P().playing, false, 'a paused player stays paused'); assert.equal(P().positionSeconds, 30); assert.equal(S().activePassageId, nth('zz-track', 1).id)

  // the target cannot be played: back to the origin, paused, with a notice
  S().seekToPassage(nth('aa-track', 1))
  await until(() => P().trackIndex === 1, 'the second track to open')
  const broken = alive()
  broken.error = { code: 4, message: 'cannot decode' }; broken.fire('error')
  await until(() => P().trackIndex === 0 && alive() !== broken, 'the origin track to reopen')
  alive().loaded(40)
  await until(() => !P().switching, 'the fallback to settle')
  assert.equal(P().playing, false); assert.equal(P().positionSeconds, 30, 'back at the second it was left')
  assert.match(P().noteNotice ?? '', /could not be played/)
  assert.equal(S().activePassageId, nth('zz-track', 1).id)

  // a track that is not part of the book is ignored
  const index = P().trackIndex
  S().seekToPassage({ trackId: 'not-a-track', startMs: 1000 })
  assert.equal(P().trackIndex, index)
  S().unbind()
})

// =====================================================================================================================
console.log('\n11. search and export')
// =====================================================================================================================
const TEXTS = [
  'The forest was quiet and Việt Nam seemed far', 'A river crossed the forest again', 'Nothing but the river', 'Deep in the forest', 'Forest fires and river floods',
]
const where = (hits) => hits.map((h) => [h.trackId, h.startMs])

await check('T030: search — hits in playback order, short queries do nothing, a late answer of an earlier query is dropped, a failed search keeps the hits; a hit plays from there; clear / bind reset it', async () => {
  await resetAll()
  await transcribe('multi', (call) => [{ startMs: 1000, endMs: 4000, text: TEXTS[call - 1] }])
  S().bind('multi'); await settle('first read')
  hooks.searches.length = 0

  await S().search('x')
  assert.equal(S().searchStatus, 'idle'); assert.deepEqual(S().searchHits, []); assert.equal(hooks.searches.length, 0, 'one character is not searched')
  await S().search('forest')
  assert.equal(S().searchStatus, 'ready'); assert.equal(S().searchQuery, 'forest')
  assert.deepEqual(where(S().searchHits), [['zz-track', 1000], ['zz-track', 29000], ['aa-track', 29000], ['mm-track', 1000]], 'playback order, each with the start to jump to')
  assert.deepEqual(hooks.searches.at(-1), { bookId: 'multi', query: 'forest', limit: SEARCH_HIT_LIMIT })
  await S().search('  river  ')
  assert.equal(hooks.searches.at(-1).query, 'river', 'the query is trimmed'); assert.equal(S().searchQuery, '  river  ', 'the box keeps what was typed')
  assert.deepEqual(where(S().searchHits), [['zz-track', 29000], ['aa-track', 1000], ['mm-track', 1000]])

  // a slow earlier query must not overwrite the answer of the later one
  hooks.search = async (query) => { if (query === 'forest') await sleepMs(80) }
  const slow = S().search('forest')
  await S().search('river')
  await slow
  assert.deepEqual(where(S().searchHits), [['zz-track', 29000], ['aa-track', 1000], ['mm-track', 1000]], 'the late answer of "forest" was dropped')
  assert.equal(S().searchStatus, 'ready')

  // a search that cannot run keeps the hits, it is not "no results"
  hooks.search = async () => { throw new Error('index busy') }
  await S().search('river again')
  assert.equal(S().searchStatus, 'unavailable'); assert.equal(S().searchHits.length, 3)
  hooks.search = null
  await S().search('nothingmatchesthis')
  assert.equal(S().searchStatus, 'ready'); assert.deepEqual(S().searchHits, [], 'no match is a real, empty answer')

  // clicking a hit plays from there (the real player, another track, exact second)
  await S().search('forest')
  await loadPlayer('multi', 40)
  const hit = S().searchHits.at(-1)
  S().seekToPassage(hit)
  await until(() => P().trackIndex === 2, 'the third track to open')
  alive().loaded(20)
  await until(() => !P().switching, 'the jump to settle')
  assert.equal(P().tracks[P().trackIndex].id, 'mm-track'); assert.equal(P().positionSeconds, 1)

  S().clearSearch()
  assert.equal(S().searchQuery, ''); assert.equal(S().searchStatus, 'idle'); assert.deepEqual(S().searchHits, [])
  await S().search('forest'); assert.ok(S().searchHits.length > 0)
  S().bind('one'); await settle('another book')
  assert.equal(S().searchQuery, ''); assert.deepEqual(S().searchHits, [], 'a new book starts without the old book\'s hits')
  S().unbind()
})

await check('T030: export — exact text on disk through the Main-owned dialog, the store only learns saved / not; cancel is silent; the app\'s own data folder and a missing transcript give a message; no second export while one runs', async () => {
  await resetAll()
  await transcribe('one')                                       // default plan: seg1 / seg2 / seg3
  S().bind('one'); await settle('first read')
  const file = path.join(exportTmp, 'one.txt')
  exportState.target = file
  assert.equal(await S().exportTranscript({ timestamps: true }), true)
  assert.equal(fs.readFileSync(file, 'utf8'), '[00:00:00] seg1\n[00:00:28] seg2\n[00:00:56] seg3\n')
  assert.equal(S().exportSaved, true); assert.equal(S().exporting, false); assert.equal(S().actionError, null)
  assert.equal(await S().exportTranscript(), true)
  assert.equal(fs.readFileSync(file, 'utf8'), 'seg1\nseg2\nseg3\n', 'without timestamps by default')

  exportState.target = null                                      // the person cancels the dialog
  assert.equal(await S().exportTranscript(), false)
  assert.equal(S().exportSaved, false, 'a new export clears the "saved" mark'); assert.equal(S().actionError, null, 'cancel is not an error')

  exportState.target = path.join(exportTmp, 'forbidden.txt'); exportState.forbidden = true
  assert.equal(await S().exportTranscript(), false)
  assert.equal(S().actionError.code, 'INVALID_ARGUMENT'); assert.match(S().actionError.message, /outside/)
  assert.ok(!fs.existsSync(path.join(exportTmp, 'forbidden.txt')), 'nothing was written')
  exportState.forbidden = false; S().clearError()

  exportState.target = path.join(exportTmp, 'slow.txt'); exportState.delayMs = 60
  const first = S().exportTranscript()
  assert.equal(S().exporting, true)
  assert.equal(await S().exportTranscript(), false, 'a second export while one is waiting for the dialog does nothing')
  assert.equal(await first, true)

  S().bind('a'); await settle('a book without a transcript')
  exportState.delayMs = 0; exportState.target = path.join(exportTmp, 'none.txt')
  assert.equal(await S().exportTranscript(), false)
  assert.equal(S().actionError.code, 'INVALID_ARGUMENT'); assert.ok(!fs.existsSync(path.join(exportTmp, 'none.txt')))
  S().unbind()
})

await service.shutdown()
try {
  fs.rmSync(exportTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
} catch {
  /* a temp folder left behind is not a failure */
}
db.close()
console.log(`\n${passed} checks passed`)

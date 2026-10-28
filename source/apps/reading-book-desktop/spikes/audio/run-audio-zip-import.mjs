/**
 * Audiobook ZIP import, the real stage (A2) — headless, no Electron window. Uses the real code on real temp files:
 * `ZipImportService` (inspect → confirm), `createZipAudiobookImporter` (extract, validate with music-metadata,
 * hash, place, one SQLite transaction), the real `importDownloadedFile` single-file path, the real library IPC handlers
 * (`removeAudiobook`, `removeBook`, `deleteBookFile`, `getBook`) and the real sandbox helpers. `userData` is a temp
 * folder (electron stub); the database is node:sqlite on every numbered migration with a `transaction` shim.
 *
 *   1. multi      real import: order, per-chapter format, hashes, files, cover, title, progress, ZIP untouched
 *   2. identity   same tracks from another ZIP ⇒ duplicate; another order / subset ⇒ a new book
 *   3. one track  ordinary single-file import: no chapter rows, plain sha, ZIP cover not applied, single-file duplicates
 *   4. failure    bad track, DB failure, UNIQUE race, no space, cancellation: nothing left behind
 *   5. sweep      `.partial` folders: orphan removed, committed book kept
 *   6. library    DTO, remove audiobook (record kept when the folder is refused), single-file remove/delete unchanged
 *   7. add file   the ordinary "Add file" dialog offers .zip (flag on), hands a picked ZIP to the preview, leaves other files alone
 *
 * Run: npm run spike:audio:zip-import   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { audiobookParentSha256, isChapterFileName } from '@reading-book/book-reader-sdk'
import { app, clipboard, invoke } from '../pdf-annotations/electron-stub.mjs'
import { getDatabase } from '../pdf-annotations/db-stub.mjs'
import { JPG, PNG1, buildZip, mp3, wav } from './zip-fixtures.mjs'

const { LibraryChannels } = await import('../../electron/ipc/channels.ts')
const { registerLibraryIpc } = await import('../../electron/ipc/library.ipc.ts')
const { importDownloadedFile } = await import('../../electron/ipc/import.ipc.ts')
const { getLibraryStore } = await import('../../electron/persistence/sqlite-library-store.ts')
const { ensureBooksSandbox, ensureCoversDir, removeCoverFile, getCoversPath } = await import('../../electron/files/sandbox.ts')
const { probeAudioFile } = await import('../../electron/adapters/audio.adapter.ts')
const { readTrackMetadata } = await import('../../electron/zip-import/track-metadata.ts')
const { ZipImportService } = await import('../../electron/zip-import/zip-import-service.ts')
const { createZipAudiobookImporter, sweepPartialBookDirs, safeTrackFileName } = await import('../../electron/zip-import/zip-audiobook-importer.ts')
const { relinkBookToFile } = await import('../../electron/files/relink-book.ts')

// ---- environment: a clean temp userData, the shared db with a `transaction` shim
const userData = app.getPath('userData')
fs.rmSync(path.dirname(userData), { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-zip-import-a2-'))
const scratch = path.join(userData, 'zip-import-tmp')
const db = getDatabase()
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN')
  try {
    const r = fn(...args)
    db.exec('COMMIT')
    return r
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
const store = getLibraryStore()
registerLibraryIpc()

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const sha = (b) => createHash('sha256').update(b).digest('hex')
const books = () => ensureBooksSandbox()
const bookDirs = () => fs.readdirSync(books()).sort()
const coverFiles = () => (fs.existsSync(getCoversPath()) ? fs.readdirSync(getCoversPath()).sort() : [])
const scratchLeft = () => (fs.existsSync(scratch) ? fs.readdirSync(scratch) : [])
const count = (table, where = '1=1') => db.prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).get().n
const snapshotState = () => ({ books: count('books'), chapters: count('book_audio_chapters'), dirs: bookDirs(), covers: coverFiles() })
let n = 0
const zipFile = (name, entries) => {
  const dir = path.join(work, String((n += 1))) // one folder per archive: the file keeps its exact name
  fs.mkdirSync(dir)
  const file = path.join(dir, name)
  fs.writeFileSync(file, buildZip(entries))
  return file
}

const A = mp3(40, 1)
const B = mp3(40, 2)
const C = wav(3)
const MAIN_ENTRIES = [
  { name: 'CD2/01.mp3', data: B },
  { name: 'Extras/bonus.wav', data: C },
  { name: 'CD1/01.mp3', data: A },
  { name: 'cover.png', data: PNG1 },
  { name: 'README.txt', data: Buffer.from('notes') },
]

function makeService(over = {}) {
  const importer = createZipAudiobookImporter({
    tmpRoot: scratch,
    booksRoot: ensureBooksSandbox,
    coversDir: ensureCoversDir,
    readTrack: readTrackMetadata,
    store,
    importSingleFile: (tempPath) => importDownloadedFile(tempPath),
    removeCover: (p) => removeCoverFile(p),
    ...over,
  })
  return new ZipImportService({
    tmpRoot: scratch,
    probe: async (f, fmt) => ({ durationSeconds: (await probeAudioFile(f, fmt)).format.duration }),
    importer,
  })
}
const inspect = async (svc, file) => {
  const r = await svc.inspect(file)
  assert.equal(r.ok, true, JSON.stringify(r))
  return r.preview
}
const idOf = (p, entryPath) => p.entries.find((e) => e.path === entryPath).id

console.log('1. multi-chapter import')
const mainZip = zipFile('My Story.zip', MAIN_ENTRIES)
const mainBytes = fs.readFileSync(mainZip)
const mainSvc = makeService()
const mainPreview = await inspect(mainSvc, mainZip)
const progressEvents = []
let mainBook
await check('three tracks (mixed mp3 + wav, the same basename in two folders) become ONE book with ordered chapters', async () => {
  const r = await mainSvc.confirm(mainPreview.sessionId, { trackIds: [...mainPreview.trackOrder].reverse(), coverId: mainPreview.defaultCoverId }, { onProgress: (p) => progressEvents.push(p) })
  assert.equal(r.ok, true, JSON.stringify(r))
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(r.bookId)
  mainBook = { id: r.bookId, row }
  assert.equal(row.title, 'My Story') // ZIP name without extension
  assert.equal(count('books'), 1)
  const chapters = store.listAudioChapters(r.bookId)
  assert.deepEqual(chapters.map((c) => c.sourcePath), ['CD1/01.mp3', 'CD2/01.mp3', 'Extras/bonus.wav'])
  assert.deepEqual(chapters.map((c) => c.fileFormat), ['mp3', 'mp3', 'wav'])
  assert.deepEqual(chapters.map((c) => c.position), [0, 1, 2])
  assert.deepEqual(chapters.map((c) => c.sha256), [sha(A), sha(B), sha(C)])
  assert.ok(chapters.every((c) => isChapterFileName(c.fileName)))
  assert.equal(new Set(chapters.map((c) => c.fileName)).size, 3)
  assert.equal(row.sha256, audiobookParentSha256([sha(A), sha(B), sha(C)]))
  assert.equal(row.file_format, 'mp3') // the first chapter's format, a routing marker only
  assert.equal(JSON.parse(row.metadata_json).fileSizeBytes, A.length + B.length + C.length)
})
await check('files: every chapter is in the book folder, byte-identical, read-only; no marker; the folder holds exactly them', () => {
  const dir = path.join(books(), mainBook.id)
  const chapters = store.listAudioChapters(mainBook.id)
  assert.equal(path.dirname(mainBook.row.file_path), dir)
  assert.equal(path.basename(mainBook.row.file_path), chapters[0].fileName)
  assert.deepEqual(fs.readdirSync(dir).sort(), chapters.map((c) => c.fileName).sort())
  assert.ok(fs.readFileSync(path.join(dir, chapters[0].fileName)).equals(A))
  assert.ok(fs.readFileSync(path.join(dir, chapters[1].fileName)).equals(B))
  assert.ok(fs.readFileSync(path.join(dir, chapters[2].fileName)).equals(C))
  assert.equal(fs.statSync(path.join(dir, chapters[0].fileName)).mode & 0o222, 0)
})
await check('durations: read when the file says so (wav 1 s), never invented', () => {
  const chapters = store.listAudioChapters(mainBook.id)
  assert.ok(Math.abs(chapters[2].durationSeconds - 1) < 0.1, String(chapters[2].durationSeconds))
  for (const c of chapters) assert.ok(c.durationSeconds === null || c.durationSeconds > 0)
})
await check('the chosen cover image is stored; title/author conventions; scratch folder empty; progress reported in order', () => {
  assert.ok(mainBook.row.cover_path && fs.existsSync(mainBook.row.cover_path))
  assert.ok(fs.readFileSync(mainBook.row.cover_path).equals(PNG1))
  assert.deepEqual(scratchLeft(), [])
  const extracting = progressEvents.filter((p) => p.stage === 'extracting')
  assert.deepEqual(extracting.map((p) => p.done), [0, 1, 2, 3])
  assert.equal(progressEvents.at(-1).stage, 'saving')
})
await check('the user’s ZIP is byte-identical afterwards and the preview session is gone', () => {
  assert.ok(fs.readFileSync(mainZip).equals(mainBytes))
  assert.equal(mainSvc.sessionCount, 0)
})
await check('"No cover" chosen explicitly ⇒ no cover stored (a different selection of the same ZIP is a different book)', async () => {
  const p = await inspect(mainSvc, mainZip)
  const before = coverFiles().length
  const r = await mainSvc.confirm(p.sessionId, { trackIds: p.trackOrder.slice(0, 2), coverId: null })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(db.prepare('SELECT cover_path c FROM books WHERE id=?').get(r.bookId).c, null)
  assert.equal(coverFiles().length, before)
  assert.notEqual(r.bookId, mainBook.id)
  assert.equal(store.listAudioChapters(r.bookId).length, 2)
})

console.log('2. identity')
await check('the same tracks in the same order from a DIFFERENT zip ⇒ duplicate (existing book id), nothing created', async () => {
  const other = zipFile('Renamed copy.zip', [
    { name: '01 - a.mp3', data: A },
    { name: '02 - b.mp3', data: B },
    { name: '03 - c.wav', data: C },
    { name: 'folder.jpg', data: JPG },
  ])
  const svc = makeService()
  const p = await inspect(svc, other)
  const before = snapshotState()
  const r = await svc.confirm(p.sessionId, { trackIds: p.trackOrder, coverId: p.defaultCoverId })
  assert.equal(r.ok, false)
  assert.equal(r.errorCode, 'duplicate')
  assert.equal(r.bookId, mainBook.id)
  assert.deepEqual(snapshotState(), before)
  assert.deepEqual(scratchLeft(), [])
  assert.equal(svc.sessionCount, 1) // the session stays so the UI can offer the existing copy
})
await check('the same tracks in another ORDER ⇒ a different hash ⇒ a new book', async () => {
  const swapped = zipFile('Swapped.zip', [
    { name: '01 - b.mp3', data: B },
    { name: '02 - a.mp3', data: A },
    { name: '03 - c.wav', data: C },
  ])
  const svc = makeService()
  const p = await inspect(svc, swapped)
  const r = await svc.confirm(p.sessionId, { trackIds: p.trackOrder, coverId: null })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(db.prepare('SELECT sha256 s FROM books WHERE id=?').get(r.bookId).s, audiobookParentSha256([sha(B), sha(A), sha(C)]))
})

console.log('3. one selected track = the ordinary single-file import')
let soloId
await check('one track: a plain book (no chapter rows), the file’s own sha256, the ZIP cover is NOT applied, title from the track', async () => {
  const solo = zipFile('Solo pack.zip', [{ name: 'Only Track.mp3', data: mp3(40, 9) }, { name: 'cover.png', data: PNG1 }])
  const svc = makeService()
  const p = await inspect(svc, solo)
  assert.ok(p.defaultCoverId) // the preview offered a cover…
  const coversBefore = coverFiles()
  const r = await svc.confirm(p.sessionId, { trackIds: p.trackOrder, coverId: p.defaultCoverId })
  assert.equal(r.ok, true, JSON.stringify(r))
  soloId = r.bookId
  const row = db.prepare('SELECT * FROM books WHERE id=?').get(soloId)
  assert.equal(count('book_audio_chapters', `book_id='${soloId}'`), 0)
  assert.equal(row.sha256, sha(mp3(40, 9)))
  assert.equal(row.title, 'Only Track') // the single-file convention (file name), not "Solo pack"
  assert.equal(path.basename(row.file_path), 'Only Track.mp3')
  assert.equal(path.dirname(path.dirname(row.file_path)), books()) // {sandbox}/{uuid}/{file}
  assert.equal(row.cover_path, null) // …but the single-file importer does not use it
  assert.deepEqual(coverFiles(), coversBefore)
  assert.deepEqual(scratchLeft(), [])
})
await check('one track already in the library (any ZIP, any file name) ⇒ the existing single-file duplicate', async () => {
  const again = zipFile('Another.zip', [{ name: 'renamed.mp3', data: mp3(40, 9) }])
  const svc = makeService()
  const p = await inspect(svc, again)
  const before = snapshotState()
  const r = await svc.confirm(p.sessionId, { trackIds: p.trackOrder, coverId: null })
  assert.deepEqual([r.ok, r.errorCode, r.bookId], [false, 'duplicate', soloId])
  assert.deepEqual(snapshotState(), before)
})
await check('a track name that is unsafe on Windows is sanitised for the single-file path', () => {
  assert.equal(safeTrackFileName('a:b?c*.MP3'), 'a_b_c_.mp3')
  assert.equal(safeTrackFileName('CON.mp3'), '_CON.mp3')
  assert.equal(safeTrackFileName('Chapter 1. .mp3'), 'Chapter 1.mp3')
})

console.log('4. failure and cancellation leave nothing behind')
const failCase = async (name, deps, expect, selectCount = 3) => {
  await check(name, async () => {
    const zip = zipFile('fail.zip', [
      { name: '1.mp3', data: mp3(40, 21) },
      { name: '2.mp3', data: mp3(40, 22) },
      { name: '3.wav', data: wav(23) },
      { name: 'cover.png', data: PNG1 },
    ])
    const before = snapshotState()
    const zipBefore = fs.readFileSync(zip)
    const svc = makeService(deps.service ?? {})
    const p = await inspect(svc, zip)
    const run = deps.run ?? {}
    const r = await svc.confirm(p.sessionId, { trackIds: p.trackOrder.slice(0, selectCount), coverId: p.defaultCoverId }, typeof run === 'function' ? run() : run)
    await expect(r)
    assert.deepEqual(snapshotState(), before, 'no book, rows, folders or covers were left')
    assert.deepEqual(scratchLeft(), [])
    assert.ok(fs.readFileSync(zip).equals(zipBefore))
  })
}
let calls = 0
await failCase('a track that fails validation mid-way (names it) ⇒ invalid_track, full cleanup', {
  service: { readTrack: async (f, fmt) => { calls += 1; if (calls === 2) throw new Error('Not a playable MP3 file (found X / Y).'); return readTrackMetadata(f, fmt) } },
}, (r) => {
  assert.deepEqual([r.ok, r.errorCode], [false, 'invalid_track'])
  assert.match(r.errorMessage, /2\.mp3/)
})
await failCase('a database failure after the files and cover were placed ⇒ import_failed, folder + cover removed', {
  service: { store: { findBySha256: (h) => store.findBySha256(h), persistImportedAudiobook: () => { throw new Error('disk I/O error') } } },
}, (r) => assert.deepEqual([r.ok, r.errorCode], [false, 'import_failed']))
await failCase('a UNIQUE race at the commit (hash looked free, then taken) ⇒ duplicate, everything removed', {
  service: { store: { findBySha256: (() => { let first = true; return async (h) => { if (first) { first = false; return undefined } return { id: mainBook.id } } })(), persistImportedAudiobook: () => { throw new Error('UNIQUE constraint failed: books.sha256') } } },
}, (r) => assert.deepEqual([r.ok, r.errorCode, r.bookId], [false, 'duplicate', mainBook.id]))
await failCase('not enough free disk space ⇒ insufficient_space before anything is written', {
  service: { freeBytes: async () => 0 },
}, (r) => assert.deepEqual([r.ok, r.errorCode], [false, 'insufficient_space']))
await failCase('cancelled before it starts ⇒ cancelled', {
  run: () => { const c = new AbortController(); c.abort(); return { signal: c.signal } },
}, (r) => assert.deepEqual([r.ok, r.errorCode], [false, 'cancelled']))
{
  const c = new AbortController()
  let reads = 0
  await failCase('cancelled after the first track was extracted and validated ⇒ cancelled, scratch + nothing placed', {
    service: { readTrack: async (f, fmt) => { const m = await readTrackMetadata(f, fmt); reads += 1; if (reads === 1) c.abort(); return m } },
    run: { signal: c.signal },
  }, (r) => assert.deepEqual([r.ok, r.errorCode], [false, 'cancelled']))
}
{
  const c = new AbortController()
  let placed = 0
  await failCase('cancelled after the files were placed, before the commit ⇒ the half-built folder and cover are removed', {
    service: { coversDir: () => { c.abort(); return ensureCoversDir() }, store },
    run: { signal: c.signal },
  }, (r) => { placed += 1; assert.deepEqual([r.ok, r.errorCode], [false, 'cancelled']) })
  assert.equal(placed, 1)
}
await check('NULL / unknown durations never reject a playable track', async () => {
  const zip = zipFile('nodur.zip', [{ name: '1.mp3', data: mp3(40, 31) }, { name: '2.mp3', data: mp3(40, 32) }])
  const svc = makeService({ readTrack: async (f, fmt) => ({ ...(await readTrackMetadata(f, fmt)), durationSeconds: null }) })
  const p = await inspect(svc, zip)
  const r = await svc.confirm(p.sessionId, { trackIds: p.trackOrder, coverId: null })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(store.listAudioChapters(r.bookId).map((c) => c.durationSeconds), [null, null])
})

console.log('5. crash leftovers (.partial)')
await check('a marker folder with no book is removed; with a committed book it is kept (marker dropped); others untouched', async () => {
  const orphan = path.join(books(), 'orphan-uuid')
  const committed = path.join(books(), mainBook.id)
  const plain = path.join(books(), 'plain-uuid')
  fs.mkdirSync(orphan)
  fs.writeFileSync(path.join(orphan, '.partial'), '')
  fs.writeFileSync(path.join(orphan, '0000-aaaaaaaa.mp3'), 'x')
  fs.writeFileSync(path.join(committed, '.partial'), '') // marker removal "failed" after the commit
  fs.mkdirSync(plain)
  fs.writeFileSync(path.join(plain, 'book.epub'), 'x')
  const registered = new Set(store.bookDirectories())
  const removed = await sweepPartialBookDirs(books(), (dir) => registered.has(dir))
  assert.deepEqual(removed, [orphan])
  assert.ok(!fs.existsSync(orphan))
  assert.ok(fs.existsSync(committed) && !fs.existsSync(path.join(committed, '.partial')))
  assert.equal(store.listAudioChapters(mainBook.id).every((c) => fs.existsSync(path.join(committed, c.fileName))), true)
  assert.ok(fs.existsSync(path.join(plain, 'book.epub')))
  fs.rmSync(plain, { recursive: true })
})

console.log('6. library behaviour')
await check('getBook: chapterCount, file name = title; single-file books have neither', async () => {
  const dto = await invoke(LibraryChannels.getBook, mainBook.id)
  assert.equal(dto.chapterCount, 3)
  assert.equal(dto.fileName, 'My Story')
  const solo = await invoke(LibraryChannels.getBook, soloId)
  assert.equal(solo.chapterCount, undefined)
  assert.equal(solo.fileName, 'Only Track.mp3')
  const list = await invoke(LibraryChannels.listBooks)
  assert.equal(list.find((b) => b.id === mainBook.id).chapterCount, 3)
  assert.equal(list.find((b) => b.id === soloId).chapterCount, undefined)
})
await check('copy file path = the folder for a multi-chapter book, the file for a single-file book; relink is refused', async () => {
  await invoke(LibraryChannels.copyFilePath, mainBook.id)
  assert.equal(clipboard.text, path.join(books(), mainBook.id))
  await invoke(LibraryChannels.copyFilePath, soloId)
  assert.equal(path.basename(clipboard.text), 'Only Track.mp3')
  const r = await relinkBookToFile(mainBook.id, mainBook.row.file_path)
  assert.deepEqual([r.ok, r.errorCode], [false, 'wrong_file'])
})
await check('removeBook and deleteBookFile refuse a multi-chapter book (nothing changes)', async () => {
  const before = snapshotState()
  assert.deepEqual(await invoke(LibraryChannels.removeBook, mainBook.id), { ok: false })
  assert.deepEqual(await invoke(LibraryChannels.deleteBookFile, mainBook.id), { ok: false })
  assert.deepEqual(snapshotState(), before)
})
await check('removeAudiobook: the record is KEPT when the folder cannot be removed (refused path), then retry works', async () => {
  const original = db.prepare('SELECT file_path f FROM books WHERE id=?').get(mainBook.id).f
  db.prepare('UPDATE books SET file_path=? WHERE id=?').run(path.join(work, 'elsewhere', 'x', path.basename(original)), mainBook.id)
  const before = snapshotState()
  assert.deepEqual(await invoke(LibraryChannels.removeAudiobook, mainBook.id), { ok: false })
  assert.deepEqual(snapshotState(), before)
  assert.equal(count('books', `id='${mainBook.id}'`), 1)
  db.prepare('UPDATE books SET file_path=? WHERE id=?').run(original, mainBook.id)
})
await check('removeAudiobook: folder, chapter rows, cover and record go; the ZIP is untouched; a single-file id is refused', async () => {
  const cover = db.prepare('SELECT cover_path c FROM books WHERE id=?').get(mainBook.id).c
  // the audiobook has Notes (multi-track Notes live in its own row) — removing it must remove them too
  const { getAudioStore } = await import('../../electron/persistence/sqlite-audio-store.ts')
  const trackId = db.prepare('SELECT id FROM book_audio_chapters WHERE book_id=? ORDER BY position LIMIT 1').get(mainBook.id).id
  assert.equal(getAudioStore().saveBookmarks(mainBook.id, [{ id: 'rm-note', label: 'x', positionSeconds: 4, createdAt: '2026-01-01T00:00:00Z', trackId }]), true)
  assert.equal(getAudioStore().getBookmarks(mainBook.id).length, 1)
  assert.deepEqual(await invoke(LibraryChannels.removeAudiobook, soloId), { ok: false }) // not a multi-chapter book
  assert.deepEqual(await invoke(LibraryChannels.removeAudiobook, mainBook.id), { ok: true })
  assert.ok(!fs.existsSync(path.join(books(), mainBook.id)))
  assert.equal(count('book_audio_chapters', `book_id='${mainBook.id}'`), 0)
  assert.equal(count('books', `id='${mainBook.id}'`), 0)
  assert.ok(!fs.existsSync(cover))
  assert.ok(fs.readFileSync(mainZip).equals(mainBytes))
  // no Notes are left behind, and importing the same ZIP again starts with none
  assert.deepEqual(getAudioStore().getBookmarks(mainBook.id), [])
  assert.equal(getAudioStore().saveBookmarks(mainBook.id, []), false, 'the removed book cannot receive Notes')
  const svc = makeService()
  const p = await inspect(svc, mainZip)
  const reimported = await svc.confirm(p.sessionId, { trackIds: p.trackOrder, coverId: null })
  assert.equal(reimported.ok, true, JSON.stringify(reimported))
  assert.deepEqual(getAudioStore().getBookmarks(reimported.bookId), [], 're-import starts with no Notes')
  assert.deepEqual(await invoke(LibraryChannels.removeAudiobook, reimported.bookId), { ok: true })
})
await check('single-file remove / delete are unchanged: removeBook keeps the file, deleteBookFile deletes the folder', async () => {
  const solo = db.prepare('SELECT file_path f FROM books WHERE id=?').get(soloId).f
  assert.deepEqual(await invoke(LibraryChannels.removeBook, soloId), { ok: true })
  assert.equal(count('books', `id='${soloId}'`), 0)
  assert.ok(fs.existsSync(solo), 'the file is kept, exactly as before')
  // import it again, then delete the file
  const again = zipFile('again.zip', [{ name: 'Only Track.mp3', data: mp3(40, 9) }])
  const svc = makeService()
  const p = await inspect(svc, again)
  const r = await svc.confirm(p.sessionId, { trackIds: p.trackOrder, coverId: null })
  assert.equal(r.ok, true, JSON.stringify(r))
  const file = db.prepare('SELECT file_path f FROM books WHERE id=?').get(r.bookId).f
  assert.deepEqual(await invoke(LibraryChannels.deleteBookFile, r.bookId), { ok: true })
  assert.ok(!fs.existsSync(path.dirname(file)))
})

console.log('7. the ordinary "Add file" dialog')
{
  const { dialog, handlers } = await import('../pdf-annotations/electron-stub.mjs')
  const config = await import('@reading-book/config')
  const { ImportChannels, ZipImportChannels } = await import('../../electron/ipc/channels.ts')
  const { registerImportIpc } = await import('../../electron/ipc/import.ipc.ts')
  const { registerZipImportIpc } = await import('../../electron/ipc/zip-import.ipc.ts')
  const events = []
  const sender = { isDestroyed: () => false, send: (channel, payload) => events.push([channel, payload]) }
  const call = (channel, ...args) => handlers.get(channel)({ sender }, ...args)
  let seen
  let picks = []
  dialog.showOpenDialog = async (a, b) => {
    seen = b ?? a
    return { canceled: false, filePaths: picks }
  }
  const zip = zipFile('Picked in Add file.zip', [
    { name: '01.mp3', data: mp3(40, 41) },
    { name: '02.mp3', data: mp3(40, 42) },
    { name: 'cover.png', data: PNG1 },
  ])
  const extensions = (name) => seen.filters.find((f) => f.name === name)?.extensions
  registerImportIpc()

  config.features.audiobookZipImportEnabled = false
  await check('feature OFF: the dialog does not offer .zip, and a ZIP is refused exactly as before', async () => {
    picks = [zip]
    const r = await call(ImportChannels.fromFile)
    assert.equal(extensions('Documents').includes('zip'), false)
    assert.equal(seen.filters.some((f) => f.name === 'Audiobook ZIP'), false)
    assert.equal(r.ok, false)
    assert.notEqual(r.errorCode, 'audiobook_zip')
    assert.equal(handlers.has(ZipImportChannels.inspectPicked), false, 'no zipImport handler is registered')
  })

  config.features.audiobookZipImportEnabled = true
  registerZipImportIpc()
  await check('feature ON: .zip is offered (in "Documents" and as "Audiobook ZIP"); the other filters are unchanged', async () => {
    picks = []
    await call(ImportChannels.fromFile)
    assert.ok(extensions('Documents').includes('zip') && extensions('Documents').includes('epub') && extensions('Documents').includes('mp3'))
    assert.deepEqual(extensions('Audiobook ZIP'), ['zip'])
    assert.ok(extensions('EPUB') && !extensions('EPUB').includes('zip'))
  })
  let preview
  await check('a picked ZIP is not imported by Add file: it answers audiobook_zip (no path, no book, no progress overlay) and the preview opens from Main\'s held path', async () => {
    picks = [zip]
    events.length = 0
    const before = count('books')
    const r = await call(ImportChannels.fromFile)
    assert.deepEqual([r.ok, r.errorCode, r.bookId], [false, 'audiobook_zip', null])
    assert.ok(!JSON.stringify(r).includes(zip) && !JSON.stringify(r).includes('Picked in Add file'), 'the path never reaches the renderer')
    assert.equal(events.some(([c]) => c === ImportChannels.progress), false, 'no import progress overlay for a ZIP')
    assert.equal(count('books'), before)
    const inspected = await call(ZipImportChannels.inspectPicked)
    assert.equal(inspected.ok, true, JSON.stringify(inspected))
    preview = inspected.preview
    assert.equal(preview.trackOrder.length, 2)
    assert.deepEqual(events.find(([c]) => c === ZipImportChannels.inspecting)?.[1], { archiveName: 'Picked in Add file.zip' })
    assert.ok(!JSON.stringify(inspected).includes(path.dirname(zip)), 'the preview carries no file-system path')
  })
  await check('the held path is used once: asking again is refused, not answered with the old ZIP', async () => {
    const again = await call(ZipImportChannels.inspectPicked)
    assert.deepEqual([again.ok, again.errorCode], [false, 'unreadable'])
  })
  await check('the preview imports through the same confirm path as the dedicated entry', async () => {
    const r = await call(ZipImportChannels.confirm, { sessionId: preview.sessionId, selection: { trackIds: preview.trackOrder, coverId: preview.defaultCoverId } })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(store.listAudioChapters(r.bookId).length, 2)
    assert.equal(db.prepare('SELECT title t FROM books WHERE id=?').get(r.bookId).t, 'Picked in Add file')
  })
  await check('ordinary files are untouched by the new branch: picking an mp3 still imports it as before', async () => {
    const file = path.join(work, 'ordinary-track.mp3')
    fs.writeFileSync(file, mp3(40, 77))
    picks = [file]
    const r = await call(ImportChannels.fromFile)
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(db.prepare('SELECT file_path f FROM books WHERE id=?').get(r.bookId).f, file)
    assert.equal(count('book_audio_chapters', `book_id='${r.bookId}'`), 0)
    picks = [file]
    const dup = await call(ImportChannels.fromFile)
    assert.deepEqual([dup.ok, dup.errorCode], [false, 'duplicate'])
  })
  config.features.audiobookZipImportEnabled = false
}

fs.rmSync(path.dirname(userData), { recursive: true, force: true })
fs.rmSync(work, { recursive: true, force: true })
console.log(`\n${passed} checks passed`)

/**
 * Integration checks for the audiobook (MP3) foundation on the Main side — no Electron window, no
 * user data: every path is under os.tmpdir(). Uses the real code:
 *   - format registry (`@reading-book/config`) + `assertSupportedExtension`
 *   - the MP3 importer (`music-metadata`) and the library store on the migrated schema (node:sqlite)
 *   - `createAudioStreamHandler` (the `rb-audio` protocol's logic) against real files, with the real
 *     `resolveBookFile` path validation
 *   - audio progress persistence in `SqliteOverlayStore` + the `overlay:*AudioProgress` IPC handlers
 *
 *   1. formats    extension → format, unsupported extensions, MIME owned by the app
 *   2. import     tags + cover, no tags, garbage / empty / damaged files, duplicate detection
 *   3. stream     200 / 206 / 416, headers, bytes identical, HEAD, bad method, ids, traversal, symlink
 *   4. large      a 512 MB file is streamed without being buffered (RSS, bytes actually read)
 *   5. progress   json_patch merge keeps other state, audio-only, validation, restore rules
 *   6. isolation  non-audio books untouched; audio never enters chunking / open-book-content reads
 *
 * Synthetic MP3 frames are used for structure only: this spike proves the plumbing, NOT codec
 * playback (that was measured separately with a real MP3 in the PoC report). If
 * READMATE_AUDIO_SAMPLE points at a real .mp3 it is imported and streamed too (never copied into the repo).
 *
 * Run: npm run spike:audio:main   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  Book,
  DocumentFormat,
  audioMimeForFormat,
  parseAudioProgress,
  parseReadingState,
  resolveRestorePosition,
} from '@reading-book/book-reader-sdk'
import { invoke } from '../pdf-annotations/electron-stub.mjs'
import { getDatabase } from '../pdf-annotations/db-stub.mjs'

const { OverlayChannels } = await import('../../electron/ipc/channels.ts')
const { registerOverlayIpc } = await import('../../electron/ipc/overlay.ipc.ts')
const { getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')
const { getLibraryStore } = await import('../../electron/persistence/sqlite-library-store.ts')
const { resolveBookFile } = await import('../../electron/files/sandbox.ts')
const { createMp3Adapter } = await import('../../electron/adapters/mp3.adapter.ts')
const { createAudioStreamHandler, parseAudioRequestUrl } = await import('../../electron/audio/audio-stream-handler.ts')
const { assertSupportedExtension, UnsupportedFormatError } = await import('../../electron/files/format-guard.ts')
const { isChunkableFormat } = await import('../../electron/chunking/extract-book-text.ts')
const { openBookContent } = await import('../../electron/files/open-book-content.ts')
const config = await import('@reading-book/config')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const sha = (data) => createHash('sha256').update(data).digest('hex')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-audio-'))
const coversDir = path.join(tmp, 'covers')
fs.mkdirSync(coversDir)

// ---- synthetic MP3 builder: MPEG-1 Layer III 128 kbps / 44.1 kHz frames of digital silence ----
const FRAME = (() => {
  const f = Buffer.alloc(417)
  f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x00
  return f
})()
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64')
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
const synchsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
const frame = (id, body) => Buffer.concat([Buffer.from(id), u32(body.length), Buffer.from([0, 0]), body])
const text = (s) => Buffer.concat([Buffer.from([0]), Buffer.from(s, 'latin1')])
function id3(frames) {
  const body = Buffer.concat(frames)
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), synchsafe(body.length), body])
}
function mp3({ frames = 115, tags = false, cover = false } = {}) {
  const audio = Buffer.concat(Array(frames).fill(FRAME))
  if (!tags) return audio
  const fs_ = [frame('TIT2', text('Spike Title')), frame('TPE1', text('Spike Artist')), frame('TALB', text('Spike Album'))]
  if (cover) fs_.push(frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0'), Buffer.from([3]), Buffer.from('\0'), PNG1])))
  return Buffer.concat([id3(fs_), audio])
}
function write(name, bytes) {
  const file = path.join(tmp, name)
  fs.writeFileSync(file, bytes)
  return file
}

// ---- 1. formats ----
console.log('1. formats')
await check('.mp3 maps to the mp3 format (case-insensitive); the app owns the MIME', () => {
  assert.equal(config.resolveFormatFromExtension('.mp3'), DocumentFormat.Mp3)
  assert.equal(config.resolveFormatFromExtension('.MP3'), DocumentFormat.Mp3)
  assert.equal(config.isSupportedExtension('mp3'), true)
  assert.ok(config.SUPPORTED_EXTENSIONS.includes('.mp3'))
  assert.equal(audioMimeForFormat('mp3'), 'audio/mpeg')
  assert.equal(assertSupportedExtension(path.join(tmp, 'x.MP3')), DocumentFormat.Mp3)
})
await check('existing formats keep their mapping', () => {
  for (const [ext, fmt] of [['.epub', 'epub'], ['.pdf', 'pdf'], ['.txt', 'txt'], ['.md', 'md']])
    assert.equal(config.resolveFormatFromExtension(ext), fmt)
})
await check('unverified audio extensions and ZIP are rejected by the import guard', () => {
  for (const ext of ['.m4a', '.m4b', '.aac', '.wav', '.flac', '.ogg', '.opus', '.aiff', '.aif', '.zip', '.mp3.exe', ''])
    assert.throws(() => assertSupportedExtension(path.join(tmp, `book${ext}`)), UnsupportedFormatError, ext)
})

// ---- 2. import ----
console.log('2. import (MP3 importer + library store)')
const adapter = createMp3Adapter({ coversDir: () => coversDir })
const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
// node:sqlite has no better-sqlite3 `.transaction()`; the library store uses it.
db.transaction = (fn) => () => {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
const library = getLibraryStore()

await check('canHandle only .mp3', () => {
  assert.equal(adapter.canHandle('a/b/c.mp3'), true)
  assert.equal(adapter.canHandle('a/b/c.MP3'), true)
  assert.equal(adapter.canHandle('a/b/c.m4a'), false)
  assert.equal(adapter.canHandle('a/b/c.txt'), false)
})

let tagged
await check('tags + embedded cover → title / author / album / cover file; source file untouched', async () => {
  const bytes = mp3({ tags: true, cover: true })
  const file = write('tagged.mp3', bytes)
  const mtime = fs.statSync(file).mtimeMs
  tagged = await adapter.import(file)
  assert.equal(tagged.format, 'mp3')
  assert.equal(tagged.title, 'Spike Title')
  assert.deepEqual(tagged.authorNames, ['Spike Artist'])
  assert.equal(tagged.description, 'Album: Spike Album')
  assert.equal(tagged.sha256, sha(bytes))
  assert.equal(tagged.fileSizeBytes, bytes.length)
  assert.ok(tagged.coverPath?.startsWith(coversDir), 'cover written under the covers dir')
  assert.deepEqual(fs.readFileSync(tagged.coverPath), PNG1)
  assert.equal(sha(fs.readFileSync(file)), sha(bytes))
  assert.equal(fs.statSync(file).mtimeMs, mtime)
})

await check('no tags → title from the file name, no cover, no author', async () => {
  const r = await adapter.import(write('Plain Chapter One.mp3', mp3()))
  assert.equal(r.title, 'Plain Chapter One')
  assert.equal(r.coverPath, undefined)
  assert.equal(r.authorNames, undefined)
})

await check('not audio (text renamed .mp3), empty file and a damaged ID3 header are rejected, not imported', async () => {
  await assert.rejects(adapter.import(write('garbage.mp3', Buffer.from('this is not audio '.repeat(40)))), /Not a readable MP3/)
  await assert.rejects(adapter.import(write('empty.mp3', Buffer.alloc(0))))
  const damaged = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), synchsafe(900000), Buffer.from('xx'), mp3({ frames: 20 })])
  await assert.rejects(adapter.import(write('damaged.mp3', damaged)))
})

await check('missing file surfaces ENOENT (the import pipeline maps it to missing_file)', async () => {
  await assert.rejects(adapter.import(path.join(tmp, 'nope.mp3')), (e) => e?.code === 'ENOENT')
})

await check('a cut-off file still imports (documented: truncation is not detected)', async () => {
  const r = await adapter.import(write('cut.mp3', mp3({ frames: 60 }).subarray(0, 417 * 30 + 200)))
  assert.equal(r.format, 'mp3')
})

function addAudioBook(importResult, id) {
  const now = '2026-10-21T00:00:00.000Z'
  const book = new Book({
    id,
    title: importResult.title,
    filePath: importResult.filePath,
    format: importResult.format,
    coverPath: importResult.coverPath,
    sha256: importResult.sha256,
    fileSizeBytes: importResult.fileSizeBytes,
    description: importResult.description,
    addedAt: now,
    updatedAt: now,
  })
  library.persistImportedBook(book, importResult.authorNames ?? [], importResult.genreNames ?? [])
  return book
}

await check('the books table accepts an mp3 row (migration 026) and rejects an unknown format', async () => {
  addAudioBook(tagged, 'a-tagged')
  const stored = await library.findById('a-tagged')
  assert.equal(stored.format, 'mp3')
  assert.equal(stored.title, 'Spike Title')
  assert.throws(() => db.prepare(`UPDATE books SET file_format = 'xyz' WHERE id = 'a-tagged'`).run(), /CHECK/)
})

await check('duplicate detection: the same bytes (same SHA-256) cannot be added twice', async () => {
  const again = await adapter.import(write('tagged-copy.mp3', mp3({ tags: true, cover: true })))
  assert.equal(again.sha256, tagged.sha256)
  assert.equal((await library.findBySha256(again.sha256))?.id, 'a-tagged')
  assert.throws(() => addAudioBook(again, 'a-dup'), /UNIQUE/)
})

// ---- books used by the stream tests ----
const BYTES = mp3({ frames: 400 }) // ≈ 167 KB
const fileMain = write('main.mp3', BYTES)
{
  const r = await adapter.import(fileMain)
  addAudioBook(r, 'a-main')
}
// a non-audio book that has a perfectly valid file: must never be served by rb-audio
const txtFile = write('note.txt', 'plain text book')
db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES ('t-text', 'Text', ?, 'txt', ?, 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
).run(txtFile, sha('plain text book'))
// an audio book whose file is gone
{
  const gone = write('gone.mp3', mp3({ frames: 30 }))
  const r = await adapter.import(gone)
  addAudioBook(r, 'a-gone')
  fs.rmSync(gone)
}
// a book row pointing at a file that is not an .mp3 (tampered path) — resolveBookFile must refuse it
db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES ('a-wrongext', 'Wrong ext', ?, 'mp3', 'wrongext-sha', 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
).run(txtFile)
// symlink named .mp3 pointing at a text file
let linkOk = true
try {
  fs.symlinkSync(txtFile, path.join(tmp, 'link.mp3'), 'file')
  db.prepare(
    `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
     VALUES ('a-link', 'Link', ?, 'mp3', 'link-sha', 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run(path.join(tmp, 'link.mp3'))
} catch (e) {
  linkOk = false
  console.log(`  (symlink not created: ${e.code} — symlink check skipped)`)
}

const opened = []
const handler = createAudioStreamHandler(
  async (bookId) => {
    const book = await library.findById(bookId)
    if (!book || book.format !== 'mp3') return { ok: false }
    const file = await resolveBookFile(book)
    return file.ok ? { ok: true, path: file.path, format: book.format } : { ok: false }
  },
  { onStreamOpened: (info, closed) => opened.push({ info, closed }) },
)
const req = (id, headers = {}, init = {}) => new Request(`rb-audio://local/${id}`, { headers, ...init })
const bodyOf = async (res) => Buffer.from(await res.arrayBuffer())

// ---- 3. stream ----
console.log('3. stream (rb-audio logic, real files, real path validation)')
await check('GET → 200, whole file, app-decided headers', async () => {
  const res = await handler(req('a-main'))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'audio/mpeg')
  assert.equal(res.headers.get('accept-ranges'), 'bytes')
  assert.equal(res.headers.get('content-length'), String(BYTES.length))
  assert.equal(res.headers.get('content-range'), null)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(sha(await bodyOf(res)), sha(BYTES))
})

const N = BYTES.length
for (const [label, range, s, e] of [
  ['0-99', 'bytes=0-99', 0, 99],
  ['mid 50000-50999', 'bytes=50000-50999', 50000, 50999],
  ['open-ended 100000-', 'bytes=100000-', 100000, N - 1],
  ['suffix -500', 'bytes=-500', N - 500, N - 1],
  ['single byte 0-0', 'bytes=0-0', 0, 0],
  ['end beyond EOF (clamped)', 'bytes=0-999999999', 0, N - 1],
  ['last byte', `bytes=${N - 1}-${N - 1}`, N - 1, N - 1],
]) {
  await check(`Range ${label} → 206, exact Content-Range / Content-Length, identical bytes`, async () => {
    const res = await handler(req('a-main', { Range: range }))
    assert.equal(res.status, 206)
    assert.equal(res.headers.get('content-range'), `bytes ${s}-${e}/${N}`)
    assert.equal(res.headers.get('content-length'), String(e - s + 1))
    assert.equal(res.headers.get('accept-ranges'), 'bytes')
    assert.equal(res.headers.get('content-type'), 'audio/mpeg')
    assert.equal(sha(await bodyOf(res)), sha(BYTES.subarray(s, e + 1)))
  })
}

await check('Range starting at / after EOF → 416 with Content-Range: bytes */size', async () => {
  for (const r of [`bytes=${N}-`, `bytes=${N + 100}-${N + 200}`, 'bytes=99999999999999999999-', 'bytes=-0']) {
    const res = await handler(req('a-main', { Range: r }))
    assert.equal(res.status, 416, r)
    assert.equal(res.headers.get('content-range'), `bytes */${N}`, r)
  }
})

await check('malformed / multi / inverted Range is ignored → 200 whole file (RFC 9110)', async () => {
  for (const r of ['bytes=abc', 'bytes=0-1,5-6', 'bytes=200-100', 'items=0-5', 'bytes=-']) {
    const res = await handler(req('a-main', { Range: r }))
    assert.equal(res.status, 200, r)
    assert.equal((await bodyOf(res)).length, N, r)
  }
})

await check('HEAD → headers only, no body; other methods → 405', async () => {
  const head = await handler(req('a-main', { Range: 'bytes=10-19' }, { method: 'HEAD' }))
  assert.equal(head.status, 206)
  assert.equal(head.headers.get('content-length'), '10')
  assert.equal((await bodyOf(head)).length, 0)
  const post = await handler(req('a-main', {}, { method: 'POST', body: 'x' }))
  assert.equal(post.status, 405)
})

await check('empty file: 200 with length 0; any Range → 416', async () => {
  const emptyFile = write('empty-served.mp3', Buffer.alloc(0))
  db.prepare(
    `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
     VALUES ('a-empty', 'Empty', ?, 'mp3', 'empty-sha', 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run(emptyFile)
  const res = await handler(req('a-empty'))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-length'), '0')
  assert.equal((await handler(req('a-empty', { Range: 'bytes=0-' }))).status, 416)
})

await check('unknown id, missing file, non-audio book, tampered extension → 404 (nothing leaked)', async () => {
  for (const id of ['nope', 'a-gone', 't-text', 'a-wrongext']) {
    const res = await handler(req(id))
    assert.equal(res.status, 404, id)
    assert.equal(await res.text(), 'Not found')
  }
})

if (linkOk) {
  await check('symlink named .mp3 that resolves to a non-mp3 file → 404', async () => {
    assert.equal((await handler(req('a-link'))).status, 404)
  })
}

await check('traversal / absolute-path / encoded / foreign-host URLs are never turned into a path', async () => {
  const urls = [
    'rb-audio://local/../../secret',
    'rb-audio://local/%2e%2e%2fsecret',
    'rb-audio://local/%2f..%2f..%2fsecret.mp3',
    'rb-audio://local/C%3A%5CWindows%5Cwin.ini',
    'rb-audio://local/%2Fetc%2Fpasswd',
    'rb-audio://local/%252e%252e%252fsecret',
    'rb-audio://local/a-main%00',
    'rb-audio://local/a-main/..%2fa-gone',
    'rb-audio://other/a-main',
    'rb-audio://local/',
    'rb-audio://local',
  ]
  for (const u of urls) {
    const res = await handler(new Request(u))
    assert.equal(res.status, 404, u)
  }
  assert.equal(parseAudioRequestUrl('rb-audio://local/a-main'), 'a-main')
  assert.equal(parseAudioRequestUrl('rb-audio://local/a%20b'), 'a b')
  assert.equal(parseAudioRequestUrl('rb-audio://local/a/b'), null)
  assert.equal(parseAudioRequestUrl('rb-audio://local/a%5Cb'), null)
  assert.equal(parseAudioRequestUrl('not a url'), null)
  // a query string does not select another file
  const res = await handler(new Request('rb-audio://local/a-main?path=C:%5CWindows%5Cwin.ini'))
  assert.equal(res.status, 200)
  assert.equal(sha(await bodyOf(res)), sha(BYTES))
})

await check('cancelling a response closes the file stream', async () => {
  const before = opened.length
  const res = await handler(req('a-main'))
  const reader = res.body.getReader()
  await reader.read()
  await reader.cancel()
  const { closed } = opened[before]
  const { bytesRead } = await closed
  assert.ok(bytesRead <= N)
})

await check('a file deleted after the lookup yields 404, not a crash', async () => {
  const f = write('vanishing.mp3', mp3({ frames: 20 }))
  const flaky = createAudioStreamHandler(async () => ({ ok: true, path: f, format: 'mp3' }))
  fs.rmSync(f)
  assert.equal((await flaky(req('x'))).status, 404)
})

await check('only formats with a registered MIME are served', async () => {
  const f = write('plain.bin', 'x')
  const h = createAudioStreamHandler(async () => ({ ok: true, path: f, format: 'epub' }))
  assert.equal((await h(req('x'))).status, 404)
})

// ---- 4. large file ----
console.log('4. large file (512 MB, sparse — streamed, never buffered)')
await check('a ranged read in the middle of a 512 MB file reads only that range', async () => {
  const big = path.join(tmp, 'big.mp3')
  const SIZE = 512 * 1024 * 1024
  fs.writeFileSync(big, mp3({ frames: 50 })) // real MP3 header at the start
  fs.truncateSync(big, SIZE)
  db.prepare(
    `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
     VALUES ('a-big', 'Big', ?, 'mp3', 'big-sha', 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run(big)
  const rss0 = process.memoryUsage().rss
  const start = 300_000_000
  const res = await handler(req('a-big', { Range: `bytes=${start}-${start + 999}` }))
  assert.equal(res.status, 206)
  assert.equal(res.headers.get('content-range'), `bytes ${start}-${start + 999}/${SIZE}`)
  assert.equal(res.headers.get('content-length'), '1000')
  assert.equal((await bodyOf(res)).length, 1000)
  const grown = process.memoryUsage().rss - rss0
  assert.ok(grown < 64 * 1024 * 1024, `RSS grew ${(grown / 1e6).toFixed(1)} MB`)
  console.log(`      (RSS delta ${(grown / 1e6).toFixed(1)} MB for a 1000-byte range of a 512 MB file)`)
})

await check('a full GET of the 512 MB file, cancelled after the first chunks, reads a tiny fraction', async () => {
  const before = opened.length
  const rss0 = process.memoryUsage().rss
  const res = await handler(req('a-big'))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-length'), String(512 * 1024 * 1024))
  const reader = res.body.getReader()
  let got = 0
  for (let i = 0; i < 4; i++) got += (await reader.read()).value.byteLength
  await reader.cancel()
  const { bytesRead } = await opened[before].closed
  const grown = process.memoryUsage().rss - rss0
  assert.ok(bytesRead < 8 * 1024 * 1024, `read ${bytesRead} bytes before the stream closed`)
  assert.ok(grown < 64 * 1024 * 1024, `RSS grew ${(grown / 1e6).toFixed(1)} MB`)
  console.log(`      (consumed ${got} B, file stream read ${bytesRead} B of 536870912, RSS delta ${(grown / 1e6).toFixed(1)} MB)`)
})
fs.rmSync(path.join(tmp, 'big.mp3'), { force: true })

// ---- 5. progress ----
console.log('5. playback progress (reading_state_json.audioProgress)')
registerOverlayIpc()
const overlays = getOverlayStore()
const stateOf = (id) => parseReadingState(db.prepare('SELECT reading_state_json AS j FROM books WHERE id = ?').get(id).j)
const rawState = (id) => db.prepare('SELECT reading_state_json AS j FROM books WHERE id = ?').get(id).j

await check('saving progress merges: location / typography / unknown keys survive', async () => {
  db.prepare(`UPDATE books SET reading_state_json = ? WHERE id = 'a-main'`).run(
    JSON.stringify({ lastReadLocation: 'keep-me', fontSize: 21, updatedAt: '2026-02-02T00:00:00.000Z', futureKey: { a: 1 } }),
  )
  assert.equal(await overlays.saveAudioProgress('a-main', { positionSeconds: 42.5, durationSeconds: 170, playbackRate: 1.25 }), true)
  const s = stateOf('a-main')
  assert.equal(s.lastReadLocation, 'keep-me')
  assert.equal(s.fontSize, 21)
  assert.equal(s.updatedAt, '2026-02-02T00:00:00.000Z')
  assert.deepEqual(s.futureKey, { a: 1 })
  assert.equal(s.percent, 25)
  const p = parseAudioProgress(s)
  assert.equal(p.positionSeconds, 42.5)
  assert.equal(p.durationSeconds, 170)
  assert.equal(p.playbackRate, 1.25)
  assert.match(p.updatedAt, /^\d{4}-\d\d-\d\dT/)
})

await check('a later save replaces only the audio keys; an unknown duration is not stored', async () => {
  await overlays.saveAudioProgress('a-main', { positionSeconds: 60, playbackRate: 1 })
  const p = parseAudioProgress(stateOf('a-main'))
  assert.equal(p.positionSeconds, 60)
  assert.equal(p.playbackRate, 1)
  assert.equal(p.durationSeconds, 170, 'merge patch keeps the previously known duration')
  assert.equal(stateOf('a-main').fontSize, 21)
})

await check('restore: getAudioProgress + restore rules (resume, finished → restart)', async () => {
  const p = await overlays.getAudioProgress('a-main')
  assert.equal(p.positionSeconds, 60)
  assert.equal(resolveRestorePosition(p.positionSeconds, 170), 60)
  assert.equal(resolveRestorePosition(169, 170), 0)
  assert.equal(await overlays.getAudioProgress('a-tagged'), undefined, 'nothing saved yet')
})

await check('settings-only session saves (json_patch) do not drop audioProgress', async () => {
  await overlays.saveSessionPreferences({ bookId: 'a-main', percent: 0, fontSize: 19, updatedAt: '2026-03-03T00:00:00.000Z' })
  assert.equal(stateOf('a-main').fontSize, 19)
  assert.equal(parseAudioProgress(stateOf('a-main')).positionSeconds, 60)
})

await check('audio progress is audio-only: a text book id writes nothing and reads nothing', async () => {
  const before = rawState('t-text')
  assert.equal(await overlays.saveAudioProgress('t-text', { positionSeconds: 5, playbackRate: 1 }), false)
  assert.equal(rawState('t-text'), before)
  assert.equal(await overlays.getAudioProgress('t-text'), undefined)
  assert.equal(await overlays.saveAudioProgress('', { positionSeconds: 5, playbackRate: 1 }), false)
  assert.equal(await overlays.saveAudioProgress('no-such-book', { positionSeconds: 5, playbackRate: 1 }), false)
})

await check('IPC validation: bad payloads are refused and change nothing', async () => {
  const before = rawState('a-main')
  const bad = [
    null, undefined, 'x', 5, [], {},
    { bookId: 'a-main' },
    { bookId: 'a-main', positionSeconds: -1, playbackRate: 1 },
    { bookId: 'a-main', positionSeconds: NaN, playbackRate: 1 },
    { bookId: 'a-main', positionSeconds: Infinity, playbackRate: 1 },
    { bookId: 'a-main', positionSeconds: 1e12, playbackRate: 1 },
    { bookId: 'a-main', positionSeconds: 5, playbackRate: 'fast' },
    { bookId: '', positionSeconds: 5, playbackRate: 1 },
    { bookId: 7, positionSeconds: 5, playbackRate: 1 },
  ]
  for (const b of bad) assert.deepEqual(await invoke(OverlayChannels.saveAudioProgress, b), { ok: false })
  assert.equal(rawState('a-main'), before)
  assert.deepEqual(await invoke(OverlayChannels.saveAudioProgress, { bookId: 'a-main', positionSeconds: 70, durationSeconds: 170, playbackRate: 99 }), { ok: true })
  assert.equal(parseAudioProgress(stateOf('a-main')).playbackRate, 4, 'rate clamped')
  assert.equal(await invoke(OverlayChannels.getAudioProgress, ''), null)
  assert.equal((await invoke(OverlayChannels.getAudioProgress, 'a-main')).positionSeconds, 70)
  assert.equal(await invoke(OverlayChannels.getAudioProgress, 't-text'), null)
})

// ---- 6. isolation ----
console.log('6. isolation from the text pipeline')
await check('audio is not chunkable (no text extraction, FTS, word count)', () => {
  assert.equal(isChunkableFormat('mp3'), false)
  for (const f of ['epub', 'pdf', 'txt', 'md']) assert.equal(isChunkableFormat(f), true)
})
await check('openBookContent never reads an audio file into memory (empty buffer) but still validates the path', async () => {
  const ok = await openBookContent('a-main')
  assert.equal(ok.ok, true)
  assert.equal(ok.format, 'mp3')
  assert.equal(ok.byteLength, 0)
  const gone = await openBookContent('a-gone')
  assert.equal(gone.ok, false)
  assert.equal(gone.errorCode, 'missing_file')
  const wrong = await openBookContent('a-wrongext')
  assert.equal(wrong.ok, false)
  assert.equal(wrong.errorCode, 'path_denied')
  const text = await openBookContent('t-text')
  assert.equal(text.format, 'txt') // unchanged behaviour for text books
})

// ---- optional: a real MP3 ----
const sample = process.env.READMATE_AUDIO_SAMPLE
if (sample && fs.existsSync(sample)) {
  console.log('7. real sample (READMATE_AUDIO_SAMPLE)')
  await check('real MP3: imports, streams a mid-file range and a suffix range byte-for-byte', async () => {
    const r = await adapter.import(sample)
    assert.equal(r.format, 'mp3')
    const book = addAudioBook(r, 'a-real')
    const real = fs.readFileSync(sample)
    const mid = Math.floor(real.length / 2)
    const res = await handler(req(book.id, { Range: `bytes=${mid}-${mid + 4095}` }))
    assert.equal(res.status, 206)
    assert.equal(sha(await bodyOf(res)), sha(real.subarray(mid, mid + 4096)))
    const tail = await handler(req(book.id, { Range: 'bytes=-1000' }))
    assert.equal(tail.status, 206)
    assert.equal(sha(await bodyOf(tail)), sha(real.subarray(real.length - 1000)))
    console.log(`      (title "${r.title}", ${real.length} B)`)
  })
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} checks passed`)

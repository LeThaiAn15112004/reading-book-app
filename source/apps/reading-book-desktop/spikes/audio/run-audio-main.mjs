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
 *   7. multi-track (Stage B1) per-track stream URLs / MIME / containment, `audio:getTracks`, progress + Notes guards
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
  audioFormatFromExtension,
  audioMimeForFormat,
  audioPlaybackStatus,
  isAudioFormat,
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
const { createAudioAdapter } = await import('../../electron/adapters/audio.adapter.ts')
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
await check('every requested audio extension maps to its format (case-insensitive); the app owns each MIME', () => {
  const expected = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.m4b': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg' }
  for (const [ext, mime] of Object.entries(expected)) {
    const fmt = ext.slice(1)
    assert.equal(config.resolveFormatFromExtension(ext.toUpperCase()), fmt, ext)
    assert.equal(assertSupportedExtension(path.join(tmp, `book${ext.toUpperCase()}`)), fmt, ext)
    assert.equal(isAudioFormat(fmt), true, ext)
    assert.equal(audioMimeForFormat(fmt), mime, ext)
  }
  for (const f of ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus']) assert.equal(audioPlaybackStatus(f), 'verified', f)
})
await check('.aif is an alias of AIFF, and AIFF is refused with an explanation (Chromium cannot decode it)', () => {
  assert.equal(audioFormatFromExtension('.AIF'), 'aiff')
  assert.equal(audioFormatFromExtension('aiff'), 'aiff')
  assert.equal(audioPlaybackStatus('aiff'), 'unsupported')
  assert.equal(isAudioFormat('aiff'), false)
  assert.equal(audioMimeForFormat('aiff'), undefined)
  for (const ext of ['.aiff', '.aif'])
    assert.throws(() => assertSupportedExtension(path.join(tmp, `book${ext}`)), (e) => e instanceof UnsupportedFormatError && /AIFF.*WAV or FLAC/.test(e.message), ext)
})
await check('ZIP and look-alike extensions are still rejected by the import guard', () => {
  for (const ext of ['.zip', '.mp3.exe', '.mp4', '.wma', ''])
    assert.throws(() => assertSupportedExtension(path.join(tmp, `book${ext}`)), UnsupportedFormatError, ext)
})

// ---- 2. import ----
console.log('2. import (MP3 importer + library store)')
const adapter = createAudioAdapter('mp3', { coversDir: () => coversDir })
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
  assert.equal(createAudioAdapter('aac', { coversDir: () => coversDir }).canHandle('x.AAC'), true)
  assert.equal(createAudioAdapter('wav', { coversDir: () => coversDir }).canHandle('x.mp3'), false)
})

// Structure-only files generated here (NOT encoder output): they prove the importer's container/codec
// gate and tag handling, never playback.
const wavFile = (name) => {
  const data = Buffer.alloc(8000 * 2) // 1 s, 8 kHz, mono, 16-bit silence
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28)
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return write(name, Buffer.concat([h, data]))
}
const aiffFile = (name) => {
  const data = Buffer.alloc(8000 * 2)
  const comm = Buffer.alloc(26); comm.write('COMM', 0); comm.writeUInt32BE(18, 4); comm.writeUInt16BE(1, 8)
  comm.writeUInt32BE(8000, 10); comm.writeUInt16BE(16, 14)
  Buffer.from([0x40, 0x0b, 0xfa, 0, 0, 0, 0, 0, 0, 0]).copy(comm, 16) // 8000 Hz as 80-bit extended
  const ssnd = Buffer.concat([Buffer.from('SSND'), u32(8 + data.length), Buffer.alloc(8), data])
  const body = Buffer.concat([Buffer.from('AIFF'), comm, ssnd])
  return write(name, Buffer.concat([Buffer.from('FORM'), u32(body.length), body]))
}
await check('per-format importer: a real WAV container imports as wav; the same bytes under another extension are refused', async () => {
  const wav = createAudioAdapter('wav', { coversDir: () => coversDir })
  const r = await wav.import(wavFile('clip.wav'))
  assert.equal(r.format, 'wav')
  assert.equal(r.title, 'clip')
  await assert.rejects(createAudioAdapter('flac', { coversDir: () => coversDir }).import(wavFile('fake.flac')))
  await assert.rejects(createAudioAdapter('mp3', { coversDir: () => coversDir }).import(wavFile('fake.mp3')), /Not a (readable|playable) MP3/)
})
await check('text renamed to every new extension is rejected, not imported', async () => {
  for (const f of ['m4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus'])
    await assert.rejects(createAudioAdapter(f, { coversDir: () => coversDir }).import(write(`garbage.${f}`, Buffer.from('this is not audio '.repeat(40)))), undefined, f)
  for (const f of ['m4a', 'flac', 'wav', 'opus'])
    await assert.rejects(createAudioAdapter(f, { coversDir: () => coversDir }).import(write(`empty.${f}`, Buffer.alloc(0))), undefined, f)
})
await check('AIFF content is never accepted by any audio importer (even when renamed .wav)', async () => {
  await assert.rejects(createAudioAdapter('wav', { coversDir: () => coversDir }).import(aiffFile('is-aiff.wav')))
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

await check('every importable format streams with its own Content-Type, Range → 206, and AIFF is never served', async () => {
  const mimes = { mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg' }
  for (const [fmt, mime] of Object.entries(mimes)) {
    const f = write(`stream.${fmt}`, Buffer.alloc(1000, 7))
    const h = createAudioStreamHandler(async () => ({ ok: true, path: f, format: fmt }))
    const full = await h(req('x'))
    assert.equal(full.status, 200, fmt)
    assert.equal(full.headers.get('content-type'), mime, fmt)
    const part = await h(req('x', { range: 'bytes=100-199' }))
    assert.equal(part.status, 206, fmt)
    assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000', fmt)
    assert.equal(part.headers.get('content-type'), mime, fmt)
    assert.equal((await part.arrayBuffer()).byteLength, 100, fmt)
  }
  const f = write('stream.aiff', Buffer.alloc(100))
  assert.equal((await createAudioStreamHandler(async () => ({ ok: true, path: f, format: 'aiff' }))(req('x'))).status, 404)
})

await check('books of the new formats persist, and their listening progress saves (SQL guard widened)', async () => {
  let i = 0
  for (const fmt of ['m4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus']) {
    const file = fmt === 'wav' ? wavFile(`pers.${fmt}`) : write(`pers.${fmt}`, Buffer.alloc(64, 1))
    const id = `n-${fmt}`
    const now = '2026-10-23T00:00:00.000Z'
    library.persistImportedBook(new Book({ id, title: id, filePath: file, format: fmt, sha256: sha(`n-${++i}-${fmt}`), fileSizeBytes: 64, addedAt: now, updatedAt: now }), [], [])
    assert.equal((await library.findById(id)).format, fmt)
    const saved = await getOverlayStore().saveAudioProgress(id, { positionSeconds: 12.5, durationSeconds: 100, playbackRate: 1.25 })
    assert.equal(saved, true, fmt)
    assert.equal((await getOverlayStore().getAudioProgress(id))?.positionSeconds, 12.5, fmt)
  }
  assert.throws(() => db.prepare(`UPDATE books SET file_format = 'aiff' WHERE id = 'n-wav'`).run(), /CHECK/)
})

// Optional: genuine encoder-made files. READMATE_AUDIO_PACK points at a folder of real files named by
// extension (e.g. .m4a .m4b .aac .wav .flac .ogg .opus .mp3); each is imported by the real importer and
// streamed by the real handler (200, Range 206, identical bytes). Never copied into the repo.
if (process.env.READMATE_AUDIO_PACK) {
  const root = process.env.READMATE_AUDIO_PACK
  const found = []
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : found.push(f) } }
  walk(root)
  for (const file of found) {
    const fmt = audioFormatFromExtension(path.extname(file))
    if (!fmt) continue
    if (fmt === 'aiff') {
      await check(`real ${path.basename(file)}: AIFF is refused at the import guard`, () =>
        assert.throws(() => assertSupportedExtension(file), UnsupportedFormatError))
      continue
    }
    await check(`real ${path.basename(file)}: imported as ${fmt}, streamed with Range, bytes identical`, async () => {
      const r = await createAudioAdapter(fmt, { coversDir: () => coversDir }).import(file)
      assert.equal(r.format, fmt)
      assert.ok(r.title)
      const h = createAudioStreamHandler(async () => ({ ok: true, path: file, format: fmt }))
      const size = fs.statSync(file).size
      const full = await h(req('x'))
      assert.equal(full.status, 200)
      assert.equal(full.headers.get('content-type'), audioMimeForFormat(fmt))
      assert.equal(sha(Buffer.from(await full.arrayBuffer())), sha(fs.readFileSync(file)))
      const mid = Math.floor(size / 2)
      const part = await h(req('x', { range: `bytes=${mid}-${mid + 999}` }))
      assert.equal(part.status, 206)
      assert.deepEqual(Buffer.from(await part.arrayBuffer()), fs.readFileSync(file).subarray(mid, mid + 1000))
    })
  }
}

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

// ---- 7. multi-track audiobooks (Stage B1): per-track URLs, the track list, Main-layer guards ----
console.log('7. multi-track audiobooks: per-track stream URLs, track list, progress + Notes guards')
{
  const { randomUUID } = await import('node:crypto')
  const { chapterFileName } = await import('@reading-book/book-reader-sdk')
  const { createBookAudioLookup } = await import('../../electron/audio/audio-lookup.ts')
  const { parseAudioRequestTarget } = await import('../../electron/audio/audio-stream-handler.ts')
  const { registerAudioIpc } = await import('../../electron/ipc/audio.ipc.ts')
  const { ensureBooksSandbox, bookFileStorage } = await import('../../electron/files/sandbox.ts')
  const { AudioChannels } = await import('../../electron/ipc/channels.ts')
  registerAudioIpc()

  const insChapter = db.prepare(
    `INSERT INTO book_audio_chapters (id, book_id, position, title, file_name, source_path, file_format, size_bytes, sha256, duration_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const mp3Bytes = mp3({ frames: 40 })
  const wavBytes = fs.readFileSync(wavFile('mt-source.wav'))
  /** A multi-track book whose files live in the app-owned books folder, like a real import. */
  function addMultiBook(bookId, tracks) {
    const dir = path.join(ensureBooksSandbox(), randomUUID())
    fs.mkdirSync(dir)
    const ids = tracks.map(() => randomUUID())
    tracks.forEach((t, i) => fs.writeFileSync(path.join(dir, chapterFileName(i, ids[i], t.format)), t.bytes))
    db.prepare(
      `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'not-started', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    ).run(bookId, `Book ${bookId}`, path.join(dir, chapterFileName(0, ids[0], tracks[0].format)), tracks[0].format, `sha-${bookId}`)
    tracks.forEach((t, i) =>
      insChapter.run(ids[i], bookId, i, t.title, chapterFileName(i, ids[i], t.format), `CD${i}/x.${t.format}`, t.format, t.bytes.length, `${i}`.padStart(64, '0'), t.duration),
    )
    return { dir, ids }
  }
  const mt = addMultiBook('mt-book', [
    { format: 'mp3', bytes: mp3Bytes, title: 'First (mp3)', duration: 12.5 },
    { format: 'wav', bytes: wavBytes, title: 'Second (wav)', duration: null },
  ])
  const other = addMultiBook('mt-other', [
    { format: 'mp3', bytes: mp3({ frames: 10 }), title: 'Other 1', duration: 3 },
    { format: 'mp3', bytes: mp3({ frames: 12 }), title: 'Other 2', duration: 4 },
  ])
  const lookup = createBookAudioLookup({
    findBook: (id) => library.findById(id),
    getChapter: (b, t) => library.getAudioChapter(b, t),
    isManaged: (p) => bookFileStorage(p) === 'managed',
    resolveFile: async (b) => {
      const f = await resolveBookFile(b)
      return f.ok ? { ok: true, path: f.path } : { ok: false }
    },
  })
  const mh = createAudioStreamHandler(lookup)
  const url = (b, t) => `rb-audio://local/${b}${t ? `/${t}` : ''}`
  const get = (u, headers = {}) => mh(new Request(u, { headers }))

  await check('URL target: {bookId} or {bookId}/{uuid}; anything else (non-UUID, extra segment, encoded separator, NUL, other host) is refused; the old parser is unchanged', () => {
    const id = mt.ids[0]
    assert.deepEqual(parseAudioRequestTarget('rb-audio://local/b1'), { bookId: 'b1' })
    assert.deepEqual(parseAudioRequestTarget(`rb-audio://local/a%20b/${id}`), { bookId: 'a b', trackId: id })
    for (const bad of ['rb-audio://local/b1/not-a-uuid', `rb-audio://local/b1/${id}/extra`, `rb-audio://local/b1%2F../${id}`, `rb-audio://local/b1/${id.replace(/.$/, '%00')}`, `rb-audio://other/b1/${id}`, 'rb-audio://local/', 'rb-audio://local/b1/%5C', 'not a url']) {
      assert.equal(parseAudioRequestTarget(bad), null, bad)
    }
    assert.equal(parseAudioRequestUrl(`rb-audio://local/b1/${id}`), null, 'the book-only parser still refuses a nested path')
    assert.equal(parseAudioRequestUrl('rb-audio://local/a-main'), 'a-main')
  })
  await check('per-track streaming: each track answers with ITS OWN format\'s MIME (mp3 / wav in one book), Range → 206 with the right bytes, 416 past the end', async () => {
    const r0 = await get(url('mt-book', mt.ids[0]), { Range: 'bytes=10-29' })
    assert.deepEqual([r0.status, r0.headers.get('content-type'), r0.headers.get('content-range')], [206, 'audio/mpeg', `bytes 10-29/${mp3Bytes.length}`])
    assert.ok((await bodyOf(r0)).equals(mp3Bytes.subarray(10, 30)))
    const r1 = await get(url('mt-book', mt.ids[1]))
    assert.deepEqual([r1.status, r1.headers.get('content-type')], [200, 'audio/wav'])
    assert.ok((await bodyOf(r1)).equals(wavBytes))
    const past = await get(url('mt-book', mt.ids[1]), { Range: `bytes=${wavBytes.length + 5}-` })
    assert.equal(past.status, 416)
  })
  await check('the book-only URL still serves the book\'s own file = chapter 0 (preflight / old URLs keep working)', async () => {
    const r = await get(url('mt-book'), { Range: 'bytes=0-3' })
    assert.deepEqual([r.status, r.headers.get('content-type')], [206, 'audio/mpeg'])
    assert.ok((await bodyOf(r)).equals(mp3Bytes.subarray(0, 4)))
  })
  await check('forged ids are 404: unknown track, another book\'s track, a track under another book, a track of a single-file book, a malformed id', async () => {
    for (const u of [
      url('mt-book', randomUUID()),
      url('mt-book', other.ids[0]), // another book's track id under this book
      url('mt-other', mt.ids[0]), // this book's track id under another book
      url('a-tagged', mt.ids[0]), // a single-file audiobook has no tracks
      url('mt-book', 'not-a-uuid'),
      url('no-such-book', mt.ids[0]),
    ]) {
      assert.equal((await get(u)).status, 404, u)
    }
  })
  await check('a chapter row with a non-canonical file name, a book outside the app folder, or a symbolic link as the file is refused', async () => {
    const row = db.prepare('SELECT file_name n FROM book_audio_chapters WHERE id = ?').get(mt.ids[1])
    fs.copyFileSync(path.join(mt.dir, row.n), path.join(mt.dir, 'evil.mp3'))
    db.prepare('UPDATE book_audio_chapters SET file_name = ? WHERE id = ?').run('evil.mp3', mt.ids[1]) // passes the SQL CHECK, is not a chapter name
    assert.equal((await get(url('mt-book', mt.ids[1]))).status, 404)
    db.prepare('UPDATE book_audio_chapters SET file_name = ? WHERE id = ?').run(row.n, mt.ids[1])
    assert.equal((await get(url('mt-book', mt.ids[1]))).status, 200)
    // the book is registered outside the app-owned books folder
    const original = db.prepare('SELECT file_path f FROM books WHERE id = ?').get('mt-book').f
    const outside = path.join(tmp, path.basename(original))
    fs.copyFileSync(original, outside)
    db.prepare('UPDATE books SET file_path = ? WHERE id = ?').run(outside, 'mt-book')
    assert.equal((await get(url('mt-book', mt.ids[0]))).status, 404)
    db.prepare('UPDATE books SET file_path = ? WHERE id = ?').run(original, 'mt-book')
    assert.equal((await get(url('mt-book', mt.ids[0]))).status, 200)
    // a symbolic link in the book's folder is never followed
    const target = path.join(mt.dir, row.n)
    const secret = path.join(tmp, 'secret.txt')
    fs.writeFileSync(secret, 'top secret')
    fs.rmSync(target)
    let linked = true
    try {
      fs.symlinkSync(secret, target, 'file')
    } catch (e) {
      linked = false
      fs.writeFileSync(target, wavBytes)
      console.log(`      (symlink not created: ${e.code} — symlink check skipped)`)
    }
    if (linked) assert.equal((await get(url('mt-book', mt.ids[1]))).status, 404)
    fs.rmSync(target, { force: true })
    fs.writeFileSync(target, wavBytes)
  })
  await check('audio:getTracks → ids, titles, durations in order and NOTHING else (no file name, source path or filesystem path); [] for a single-file book; ok:false for unknown', async () => {
    const r = await invoke(AudioChannels.getTracks, 'mt-book')
    assert.deepEqual(r, {
      ok: true,
      tracks: [
        { id: mt.ids[0], title: 'First (mp3)', durationSeconds: 12.5 },
        { id: mt.ids[1], title: 'Second (wav)', durationSeconds: null },
      ],
    })
    assert.ok(!JSON.stringify(r).includes(mt.dir) && !JSON.stringify(r).includes('CD0') && !/\.(mp3|wav)/.test(JSON.stringify(r)))
    assert.deepEqual(await invoke(AudioChannels.getTracks, 'a-tagged'), { ok: true, tracks: [] })
    assert.deepEqual(await invoke(AudioChannels.getTracks, 'no-such-book'), { ok: false, tracks: [] })
    assert.deepEqual(await invoke(AudioChannels.getTracks, 7), { ok: false, tracks: [] })
  })
  await check('audio:getChapters is empty (ok) for a multi-track book — embedded chapters are ignored — and unchanged for a single-file book', async () => {
    assert.deepEqual(await invoke(AudioChannels.getChapters, 'mt-book'), { ok: true, chapters: [] })
    const single = await invoke(AudioChannels.getChapters, 'a-tagged')
    assert.equal(single.ok, true)
  })
  await check('PROGRESS guard: a multi-track book needs a trackId of ITS OWN; a single-file book must not carry one', async () => {
    const save = (bookId, extra) => invoke(OverlayChannels.saveAudioProgress, { bookId, positionSeconds: 5, playbackRate: 1, ...extra })
    assert.deepEqual(await save('mt-book', {}), { ok: false }, 'no trackId')
    assert.deepEqual(await save('mt-book', { trackId: randomUUID() }), { ok: false }, 'unknown trackId')
    assert.deepEqual(await save('mt-book', { trackId: other.ids[0] }), { ok: false }, 'another book\'s trackId')
    assert.deepEqual(await save('mt-book', { trackId: mt.ids[1] }), { ok: true })
    const stored = JSON.parse(db.prepare('SELECT reading_state_json j FROM books WHERE id = ?').get('mt-book').j)
    assert.equal(stored.audioProgress.trackId, mt.ids[1])
    assert.equal(stored.audioProgress.positionSeconds, 5)
    assert.equal('percent' in stored, false)
    // single-file book: unchanged without a trackId, refused with one
    assert.deepEqual(await save('a-tagged', { trackId: mt.ids[0] }), { ok: false })
    assert.deepEqual(await save('a-tagged', { durationSeconds: 100 }), { ok: true })
    const single = JSON.parse(db.prepare('SELECT reading_state_json j FROM books WHERE id = ?').get('a-tagged').j)
    assert.equal(single.audioProgress.durationSeconds, 100)
    assert.equal('trackId' in single.audioProgress, false)
    assert.equal(single.percent, 5)
    // reading it back carries the trackId
    const back = await invoke(OverlayChannels.getAudioProgress, 'mt-book')
    assert.equal(back.trackId, mt.ids[1])
  })
  await check('NOTES guard (single-file half, unchanged): a single-file book\'s Notes round trip', async () => {
    const note = { id: 'n1', label: 'x', positionSeconds: 3, createdAt: '2026-01-01T00:00:00Z' }
    assert.deepEqual(await invoke(AudioChannels.saveBookmarks, { bookId: 'a-tagged', bookmarks: [note] }), { ok: true })
    assert.deepEqual((await invoke(AudioChannels.getBookmarks, 'a-tagged')).map((n) => n.id), ['n1'])
  })

  // ---- Notes for multi-track audiobooks: ownership, orphans, cap, other keys ----
  const rawState = (bookId) => db.prepare('SELECT reading_state_json j FROM books WHERE id = ?').get(bookId).j
  const storedNotes = (bookId) => JSON.parse(rawState(bookId)).audioBookmarks
  const noteOf = (id, trackId, positionSeconds = 3, extra = {}) => ({
    id,
    label: `L-${id}`,
    positionSeconds,
    createdAt: '2026-01-01T00:00:00Z',
    ...extra,
    ...(trackId ? { trackId } : {}),
  })
  const saveNotes = (bookId, bookmarks) => invoke(AudioChannels.saveBookmarks, { bookId, bookmarks })

  await check('NOTES ownership (multi-track): a save is accepted only if EVERY Note names a track of THIS book; otherwise refused whole and nothing is written', async () => {
    assert.equal(storedNotes('mt-book'), undefined)
    for (const bad of [
      [noteOf('n1')], // no trackId
      [noteOf('n1', randomUUID())], // unknown track
      [noteOf('n1', other.ids[0])], // another book's track
      [noteOf('n1', mt.ids[0]), noteOf('n2', randomUUID())], // mixed list
    ]) {
      assert.deepEqual(await saveNotes('mt-book', bad), { ok: false })
      assert.equal(storedNotes('mt-book'), undefined, 'nothing written')
    }
    assert.deepEqual(await saveNotes('mt-book', [noteOf('n1', mt.ids[0], 3), noteOf('n2', mt.ids[1], 4)]), { ok: true })
    const back = await invoke(AudioChannels.getBookmarks, 'mt-book')
    assert.deepEqual(back.map((n) => [n.id, n.trackId, n.positionSeconds]), [['n1', mt.ids[0], 3], ['n2', mt.ids[1], 4]])
    // a refused save over existing Notes leaves the stored state byte-identical
    const before = rawState('mt-book')
    assert.deepEqual(await saveNotes('mt-book', [noteOf('n1', mt.ids[0]), noteOf('bad', randomUUID())]), { ok: false })
    assert.equal(rawState('mt-book'), before)
    // single-file: a Note with a trackId is refused and nothing is written
    const singleBefore = rawState('a-tagged')
    assert.deepEqual(await saveNotes('a-tagged', [noteOf('n1', mt.ids[0])]), { ok: false })
    assert.equal(rawState('a-tagged'), singleBefore)
    assert.deepEqual((await invoke(AudioChannels.getBookmarks, 'a-tagged')).map((n) => n.id), ['n1'])
    assert.equal('trackId' in (await invoke(AudioChannels.getBookmarks, 'a-tagged'))[0], false)
  })

  await check('NOTES orphans (multi-track): foreign / track-less stored entries are never returned, and survive add, edit and delete (canonical form); an incoming id wins over a foreign duplicate', async () => {
    const o = addMultiBook('mt-orph', [
      { format: 'mp3', bytes: mp3({ frames: 10 }), title: 'O1', duration: 3 },
      { format: 'mp3', bytes: mp3({ frames: 12 }), title: 'O2', duration: 4 },
    ])
    const foreign = noteOf('f-foreign', randomUUID(), 50, { note: 'orphan text' })
    const trackless = noteOf('f-none', undefined, 60)
    const own1 = noteOf('own1', o.ids[0], 5)
    db.prepare('UPDATE books SET reading_state_json = ? WHERE id = ?').run(JSON.stringify({ futureKey: 1, audioBookmarks: [foreign, trackless, own1] }), 'mt-orph')
    const ids = async () => (await invoke(AudioChannels.getBookmarks, 'mt-orph')).map((n) => n.id)
    const foreignKept = () => {
      const s = storedNotes('mt-orph')
      assert.deepEqual(s.find((n) => n.id === 'f-foreign'), foreign)
      assert.deepEqual(s.find((n) => n.id === 'f-none'), trackless)
    }
    assert.deepEqual(await ids(), ['own1'], 'foreign entries are not returned')
    // add
    assert.deepEqual(await saveNotes('mt-orph', [own1, noteOf('own2', o.ids[1], 7)]), { ok: true })
    assert.deepEqual(await ids(), ['own1', 'own2'])
    foreignKept()
    // edit
    assert.deepEqual(await saveNotes('mt-orph', [noteOf('own1', o.ids[0], 5, { note: 'edited' }), noteOf('own2', o.ids[1], 7)]), { ok: true })
    assert.equal((await invoke(AudioChannels.getBookmarks, 'mt-orph'))[0].note, 'edited')
    foreignKept()
    // delete (all visible Notes)
    assert.deepEqual(await saveNotes('mt-orph', []), { ok: true })
    assert.deepEqual(await ids(), [])
    foreignKept()
    assert.equal(JSON.parse(rawState('mt-orph')).futureKey, 1, 'other keys kept')
    // an incoming Note with the id of a foreign entry wins; the foreign duplicate is dropped
    assert.deepEqual(await saveNotes('mt-orph', [noteOf('f-foreign', o.ids[0], 9)]), { ok: true })
    const dupes = storedNotes('mt-orph').filter((n) => n.id === 'f-foreign')
    assert.equal(dupes.length, 1)
    assert.equal(dupes[0].trackId, o.ids[0])
  })

  await check('NOTES cap (multi-track): 500 owned + foreign entries — all 500 returned; editing one keeps every foreign entry; exactly 500 is accepted, 501 is refused whole, orphans do not count', async () => {
    const c = addMultiBook('mt-cap', [
      { format: 'mp3', bytes: mp3({ frames: 10 }), title: 'C1', duration: 3 },
      { format: 'mp3', bytes: mp3({ frames: 12 }), title: 'C2', duration: 4 },
    ])
    const owned = Array.from({ length: 500 }, (_, i) => noteOf(`o${i}`, c.ids[i % 2], i))
    const foreigns = [noteOf('x-foreign-1', randomUUID(), 1), noteOf('x-foreign-2', randomUUID(), 2), noteOf('x-none', undefined, 3)]
    // stored order: the 500 owned first, then the foreign tail (this is what a plain "sanitize the whole array" would cut)
    db.prepare('UPDATE books SET reading_state_json = ? WHERE id = ?').run(JSON.stringify({ audioBookmarks: [...owned, ...foreigns] }), 'mt-cap')
    assert.equal((await invoke(AudioChannels.getBookmarks, 'mt-cap')).length, 500, 'all 500 visible Notes are returned')
    const edited = owned.map((n) => (n.id === 'o10' ? { ...n, note: 'edited' } : n))
    assert.deepEqual(await saveNotes('mt-cap', edited), { ok: true }, 'exactly 500 is accepted')
    const s = storedNotes('mt-cap')
    assert.equal(s.length, 503)
    for (const f of foreigns) assert.deepEqual(s.find((n) => n.id === f.id), f, `${f.id} survives`)
    assert.equal((await invoke(AudioChannels.getBookmarks, 'mt-cap')).find((n) => n.id === 'o10').note, 'edited')
    const before = rawState('mt-cap')
    assert.deepEqual(await saveNotes('mt-cap', [...edited, noteOf('o500', c.ids[0], 500)]), { ok: false }, '501 is refused whole')
    assert.equal(rawState('mt-cap'), before, 'nothing written, nothing truncated')
  })

  await check('NOTES vs other state (multi-track and single-file): add / edit / delete change only audioBookmarks; audioProgress is byte-identical and gains no percent; a progress save leaves the Notes identical; the text cap applies', async () => {
    const m = addMultiBook('mt-matrix', [
      { format: 'mp3', bytes: mp3({ frames: 10 }), title: 'M1', duration: 3 },
      { format: 'mp3', bytes: mp3({ frames: 12 }), title: 'M2', duration: 4 },
    ])
    const seed = {
      lastReadLocation: { k: 1 },
      fontSize: 18,
      futureKey: { a: [1, { b: 2 }] },
      audioProgress: { trackId: m.ids[1], positionSeconds: 42, playbackRate: 1.25, scope: 'book', updatedAt: '2026-01-01T00:00:00Z' },
    }
    db.prepare('UPDATE books SET reading_state_json = ? WHERE id = ?').run(JSON.stringify(seed), 'mt-matrix')
    const assertOthersUntouched = (step) => {
      const parsed = JSON.parse(rawState('mt-matrix'))
      const { audioBookmarks: _n, ...rest } = parsed
      void _n
      assert.deepEqual(rest, seed, `${step}: everything except audioBookmarks equals the seed`)
      assert.equal(JSON.stringify(parsed.audioProgress), JSON.stringify(seed.audioProgress), `${step}: audioProgress byte-identical`)
      assert.equal('percent' in parsed, false, `${step}: no percent appeared`)
    }
    assert.deepEqual(await saveNotes('mt-matrix', [noteOf('m1', m.ids[0], 2)]), { ok: true })
    assertOthersUntouched('add')
    assert.deepEqual(await saveNotes('mt-matrix', [noteOf('m1', m.ids[0], 2, { note: 'edited' })]), { ok: true })
    assertOthersUntouched('edit')
    assert.equal(storedNotes('mt-matrix')[0].note, 'edited')
    assert.deepEqual(await saveNotes('mt-matrix', [noteOf('m1', m.ids[0], 2, { note: 'x'.repeat(2500) })]), { ok: true })
    assert.equal(storedNotes('mt-matrix')[0].note.length, 2000, 'text cap')
    assert.deepEqual(await saveNotes('mt-matrix', []), { ok: true })
    assertOthersUntouched('delete')
    // reverse: a progress save leaves the Notes identical (multi-track)
    assert.deepEqual(await saveNotes('mt-matrix', [noteOf('m1', m.ids[0], 2)]), { ok: true })
    const notesBefore = JSON.stringify(storedNotes('mt-matrix'))
    assert.deepEqual(await invoke(OverlayChannels.saveAudioProgress, { bookId: 'mt-matrix', trackId: m.ids[0], positionSeconds: 7, playbackRate: 1 }), { ok: true })
    assert.equal(JSON.stringify(storedNotes('mt-matrix')), notesBefore)
    assert.equal(JSON.parse(rawState('mt-matrix')).audioProgress.trackId, m.ids[0])
    // reverse: single-file
    const singleNotes = JSON.stringify(storedNotes('a-tagged'))
    assert.deepEqual(await invoke(OverlayChannels.saveAudioProgress, { bookId: 'a-tagged', positionSeconds: 9, playbackRate: 1 }), { ok: true })
    assert.equal(JSON.stringify(storedNotes('a-tagged')), singleNotes)
  })

  // ---- CHARACTERIZATION GOLDEN (Notes for Multi-Track Audiobooks, task T002) ----
  // Expected values were captured from the implementation as it was BEFORE that feature. They pin the
  // single-file Notes persistence (IPC handler → SqliteAudioStore → json_patch) and must keep passing,
  // unmodified, after multi-track Notes are added.
  await check('GOLDEN single-file Notes: exact stored JSON and getBookmarks result for a fixed save; 501 entries keep the first 500 in input order (silent)', async () => {
    const r = await adapter.import(write('golden-notes.mp3', mp3({ frames: 50 })))
    addAudioBook(r, 'a-golden')
    const stored = () => db.prepare('SELECT reading_state_json j FROM books WHERE id = ?').get('a-golden').j
    const seed = JSON.stringify({ lastReadLocation: { k: 1 }, futureKey: { a: [1, 2] } })
    db.prepare('UPDATE books SET reading_state_json = ? WHERE id = ?').run(seed, 'a-golden')

    const input = [
      { id: 'g-b', label: 'B', positionSeconds: 90, note: '  text  ', chapterId: 'c1', chapterOffsetSeconds: 12.5, createdAt: '2026-01-01T00:00:02Z' },
      { id: 'g-a', label: '', positionSeconds: 10, createdAt: '2026-01-01T00:00:01Z', junk: true },
      { id: 'g-c', label: '  padded  ', positionSeconds: 90.5, createdAt: '2026-01-01T00:00:03Z' },
    ]
    assert.deepEqual(await invoke(AudioChannels.saveBookmarks, { bookId: 'a-golden', bookmarks: input }), { ok: true })
    // other reading-state keys are kept; the stored string is exactly this (key order included)
    assert.equal(
      stored(),
      '{"lastReadLocation":{"k":1},"futureKey":{"a":[1,2]},"audioBookmarks":[{"id":"g-a","label":"Bookmark at 0:10","positionSeconds":10,"createdAt":"2026-01-01T00:00:01Z"},{"id":"g-b","label":"B","positionSeconds":90,"createdAt":"2026-01-01T00:00:02Z","note":"text","chapterId":"c1","chapterOffsetSeconds":12.5},{"id":"g-c","label":"padded","positionSeconds":90.5,"createdAt":"2026-01-01T00:00:03Z"}]}',
    )
    assert.deepEqual(await invoke(AudioChannels.getBookmarks, 'a-golden'), [
      { id: 'g-a', label: 'Bookmark at 0:10', positionSeconds: 10, createdAt: '2026-01-01T00:00:01Z' },
      { id: 'g-b', label: 'B', positionSeconds: 90, createdAt: '2026-01-01T00:00:02Z', note: 'text', chapterId: 'c1', chapterOffsetSeconds: 12.5 },
      { id: 'g-c', label: 'padded', positionSeconds: 90.5, createdAt: '2026-01-01T00:00:03Z' },
    ])

    const many = Array.from({ length: 501 }, (_, i) => ({ id: `g${i}`, label: `n${i}`, positionSeconds: 500 - i, createdAt: '2026-01-01T00:00:00Z' }))
    assert.deepEqual(await invoke(AudioChannels.saveBookmarks, { bookId: 'a-golden', bookmarks: many }), { ok: true })
    const after = JSON.parse(stored())
    // 501 entries: ok:true, the FIRST 500 in input order are stored (the 501st is dropped silently), sorted by position
    assert.equal(after.audioBookmarks.length, 500)
    assert.equal(after.audioBookmarks[0].id, 'g499')
    assert.equal(after.audioBookmarks[499].id, 'g0')
    assert.equal(after.audioBookmarks.some((n) => n.id === 'g500'), false)
    assert.equal(createHash('sha256').update(JSON.stringify(after.audioBookmarks)).digest('hex'), 'c61bbc6231cbf3a9b799df4977b81c9acc7ead7ca458c18c5e4883df0b258a79')
    assert.equal(Object.keys(after).join(','), 'lastReadLocation,futureKey,audioBookmarks')
    assert.equal((await invoke(AudioChannels.getBookmarks, 'a-golden')).length, 500)
  })
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} checks passed`)

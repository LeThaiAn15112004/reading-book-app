/**
 * Integration checks: the renderer's audiobook player store (the REAL zustand store behind
 * AudioBookScreen) against the REAL Main-side overlay store / IPC handlers / SQLite schema and the real
 * `openBookContent` preflight. Only two things are fake: the IPC hop is a direct call, and `Audio` is a
 * scriptable stand-in for the media element (so no window, no sound, no decoding — decoding and seeking
 * were measured separately with a real MP3 in Electron, see the PoC report).
 *
 *   1. load       preflight errors, restore position / rate, finished book restarts
 *   2. persist    throttled while playing, immediate on pause / rate / end / leaving / window flush
 *   3. lifecycle  one element at a time, listeners and stream released, switching books, stale loads
 *   4. controls   seek clamping, skip, errors from the element
 *
 * Run: npm run spike:audio:store   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseAudioProgress, parseReadingState } from '@reading-book/book-reader-sdk'
import { invoke } from '../pdf-annotations/electron-stub.mjs'
import { getDatabase } from '../pdf-annotations/db-stub.mjs'

const { OverlayChannels } = await import('../../electron/ipc/channels.ts')
const { registerOverlayIpc } = await import('../../electron/ipc/overlay.ipc.ts')
const { getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')
const { getLibraryStore } = await import('../../electron/persistence/sqlite-library-store.ts')
const { openBookContent } = await import('../../electron/files/open-book-content.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- scriptable stand-in for HTMLAudioElement ----
const elements = []
class FakeAudio extends EventTarget {
  constructor() {
    super()
    this._src = ''
    this.preload = ''
    this.currentTime = 0
    this.duration = NaN
    this._rate = 1
    this.defaultPlaybackRate = 1
    this.paused = true
    this.ended = false
    this.error = null
    this.released = false
    elements.push(this)
  }
  get playbackRate() { return this._rate }
  /** Like the real element: a changed rate fires `ratechange` (asynchronously). */
  set playbackRate(v) {
    const changed = v !== this._rate
    this._rate = v
    if (changed) queueMicrotask(() => this.fire('ratechange'))
  }
  get src() { return this._src }
  set src(v) { this._src = v }
  removeAttribute(name) { if (name === 'src') this._src = '' }
  load() { this.released = true }
  fire(type) { this.dispatchEvent(new Event(type)) }
  async play() { this.paused = false; this.ended = false; queueMicrotask(() => this.fire('playing')) }
  pause() { if (!this.paused) { this.paused = true; this.fire('pause') } }
  /** The element reports its metadata (duration) — what the browser does once the stream answered. */
  loaded(duration) { this.duration = duration; this.fire('durationchange'); this.fire('loadedmetadata') }
}
globalThis.Audio = FakeAudio

// ---- real Main side, IPC hop as a direct call ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-audio-store-'))
const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
registerOverlayIpc()
const library = getLibraryStore()
const overlays = getOverlayStore()

const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, 'mp3', ?, 'not-started', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
function addBook(id, { state = '{}', create = true } = {}) {
  const file = path.join(tmp, `${id}.mp3`)
  if (create) fs.writeFileSync(file, Buffer.alloc(1000, 1))
  insertBook.run(id, `Title ${id}`, file, `sha-${id}`, state)
  return file
}
const progressOf = (id) => parseAudioProgress(parseReadingState(db.prepare('SELECT reading_state_json j FROM books WHERE id = ?').get(id).j))

const calls = { markAsReading: [], save: [] }
globalThis.window = {
  api: {
    library: {
      getBook: async (id) => {
        const b = await library.findById(id)
        return b ? { id: b.id, title: b.title, format: b.format, author: 'Some Author' } : null
      },
      openBookContent: (id) => openBookContent(id),
      markAsReading: async (id) => { calls.markAsReading.push(id); return { ok: true } },
    },
    overlay: {
      getAudioProgress: (id) => invoke(OverlayChannels.getAudioProgress, id),
      saveAudioProgress: async (input) => {
        calls.save.push(structuredClone(input))
        return invoke(OverlayChannels.saveAudioProgress, input)
      },
    },
  },
}

const { useAudioPlayerStore, audioStreamUrl } = await import('../../src/screens/AudioBook/logic/audioPlayerStore.ts')
const { flushRegisteredSession } = await import('../../src/screens/Reader/logic/session/sessionFlushRegistry.ts')
const store = useAudioPlayerStore
const S = () => store.getState()
const current = () => elements.filter((e) => !e.released).at(-1)
const reset = async () => {
  await S().dispose()
  calls.save.length = 0
  calls.markAsReading.length = 0
}

// ---- 1. load ----
console.log('1. load')
await check('loads: preflight → element on the rb-audio stream URL → ready after metadata', async () => {
  addBook('b1')
  const p = S().load('b1')
  await p
  assert.equal(S().status, 'loading', 'still waiting for the element metadata')
  const el = current()
  assert.equal(el.src, 'rb-audio://local/b1')
  assert.equal(el.src, audioStreamUrl('b1'))
  assert.equal(S().title, 'Title b1')
  assert.equal(S().author, 'Some Author')
  el.loaded(170)
  assert.equal(S().status, 'ready')
  assert.equal(S().durationSeconds, 170)
  assert.equal(S().positionSeconds, 0)
  await reset()
})

await check('book ids are encoded in the stream URL', () => {
  assert.equal(audioStreamUrl('a b/c'), 'rb-audio://local/a%20b%2Fc')
})

await check('a moved / deleted file is reported by the preflight, no element is created', async () => {
  addBook('gone', { create: false })
  const before = elements.length
  await S().load('gone')
  assert.equal(S().status, 'error')
  assert.equal(S().errorCode, 'missing_file')
  assert.match(S().errorMessage, /could not be found/i)
  assert.equal(elements.length, before)
  await reset()
})

await check('an unknown book id → error "no longer in your library"', async () => {
  await S().load('does-not-exist')
  assert.equal(S().status, 'error')
  assert.match(S().errorMessage, /no longer in your library/)
  await reset()
})

await check('restores the saved position and rate after the metadata arrives', async () => {
  addBook('b2', { state: JSON.stringify({ fontSize: 18, audioProgress: { positionSeconds: 60, durationSeconds: 170, playbackRate: 1.5, updatedAt: 't' } }) })
  await S().load('b2')
  const el = current()
  assert.equal(el.defaultPlaybackRate, 1.5, 'defaultPlaybackRate set: the load algorithm resets playbackRate to it')
  assert.equal(el.playbackRate, 1.5)
  el.loaded(170)
  assert.equal(el.currentTime, 60)
  assert.equal(S().positionSeconds, 60)
  assert.equal(S().playbackRate, 1.5)
  await reset()
})

await check('a book saved at its very end starts over; garbage saved values are ignored', async () => {
  addBook('b3', { state: JSON.stringify({ audioProgress: { positionSeconds: 169, durationSeconds: 170, playbackRate: 1, updatedAt: 't' } }) })
  await S().load('b3')
  current().loaded(170)
  assert.equal(current().currentTime, 0)
  await reset()
  addBook('b4', { state: JSON.stringify({ audioProgress: { positionSeconds: 'x', playbackRate: 'y' } }) })
  await S().load('b4')
  current().loaded(170)
  assert.equal(current().currentTime, 0)
  assert.equal(S().playbackRate, 1)
  await reset()
})

// ---- 2. persist ----
console.log('2. persist')
await check('while playing: first write on the first tick, then throttled to 5 s; immediate on pause / rate / end', async () => {
  addBook('p1')
  await S().load('p1')
  const el = current()
  el.loaded(200)
  calls.save.length = 0
  S().play()
  await sleep(10)
  assert.equal(S().playing, true)
  assert.deepEqual(calls.markAsReading, ['p1'], 'first play marks the book as "reading"')
  el.currentTime = 10
  await sleep(1150) // one interval tick
  assert.equal(calls.save.length, 1, 'first tick writes')
  assert.deepEqual(calls.save[0], { bookId: 'p1', positionSeconds: 10, playbackRate: 1, durationSeconds: 200 })
  el.currentTime = 20
  await sleep(1150)
  assert.equal(calls.save.length, 1, 'throttled: < 5 s since the last write')
  const realNow = Date.now
  Date.now = () => realNow() + 6000
  try {
    el.currentTime = 30
    await sleep(1150)
  } finally {
    Date.now = realNow
  }
  assert.equal(calls.save.length, 2, 'after the interval it writes again')
  assert.equal(progressOf('p1').positionSeconds, 30)

  el.currentTime = 31
  S().pause()
  await sleep(20)
  assert.equal(calls.save.at(-1).positionSeconds, 31, 'pause writes immediately')

  S().setRate(1.25)
  await sleep(20)
  assert.equal(calls.save.at(-1).playbackRate, 1.25, 'rate change writes immediately')
  assert.equal(progressOf('p1').playbackRate, 1.25)

  el.currentTime = 200
  el.ended = true
  el.fire('ended')
  await sleep(20)
  assert.equal(calls.save.at(-1).positionSeconds, 200, 'end writes immediately')
  assert.equal(S().ended, true)
  assert.equal(S().playing, false)
  assert.equal(progressOf('p1').positionSeconds, 200)
  await reset()
})

await check('writes are in order and never carry non-finite numbers or an unknown duration', async () => {
  addBook('p2')
  await S().load('p2')
  const el = current()
  el.loaded(Infinity) // a stream whose duration is not known yet
  assert.equal(S().durationSeconds, null)
  S().play(); await sleep(10)
  el.currentTime = 12
  S().pause(); await sleep(20)
  for (const call of calls.save) {
    assert.ok(Number.isFinite(call.positionSeconds) && call.positionSeconds >= 0)
    assert.equal('durationSeconds' in call, false)
  }
  assert.equal(progressOf('p2').positionSeconds, 12)
  assert.equal(progressOf('p2').durationSeconds, undefined)
  await reset()
})

await check('leaving the book while playing saves the exact position and releases the stream', async () => {
  addBook('p3')
  await S().load('p3')
  const el = current()
  el.loaded(300)
  S().play(); await sleep(10)
  el.currentTime = 77.5
  await S().dispose()
  assert.equal(progressOf('p3').positionSeconds, 77.5)
  assert.equal(el.released, true)
  assert.equal(el.src, '', 'src removed → the protocol request is cancelled')
  assert.equal(el.paused, true)
  assert.equal(S().bookId, null)
  assert.equal(S().status, 'idle')
  calls.save.length = 0
  el.fire('timeupdate'); el.fire('ended'); el.fire('error')
  await sleep(20)
  assert.equal(calls.save.length, 0, 'listeners are gone: a late event writes nothing')
  assert.equal(S().status, 'idle')
})

await check('the window-close flush handler saves the current position', async () => {
  addBook('p4')
  await S().load('p4')
  const el = current()
  el.loaded(100)
  S().play(); await sleep(10)
  el.currentTime = 41
  await flushRegisteredSession()
  assert.equal(progressOf('p4').positionSeconds, 41)
  await reset()
  // after dispose the handler is unregistered
  calls.save.length = 0
  await flushRegisteredSession()
  assert.equal(calls.save.length, 0)
})

await check('nothing is written before the element is ready (no progress for a book that never loaded)', async () => {
  addBook('p5')
  await S().load('p5') // metadata never arrives
  await S().dispose()
  assert.equal(calls.save.length, 0)
  assert.equal(progressOf('p5'), undefined)
})

await check('a seek made while paused is saved at once (no timer is running then)', async () => {
  addBook('p6')
  await S().load('p6')
  const el = current()
  el.loaded(100)
  calls.save.length = 0
  S().seekTo(64)
  el.fire('seeked')
  await sleep(30)
  assert.equal(S().playing, false)
  assert.equal(calls.save.at(-1)?.positionSeconds, 64)
  assert.equal(progressOf('p6').positionSeconds, 64)
  await reset()
})

// ---- 3. lifecycle ----
console.log('3. lifecycle')
await check('switching books: the old position is saved under the OLD id; only one live element', async () => {
  addBook('s1'); addBook('s2', { state: JSON.stringify({ audioProgress: { positionSeconds: 5, playbackRate: 2, updatedAt: 't' } }) })
  await S().load('s1')
  const a = current()
  a.loaded(100)
  S().play(); await sleep(10)
  a.currentTime = 33
  await S().load('s2')
  assert.equal(progressOf('s1').positionSeconds, 33)
  assert.equal(a.released, true)
  const b = current()
  assert.notEqual(a, b)
  assert.equal(elements.filter((e) => !e.released).length, 1)
  b.loaded(100)
  assert.equal(b.currentTime, 5)
  assert.equal(S().playbackRate, 2)
  assert.equal(progressOf('s2').positionSeconds, 5, 'the other book was not touched')
  await reset()
})

await check('a stale load (superseded before it finished) is ignored', async () => {
  addBook('l1'); addBook('l2')
  const first = S().load('l1')
  const second = S().load('l2')
  await Promise.all([first, second])
  assert.equal(S().bookId, 'l2')
  assert.equal(elements.filter((e) => !e.released).length, 1)
  assert.equal(current().src, audioStreamUrl('l2'))
  await reset()
})

await check('retry after an error loads again', async () => {
  addBook('r1', { create: false })
  await S().load('r1')
  assert.equal(S().status, 'error')
  fs.writeFileSync(path.join(tmp, 'r1.mp3'), Buffer.alloc(1000, 1))
  await S().load('r1')
  current().loaded(60)
  assert.equal(S().status, 'ready')
  await reset()
})

// ---- 4. controls ----
console.log('4. controls')
await check('seek is clamped to [0, duration]; skip moves relative to the position', async () => {
  addBook('c1')
  await S().load('c1')
  const el = current()
  el.loaded(100)
  S().seekTo(-20); assert.equal(el.currentTime, 0)
  S().seekTo(250); assert.equal(el.currentTime, 100)
  S().seekTo(40); assert.equal(el.currentTime, 40)
  S().skipBy(30); assert.equal(el.currentTime, 70)
  S().skipBy(-15); assert.equal(el.currentTime, 55)
  S().skipBy(-500); assert.equal(el.currentTime, 0)
  S().seekTo(Number.NaN); assert.equal(el.currentTime, 0)
  await reset()
})

await check('play after the end restarts from 0; rate is clamped', async () => {
  addBook('c2')
  await S().load('c2')
  const el = current()
  el.loaded(50)
  el.currentTime = 50; el.ended = true
  S().play(); await sleep(10)
  assert.equal(el.currentTime, 0)
  S().setRate(99); assert.equal(el.playbackRate, 4)
  S().setRate(-3); assert.equal(el.playbackRate, 0.25)
  await reset()
})

await check('a decode / network error from the element → error state with a readable message; no further writes', async () => {
  addBook('e1')
  await S().load('e1')
  const el = current()
  el.loaded(50)
  S().play(); await sleep(10)
  calls.save.length = 0
  el.error = { code: 4 }
  el.fire('error')
  assert.equal(S().status, 'error')
  assert.equal(S().errorCode, 'media_error')
  assert.match(S().errorMessage, /could not be played/)
  assert.equal(S().playing, false)
  await sleep(1200)
  assert.equal(calls.save.length, 0, 'the save timer stopped')
  await reset()
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} checks passed`)
process.exit(0)

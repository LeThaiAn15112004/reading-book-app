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
 *   5. multi-track  (Stage B1) load / restore, element-per-track switching, A -> B fails -> C and the other race suites,
 *                 play-state preservation, no writes while switching, status stays `ready`, single-file regression
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
const { registerAudioIpc } = await import('../../electron/ipc/audio.ipc.ts')
const { AudioChannels } = await import('../../electron/ipc/channels.ts')

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
    this.volume = 1
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
// node:sqlite has no better-sqlite3 `.transaction()`, which the audio Notes store uses (a read-modify-write in one step).
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
registerOverlayIpc()
registerAudioIpc()
const store_ = new Map()
globalThis.localStorage = { getItem: (k) => store_.get(k) ?? null, setItem: (k, v) => store_.set(k, String(v)) }
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

const calls = { markAsReading: [], save: [], bookmarks: [], getBookmarks: [], delays: [] }
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
    audio: {
      getChapters: (id) => invoke(AudioChannels.getChapters, id),
      getTracks: (id) => invoke(AudioChannels.getTracks, id),
      getBookmarks: (id) => { calls.getBookmarks.push(id); return invoke(AudioChannels.getBookmarks, id) },
      saveBookmarks: async (input) => { calls.bookmarks.push(structuredClone(input)); return invoke(AudioChannels.saveBookmarks, input) },
    },
    overlay: {
      getAudioProgress: (id) => invoke(OverlayChannels.getAudioProgress, id),
      saveAudioProgress: async (input) => {
        calls.save.push(structuredClone(input))
        const delay = calls.delays.shift() // a deliberately slow write, for the ordering checks
        if (delay) await sleep(delay)
        return invoke(OverlayChannels.saveAudioProgress, input)
      },
    },
  },
}

const { useAudioPlayerStore, audioStreamUrl, selectCanAddNote } = await import('../../src/screens/AudioBook/logic/audioPlayerStore.ts')
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
  assert.deepEqual(calls.save[0], { bookId: 'p1', positionSeconds: 10, playbackRate: 1, scope: 'book', durationSeconds: 200 })
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

// ---- 3b. chapters, scope, bookmarks, sleep timer, volume ----
console.log('3b. chapters / Book–Chapter scope / bookmarks / sleep timer / volume')
const { timelineView } = await import('@reading-book/book-reader-sdk')
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
const id3frame = (id, body) => Buffer.concat([Buffer.from(id), u32(body.length), Buffer.from([0, 0]), body])
const iso = (t) => Buffer.concat([Buffer.from([0]), Buffer.from(t, 'latin1')])
const synchsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
/** A real ID3v2.3 tag with CHAP / CTOC frames, so Main reads genuine chapter data from the file. */
function chapterMp3(chapters) {
  const frames = chapters.map(([id, title, a, b]) =>
    id3frame('CHAP', Buffer.concat([Buffer.from(`${id}\0`), u32(a), u32(b), u32(0xffffffff), u32(0xffffffff), id3frame('TIT2', iso(title))])))
  const toc = id3frame('CTOC', Buffer.concat([Buffer.from('toc\0'), Buffer.from([3, chapters.length]), Buffer.from(chapters.map(([id]) => `${id}\0`).join('')), id3frame('TIT2', iso('TOC'))]))
  const body = Buffer.concat([toc, ...frames])
  const frame = Buffer.alloc(417); frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), synchsafe(body.length), body, ...Array(20).fill(frame)])
}
const MIN = 60
function addChapterBook(id, state = '{}') {
  const file = path.join(tmp, `${id}.mp3`)
  fs.writeFileSync(file, chapterMp3([['ch1', 'One', 0, 20 * MIN * 1000], ['ch2', 'Two', 20 * MIN * 1000, 45 * MIN * 1000], ['ch3', 'Three', 45 * MIN * 1000, 60 * MIN * 1000]]))
  insertBook.run(id, `Title ${id}`, file, `sha-${id}`, state)
}
const at = (el, seconds) => { el.currentTime = seconds; el.fire('timeupdate') }
const stateOf2 = (id) => parseReadingState(db.prepare('SELECT reading_state_json j FROM books WHERE id = ?').get(id).j)

await check('chapters come from the file and are validated against the real duration', async () => {
  addChapterBook('k1')
  await S().load('k1')
  assert.equal(S().chapterStatus, 'none', 'not shown before the duration is known')
  const el = current()
  el.loaded(3600)
  assert.equal(S().chapterStatus, 'ok')
  assert.deepEqual(S().chapters.map((c) => [c.id, c.title, c.startSeconds, c.endSeconds]), [['ch1', 'One', 0, 1200], ['ch2', 'Two', 1200, 2700], ['ch3', 'Three', 2700, 3600]])
  await reset()
})

await check('a file without chapter tags has none (a single MP3 is never assumed to have chapters)', async () => {
  addBook('k0')
  await S().load('k0')
  current().loaded(3600)
  assert.equal(S().chapterStatus, 'none')
  assert.deepEqual(S().chapters, [])
  S().previousChapter(); S().nextChapter(); S().goToChapter('ch1') // all no-ops
  assert.equal(current().currentTime, 0)
  S().setSleep({ kind: 'chapter' })
  assert.deepEqual(S().sleep, { kind: 'off' }, 'no chapter to stop at')
  await reset()
})

await check('chapters that do not fit the real duration are rejected as a whole', async () => {
  addChapterBook('k2')
  await S().load('k2')
  current().loaded(1000) // shorter than the declared chapters
  assert.equal(S().chapterStatus, 'invalid')
  assert.deepEqual(S().chapters, [])
  assert.ok(S().chapterReason)
  await reset()
})

await check('the spec example: chapter two starts at 20:00, 5:00 in → Book 25:00, Chapter 5:00; switching scope does not move the audio', async () => {
  addChapterBook('k3')
  await S().load('k3')
  const el = current()
  el.loaded(3600)
  at(el, 25 * MIN)
  const view = (scope) => timelineView(scope, S().positionSeconds, S().durationSeconds, S().chapters)
  assert.equal(view('book').positionSeconds, 25 * MIN)
  assert.equal(view('chapter').positionSeconds, 5 * MIN)
  S().setScope('chapter')
  assert.equal(S().scope, 'chapter')
  assert.equal(el.currentTime, 25 * MIN, 'the element was not touched')
  assert.equal(S().positionSeconds, 25 * MIN)
  S().setScope('book')
  assert.equal(el.currentTime, 25 * MIN)
  assert.equal(S().positionSeconds, 25 * MIN)
  await reset()
})

await check('seeking on the chapter timeline maps to the book timeline and never leaves the chapter', async () => {
  addChapterBook('k4')
  await S().load('k4')
  const el = current()
  el.loaded(3600)
  at(el, 25 * MIN)
  S().setScope('chapter')
  S().seekScoped(10 * MIN); assert.equal(el.currentTime, 30 * MIN)
  S().seekScoped(0); assert.equal(el.currentTime, 20 * MIN)
  S().seekScoped(99999); assert.ok(Math.abs(el.currentTime - (45 * MIN - 0.1)) < 1e-6, "stops just inside the chapter")
  S().seekScoped(-5); assert.equal(el.currentTime, 20 * MIN)
  S().setScope('book')
  S().seekScoped(50 * MIN); assert.equal(el.currentTime, 50 * MIN, 'Book scope: relative = absolute')
  await reset()
})

await check('previous / next chapter and jumping to a chapter', async () => {
  addChapterBook('k5')
  await S().load('k5')
  const el = current()
  el.loaded(3600)
  at(el, 25 * MIN)
  S().previousChapter(); assert.equal(el.currentTime, 20 * MIN, 'past 3 s into a chapter: restart it')
  at(el, 20 * MIN + 2)
  S().previousChapter(); assert.equal(el.currentTime, 0, 'within 3 s of the start: previous chapter')
  S().nextChapter(); assert.equal(el.currentTime, 20 * MIN)
  S().nextChapter(); assert.equal(el.currentTime, 45 * MIN)
  at(el, 45 * MIN)
  S().nextChapter(); assert.equal(el.currentTime, 45 * MIN, 'the last chapter has no next')
  S().goToChapter('ch2'); assert.equal(el.currentTime, 20 * MIN)
  S().goToChapter('nope'); assert.equal(el.currentTime, 20 * MIN)
  await reset()
})

await check('scope, current chapter and position are saved together and restored; nothing resets', async () => {
  addChapterBook('k6')
  await S().load('k6')
  let el = current()
  el.loaded(3600)
  S().seekScoped(0) // book scope, position 0
  S().setScope('chapter')
  el.currentTime = 25 * MIN; el.fire('timeupdate')
  S().pause(); el.fire('pause'); await sleep(30)
  const saved = progressOf('k6')
  assert.equal(saved.positionSeconds, 25 * MIN)
  assert.equal(saved.scope, 'chapter')
  assert.equal(saved.chapterId, 'ch2')
  await S().dispose()
  await S().load('k6')
  el = current()
  el.loaded(3600)
  assert.equal(S().scope, 'chapter')
  assert.equal(el.currentTime, 25 * MIN)
  assert.equal(S().chapterStatus, 'ok')
  // changing the scope saves at once, without a position change
  calls.save.length = 0
  S().setScope('book'); await sleep(30)
  assert.equal(calls.save.at(-1).scope, 'book')
  assert.equal(calls.save.at(-1).positionSeconds, 25 * MIN)
  await reset()
})

await check('a position outside every chapter clears the stored chapter id (merge-patch null)', async () => {
  addChapterBook('k7')
  await S().load('k7')
  const el = current()
  el.loaded(3600)
  at(el, 100); S().pause(); el.fire('pause'); await sleep(30)
  assert.equal(progressOf('k7').chapterId, 'ch1')
  await overlays.saveAudioProgress('k7', { positionSeconds: 100, playbackRate: 1, chapterId: null })
  assert.equal(progressOf('k7').chapterId, undefined)
  await reset()
})

await check('bookmarks: create (with chapter + offset), persist, restore after reopening, resume, delete', async () => {
  addChapterBook('k8')
  await S().load('k8')
  let el = current()
  el.loaded(3600)
  at(el, 25 * MIN)
  S().addNote()
  at(el, 5)
  S().addNote('Start here')
  await sleep(30)
  assert.equal(S().notes.length, 2)
  const [first, second] = S().notes
  assert.equal(first.note, 'Start here')
  assert.deepEqual([second.label, second.chapterId, second.chapterOffsetSeconds, second.positionSeconds], ['Two · 25:00', 'ch2', 5 * MIN, 25 * MIN])
  const stored = stateOf2('k8')
  assert.equal(stored.audioBookmarks.length, 2)
  assert.ok(stored.audioProgress === undefined || stored.audioProgress, 'other keys are not disturbed')
  await S().dispose()
  await S().load('k8')
  el = current()
  el.loaded(3600)
  assert.equal(S().notes.length, 2, 'restored after reopening')
  S().goToNote(second.id)
  assert.equal(el.currentTime, 25 * MIN)
  S().removeNote(first.id)
  await sleep(30)
  assert.deepEqual(S().notes.map((b) => b.id), [second.id])
  assert.equal(stateOf2('k8').audioBookmarks.length, 1)
  assert.deepEqual((await invoke(AudioChannels.getBookmarks, 'k8')).map((b) => b.id), [second.id])
  S().removeNote('nope')
  await reset()
})

await check('bookmarks and progress live side by side in reading_state_json without overwriting each other or other keys', async () => {
  addChapterBook('k9', JSON.stringify({ fontSize: 17, futureKey: { x: 1 } }))
  await S().load('k9')
  const el = current()
  el.loaded(3600)
  at(el, 100)
  S().addNote('A')
  S().pause(); el.fire('pause'); await sleep(40)
  const s9 = stateOf2('k9')
  assert.equal(s9.fontSize, 17)
  assert.deepEqual(s9.futureKey, { x: 1 })
  assert.equal(s9.audioBookmarks.length, 1)
  assert.equal(s9.audioProgress.positionSeconds, 100)
  await reset()
})

await check('bookmark storage is audio-only and validated', async () => {
  const before = db.prepare(`SELECT reading_state_json j FROM books WHERE id = 't-nope'`).get()
  assert.equal(before, undefined)
  addBook('k10')
  db.prepare(`INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at) VALUES ('k-txt', 'T', ?, 'txt', 'sha-k-txt', 'reading', '{}', 't', 't')`).run(path.join(tmp, 'k10.mp3'))
  assert.deepEqual(await invoke(AudioChannels.saveBookmarks, { bookId: 'k-txt', bookmarks: [{ id: 'a', positionSeconds: 1 }] }), { ok: false })
  assert.equal(stateOf2('k-txt').audioBookmarks, undefined)
  for (const bad of [null, 'x', {}, { bookId: 'k10' }, { bookId: 'k10', bookmarks: 'no' }, { bookId: '', bookmarks: [] }])
    assert.deepEqual(await invoke(AudioChannels.saveBookmarks, bad), { ok: false })
  assert.deepEqual(await invoke(AudioChannels.saveBookmarks, { bookId: 'k10', bookmarks: [{ id: 'good', positionSeconds: 3 }, { id: 'bad', positionSeconds: -1 }, null] }), { ok: true })
  assert.deepEqual((await invoke(AudioChannels.getBookmarks, 'k10')).map((b) => b.id), ['good'])
  assert.deepEqual(await invoke(AudioChannels.getBookmarks, 'k-txt'), [])
  assert.deepEqual(await invoke(AudioChannels.getChapters, 'k-txt'), { ok: false, chapters: [] })
  assert.deepEqual(await invoke(AudioChannels.getChapters, ''), { ok: false, chapters: [] })
  assert.deepEqual(await invoke(AudioChannels.getChapters, 'does-not-exist'), { ok: false, chapters: [] })
})

await check('notes: add (with / without text), edit in place without a duplicate, persist, reload, delete', async () => {
  addChapterBook('n1')
  await S().load('n1')
  let el = current()
  el.loaded(3600)
  at(el, 25 * MIN)
  const plain = S().addNote()
  const withText = (at(el, 100), S().addNote('  quote  '))
  assert.ok(plain && withText)
  assert.equal(S().notes.length, 2)
  assert.deepEqual(S().notes.map((n) => [n.id, n.note]), [[withText, 'quote'], [plain, undefined]])
  // edit: same id, same position, same count
  const before = S().notes.find((n) => n.id === plain)
  S().updateNote(plain, ' now has text ')
  assert.equal(S().notes.length, 2)
  const after = S().notes.find((n) => n.id === plain)
  assert.equal(after.note, 'now has text')
  assert.equal(after.positionSeconds, before.positionSeconds)
  assert.equal(after.createdAt, before.createdAt)
  S().updateNote('nope', 'x'); assert.equal(S().notes.length, 2)
  await sleep(40)
  assert.deepEqual((await invoke(AudioChannels.getBookmarks, 'n1')).map((n) => [n.id, n.note]), [[withText, 'quote'], [plain, 'now has text']])
  // reload: the same notes come back (what the sidebar and the timeline both draw)
  await S().dispose()
  await S().load('n1')
  el = current(); el.loaded(3600)
  assert.deepEqual(S().notes.map((n) => [n.id, n.note]), [[withText, 'quote'], [plain, 'now has text']])
  S().goToNote(plain); assert.equal(el.currentTime, 25 * MIN)
  // clearing the text keeps the marker
  S().updateNote(plain, '   ')
  assert.equal(S().notes.length, 2)
  assert.equal(S().notes.find((n) => n.id === plain).note, undefined)
  S().removeNote(withText)
  await sleep(40)
  assert.deepEqual((await invoke(AudioChannels.getBookmarks, 'n1')).map((n) => n.id), [plain])
  S().removeNote('nope')
  assert.equal(S().notes.length, 1)
  await reset()
})

await check('notes: a very long text is capped; notes need a ready player', async () => {
  addChapterBook('n2')
  assert.equal(useAudioPlayerStore.getState().addNote(), null, 'nothing loaded: no note')
  await S().load('n2')
  assert.equal(S().addNote(), null, 'not ready yet (metadata has not arrived)')
  const el = current(); el.loaded(3600)
  const id = S().addNote('x'.repeat(5000))
  assert.equal(S().notes.find((n) => n.id === id).note.length, 2000)
  at(el, 99999)
  const late = S().addNote()
  assert.ok(S().notes.find((n) => n.id === late).positionSeconds <= 3600, 'a position is clamped into the audio')
  await reset()
})

await check('sleep timer: minutes (fires once, pauses, resets), cancel, and "end of chapter"', async () => {
  addChapterBook('k11')
  await S().load('k11')
  const el = current()
  el.loaded(3600)
  const realSet = globalThis.setTimeout
  const realClear = globalThis.clearTimeout
  const timers = []
  globalThis.setTimeout = (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t }
  globalThis.clearTimeout = (t) => { if (t && typeof t === 'object') t.cleared = true }
  try {
    S().setSleep({ kind: 'minutes', minutes: 15 })
    assert.deepEqual(S().sleep, { kind: 'minutes', minutes: 15 })
    assert.ok(S().sleepEndsAt > Date.now() + 14 * 60_000)
    assert.equal(timers.at(-1).ms, 15 * 60_000)
    S().setSleep({ kind: 'off' })
    assert.equal(timers.at(-1).cleared, true)
    assert.equal(S().sleepEndsAt, null)
    S().setSleep({ kind: 'minutes', minutes: 30 })
    S().play()
    await new Promise((r) => realSet(r, 10)) // the helper `sleep` would use the patched timer
    assert.equal(S().playing, true)
    timers.at(-1).fn() // the 30 minutes elapse
    assert.equal(el.paused, true)
    assert.deepEqual(S().sleep, { kind: 'off' })
    S().setSleep({ kind: 'minutes', minutes: 99999 }) // clamped
    assert.equal(S().sleep.minutes, 600)
    S().setSleep({ kind: 'off' })
  } finally {
    globalThis.setTimeout = realSet
    globalThis.clearTimeout = realClear
  }
  at(el, 10 * MIN)
  S().play(); await sleep(10)
  S().setSleep({ kind: 'chapter' })
  assert.deepEqual(S().sleep, { kind: 'chapter' })
  at(el, 19 * MIN)
  assert.equal(el.paused, false, 'not yet at the chapter end')
  at(el, 20 * MIN - 0.2)
  assert.equal(el.paused, true, 'stopped at the end of the chapter')
  assert.deepEqual(S().sleep, { kind: 'off' })
  await reset()
})

await check('volume: clamped, applied to the element, remembered for the next book', async () => {
  addBook('v1'); addBook('v2')
  await S().load('v1')
  let el = current()
  el.loaded(60)
  S().setVolume(0.4)
  assert.equal(el.volume, 0.4)
  S().setVolume(7); assert.equal(el.volume, 1)
  S().setVolume(-1); assert.equal(el.volume, 0)
  S().setVolume(Number.NaN); assert.equal(el.volume, 1)
  S().setVolume(0.4)
  assert.equal(store_.get('readmate.audioVolume.v1'), '0.4')
  await S().load('v2')
  el = current()
  assert.equal(el.volume, 0.4)
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

// ---- 5. multi-track audiobooks (Stage B1): track switching, races, errors ----
console.log('5. multi-track: load, restore, switching, races, errors')
const { randomUUID } = await import('node:crypto')
const { chapterFileName } = await import('@reading-book/book-reader-sdk')
const insertChapter = db.prepare(
  `INSERT INTO book_audio_chapters (id, book_id, position, title, file_name, source_path, file_format, size_bytes, sha256, duration_seconds)
   VALUES (?, ?, ?, ?, ?, ?, 'mp3', 10, ?, ?)`,
)
/** A multi-track book: real rows in `books` + `book_audio_chapters` (so the REAL Main IPC and guards answer). */
function addMulti(id, durations = [60, null, 90, 30]) {
  const dir = path.join(tmp, id)
  fs.mkdirSync(dir)
  const ids = durations.map(() => randomUUID())
  const first = path.join(dir, chapterFileName(0, ids[0], 'mp3'))
  fs.writeFileSync(first, Buffer.alloc(1000, 1))
  insertBook.run(id, `Book ${id}`, first, `sha-${id}`, '{}')
  durations.forEach((d, i) =>
    insertChapter.run(ids[i], id, i, `Track ${i + 1}`, chapterFileName(i, ids[i], 'mp3'), `CD/${i + 1}.mp3`, `${i}`.padStart(64, '0'), d),
  )
  return ids
}
const url = (book, trackId) => audioStreamUrl(book, trackId)
const settle = () => sleep(15)
/** Open a multi-track book, finish loading its first track, and start it playing at `position` seconds. */
async function openPlaying(id, durations, position = 12) {
  const ids = addMulti(id, durations)
  await S().load(id)
  const el = current()
  el.loaded(durations[0] ?? 60)
  S().play()
  await settle()
  el.currentTime = position
  return { ids, el }
}
const statusLog = []
store.subscribe((s) => statusLog.push(s.status))

await check('load: tracks come from Main (ids, titles, durations — no paths), the first track streams from its own URL, Notes are read once', async () => {
  const ids = addMulti('mt-m1')
  calls.getBookmarks.length = 0
  await S().load('mt-m1')
  assert.deepEqual(S().tracks.map((t) => [t.id, t.title, t.durationSeconds]), ids.map((id, i) => [id, `Track ${i + 1}`, [60, null, 90, 30][i]]))
  assert.ok(S().tracks.every((t) => Object.keys(t).sort().join() === 'durationSeconds,id,title'), 'no file name / path crosses IPC')
  const el = current()
  assert.equal(el.src, url('mt-m1', ids[0]))
  assert.equal(S().trackIndex, 0)
  assert.equal(S().switching, true)
  assert.equal(S().status, 'loading')
  el.loaded(60)
  assert.deepEqual([S().status, S().switching, S().durationSeconds], ['ready', false, 60])
  assert.deepEqual(S().notes, [])
  assert.deepEqual(calls.getBookmarks, ['mt-m1'], 'Notes are read once, after the tracks are known')
  assert.equal(S().notesUnavailable, false)
  assert.ok(S().addNote(), 'a Note can be added to a loaded multi-track book')
  await reset()
})

await check('restore: a saved trackId + position resumes in THAT track (rate restored too)', async () => {
  const ids = addMulti('mt-m2')
  assert.deepEqual(await invoke(OverlayChannels.saveAudioProgress, { bookId: 'mt-m2', positionSeconds: 33, playbackRate: 1.5, trackId: ids[2] }), { ok: true })
  await S().load('mt-m2')
  const el = current()
  assert.equal(el.src, url('mt-m2', ids[2]))
  assert.equal(S().trackIndex, 2)
  assert.equal(S().playbackRate, 1.5)
  el.loaded(90)
  assert.equal(el.currentTime, 33)
  assert.equal(S().positionSeconds, 33)
  await reset()
})

await check('restore: a missing, unknown or legacy-shaped trackId starts track 0 at 0 — the saved position is NEVER applied', async () => {
  for (const [id, audioProgress] of [
    ['mt-m3a', { positionSeconds: 500, playbackRate: 1, updatedAt: 'x' }], // legacy shape: position without a track
    ['mt-m3b', { positionSeconds: 500, playbackRate: 1, trackId: 'not-a-track-of-this-book', updatedAt: 'x' }],
    ['mt-m3c', { positionSeconds: 500, playbackRate: 1, trackId: 7, updatedAt: 'x' }],
  ]) {
    const ids = addMulti(id)
    db.prepare('UPDATE books SET reading_state_json = ? WHERE id = ?').run(JSON.stringify({ audioProgress }), id)
    await S().load(id)
    const el = current()
    assert.equal(el.src, url(id, ids[0]), id)
    el.loaded(60)
    assert.equal(el.currentTime, 0, id)
    assert.equal(S().positionSeconds, 0, id)
    assert.equal(S().trackIndex, 0, id)
    await reset()
  }
})

await check('saved progress of a multi-track book: trackId + the position IN the track, and no percent / duration / chapter id (real Main guard accepted it)', async () => {
  const { ids, el } = await openPlaying('mt-m4', [60, null, 90, 30], 12)
  calls.save.length = 0
  el.pause()
  await settle()
  assert.deepEqual(calls.save[0], { bookId: 'mt-m4', positionSeconds: 12, playbackRate: 1, scope: 'book', trackId: ids[0] })
  const state = JSON.parse(db.prepare('SELECT reading_state_json j FROM books WHERE id = ?').get('mt-m4').j)
  assert.equal(state.audioProgress.trackId, ids[0])
  assert.equal('percent' in state, false)
  assert.equal('durationSeconds' in state.audioProgress, false)
  assert.equal('chapterId' in state.audioProgress, false)
  await reset()
})

await check('click another track while PLAYING: it plays from 0 on a new element, the old one is retired; status stays ready', async () => {
  const { ids, el: a } = await openPlaying('mt-m5', [60, 45, 90, 30], 20)
  const before = elements.length
  S().goToTrack(1)
  assert.equal(elements.length, before + 1, 'a new element per track')
  assert.equal(a.released, true)
  assert.equal(a.src, '')
  const b = current()
  assert.equal(b.src, url('mt-m5', ids[1]))
  assert.deepEqual([S().trackIndex, S().switching, S().status, S().positionSeconds], [1, true, 'ready', 0])
  b.loaded(45)
  assert.deepEqual([S().switching, S().durationSeconds, S().playing], [false, 45, true], 'play state preserved')
  assert.equal(b.paused, false)
  await reset()
})

await check('click another track while PAUSED: it loads and STAYS paused', async () => {
  const ids = addMulti('mt-m6')
  await S().load('mt-m6')
  const a = current()
  a.loaded(60)
  assert.equal(S().playing, false)
  S().goToTrack(2)
  const b = current()
  b.loaded(90)
  assert.deepEqual([S().trackIndex, S().playing, S().switching], [2, false, false])
  assert.equal(b.paused, true)
  assert.equal(b.src, url('mt-m6', ids[2]))
  await reset()
})

await check('click the CURRENT track: nothing happens — no element, no save, no seek, no state change', async () => {
  const { el } = await openPlaying('mt-m7', [60, 45, 90, 30], 20)
  await settle()
  calls.save.length = 0
  const before = { elements: elements.length, state: { ...S() } }
  S().goToTrack(0)
  await settle()
  assert.equal(elements.length, before.elements)
  assert.equal(el.released, false)
  assert.equal(el.currentTime, 20)
  assert.equal(calls.save.length, 0)
  assert.deepEqual([S().trackIndex, S().switching, S().playing, S().positionSeconds], [0, false, true, before.state.positionSeconds])
  // out-of-range / invalid indices are ignored too
  for (const bad of [-1, 4, 1.5, Number.NaN]) S().goToTrack(bad)
  assert.equal(elements.length, before.elements)
  await reset()
})

await check('RACE  A playing → B FAILS → C: stale events of B change nothing; A@12 saved once, never as B; C plays and saves as C', async () => {
  statusLog.length = 0
  const { ids, el: a } = await openPlaying('mt-r1', [60, 45, 90, 30], 12)
  calls.save.length = 0
  S().goToTrack(1) // A → B
  // the OLD track was saved first, from the OLD element and the OLD trackId
  assert.deepEqual([S().switching, S().trackIndex, S().status], [true, 1, 'ready'])
  await settle()
  assert.equal(calls.save.length, 1)
  assert.deepEqual(calls.save[0], { bookId: 'mt-r1', positionSeconds: 12, playbackRate: 1, scope: 'book', trackId: ids[0] })
  const b = current()
  b.error = { code: 4 }
  b.fire('error') // B cannot be played
  assert.deepEqual([S().switching, S().status, S().playing], [false, 'ready', false])
  assert.deepEqual([...S().trackErrors], [ids[1]])
  await settle()
  assert.equal(calls.save.length, 1, 'nothing is saved for the failed track')
  assert.equal(JSON.parse(db.prepare('SELECT reading_state_json j FROM books WHERE id = ?').get('mt-r1').j).audioProgress.trackId, ids[0], 'last good progress is still A')
  // the user picks C although B just failed
  S().goToTrack(2)
  const c = current()
  assert.notEqual(c, b)
  assert.equal(b.released, true)
  assert.equal(c.src, url('mt-r1', ids[2]))
  const snapshot = { ...S(), tracks: undefined }
  const elementsNow = elements.length
  const savesNow = calls.save.length
  // B's LATE events (its element was retired): none of them may touch C or the store
  b.duration = 777
  b.currentTime = 99
  for (const type of ['loadedmetadata', 'durationchange', 'canplay', 'timeupdate', 'seeking', 'seeked', 'waiting', 'playing', 'pause', 'ratechange', 'ended', 'error']) {
    b.fire(type)
    assert.equal(S().trackIndex, 2, type)
    assert.equal(S().switching, true, `${type}: C is still loading`)
    assert.equal(S().positionSeconds, snapshot.positionSeconds, type)
    assert.equal(S().durationSeconds, 90, type)
    assert.equal(S().playing, snapshot.playing, type)
    assert.equal(S().ended, false, type)
    assert.deepEqual([...S().trackErrors], [ids[1]], type)
    assert.equal(c.currentTime, 0, `${type}: C was not seeked`)
    assert.equal(elements.length, elementsNow, `${type}: no auto-advance / new element`)
  }
  await settle()
  assert.equal(calls.save.length, savesNow, 'stale events wrote nothing')
  c.loaded(90)
  assert.deepEqual([S().switching, S().trackIndex], [false, 2])
  assert.equal(c.currentTime, 0, 'C starts at its own offset (0), not B\'s 99')
  S().play()
  await settle()
  assert.equal(S().playing, true, 'C can be played')
  c.currentTime = 5
  c.pause()
  await settle()
  assert.deepEqual(calls.save.at(-1), { bookId: 'mt-r1', positionSeconds: 5, playbackRate: 1, scope: 'book', trackId: ids[2] })
  assert.ok(calls.save.every((s) => s.trackId !== ids[1]), 'no save was ever made with the failed track\'s id')
  assert.equal(JSON.parse(db.prepare('SELECT reading_state_json j FROM books WHERE id = ?').get('mt-r1').j).audioProgress.trackId, ids[2])
  assert.ok(a.released)
  assert.ok(statusLog.every((s) => s === 'ready' || s === 'idle' || s === 'loading') && !statusLog.slice(statusLog.indexOf('ready')).includes('loading') && !statusLog.includes('error'), `status never left ready during the switches: ${[...new Set(statusLog)]}`)
  await reset()
})

await check('RACE  A → B (still loading) → C: B\'s late metadata is dropped, C\'s offset applied once, ONE save in total (A)', async () => {
  const { ids } = await openPlaying('mt-r2', [60, 45, 90, 30], 7)
  calls.save.length = 0
  S().goToTrack(1)
  const b = current()
  S().goToTrack(2) // before B ever loaded
  const c = current()
  assert.equal(b.released, true)
  assert.equal(c.src, url('mt-r2', ids[2]))
  b.duration = 45
  b.fire('loadedmetadata') // B answers late
  b.fire('canplay')
  assert.deepEqual([S().switching, S().trackIndex, S().durationSeconds], [true, 2, 90], 'C is still the one loading')
  assert.equal(c.currentTime, 0)
  c.loaded(90)
  assert.deepEqual([S().switching, S().trackIndex], [false, 2])
  await settle()
  assert.equal(calls.save.length, 1, 'exactly one save: the track the user left')
  assert.deepEqual([calls.save[0].trackId, calls.save[0].positionSeconds], [ids[0], 7])
  await reset()
})

await check('RACE  rapid A → B → C → D: only D is loaded and current, one save (A), and a slow save of A cannot land after later ones', async () => {
  const { ids } = await openPlaying('mt-r3', [60, 45, 90, 30], 9)
  calls.save.length = 0
  calls.delays.push(60) // the first write (A) is slow
  S().goToTrack(1)
  S().goToTrack(2)
  S().goToTrack(3)
  assert.equal(elements.filter((e) => !e.released).length, 1, 'one live element')
  const d = current()
  assert.equal(d.src, url('mt-r3', ids[3]))
  d.loaded(30)
  S().play()
  await settle()
  d.currentTime = 3
  d.pause() // a later write (D) while A's write is still in flight
  await sleep(150)
  assert.deepEqual(calls.save.map((s) => [s.trackId, s.positionSeconds]), [[ids[0], 9], [ids[3], 3]], 'saves made in order, none for B or C')
  assert.equal(JSON.parse(db.prepare('SELECT reading_state_json j FROM books WHERE id = ?').get('mt-r3').j).audioProgress.trackId, ids[3], 'the last write wins')
  await reset()
})

await check('NO WRITES while switching: pause/seeked on the new element and a window flush are skipped; writing resumes after metadata', async () => {
  const { ids } = await openPlaying('mt-r4', [60, 45, 90, 30], 15)
  S().goToTrack(1)
  await settle()
  calls.save.length = 0
  const b = current()
  b.fire('pause')
  b.fire('seeked')
  b.fire('ratechange')
  await flushRegisteredSession()
  await settle()
  assert.equal(calls.save.length, 0)
  b.loaded(45)
  b.currentTime = 2
  b.fire('pause')
  await settle()
  assert.deepEqual([calls.save.at(-1)?.trackId, calls.save.at(-1)?.positionSeconds], [ids[1], 2])
  await reset()
})

await check('a track that fails to load: the player stays up (status ready), the row is marked, other tracks work; clicking it again retries', async () => {
  const ids = addMulti('mt-r5')
  await S().load('mt-r5')
  const a = current()
  a.fire('error') // the very first track cannot be opened
  assert.deepEqual([S().status, S().switching, S().playing], ['ready', false, false])
  assert.deepEqual([...S().trackErrors], [ids[0]])
  S().goToTrack(1) // another track is chosen
  const b = current()
  b.loaded(60)
  assert.deepEqual([S().trackIndex, S().trackErrors.size, S().switching], [1, 1, false])
  // retry the failed track
  const before = elements.length
  S().goToTrack(0)
  assert.equal(elements.length, before + 1)
  assert.equal(S().trackErrors.has(ids[0]), false)
  assert.equal(S().switching, true)
  current().loaded(60)
  assert.equal(S().switching, false)
  // a play() rejected by the element is a per-track failure too (never the screen-level error)
  const el = current()
  el.play = async () => { throw new DOMException('not supported', 'NotSupportedError') }
  S().play()
  await settle()
  assert.equal(S().status, 'ready')
  assert.equal(S().trackErrors.has(ids[0]), true)
  await reset()
})

await check('previous / next TRACK buttons: next = +1 keeping the play state and nothing after the last; previous restarts after 3 s (and on the first track), else goes back one', async () => {
  const { ids, el: a } = await openPlaying('mt-n1', [60, 45, 90, 30], 1) // playing, 1 s in
  S().nextChapter()
  const b = current()
  assert.notEqual(b, a)
  assert.deepEqual([S().trackIndex, a.released, b.src], [1, true, url('mt-n1', ids[1])])
  b.loaded(45)
  assert.equal(S().playing, true, 'a playing player keeps playing on the next track')
  b.currentTime = 1 // under 3 s: back one track
  S().previousChapter()
  const a2 = current()
  assert.equal(S().trackIndex, 0)
  a2.loaded(60)
  a2.currentTime = 10 // over 3 s: restart this track, no new element
  let count = elements.length
  S().previousChapter()
  assert.deepEqual([elements.length, a2.currentTime, S().trackIndex], [count, 0, 0])
  a2.currentTime = 1 // first track: previous only restarts
  S().previousChapter()
  assert.deepEqual([elements.length, a2.currentTime, S().trackIndex], [count, 0, 0])
  S().goToTrack(3)
  current().loaded(30)
  count = elements.length
  S().nextChapter() // after the last track: nothing
  assert.deepEqual([elements.length, S().trackIndex], [count, 3])
  await reset()
  // paused stays paused
  const ids2 = addMulti('mt-n2')
  await S().load('mt-n2')
  current().loaded(60)
  assert.equal(S().playing, false)
  S().nextChapter()
  const c = current()
  c.loaded(45)
  assert.deepEqual([S().trackIndex, S().playing, c.paused, c.src], [1, false, true, url('mt-n2', ids2[1])])
  await reset()
})

await check('AUTO-ADVANCE: when a track ends the next one starts playing; the next track (not the finished one\'s end) is what gets saved; a minutes timer keeps running', async () => {
  const { ids, el: a } = await openPlaying('mt-aa1', [60, 45, 90, 30], 59)
  S().setSleep({ kind: 'minutes', minutes: 15 })
  calls.save.length = 0
  const count = elements.length
  a.currentTime = 60
  a.ended = true
  a.fire('ended')
  assert.equal(elements.length, count + 1, 'one new element for the next track')
  const b = current()
  assert.equal(a.released, true)
  assert.equal(b.src, url('mt-aa1', ids[1]))
  assert.deepEqual([S().trackIndex, S().switching, S().status, S().ended], [1, true, 'ready', false])
  assert.equal(S().sleep.kind, 'minutes', 'the sleep timer survives the advance')
  b.loaded(45)
  await settle()
  assert.deepEqual([S().playing, b.paused, S().switching], [true, false, false], 'the next track plays')
  assert.deepEqual(calls.save.map((s) => [s.trackId, s.positionSeconds]), [[ids[1], 0]], 'saved once: the NEW track at 0 — never the finished track\'s end')
  const stored = JSON.parse(db.prepare('SELECT reading_state_json j FROM books WHERE id = ?').get('mt-aa1').j)
  assert.equal(stored.audioProgress.trackId, ids[1])
  S().setSleep({ kind: 'off' })
  await reset()
})

await check('AUTO-ADVANCE: the LAST track just stops (ended, not playing, nothing further opened) and clears the sleep timer', async () => {
  const { ids } = await openPlaying('mt-aa2', [60, 45, 90, 30], 1)
  S().goToTrack(3)
  const last = current()
  last.loaded(30)
  await settle()
  S().setSleep({ kind: 'minutes', minutes: 15 })
  calls.save.length = 0
  const count = elements.length
  last.currentTime = 30
  last.ended = true
  last.fire('ended')
  await settle()
  assert.equal(elements.length, count, 'nothing opened after the last track')
  assert.deepEqual([S().trackIndex, S().playing, S().ended, S().sleep.kind], [3, false, true, 'off'])
  assert.deepEqual([calls.save.at(-1).trackId, calls.save.at(-1).positionSeconds], [ids[3], 30])
  await reset()
})

await check('AUTO-ADVANCE: if the next track cannot be opened it is marked and playback stops there — no skipping on to a third track', async () => {
  const { ids, el: a } = await openPlaying('mt-aa3', [60, 45, 90, 30], 59)
  a.currentTime = 60
  a.ended = true
  a.fire('ended')
  const b = current()
  const count = elements.length
  b.fire('error')
  await settle()
  assert.deepEqual([S().trackIndex, S().playing, S().status, S().switching], [1, false, 'ready', false])
  assert.deepEqual([...S().trackErrors], [ids[1]])
  assert.equal(elements.length, count, 'no third track was opened by itself')
  // the user can still go on by hand
  S().nextChapter()
  current().loaded(90)
  assert.equal(S().trackIndex, 2)
  await reset()
})

await check('SLEEP "end of track": pauses at the end of the CURRENT track without advancing; a different track starts without it; no timer while the duration is unknown', async () => {
  const { ids, el: a } = await openPlaying('mt-sl1', [60, 45, 90, 30], 10)
  S().setSleep({ kind: 'chapter' })
  assert.equal(S().sleep.kind, 'chapter')
  const count = elements.length
  a.currentTime = 59.8
  a.fire('timeupdate')
  assert.deepEqual([a.paused, S().sleep.kind, elements.length], [true, 'off', count], 'paused at the end of the track, timer used up, no advance')
  assert.equal(S().trackIndex, 0)
  // armed, then another track is chosen: the timer does not carry over to it
  S().setSleep({ kind: 'chapter' })
  assert.equal(S().sleep.kind, 'chapter')
  S().goToTrack(1)
  assert.equal(S().sleep.kind, 'off')
  // not armed while a track is still loading (no duration yet)
  S().setSleep({ kind: 'chapter' })
  assert.equal(S().sleep.kind, 'off')
  current().loaded(45)
  S().setSleep({ kind: 'chapter' })
  assert.equal(S().sleep.kind, 'chapter')
  S().setSleep({ kind: 'off' })
  void ids
  await reset()
})

await check('status never left ready during any of the multi-track switches above (no full-screen "opening…" / error)', () => {
  const afterFirstReady = statusLog.slice(statusLog.indexOf('ready'))
  assert.equal(afterFirstReady.includes('error'), false)
})

await check('single-file regression: one element, no tracks, no trackId in the saved payload, Notes still work', async () => {
  addBook('mt-s1')
  const before = elements.length
  await S().load('mt-s1')
  const el = current()
  el.loaded(100)
  assert.equal(elements.length, before + 1)
  assert.deepEqual([S().tracks.length, S().trackIndex, S().switching], [0, -1, false])
  S().play()
  await settle()
  calls.save.length = 0
  el.currentTime = 10
  el.pause()
  await settle()
  assert.deepEqual(calls.save[0], { bookId: 'mt-s1', positionSeconds: 10, playbackRate: 1, scope: 'book', durationSeconds: 100 })
  assert.equal('trackId' in calls.save[0], false)
  S().goToTrack(1) // a no-op for a single-file book
  assert.equal(elements.length, before + 1)
  assert.ok(S().addNote())
  await reset()
})

// ---- 6. Notes for multi-track audiobooks: add / list / edit / delete, jumps, fallback and races, limits ----
console.log('6. multi-track Notes: add, list, edit, delete, jumps, fallback, races, limits')
const { notesForTrack, noteMarkerFraction } = await import('@reading-book/book-reader-sdk')
const rawState = (id) => JSON.parse(db.prepare('SELECT reading_state_json j FROM books WHERE id = ?').get(id).j)
const mkNote = (id, trackId, positionSeconds, extra = {}) => ({ id, label: `L-${id}`, positionSeconds, createdAt: '2026-01-01T00:00:00Z', ...extra, trackId })
/** A multi-track book seeded with Notes (`notes(ids)`), opened, track 0 loaded and PLAYING at `position`. Counters are cleared. */
async function openJ(id, durations, notes, position = 12) {
  const ids = addMulti(id, durations)
  db.prepare('UPDATE books SET reading_state_json = ? WHERE id = ?').run(JSON.stringify({ audioBookmarks: notes(ids) }), id)
  await S().load(id)
  const el = current()
  el.loaded(durations[0] ?? 60)
  S().play()
  await settle()
  el.currentTime = position
  calls.save.length = 0
  calls.bookmarks.length = 0
  return { ids, el }
}
const JNOTES = (ids) => [
  mkNote('nA', ids[0], 40),
  mkNote('nB', ids[1], 30),
  mkNote('nC', ids[2], 85),
  mkNote('nD', ids[3], 29),
  mkNote('nE', ids[2], 500),
  mkNote('nF', ids[1], 45),
]
const JDUR = [100, 60, 90, 30]
const savedTrackIds = () => calls.save.map((s) => s.trackId)

await check('NOTES add: current track + current second, with / without text, stored with trackId and no chapter reference; same-second Notes both kept; ZERO progress saves; other tracks later come out in track order', async () => {
  const { ids } = await openPlaying('nt-n1', [60, 45, 90, 30], 12)
  calls.save.length = 0
  const plain = S().addNote()
  const texted = S().addNote('with text')
  assert.ok(plain && texted && plain !== texted)
  assert.deepEqual(S().notes.map((n) => [n.trackId, n.positionSeconds]), [[ids[0], 12], [ids[0], 12]])
  assert.equal(S().notes.find((n) => n.id === plain).label, 'Track 1 · 0:12')
  assert.equal(S().notes.find((n) => n.id === texted).note, 'with text')
  await sleep(30)
  assert.equal(calls.save.length, 0, 'adding a Note issues no saveAudioProgress')
  assert.equal(rawState('nt-n1').audioProgress, undefined, 'stored audioProgress untouched')
  const stored = stateOf2('nt-n1').audioBookmarks
  assert.deepEqual(stored.map((n) => n.id).sort(), [plain, texted].sort())
  assert.ok(stored.every((n) => n.trackId === ids[0] && !('chapterId' in n) && !('chapterOffsetSeconds' in n)))
  // a Note on a later track, made while the first track's Notes exist
  S().goToTrack(2)
  current().loaded(90)
  current().currentTime = 20
  const later = S().addNote()
  assert.deepEqual(S().notes.map((n) => n.trackId), [ids[0], ids[0], ids[2]])
  assert.equal(S().notes.find((n) => n.id === later).positionSeconds, 20)
  await reset()
})

await check('NOTES add is unavailable (no Note, nothing saved) before the track is ready, while switching and on a failed track; a track of unknown length still accepts one', async () => {
  const ids = addMulti('nt-n2', [60, 45, 90, 30])
  calls.bookmarks.length = 0
  await S().load('nt-n2')
  assert.equal(selectCanAddNote(S()), false, 'not ready')
  assert.equal(S().addNote(), null)
  current().loaded(60)
  assert.equal(selectCanAddNote(S()), true)
  S().goToTrack(1) // a switch in flight
  assert.equal(selectCanAddNote(S()), false, 'switching')
  assert.equal(S().addNote(), null)
  current().fire('error') // the track failed
  assert.deepEqual([S().status, S().switching, [...S().trackErrors]], ['ready', false, [ids[1]]])
  assert.equal(selectCanAddNote(S()), false, 'failed track')
  assert.equal(S().addNote(), null)
  assert.equal(S().notes.length, 0)
  await sleep(30)
  assert.equal(calls.bookmarks.length, 0, 'nothing was saved')
  await reset()
  // unknown duration (NaN from the element): the position comes from where playback is
  addMulti('nt-n3', [null, 50])
  await S().load('nt-n3')
  const el = current()
  el.loaded(NaN)
  assert.equal(S().durationSeconds, null)
  el.currentTime = 7
  const id = S().addNote()
  assert.ok(id)
  assert.equal(S().notes[0].positionSeconds, 7)
  assert.equal(noteMarkerFraction(7, S().durationSeconds), null, 'no marker while the duration is unknown')
  await reset()
})

await check('NOTES list / edit / delete: order across tracks, restore after reopening, edit keeps track + second + id, zero progress saves, other state untouched; a FAILED current track keeps Notes editable and deletable while add stays blocked', async () => {
  const { ids } = await openPlaying('nt-n4', [60, 45, 90, 30], 10)
  const a = S().addNote('a') // track 0 @10
  S().goToTrack(2)
  current().loaded(90)
  current().currentTime = 5
  const b = S().addNote('b') // track 2 @5
  S().goToTrack(1)
  current().loaded(45)
  current().currentTime = 33
  const c = S().addNote('c') // track 1 @33
  assert.deepEqual(S().notes.map((n) => n.id), [a, c, b], 'ordered by track, not by creation')
  await sleep(30)
  await S().dispose()
  await S().load('nt-n4')
  current().loaded(45)
  assert.deepEqual(S().notes.map((n) => n.id), [a, c, b], 'restored in the same order after reopening')
  assert.deepEqual(S().notes.map((n) => n.trackId), [ids[0], ids[1], ids[2]])
  calls.save.length = 0
  const before = S().notes.find((n) => n.id === c)
  S().updateNote(c, 'edited')
  const after = S().notes.find((n) => n.id === c)
  assert.deepEqual([after.id, after.trackId, after.positionSeconds, after.createdAt, after.note], [before.id, before.trackId, before.positionSeconds, before.createdAt, 'edited'])
  assert.equal(S().notes.length, 3, 'no duplicate')
  await sleep(30)
  assert.equal(stateOf2('nt-n4').audioBookmarks.find((n) => n.id === c).note, 'edited')
  // the current track fails: its Notes (and the others') stay listed, editable and deletable; adding is blocked
  current().fire('error')
  assert.equal(selectCanAddNote(S()), false)
  assert.equal(S().addNote(), null)
  S().updateNote(a, 'a2')
  S().removeNote(b)
  assert.deepEqual(S().notes.map((n) => [n.id, n.note]), [[a, 'a2'], [c, 'edited']])
  await sleep(30)
  assert.deepEqual(stateOf2('nt-n4').audioBookmarks.map((n) => n.id).sort(), [a, c].sort())
  assert.equal(calls.save.length, 0, 'edit and delete issue no saveAudioProgress')
  await reset()
})

await check('NOTES mutations leave every other reading-state key and the stored audioProgress untouched (renderer path)', async () => {
  const ids = addMulti('nt-p1')
  const seed = {
    lastReadLocation: { k: 1 },
    fontSize: 18,
    futureKey: { a: [1, { b: 2 }] },
    audioProgress: { trackId: ids[0], positionSeconds: 0, playbackRate: 1, scope: 'book', updatedAt: '2026-01-01T00:00:00Z' },
  }
  db.prepare('UPDATE books SET reading_state_json = ? WHERE id = ?').run(JSON.stringify(seed), 'nt-p1')
  await S().load('nt-p1')
  current().loaded(60)
  calls.save.length = 0
  const othersUntouched = (step) => {
    const { audioBookmarks: _n, ...rest } = rawState('nt-p1')
    void _n
    assert.deepEqual(rest, seed, `${step}: everything except audioBookmarks equals the seed`)
    assert.equal(JSON.stringify(rest.audioProgress), JSON.stringify(seed.audioProgress), `${step}: audioProgress byte-identical`)
  }
  const id = S().addNote('x')
  await sleep(30)
  othersUntouched('add')
  S().updateNote(id, 'y')
  await sleep(30)
  othersUntouched('edit')
  S().removeNote(id)
  await sleep(30)
  othersUntouched('delete')
  assert.equal(calls.save.length, 0)
  await reset()
})

await check('NOTES rapid add → edit → delete → add back (no awaiting): the stored list equals the last list seen, no duplicate, nothing resurrected; saves reach Main in call order', async () => {
  await openPlaying('nt-n5', [60, 45, 90, 30], 12)
  calls.bookmarks.length = 0
  const first = S().addNote('one')
  S().updateNote(first, 'one edited')
  S().removeNote(first)
  const back = S().addNote('one')
  assert.notEqual(first, back)
  const seen = S().notes.map((n) => n.id)
  assert.deepEqual(seen, [back])
  await sleep(60)
  assert.deepEqual(calls.bookmarks.map((c) => c.bookmarks.map((n) => n.id)), [[first], [first], [], [back]], 'one save per action, in order')
  assert.equal(calls.bookmarks[1].bookmarks[0].note, 'one edited')
  assert.deepEqual((await invoke(AudioChannels.getBookmarks, 'nt-n5')).map((n) => n.id), seen, 'stored == the last list seen')
  assert.deepEqual(S().notes.map((n) => n.id), seen)
  await reset()
})

await check('NOTES jump: same track = position only (no new element, no reload); other track keeps PLAYING / PAUSED; saves follow the usual rules (old track first, then only {trackId, positionSeconds})', async () => {
  const { ids, el: a } = await openJ('nt-j1', JDUR, JNOTES)
  const elementsBefore = elements.length
  S().goToNote('nA') // same track
  assert.equal(elements.length, elementsBefore, 'no new element')
  assert.equal(a.currentTime, 40)
  assert.deepEqual([S().trackIndex, S().switching, S().positionSeconds], [0, false, 40])
  // other track while playing
  calls.save.length = 0
  a.currentTime = 12
  S().goToNote('nC')
  assert.deepEqual([S().trackIndex, S().switching, S().playing, S().status], [2, true, true, 'ready'])
  const c = current()
  assert.equal(c.src, url('nt-j1', ids[2]))
  assert.equal(a.released, true)
  c.loaded(90)
  await settle()
  assert.equal(c.currentTime, 85, 'the exact second of the Note')
  assert.equal(S().playing, true, 'playing stays playing')
  assert.deepEqual(calls.save, [
    { bookId: 'nt-j1', positionSeconds: 12, playbackRate: 1, scope: 'book', trackId: ids[0] },
    { bookId: 'nt-j1', positionSeconds: 85, playbackRate: 1, scope: 'book', trackId: ids[2] },
  ])
  assert.ok(calls.save.every((s) => !('percent' in s) && !('durationSeconds' in s) && !('chapterId' in s)))
  // other track while paused
  S().pause()
  await settle()
  calls.save.length = 0
  S().goToNote('nB')
  const b = current()
  b.loaded(60)
  await settle()
  assert.equal(b.currentTime, 30)
  assert.deepEqual([S().playing, b.paused, S().trackIndex], [false, true, 1], 'paused stays paused')
  await reset()
})

await check('NOTES jump lands EXACTLY near the end of a track (not restarted at 0) and is clamped when the second is beyond the real length', async () => {
  const { ids } = await openJ('nt-j2', JDUR, JNOTES)
  S().goToNote('nD') // track 3 (30 s) @29 — inside the "restart a finished track" window
  current().loaded(30)
  assert.equal(current().currentTime, 29)
  assert.equal(S().positionSeconds, 29)
  S().goToNote('nE') // track 2 (90 s) @500
  current().loaded(90)
  assert.equal(current().currentTime, 90, 'clamped to the end of the track, not rejected')
  assert.equal(S().trackIndex, 2)
  assert.ok(ids)
  await reset()
})

await check('NOTES jump RACE: 3 rapid jumps and a run of 12 across tracks end on the LAST Note only; every late metadata of a retired element is ignored; a second Note on the track still loading is not lost', async () => {
  const { ids } = await openJ('nt-j3', JDUR, JNOTES)
  S().goToNote('nB')
  const b = current()
  S().goToNote('nC')
  const c = current()
  b.loaded(60) // B's late metadata
  assert.deepEqual([S().trackIndex, S().switching], [2, true])
  assert.equal(c.currentTime, 0)
  c.loaded(90)
  assert.deepEqual([S().trackIndex, c.currentTime], [2, 85])
  assert.equal(b.currentTime, 0, "B's second was never applied")
  await settle()
  assert.deepEqual(savedTrackIds(), [ids[0], ids[2]], 'one save of the old track, one of the final one — never B')
  await reset()

  const run = await openJ('nt-j4', JDUR, JNOTES)
  const seq = ['nB', 'nC', 'nD', 'nB', 'nC', 'nD', 'nF', 'nC', 'nD', 'nB', 'nF', 'nC']
  const made = []
  for (const id of seq) {
    S().goToNote(id)
    made.push(current())
  }
  assert.equal(seq.length, 12)
  assert.deepEqual([S().trackIndex, S().switching], [2, true])
  for (const e of made.slice(0, -1)) e.loaded(60) // every earlier element answers late
  assert.deepEqual([S().trackIndex, S().switching], [2, true], 'late answers change nothing')
  made.at(-1).loaded(90)
  assert.deepEqual([S().trackIndex, made.at(-1).currentTime, S().positionSeconds], [2, 85, 85])
  assert.ok(made.slice(0, -1).every((e) => e.currentTime === 0 && e.released), 'no earlier Note second was applied to anything')
  await settle()
  assert.deepEqual(savedTrackIds(), [run.ids[0], run.ids[2]])
  await reset()

  // a second Note on the track that is still loading: the track is reopened at the LAST requested second
  const { ids: ids3 } = await openJ('nt-j5', JDUR, JNOTES)
  S().goToNote('nB') // track 1 @30
  const first = current()
  S().goToNote('nF') // track 1 @45, while track 1 is still loading
  const second = current()
  assert.notEqual(first, second)
  first.loaded(60)
  second.loaded(60)
  assert.equal(second.currentTime, 45)
  assert.equal(S().trackIndex, 1)
  assert.ok(ids3)
  await reset()
})

await check('NOTES jump FALLBACK (a): the target cannot be played → back on the origin track at its second, PAUSED, target marked, a notice names it, the Note stays; the target is never saved', async () => {
  const { ids } = await openJ('nt-f1', JDUR, JNOTES, 12)
  S().goToNote('nB') // origin: track 0 @12
  const target = current()
  target.fire('error')
  assert.deepEqual([S().trackIndex, S().switching, S().playing, S().status], [0, true, false, 'ready'])
  assert.deepEqual([...S().trackErrors], [ids[1]])
  assert.ok(S().noteNotice?.includes('Track 2'), S().noteNotice)
  const origin = current()
  assert.notEqual(origin, target)
  assert.equal(origin.src, url('nt-f1', ids[0]))
  origin.loaded(100)
  await settle()
  assert.equal(origin.currentTime, 12, 'back at the origin second')
  assert.deepEqual([S().playing, origin.paused, S().switching], [false, true, false])
  assert.ok(S().notes.some((n) => n.id === 'nB'), 'the Note is kept')
  assert.ok(calls.save.every((s) => s.trackId !== ids[1]), 'the failed target was never saved')
  assert.equal(rawState('nt-f1').audioProgress.trackId, ids[0], 'stored progress ends at the origin')
  await reset()
})

await check('NOTES jump FALLBACK (b): a failure arriving AFTER a newer Contents click or a newer Note jump never falls back — the newer action wins', async () => {
  const { ids } = await openJ('nt-f2', JDUR, JNOTES, 12)
  S().goToNote('nB')
  const b = current()
  S().goToTrack(3) // a newer, user-initiated switch
  const d = current()
  const elementsNow = elements.length
  b.error = { code: 4 }
  b.fire('error') // B's late failure
  assert.equal(elements.length, elementsNow, 'no fallback element')
  assert.deepEqual([S().trackIndex, S().switching, [...S().trackErrors]], [3, true, []])
  d.loaded(30)
  assert.equal(S().trackIndex, 3)
  await reset()

  const second = await openJ('nt-f3', JDUR, JNOTES, 12)
  S().goToNote('nB')
  const b2 = current()
  S().goToNote('nC') // a newer Note jump
  const c2 = current()
  const n2 = elements.length
  b2.fire('error')
  assert.equal(elements.length, n2, 'no fallback element')
  assert.deepEqual([S().trackIndex, [...S().trackErrors]], [2, []])
  c2.loaded(90)
  assert.deepEqual([S().trackIndex, c2.currentTime, S().noteNotice], [2, 85, null])
  assert.ok(second.ids)
  await reset()
  assert.ok(ids)
})

await check('NOTES jump FALLBACK (c): the target AND the origin fail → the standard error state for the origin, no second fallback, no loop, nothing saved for either', async () => {
  const { ids } = await openJ('nt-f4', JDUR, JNOTES, 12)
  S().goToNote('nB')
  const target = current()
  target.fire('error')
  const origin = current()
  const afterFallback = elements.length
  origin.fire('error') // the fallback fails too
  await settle()
  assert.equal(elements.length, afterFallback, 'no further element: no loop')
  assert.deepEqual([S().status, S().switching, S().playing], ['ready', false, false])
  assert.deepEqual([...S().trackErrors].sort(), [ids[0], ids[1]].sort())
  assert.equal(S().trackIndex, 0, 'the usual error state is shown for the origin track')
  assert.ok(savedTrackIds().every((t) => t === ids[0]), 'only the forced save of the old track, never the target')
  await reset()
})

await check('NOTES jump FALLBACK (d, e, f): a target that already loaded never rolls back; with no settled origin a failure keeps the usual error state; a jump during a jump inherits the first origin', async () => {
  // (d) loaded, then fails minutes later → ordinary error, no fallback
  const d = await openJ('nt-f5', JDUR, JNOTES, 12)
  S().goToNote('nB')
  const b = current()
  b.loaded(60)
  const n = elements.length
  b.fire('error')
  assert.equal(elements.length, n, 'no fallback after the jump completed')
  assert.deepEqual([S().trackIndex, [...S().trackErrors], S().noteNotice], [1, [d.ids[1]], null])
  await reset()

  // (e1) the player was mid-switch from a Contents click: no settled origin
  const e = await openJ('nt-f6', JDUR, JNOTES, 12)
  S().goToTrack(2)
  S().goToNote('nB')
  const eb = current()
  const n2 = elements.length
  eb.fire('error')
  assert.equal(elements.length, n2, 'no origin → no fallback')
  assert.deepEqual([S().trackIndex, [...S().trackErrors]], [1, [e.ids[1]]])
  await reset()

  // (e2) the current track itself had failed
  const e2 = await openJ('nt-f7', JDUR, JNOTES, 12)
  e2.el.fire('error')
  S().goToNote('nB')
  const eb2 = current()
  const n3 = elements.length
  eb2.fire('error')
  assert.equal(elements.length, n3, 'the failed track is not a place to return to')
  await reset()

  // (f) Note jump during a Note jump: the second inherits the first's origin (track 0 @12)
  const f = await openJ('nt-f8', JDUR, JNOTES, 12)
  S().goToNote('nB')
  S().goToNote('nC')
  const fc = current()
  fc.fire('error')
  const back = current()
  assert.equal(back.src, url('nt-f8', f.ids[0]), 'back on the track the first jump started from')
  back.loaded(100)
  assert.equal(back.currentTime, 12)
  assert.deepEqual([S().trackIndex, S().playing], [0, false])
  await reset()
})

await check('NOTES cap (multi-track only): the 501st Note is NOT created, a visible notice is set, the 500 stay; a refused save reloads the list from Main with a notice; a single-file book at the cap is exactly as before', async () => {
  const { ids } = await openJ('nt-c1', [60, 45, 90, 30], (ids) => Array.from({ length: 500 }, (_, i) => mkNote(`o${i}`, ids[i % 4], i % 40)))
  assert.equal(S().notes.length, 500)
  assert.equal(S().addNote('one too many'), null)
  assert.equal(S().notes.length, 500)
  assert.ok(S().noteNotice?.includes('500'), S().noteNotice)
  await sleep(30)
  assert.equal(calls.bookmarks.length, 0, 'nothing was saved')
  assert.equal(stateOf2('nt-c1').audioBookmarks.length, 500)
  await reset()
  assert.ok(ids)

  // a save Main refuses: the list is reloaded and the user is told
  await openJ('nt-c2', [60, 45, 90, 30], (ids) => [mkNote('keep', ids[0], 3)])
  const realSave = window.api.audio.saveBookmarks
  window.api.audio.saveBookmarks = async (input) => {
    calls.bookmarks.push(structuredClone(input))
    return { ok: false }
  }
  try {
    assert.ok(S().addNote('refused'))
    assert.equal(S().notes.length, 2, 'shown at once')
    await sleep(60)
  } finally {
    window.api.audio.saveBookmarks = realSave
  }
  assert.deepEqual(S().notes.map((n) => n.id), ['keep'], 'reloaded from Main: the refused Note is gone')
  assert.ok(S().noteNotice?.includes('could not be saved'))
  await reset()

  // single-file at the cap: no notice, nothing refused, the silent truncation of before
  addBook('nt-c3', { state: JSON.stringify({ audioBookmarks: Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, label: 'x', positionSeconds: 100 + i, createdAt: '2026-01-01T00:00:00Z' })) }) })
  await S().load('nt-c3')
  current().loaded(1000)
  assert.equal(S().notes.length, 500)
  assert.ok(S().addNote(), 'the single-file add still returns an id')
  assert.equal(S().noteNotice, null, 'no cap notice for a single-file book')
  await sleep(30)
  assert.equal(stateOf2('nt-c3').audioBookmarks.length, 500)
  await reset()
})

await check('NOTES that cannot be read: a rejected read makes Notes UNAVAILABLE (not empty) — add / edit / delete do nothing and the stored Notes are never overwritten', async () => {
  const ids = addMulti('nt-u1')
  db.prepare('UPDATE books SET reading_state_json = ? WHERE id = ?').run(JSON.stringify({ audioBookmarks: [mkNote('keep', ids[0], 5)] }), 'nt-u1')
  const realGet = window.api.audio.getBookmarks
  window.api.audio.getBookmarks = async () => {
    throw new Error('read failed')
  }
  try {
    await S().load('nt-u1')
  } finally {
    window.api.audio.getBookmarks = realGet
  }
  current().loaded(60)
  assert.deepEqual([S().notesUnavailable, S().notes.length, S().status], [true, 0, 'ready'])
  assert.equal(selectCanAddNote(S()), false)
  calls.bookmarks.length = 0
  assert.equal(S().addNote('x'), null)
  S().updateNote('keep', 'y')
  S().removeNote('keep')
  await sleep(30)
  assert.equal(calls.bookmarks.length, 0, 'nothing was saved')
  assert.deepEqual(stateOf2('nt-u1').audioBookmarks.map((n) => n.id), ['keep'], 'the stored Note is untouched')
  await reset()
})

await check('NOTES markers: only the current track\'s Notes, following track changes (selector over the store state)', async () => {
  const { ids } = await openJ('nt-k1', JDUR, JNOTES)
  const markerIds = () => notesForTrack(S().notes, S().tracks[S().trackIndex].id).map((n) => n.id)
  assert.deepEqual(markerIds(), ['nA'])
  S().goToNote('nB')
  current().loaded(60)
  assert.deepEqual(markerIds(), ['nB', 'nF'].sort((x, y) => S().notes.findIndex((n) => n.id === x) - S().notes.findIndex((n) => n.id === y)))
  assert.deepEqual(notesForTrack(S().notes, 'nope'), [])
  assert.ok(ids)
  await reset()
})

// ---- 7. Notes grouped by track (the multi-track Notes tab): rows, open / closed state, "add opens its row" ----
console.log('7. Notes grouped by track')
const { groupNotesByTrack } = await import('@reading-book/book-reader-sdk')
const { useNoteGroupsStore } = await import('../../src/screens/AudioBook/logic/audioNoteGroupsStore.ts')
const GS = () => useNoteGroupsStore.getState()
const G = () => groupNotesByTrack(S().notes, S().tracks)

await check('GROUPS rows follow the Notes: a track gets a row with its first Note and loses it with its last; counts sum to the Notes; edit changes no count; unreadable Notes give no rows', async () => {
  const { ids } = await openPlaying('gp-1', [60, 45, 90, 30], 12)
  assert.deepEqual(G(), [], 'no Notes, no rows')
  const a = S().addNote()
  S().addNote('second')
  assert.deepEqual(G().map((g) => [g.trackId, g.count]), [[ids[0], 2]])
  S().goToTrack(2)
  current().loaded(90)
  current().currentTime = 5
  const c = S().addNote()
  assert.deepEqual(G().map((g) => [g.trackId, g.index, g.count]), [[ids[0], 0, 2], [ids[2], 2, 1]], 'only tracks with Notes, in track order')
  assert.equal(G().reduce((n, g) => n + g.count, 0), S().notes.length)
  S().updateNote(c, 'edited')
  assert.deepEqual(G().map((g) => g.count), [2, 1], 'edit changes no count')
  S().removeNote(c)
  assert.deepEqual(G().map((g) => g.trackId), [ids[0]], 'the last Note of a track removes its row')
  S().removeNote(a)
  assert.deepEqual(G().map((g) => g.count), [1])
  await reset()
  // Notes that could not be read: no rows (the tab shows its message instead)
  const ids2 = addMulti('gp-1b')
  db.prepare('UPDATE books SET reading_state_json = ? WHERE id = ?').run(JSON.stringify({ audioBookmarks: [mkNote('keep', ids2[0], 5)] }), 'gp-1b')
  const realGet = window.api.audio.getBookmarks
  window.api.audio.getBookmarks = async () => {
    throw new Error('read failed')
  }
  try {
    await S().load('gp-1b')
  } finally {
    window.api.audio.getBookmarks = realGet
  }
  current().loaded(60)
  assert.deepEqual([S().notesUnavailable, G()], [true, []])
  await reset()
})

await check('GROUPS open / closed state: the default opens the playing track once and only adds; toggling flips one row; several rows open; it survives "closing the tab"; another audiobook or a reopened one starts clean', async () => {
  const { ids } = await openPlaying('gp-2', [60, 45, 90, 30], 12)
  assert.deepEqual([GS().open, GS().seeded], [{}, false], 'clean for a newly opened audiobook')
  GS().ensureSeeded(ids[0])
  assert.deepEqual([GS().open, GS().seeded], [{ [ids[0]]: true }, true])
  GS().ensureSeeded(ids[1]) // later calls do nothing
  assert.deepEqual(GS().open, { [ids[0]]: true })
  GS().toggle(ids[2])
  assert.deepEqual(Object.keys(GS().open).sort(), [ids[0], ids[2]].sort(), 'several rows can be open')
  GS().toggle(ids[0])
  assert.deepEqual(GS().open, { [ids[2]]: true }, 'only the toggled row changed')
  // nothing lives in a component: the choices are still there when the tab is "reopened" (read back)
  assert.deepEqual(GS().open, { [ids[2]]: true })
  // an earlier choice is kept when seeding runs for the first time
  GS().reset()
  GS().toggle(ids[1])
  GS().ensureSeeded(ids[0])
  assert.deepEqual(Object.keys(GS().open).sort(), [ids[0], ids[1]].sort())
  // seeding without a current track marks the audiobook seeded and opens nothing
  GS().reset()
  GS().ensureSeeded(undefined)
  GS().ensureSeeded(ids[0])
  assert.deepEqual([GS().open, GS().seeded], [{}, true])
  // another audiobook starts clean
  GS().toggle(ids[3])
  await S().load('gp-1')
  assert.deepEqual([GS().open, GS().seeded], [{}, false])
  // the same audiobook, closed and reopened, starts clean too
  GS().ensureSeeded('x')
  await S().dispose()
  assert.deepEqual([GS().open, GS().seeded], [{}, false])
  await S().load('gp-2')
  assert.deepEqual([GS().open, GS().seeded], [{}, false])
  await reset()
})

await check('GROUPS a Note taken from a row behaves as before: jump (other track, exact second, play state, failed-target fallback), edit keeps its place, delete updates the count and the row', async () => {
  const { ids } = await openJ('gp-4', JDUR, JNOTES, 12)
  const row = G().find((g) => g.trackId === ids[1])
  assert.deepEqual(row.notes.map((n) => n.id), ['nB', 'nF'], 'time order inside the row')
  S().goToNote(row.notes[1].id) // nF: track 1 @45
  const b = current()
  assert.deepEqual([S().trackIndex, S().switching, S().playing], [1, true, true])
  b.loaded(60)
  assert.equal(b.currentTime, 45)
  // edit keeps track, second, id and its place in the row
  S().updateNote('nB', 'edited text')
  const after = G().find((g) => g.trackId === ids[1])
  assert.deepEqual(after.notes.map((n) => [n.id, n.positionSeconds, n.note]), [['nB', 30, 'edited text'], ['nF', 45, undefined]])
  assert.equal(after.count, 2)
  // delete one of two: count 1, the row stays; delete the only Note of a track: the row goes
  S().removeNote('nF')
  assert.deepEqual(G().find((g) => g.trackId === ids[1]).count, 1)
  S().removeNote('nA')
  assert.equal(G().some((g) => g.trackId === ids[0]), false)
  // a failed target still falls back to the track it came from
  S().goToNote('nC')
  current().fire('error')
  const back = current()
  assert.equal(back.src, url('gp-4', ids[1]))
  assert.ok(S().notes.some((n) => n.id === 'nC'), 'the Note stays')
  await reset()
})

await check('GROUPS adding a Note opens its row from the "+ Note" path (no component): also for a row that was closed or a track that had no Notes; a new signal each time', async () => {
  const { ids } = await openJ('gp-5', JDUR, () => [], 12)
  assert.deepEqual([GS().open, S().lastAddedNote], [{}, null])
  const first = S().addNote('one')
  const signal1 = S().lastAddedNote
  assert.deepEqual(signal1, { id: first, trackId: ids[0] })
  assert.equal(GS().open[ids[0]], true, "the new Note's row is open")
  S().addNote('two')
  assert.notEqual(S().lastAddedNote, signal1, 'a NEW object each add')
  GS().toggle(ids[0]) // the listener closed the row
  S().addNote('three')
  assert.equal(GS().open[ids[0]], true, 'a closed row opens when a Note is added to it')
  S().goToTrack(2) // a track that had no Notes
  current().loaded(90)
  current().currentTime = 20
  assert.equal(GS().open[ids[2]], undefined)
  S().addNote()
  assert.equal(GS().open[ids[2]], true)
  assert.deepEqual(G().map((g) => g.trackId), [ids[0], ids[2]])
  await reset()
})

await check('GROUPS no false signals and no auto open / close: load, edit, delete, jumps, Contents click, next, auto-advance, fallback, a refused save and the 501st refusal leave the rows and lastAddedNote alone', async () => {
  const { ids } = await openJ('gp-6', JDUR, JNOTES, 12)
  assert.equal(S().lastAddedNote, null, 'load set no signal')
  GS().ensureSeeded(ids[0])
  const snapshot = JSON.stringify(GS().open)
  const unchanged = (what) => {
    assert.equal(JSON.stringify(GS().open), snapshot, `${what}: rows unchanged`)
    assert.equal(S().lastAddedNote, null, `${what}: no signal`)
  }
  S().updateNote('nA', 'x')
  S().removeNote('nE')
  unchanged('edit / delete')
  S().goToTrack(1)
  current().loaded(60)
  unchanged('Contents click')
  S().nextChapter()
  current().loaded(90)
  unchanged('next track')
  S().goToNote('nD')
  current().loaded(30)
  unchanged('Note jump')
  current().fire('ended') // the last track: just stops
  S().goToTrack(1)
  current().loaded(60)
  current().fire('ended') // auto-advance to track 2
  current().loaded(90)
  unchanged('auto-advance')
  S().goToNote('nA')
  current().fire('error') // the target fails → back to the origin
  current().loaded(90)
  unchanged('failed-jump fallback')
  assert.equal(S().tracks[S().trackIndex].id, ids[2], 'the current track id follows the playing track')
  await reset()

  // a refused save reloads the list; it does not look like a new Note
  await openJ('gp-7', JDUR, (i) => [mkNote('keep', i[0], 3)], 12)
  const realSave = window.api.audio.saveBookmarks
  window.api.audio.saveBookmarks = async () => ({ ok: false })
  try {
    S().addNote('refused')
    const signal = S().lastAddedNote
    await sleep(60)
    assert.equal(S().lastAddedNote, signal, 'the reload did not replace the signal')
  } finally {
    window.api.audio.saveBookmarks = realSave
  }
  await reset()

  // the 501st Note is refused: no Note, no signal, no row change
  await openJ('gp-8', JDUR, (i) => Array.from({ length: 500 }, (_, k) => mkNote(`o${k}`, i[k % 4], k % 40)), 12)
  const before = JSON.stringify(GS().open)
  assert.equal(S().addNote(), null)
  assert.deepEqual([S().lastAddedNote, JSON.stringify(GS().open)], [null, before])
  await reset()
})

await check('GROUPS single-file audiobooks never touch the groups store or the signal', async () => {
  addBook('gp-sf')
  await S().load('gp-sf')
  current().loaded(100)
  assert.deepEqual([GS().open, GS().seeded, S().tracks.length], [{}, false, 0])
  assert.ok(S().addNote('plain'), 'single-file Notes still work')
  assert.deepEqual([S().lastAddedNote, GS().open, GS().seeded], [null, {}, false])
  assert.equal(S().notes.every((n) => n.trackId === undefined), true)
  await reset()
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} checks passed`)
process.exit(0)

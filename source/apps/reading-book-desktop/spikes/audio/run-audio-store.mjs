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

const calls = { markAsReading: [], save: [], bookmarks: [] }
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
      getBookmarks: (id) => invoke(AudioChannels.getBookmarks, id),
      saveBookmarks: async (input) => { calls.bookmarks.push(structuredClone(input)); return invoke(AudioChannels.saveBookmarks, input) },
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

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} checks passed`)
process.exit(0)

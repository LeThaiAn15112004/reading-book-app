/**
 * Integration checks for PDF freehand Ink on the renderer side (docs/implementation_plan/
 * pdf_freehand_ink_eraser_plan.md, Phase 1): the REAL zustand stores behind the Pen tool
 * (`pdfInkStore`, `pdfInkPrefsStore`, the Ctrl+Z `pdfUndoRouter`) against the REAL Main-side overlay IPC
 * handlers and SQLite schema. Only the IPC hop is a direct call (no window, no Electron).
 *
 *   1. draw       a stroke is saved with the pen as it was, and restored after leaving the book and coming back
 *   2. settings   changing the pen never touches saved strokes; settings persist and reset
 *   3. undo/redo  draw / delete, persisted both ways; cleared per book; shared Ctrl+Z with text markup
 *   4. failures   a refused save rolls the stroke back; a refused delete restores it; stale loads are dropped
 *
 * Run: npm run spike:pdf:ink-store   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { invoke } from './electron-stub.mjs'
import { getDatabase } from './db-stub.mjs'

const { OverlayChannels } = await import('../../electron/ipc/channels.ts')
const { registerOverlayIpc } = await import('../../electron/ipc/overlay.ipc.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

const db = getDatabase()
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
insertBook.run('pdf-a', 'PDF A', '/a.pdf', 'pdf', 'sha-a')
insertBook.run('pdf-b', 'PDF B', '/b.pdf', 'pdf', 'sha-b')
registerOverlayIpc()

const localStore = new Map()
globalThis.localStorage = { getItem: (k) => localStore.get(k) ?? null, setItem: (k, v) => localStore.set(k, String(v)) }
globalThis.crypto ??= (await import('node:crypto')).webcrypto

const overrides = { saveInk: null, deleteInk: null }
const calls = []
globalThis.window = {
  api: {
    overlay: {
      listInk: (id) => invoke(OverlayChannels.listInk, id),
      saveInk: async (input) => {
        calls.push(['saveInk', input.id])
        return overrides.saveInk ? overrides.saveInk(input) : invoke(OverlayChannels.saveInk, input)
      },
      deleteInk: async (input) => {
        calls.push(['deleteInk', input.id])
        return overrides.deleteInk ? overrides.deleteInk(input) : invoke(OverlayChannels.deleteInk, input)
      },
      listHighlights: (id) => invoke(OverlayChannels.listHighlights, id),
      saveHighlight: (input) => invoke(OverlayChannels.saveHighlight, input),
      deleteHighlight: (input) => invoke(OverlayChannels.deleteHighlight, input),
    },
  },
}

const { usePdfInkStore } = await import('../../src/screens/Reader/logic/pdfInk/pdfInkStore.ts')
const { usePdfInkPrefsStore, DEFAULT_PDF_INK_PREFS } = await import('../../src/screens/Reader/logic/pdfInk/pdfInkPrefsStore.ts')
const { pdfUndo, pdfRedo, pdfDeleteFocused, pdfHasFocusedMark } = await import('../../src/screens/Reader/logic/pdfInk/pdfUndoRouter.ts')
const { usePdfHighlightsStore } = await import('../../src/screens/Reader/logic/pdfHighlights/pdfHighlightsStore.ts')

const ink = usePdfInkStore
const S = () => ink.getState()
const prefs = usePdfInkPrefsStore
const toasts = []
const rows = (book = 'pdf-a') => db.prepare(`SELECT id, note_json FROM notes WHERE book_id = ? AND json_extract(note_json, '$.type') = 'ink' ORDER BY created_at, rowid`).all(book)
const json = (id) => JSON.parse(db.prepare('SELECT note_json FROM notes WHERE id = ?').get(id).note_json)

async function openBook(bookId) {
  S().setContext({ bookId, onToast: (m) => toasts.push(m) })
  usePdfHighlightsStore.getState().setContext({ bookId, onToast: (m) => toasts.push(m), pdfApiRef: null })
  S().resetForNewBook()
  usePdfHighlightsStore.getState().resetForNewBook()
  await S().loadInk()
}
const line = (y) => [[0.1, y], [0.5, Math.round((y + 0.1) * 1e5) / 1e5]]

console.log('PDF freehand Ink (renderer stores + Main IPC + SQLite)')

console.log('1. draw')
await openBook('pdf-a')
let first
await check('commitStroke saves an ink row with the current pen, page and points', async () => {
  first = S().commitStroke(2, line(0.2))
  assert.ok(first)
  await tick()
  assert.equal(S().strokes.length, 1)
  const j = json(first.id)
  assert.equal(j.type, 'ink')
  assert.equal(j.pdfInk.pageIndex, 2)
  assert.deepEqual(j.pdfInk.paths, [line(0.2)])
  assert.equal(j.pdfInk.width, DEFAULT_PDF_INK_PREFS.pen.width)
  assert.equal(j.style.colorHex, DEFAULT_PDF_INK_PREFS.pen.colorHex)
})

await check('a tap (one point) becomes a dot; an empty stroke is refused', async () => {
  const dot = S().commitStroke(0, [[0.3, 0.3]])
  assert.ok(dot)
  assert.deepEqual(dot.paths, [[[0.3, 0.3], [0.3, 0.3]]])
  assert.equal(S().commitStroke(0, []), null)
  assert.ok(toasts.pop())
  await tick()
  S().deleteStroke(dot.id)
  await tick()
})

await check('leaving the book and coming back (and a fresh store load) restores the strokes in order', async () => {
  const second = S().commitStroke(0, line(0.5))
  await tick()
  await openBook('pdf-b')
  assert.deepEqual(S().strokes, [])
  await openBook('pdf-a')
  assert.deepEqual(S().strokes.map((m) => m.id), [first.id, second.id])
  assert.deepEqual(S().strokes[0].paths, [line(0.2)])
  assert.equal(S().history.canUndo(), false, 'undo history is per book')
  assert.equal(S().pushes, 0)
})

console.log('2. settings')
await check('changing colour / thickness never alters saved strokes, only the next one', async () => {
  const before = rows().map((r) => r.note_json)
  prefs.getState().setPenColor('#E53935')
  prefs.getState().setPenWidth(0.012)
  assert.deepEqual(rows().map((r) => r.note_json), before)
  assert.equal(S().strokes[0].colorHex, DEFAULT_PDF_INK_PREFS.pen.colorHex)
  const next = S().commitStroke(1, line(0.7))
  await tick()
  assert.equal(next.colorHex, '#E53935')
  assert.equal(next.width, 0.012)
  assert.equal(json(first.id).style.colorHex, DEFAULT_PDF_INK_PREFS.pen.colorHex)
  assert.equal(json(first.id).pdfInk.width, DEFAULT_PDF_INK_PREFS.pen.width)
  S().deleteStroke(next.id)
  await tick()
})

await check('settings persist to localStorage, clamp, ignore junk, and reset to the defaults', async () => {
  assert.deepEqual(JSON.parse(localStore.get('readmate.pdfInkPrefs.v1')), { pen: { colorHex: '#E53935', width: 0.012 }, tool: 'pen' })
  prefs.getState().setPenColor('not a colour')
  prefs.getState().setPenWidth(Number.NaN)
  prefs.getState().setPenWidth(99)
  assert.equal(prefs.getState().pen.colorHex, '#E53935')
  assert.equal(prefs.getState().pen.width, 0.1)
  assert.equal(prefs.getState().reset(), true)
  assert.deepEqual(prefs.getState().pen, DEFAULT_PDF_INK_PREFS.pen)
})

console.log('3. undo / redo')
await openBook('pdf-a')
await check('undo of a draw removes the row from SQLite; redo restores the same stroke', async () => {
  const mark = S().commitStroke(3, line(0.1))
  await tick()
  assert.equal(rows().length, 3)
  S().undo()
  await tick()
  assert.equal(S().strokes.some((m) => m.id === mark.id), false)
  assert.equal(rows().some((r) => r.id === mark.id), false)
  S().redo()
  await tick()
  assert.equal(S().strokes.at(-1).id, mark.id)
  assert.deepEqual(json(mark.id).pdfInk.paths, [line(0.1)])
})

await check('delete + undo restores the stroke with its original look; selection is cleared by delete', async () => {
  const target = S().strokes[0]
  S().select(target.id)
  assert.equal(pdfHasFocusedMark(), true)
  pdfDeleteFocused()
  await tick()
  assert.equal(S().selectedId, null)
  assert.equal(rows().some((r) => r.id === target.id), false)
  S().undo()
  await tick()
  assert.equal(json(target.id).style.colorHex, target.colorHex)
  assert.equal(S().strokes.find((m) => m.id === target.id).createdAt, target.createdAt)
})

await check('Ctrl+Z is shared with text markup: newest edit first, redo in the opposite order', async () => {
  await openBook('pdf-a')
  const hl = usePdfHighlightsStore.getState()
  const mark = { rects: [{ page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.02 }], text: 'x' }
  const a = S().commitStroke(0, line(0.3))
  await tick()
  hl.createFromSelection(mark, 'highlight')
  await tick()
  const c = S().commitStroke(0, line(0.6))
  await tick()
  const hlCount = () => usePdfHighlightsStore.getState().highlights.length
  const has = (id) => S().strokes.some((m) => m.id === id)
  assert.equal(hlCount(), 1)
  pdfUndo() // c
  await tick()
  assert.equal(has(c.id), false)
  assert.equal(hlCount(), 1)
  pdfUndo() // the highlight
  await tick()
  assert.equal(hlCount(), 0)
  assert.equal(has(a.id), true)
  pdfUndo() // a
  await tick()
  assert.equal(has(a.id), false)
  pdfRedo() // a
  await tick()
  assert.equal(has(a.id), true)
  assert.equal(hlCount(), 0)
  pdfRedo() // the highlight
  await tick()
  assert.equal(hlCount(), 1)
  assert.equal(has(c.id), false)
  pdfRedo() // c
  await tick()
  assert.equal(has(c.id), true)
  // the highlight rows and the ink rows both match the screen
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM notes WHERE book_id = 'pdf-a' AND json_extract(note_json,'$.type') = 'highlight'`).get().n, 1)
  assert.equal(rows().length, S().strokes.length)
})

await check('a new edit after an undo drops the redo of both stores', async () => {
  pdfUndo()
  await tick()
  S().commitStroke(0, line(0.8))
  await tick()
  const before = S().strokes.length
  pdfRedo()
  await tick()
  assert.equal(S().strokes.length, before)
})

await check('move: one undo step, clamped to the page, saved, restored by undo / redo; a no-op move records nothing', async () => {
  const mark = S().commitStroke(0, [[0.2, 0.3], [0.4, 0.5]])
  await tick()
  const pushes = S().pushes
  S().moveStroke(mark.id, 0.1, -0.1)
  await tick()
  const moved = S().strokes.find((m) => m.id === mark.id)
  assert.deepEqual(moved.paths, [[[0.3, 0.2], [0.5, 0.4]]])
  assert.deepEqual(json(mark.id).pdfInk.paths, moved.paths)
  assert.equal(json(mark.id).style.colorHex, mark.colorHex)
  assert.equal(S().pushes, pushes + 1)
  S().moveStroke(mark.id, 9, 0) // far past the right edge: stops at the page edge
  await tick()
  assert.equal(S().strokes.find((m) => m.id === mark.id).paths[0][1][0], 1)
  S().undo()
  await tick()
  assert.deepEqual(json(mark.id).pdfInk.paths, moved.paths)
  S().undo()
  await tick()
  assert.deepEqual(json(mark.id).pdfInk.paths, [[[0.2, 0.3], [0.4, 0.5]]])
  S().redo()
  await tick()
  assert.deepEqual(json(mark.id).pdfInk.paths, moved.paths)
  const before = S().pushes
  S().moveStroke(mark.id, 0, 0)
  S().moveStroke('missing', 0.1, 0.1)
  assert.equal(S().pushes, before)
  S().deleteStroke(mark.id)
  await tick()
})

console.log('4. failures')
await check('a refused save rolls the stroke back and tells the user', async () => {
  await openBook('pdf-b')
  toasts.length = 0
  overrides.saveInk = async () => null
  S().commitStroke(0, line(0.2))
  await tick()
  overrides.saveInk = null
  assert.deepEqual(S().strokes, [])
  assert.equal(rows('pdf-b').length, 0)
  assert.ok(toasts.length > 0)
})

await check('a refused delete puts the stroke back', async () => {
  toasts.length = 0
  const mark = S().commitStroke(0, line(0.2))
  await tick()
  overrides.deleteInk = async () => ({ ok: false })
  S().deleteStroke(mark.id)
  await tick()
  overrides.deleteInk = null
  assert.equal(S().strokes.some((m) => m.id === mark.id), true)
  assert.equal(rows('pdf-b').length, 1)
  assert.ok(toasts.length > 0)
})

await check('a load that finishes after another book opened is dropped; no book → nothing happens', async () => {
  let release
  const gate = new Promise((r) => (release = r))
  const real = globalThis.window.api.overlay.listInk
  globalThis.window.api.overlay.listInk = async (id) => { await gate; return real(id) }
  S().setContext({ bookId: 'pdf-b' })
  const pending = S().loadInk()
  S().setContext({ bookId: 'pdf-a' })
  S().resetForNewBook()
  release()
  await pending
  globalThis.window.api.overlay.listInk = real
  assert.deepEqual(S().strokes, [])
  S().setContext({ bookId: undefined })
  const calls0 = calls.length
  assert.equal(S().commitStroke(0, line(0.1)), null)
  assert.equal(calls.length, calls0)
})

console.log(`\n${passed} checks passed`)

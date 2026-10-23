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
const { usePdfInkPrefsStore, DEFAULT_PDF_INK_PREFS, parseHexInput } = await import('../../src/screens/Reader/logic/pdfInk/pdfInkPrefsStore.ts')
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
  assert.equal(j.pdfInk.penStyle, 'pen')
  assert.equal(j.pdfInk.width, DEFAULT_PDF_INK_PREFS.styles.pen.width)
  assert.equal(j.style.colorHex, DEFAULT_PDF_INK_PREFS.styles.pen.colorHex)
  assert.equal(j.style.opacity, 1)
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
const penDefaults = DEFAULT_PDF_INK_PREFS.styles.pen
await check('changing colour / thickness never alters saved strokes, only the next one', async () => {
  const before = rows().map((r) => r.note_json)
  prefs.getState().setStyleColor('pen', '#E53935')
  prefs.getState().setStyleWidth('pen', 0.012)
  assert.deepEqual(rows().map((r) => r.note_json), before)
  assert.equal(S().strokes[0].colorHex, penDefaults.colorHex)
  const next = S().commitStroke(1, line(0.7))
  await tick()
  assert.equal(next.colorHex, '#E53935')
  assert.equal(next.width, 0.012)
  assert.equal(json(first.id).style.colorHex, penDefaults.colorHex)
  assert.equal(json(first.id).pdfInk.width, penDefaults.width)
  S().deleteStroke(next.id)
  await tick()
})

await check('defaults: Pen opaque blue, Pencil thin + translucent grey, Marker wide + translucent yellow; Pen is the default tool', async () => {
  const d = DEFAULT_PDF_INK_PREFS
  assert.equal(d.tool, 'pen')
  assert.deepEqual(Object.keys(d.styles), ['pen', 'pencil', 'marker', 'brush'])
  assert.equal(d.styles.pen.opacity, 1)
  assert.ok(d.styles.pencil.opacity < 1 && d.styles.pencil.width < d.styles.pen.width)
  assert.ok(d.styles.marker.opacity < 0.5 && d.styles.marker.width > d.styles.pen.width * 2)
  for (const style of ['pen', 'pencil', 'marker', 'brush']) assert.match(d.styles[style].colorHex, /^#[0-9A-F]{6}$/)
  assert.ok(d.styles.brush.opacity < 1 && d.styles.brush.width > d.styles.pen.width)
})

await check('each style remembers its own colour / thickness / opacity; the Pen ignores opacity', async () => {
  const p = prefs.getState()
  p.setStyleColor('pencil', '#00ff00')
  p.setStyleWidth('pencil', 0.006)
  p.setStyleOpacity('pencil', 0.5)
  p.setStyleColor('marker', '#ec407a')
  p.setStyleOpacity('marker', 0.6)
  p.setStyleOpacity('pen', 0.2)
  const st = prefs.getState().styles
  assert.deepEqual(st.pencil, { colorHex: '#00FF00', width: 0.006, opacity: 0.5 })
  assert.equal(st.marker.colorHex, '#EC407A')
  assert.equal(st.marker.opacity, 0.6)
  assert.equal(st.marker.width, DEFAULT_PDF_INK_PREFS.styles.marker.width)
  assert.equal(st.pen.opacity, 1)
  assert.equal(st.pen.colorHex, '#E53935') // untouched by the other styles
  prefs.getState().setTool('marker')
  prefs.getState().setTool('pen')
  prefs.getState().setTool('calligraphy') // not offered: ignored
  assert.equal(prefs.getState().tool, 'pen')
  assert.equal(prefs.getState().styles.pencil.colorHex, '#00FF00')
})

await check('HEX validation and clamping: only #RRGGBB, widths / opacities stay in range, junk is ignored', async () => {
  const p = prefs.getState()
  p.setStyleColor('pen', 'not a colour')
  p.setStyleColor('pen', '#12345')
  p.setStyleColor('pen', '#1234567')
  p.setStyleWidth('pen', Number.NaN)
  assert.equal(prefs.getState().styles.pen.colorHex, '#E53935')
  p.setStyleWidth('pen', 99)
  assert.equal(prefs.getState().styles.pen.width, 0.02)
  p.setStyleWidth('marker', 0.0001)
  assert.equal(prefs.getState().styles.marker.width, 0.006)
  p.setStyleOpacity('pencil', 0)
  assert.equal(prefs.getState().styles.pencil.opacity, 0.3)
  p.setStyleOpacity('marker', 5)
  assert.equal(prefs.getState().styles.marker.opacity, 0.8)
  assert.equal(parseHexInput('#abc'), '#AABBCC')
  assert.equal(parseHexInput('1e88e5'), '#1E88E5')
  assert.equal(parseHexInput('#12345'), null)
  assert.equal(parseHexInput('#GGGGGG'), null)
})

await check('settings persist: a fresh store (app restart) reads them back; the Phase 1 format still loads', async () => {
  prefs.getState().setStyleWidth('pen', 0.012)
  prefs.getState().setTool('marker')
  const saved = JSON.parse(localStore.get('readmate.pdfInkPrefs.v1'))
  assert.equal(saved.tool, 'marker')
  assert.deepEqual(Object.keys(saved.styles), ['pen', 'pencil', 'marker', 'brush'])
  const fresh = (await import('../../src/screens/Reader/logic/pdfInk/pdfInkPrefsStore.ts?restart=1')).usePdfInkPrefsStore.getState()
  assert.equal(fresh.tool, 'marker')
  assert.deepEqual(fresh.styles, prefs.getState().styles)
  // Phase 1 wrote { pen: { colorHex, width }, tool }.
  localStore.set('readmate.pdfInkPrefs.v1', JSON.stringify({ pen: { colorHex: '#43A047', width: 0.007 }, tool: 'pen' }))
  const migrated = (await import('../../src/screens/Reader/logic/pdfInk/pdfInkPrefsStore.ts?restart=2')).usePdfInkPrefsStore.getState()
  assert.deepEqual(migrated.styles.pen, { colorHex: '#43A047', width: 0.007, opacity: 1 })
  assert.deepEqual(migrated.styles.pencil, DEFAULT_PDF_INK_PREFS.styles.pencil)
  // Corrupt storage falls back to the defaults instead of throwing.
  localStore.set('readmate.pdfInkPrefs.v1', '{"tool":"calligraphy","styles":{"pen":{"colorHex":"red","width":"x"}}}')
  const corrupt = (await import('../../src/screens/Reader/logic/pdfInk/pdfInkPrefsStore.ts?restart=3')).usePdfInkPrefsStore.getState()
  assert.equal(corrupt.tool, 'pen')
  assert.deepEqual(corrupt.styles, DEFAULT_PDF_INK_PREFS.styles)
  localStore.set('readmate.pdfInkPrefs.v1', JSON.stringify({ tool: 'marker', styles: saved.styles }))
})

await check('a stroke takes the active style at the moment it is drawn (Pencil / Marker look, opacity), and never changes afterwards', async () => {
  prefs.getState().setTool('marker')
  prefs.getState().setStyleColor('marker', '#FFEB3B')
  prefs.getState().setStyleWidth('marker', 0.016)
  prefs.getState().setStyleOpacity('marker', 0.35)
  const marker = S().commitStroke(0, line(0.4))
  await tick()
  assert.deepEqual(json(marker.id).pdfInk.penStyle, 'marker')
  assert.equal(json(marker.id).pdfInk.width, 0.016)
  assert.deepEqual(json(marker.id).style, { colorHex: '#FFEB3B', opacity: 0.35 })
  const before = rows().map((r) => r.note_json)
  prefs.getState().setTool('pencil')
  prefs.getState().setStyleOpacity('pencil', 0.5)
  prefs.getState().setStyleColor('marker', '#00BCD4')
  prefs.getState().setStyleOpacity('marker', 0.7)
  prefs.getState().setStyleWidth('marker', 0.03)
  assert.deepEqual(rows().map((r) => r.note_json), before)
  const pencil = S().commitStroke(0, line(0.5))
  await tick()
  assert.equal(json(pencil.id).pdfInk.penStyle, 'pencil')
  assert.equal(json(pencil.id).style.opacity, 0.5)
  assert.equal(json(marker.id).style.opacity, 0.35)
  S().deleteStroke(marker.id)
  S().deleteStroke(pencil.id)
  await tick()
  prefs.getState().setTool('pen')
})

await check('Reset App Settings: the documented defaults are restored AND written (no stale saved preferences)', async () => {
  prefs.getState().setStyleColor('pen', '#E53935')
  prefs.getState().setStyleOpacity('marker', 0.6)
  prefs.getState().setTool('marker')
  assert.equal(prefs.getState().reset(), true)
  assert.deepEqual({ tool: prefs.getState().tool, styles: prefs.getState().styles }, DEFAULT_PDF_INK_PREFS)
  assert.deepEqual(JSON.parse(localStore.get('readmate.pdfInkPrefs.v1')), DEFAULT_PDF_INK_PREFS)
  const defaults = structuredClone(DEFAULT_PDF_INK_PREFS)
  prefs.getState().setStyleColor('pen', '#000000')
  assert.deepEqual(DEFAULT_PDF_INK_PREFS, defaults, 'the shared defaults object is never mutated')
  prefs.getState().reset()
})

console.log('2b. edit a selected stroke')
await openBook('pdf-a')
await check('updateStroke changes only that row: look, one replace history entry, saved, other rows byte-identical', async () => {
  const a = S().commitStroke(0, line(0.1))
  const b = S().commitStroke(0, line(0.3))
  await tick()
  const bJson = json(b.id)
  const others = rows().filter((r) => r.id !== a.id).map((r) => r.note_json)
  const pushes = S().pushes
  S().updateStroke(a.id, { colorHex: '#e53935', width: 0.01 })
  await tick()
  assert.equal(S().pushes, pushes + 1)
  const edited = S().strokes.find((m) => m.id === a.id)
  assert.equal(edited.colorHex, '#E53935')
  assert.equal(edited.width, 0.01)
  assert.deepEqual(edited.paths, a.paths)
  assert.equal(edited.createdAt, a.createdAt)
  assert.equal(json(a.id).style.colorHex, '#E53935')
  assert.equal(json(a.id).pdfInk.width, 0.01)
  assert.deepEqual(rows().filter((r) => r.id !== a.id).map((r) => r.note_json), others)
  assert.deepEqual(json(b.id), bJson)
  // the pen settings used for the NEXT stroke did not move
  assert.deepEqual(prefs.getState().styles, DEFAULT_PDF_INK_PREFS.styles)
})

await check('switching one stroke to Marker re-derives opacity / width; invalid / no-op patches record nothing', async () => {
  const target = S().strokes.at(-2)
  const pushes = S().pushes
  S().updateStroke(target.id, { penStyle: 'marker' })
  await tick()
  const m = S().strokes.find((x) => x.id === target.id)
  assert.equal(m.penStyle, 'marker')
  assert.equal(m.opacity, 0.35)
  assert.equal(m.width, 0.01)
  assert.equal(json(target.id).pdfInk.penStyle, 'marker')
  assert.equal(json(target.id).style.opacity, 0.35)
  S().updateStroke(target.id, { opacity: 0.6 })
  await tick()
  assert.equal(S().strokes.find((x) => x.id === target.id).opacity, 0.6)
  const now = S().pushes
  assert.equal(now, pushes + 2)
  S().updateStroke(target.id, { colorHex: 'nope' })
  S().updateStroke(target.id, { opacity: 0.6 })
  S().updateStroke(target.id, { penStyle: 'calligraphy' })
  S().updateStroke('missing', { width: 0.01 })
  assert.equal(S().pushes, now)
  // Pen is always opaque
  S().updateStroke(target.id, { penStyle: 'pen' })
  await tick()
  assert.equal(S().strokes.find((x) => x.id === target.id).opacity, 1)
  S().updateStroke(target.id, { opacity: 0.2 })
  assert.equal(S().strokes.find((x) => x.id === target.id).opacity, 1)
})

await check('undo / redo restore the old / new look of the edited stroke (and the database)', async () => {
  const target = S().strokes.at(-2)
  const before = structuredClone(target)
  S().updateStroke(target.id, { colorHex: '#00BCD4', width: 0.014 })
  await tick()
  const after = structuredClone(S().strokes.find((m) => m.id === target.id))
  S().undo()
  await tick()
  const undone = S().strokes.find((m) => m.id === target.id)
  assert.equal(undone.colorHex, before.colorHex)
  assert.equal(undone.width, before.width)
  assert.equal(json(target.id).style.colorHex, before.colorHex)
  assert.equal(json(target.id).pdfInk.width, before.width)
  S().redo()
  await tick()
  assert.equal(S().strokes.find((m) => m.id === target.id).colorHex, after.colorHex)
  assert.equal(json(target.id).pdfInk.width, after.width)
  // Ctrl+Z through the shared router reverts the edit as well
  pdfUndo()
  await tick()
  assert.equal(json(target.id).style.colorHex, before.colorHex)
  pdfRedo()
  await tick()
  assert.equal(json(target.id).style.colorHex, after.colorHex)
})

console.log('2c. Brush')
await openBook('pdf-a')
await check('Brush settings are independent: changing them never moves Pen / Pencil / Marker, and vice versa', async () => {
  prefs.getState().reset()
  const before = structuredClone(prefs.getState().styles)
  prefs.getState().setTool('brush')
  prefs.getState().setStyleColor('brush', '#e91e63')
  prefs.getState().setStyleWidth('brush', 0.02)
  prefs.getState().setStyleOpacity('brush', 0.5)
  const st = prefs.getState().styles
  assert.deepEqual(st.brush, { colorHex: '#E91E63', width: 0.02, opacity: 0.5 })
  for (const other of ['pen', 'pencil', 'marker']) assert.deepEqual(st[other], before[other], other + ' unchanged')
  prefs.getState().setStyleColor('pen', '#000000')
  prefs.getState().setStyleOpacity('marker', 0.6)
  assert.deepEqual(prefs.getState().styles.brush, { colorHex: '#E91E63', width: 0.02, opacity: 0.5 })
  // Brush ranges: opacity 0.3–1, width 0.004–0.04.
  prefs.getState().setStyleOpacity('brush', 0)
  assert.equal(prefs.getState().styles.brush.opacity, 0.3)
  prefs.getState().setStyleWidth('brush', 1)
  assert.equal(prefs.getState().styles.brush.width, 0.04)
  prefs.getState().setStyleWidth('brush', 0.0001)
  assert.equal(prefs.getState().styles.brush.width, 0.004)
  prefs.getState().setStyleOpacity('brush', 0.5)
  prefs.getState().setStyleWidth('brush', 0.02)
  prefs.getState().setStyleColor('pen', DEFAULT_PDF_INK_PREFS.styles.pen.colorHex)
  prefs.getState().setStyleOpacity('marker', DEFAULT_PDF_INK_PREFS.styles.marker.opacity)
})

await check('Brush settings persist across a restart; preferences saved before the Brush existed load with Brush defaults', async () => {
  const saved = JSON.parse(localStore.get('readmate.pdfInkPrefs.v1'))
  assert.equal(saved.tool, 'brush')
  assert.deepEqual(saved.styles.brush, { colorHex: '#E91E63', width: 0.02, opacity: 0.5 })
  const fresh = (await import('../../src/screens/Reader/logic/pdfInk/pdfInkPrefsStore.ts?restart=brush1')).usePdfInkPrefsStore.getState()
  assert.equal(fresh.tool, 'brush')
  assert.deepEqual(fresh.styles.brush, { colorHex: '#E91E63', width: 0.02, opacity: 0.5 })
  const { brush: _brush, ...beforeBrush } = saved.styles
  localStore.set('readmate.pdfInkPrefs.v1', JSON.stringify({ tool: 'pencil', styles: beforeBrush }))
  const old = (await import('../../src/screens/Reader/logic/pdfInk/pdfInkPrefsStore.ts?restart=brush2')).usePdfInkPrefsStore.getState()
  assert.equal(old.tool, 'pencil')
  assert.deepEqual(old.styles.brush, DEFAULT_PDF_INK_PREFS.styles.brush)
  assert.deepEqual(old.styles.pen, saved.styles.pen)
  localStore.set('readmate.pdfInkPrefs.v1', JSON.stringify(saved))
})

let brushMark
await check('a Brush stroke is saved as ink with its own style, colour, width and opacity; Pen strokes are unaffected', async () => {
  const pen = S().commitStroke(0, line(0.15)) // tool is brush here: draw a pen one explicitly below
  S().deleteStroke(pen.id)
  await tick()
  prefs.getState().setTool('pen')
  const penStroke = S().commitStroke(0, line(0.2))
  prefs.getState().setTool('brush')
  brushMark = S().commitStroke(0, [[0.1, 0.5], [0.3, 0.55], [0.5, 0.5], [0.7, 0.58]])
  await tick()
  assert.equal(penStroke.penStyle, 'pen')
  assert.equal(brushMark.penStyle, 'brush')
  const j = json(brushMark.id)
  assert.equal(j.type, 'ink')
  assert.equal(j.pdfInk.penStyle, 'brush')
  assert.equal(j.pdfInk.width, 0.02)
  assert.deepEqual(j.style, { colorHex: '#E91E63', opacity: 0.5 })
  const pj = json(penStroke.id)
  assert.equal(pj.pdfInk.penStyle, 'pen')
  assert.equal(pj.style.opacity, 1)
  // reopening the book restores both with their styles
  await openBook('pdf-b')
  await openBook('pdf-a')
  const again = S().strokes.find((m) => m.id === brushMark.id)
  assert.equal(again.penStyle, 'brush')
  assert.deepEqual(again.paths, brushMark.paths)
  assert.equal(again.opacity, 0.5)
  assert.equal(S().strokes.find((m) => m.id === penStroke.id).penStyle, 'pen')
  // changing the Brush settings afterwards never touches the saved Brush stroke
  const before = rows().map((r) => r.note_json)
  prefs.getState().setStyleColor('brush', '#00BCD4')
  prefs.getState().setStyleWidth('brush', 0.01)
  assert.deepEqual(rows().map((r) => r.note_json), before)
})

await check('Brush strokes undo / redo (draw, edit, delete) like every other stroke', async () => {
  const extra = S().commitStroke(1, line(0.4))
  await tick()
  assert.equal(extra.penStyle, 'brush')
  S().undo()
  await tick()
  assert.equal(rows().some((r) => r.id === extra.id), false)
  S().redo()
  await tick()
  assert.equal(json(extra.id).pdfInk.penStyle, 'brush')
  S().updateStroke(extra.id, { penStyle: 'pen' })
  await tick()
  assert.equal(json(extra.id).pdfInk.penStyle, 'pen')
  assert.equal(json(extra.id).style.opacity, 1)
  S().undo()
  await tick()
  assert.equal(json(extra.id).pdfInk.penStyle, 'brush')
  assert.equal(json(extra.id).style.opacity, 0.5)
  S().deleteStroke(extra.id)
  await tick()
  S().undo()
  await tick()
  assert.equal(json(extra.id).pdfInk.penStyle, 'brush')
  S().deleteStroke(extra.id)
  await tick()
})

await check('the Stroke Eraser removes a Brush stroke as a whole (one undo step), leaving other strokes alone', async () => {
  const others = S().strokes.filter((m) => m.id !== brushMark.id).map((m) => m.id)
  const pushes = S().pushes
  assert.equal(S().eraseStrokes([brushMark.id]), 1)
  await tick()
  assert.equal(S().pushes, pushes + 1)
  assert.equal(rows().some((r) => r.id === brushMark.id), false)
  assert.deepEqual(S().strokes.map((m) => m.id), others)
  S().undo()
  await tick()
  assert.equal(json(brushMark.id).pdfInk.penStyle, 'brush')
  assert.equal(json(brushMark.id).style.colorHex, '#E91E63')
  prefs.getState().reset()
  assert.deepEqual(prefs.getState().styles.brush, DEFAULT_PDF_INK_PREFS.styles.brush)
  assert.equal(prefs.getState().tool, 'pen')
})

console.log('3. undo / redo')
await openBook('pdf-a')
await check('undo of a draw removes the row from SQLite; redo restores the same stroke', async () => {
  const count = rows().length
  const mark = S().commitStroke(3, line(0.1))
  await tick()
  assert.equal(rows().length, count + 1)
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

await check('resize: one undo step, saved with the same look, selection kept; a no-op or unknown id records nothing', async () => {
  const mark = S().commitStroke(0, [[0.2, 0.3], [0.4, 0.5]])
  await tick()
  S().select(mark.id)
  const pushes = S().pushes
  S().resizeStroke(mark.id, [[[0.2, 0.3], [0.6, 0.7]]])
  await tick()
  assert.deepEqual(json(mark.id).pdfInk.paths, [[[0.2, 0.3], [0.6, 0.7]]])
  assert.equal(json(mark.id).style.colorHex, mark.colorHex)
  assert.equal(S().selectedId, mark.id)
  assert.equal(S().pushes, pushes + 1)
  S().undo()
  await tick()
  assert.deepEqual(json(mark.id).pdfInk.paths, [[[0.2, 0.3], [0.4, 0.5]]])
  S().redo()
  await tick()
  assert.deepEqual(json(mark.id).pdfInk.paths, [[[0.2, 0.3], [0.6, 0.7]]])
  const before = S().pushes
  S().resizeStroke(mark.id, [[[0.2, 0.3], [0.6, 0.7]]])
  S().resizeStroke('missing', [[[0, 0], [1, 1]]])
  S().resizeStroke(mark.id, [[[2, 0], [1, 1]]]) // outside the page: refused
  assert.equal(S().pushes, before)
  S().deleteStroke(mark.id)
  await tick()
})

console.log('3b. stroke eraser')
const otherRows = (book = 'pdf-a') =>
  db.prepare(`SELECT id, note_json FROM notes WHERE book_id = ? AND json_extract(note_json, '$.type') != 'ink' ORDER BY id`).all(book)
await openBook('pdf-a')
const eraseMark = { rects: [{ page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.02 }], text: 'x' }
const ea = S().commitStroke(0, line(0.1))
const eb = S().commitStroke(0, line(0.3))
const ec = S().commitStroke(1, line(0.5))
const mineIds = new Set([ea.id, eb.id, ec.id])
const mine = () => rows().filter((r) => mineIds.has(r.id)).map((r) => r.id)
const mineOnScreen = () => S().strokes.filter((m) => mineIds.has(m.id)).map((m) => m.id)
for (const kind of ['highlight', 'underline', 'strikethrough']) usePdfHighlightsStore.getState().createFromSelection(eraseMark, kind)
await tick()

await check('a multi-stroke erase deletes only the given Ink rows (SQLite + screen) as ONE history entry', async () => {
  const keep = otherRows()
  assert.ok(keep.length >= 3, 'highlight / underline / strikethrough rows exist')
  const pushes = S().pushes
  assert.equal(S().eraseStrokes([ea.id, eb.id]), 2)
  await tick()
  assert.equal(S().pushes, pushes + 1)
  assert.deepEqual(mineOnScreen(), [ec.id])
  assert.deepEqual(mine(), [ec.id])
  assert.deepEqual(otherRows(), keep, 'text markup rows are byte-identical')
})

await check('undo restores the whole gesture, redo erases it again; both persisted; Ctrl+Z router agrees', async () => {
  const keep = otherRows()
  S().undo()
  await tick()
  assert.deepEqual(mineOnScreen().sort(), [ea.id, eb.id, ec.id].sort())
  assert.deepEqual(mine().sort(), [ea.id, eb.id, ec.id].sort())
  assert.deepEqual(json(ea.id).pdfInk.paths, [line(0.1)])
  S().redo()
  await tick()
  assert.deepEqual(mine(), [ec.id])
  pdfUndo()
  await tick()
  assert.equal(mine().length, 3)
  pdfRedo()
  await tick()
  assert.equal(mine().length, 1)
  assert.deepEqual(otherRows(), keep)
  S().undo()
  await tick()
})

await check('ids that are not saved Ink strokes (highlights, unknown ids, other book) are ignored — nothing recorded, nothing deleted', async () => {
  const keep = otherRows()
  const ink = rows().length
  const pushes = S().pushes
  const callsBefore = calls.length
  assert.equal(S().eraseStrokes([...keep.map((r) => r.id), 'missing']), 0)
  assert.equal(S().eraseStrokes([]), 0)
  assert.equal(S().pushes, pushes)
  assert.equal(calls.length, callsBefore, 'no IPC call')
  assert.deepEqual(otherRows(), keep)
  assert.equal(rows().length, ink)
  // Main refuses it too: deleteInk on a text-markup id is a no-op.
  const result = await invoke(OverlayChannels.deleteInk, { bookId: 'pdf-a', id: keep[0].id })
  assert.equal(result.ok, false)
  assert.deepEqual(otherRows(), keep)
})

await check('a single stroke is a plain remove; a selected erased stroke is deselected', async () => {
  S().select(ec.id)
  const pushes = S().pushes
  assert.equal(S().eraseStrokes([ec.id]), 1)
  await tick()
  assert.equal(S().pushes, pushes + 1)
  assert.equal(S().selectedId, null)
  S().undo()
  await tick()
  assert.ok(S().strokes.some((m) => m.id === ec.id))
})

await check('nothing is deleted before the commit: the preview (renderer) never calls the store, so the data is untouched', async () => {
  // A cancelled gesture (Escape / pointercancel / blur) simply never calls eraseStrokes.
  const before = rows().map((r) => r.note_json)
  const callsBefore = calls.length
  assert.deepEqual(rows().map((r) => r.note_json), before)
  assert.equal(calls.length, callsBefore)
})

await check('a refused delete puts the affected stroke back and tells the user', async () => {
  toasts.length = 0
  overrides.deleteInk = async (input) => (input.id === ea.id ? { ok: false } : invoke(OverlayChannels.deleteInk, input))
  assert.equal(S().eraseStrokes([ea.id, eb.id]), 2)
  await tick()
  overrides.deleteInk = null
  assert.ok(S().strokes.some((m) => m.id === ea.id))
  assert.equal(S().strokes.some((m) => m.id === eb.id), false)
  assert.ok(toasts.length > 0)
})

console.log('3c. partial eraser')
const sdk = await import('@reading-book/book-reader-sdk')
insertBook.run('pdf-c', 'PDF C', '/c.pdf', 'pdf', 'sha-c')
await openBook('pdf-c')
const hl = usePdfHighlightsStore.getState()
for (const kind of ['highlight', 'underline', 'strikethrough']) hl.createFromSelection(eraseMark, kind)
await tick()
const flat = [[0.1, 0.5], [0.9, 0.5]]
const styled = {}
for (const style of ['pen', 'pencil', 'marker', 'brush']) {
  prefs.getState().setTool(style)
  prefs.getState().setStyleColor(style, '#336699')
  styled[style] = S().commitStroke(0, [[0.1, 0.1 + 0.1 * Object.keys(styled).length], [0.9, 0.1 + 0.1 * Object.keys(styled).length]])
}
prefs.getState().reset()
await tick()
const cutAll = (ids, x = 0.5, r = 0.02) =>
  ids.map((id) => {
    const m = S().strokes.find((s) => s.id === id)
    const y = m.paths[0][0][1]
    const out = sdk.erasePathsWithSweeps(m.paths, m.width, [{ from: [x, y - 0.01], to: [x, y + 0.01] }], r, 1)
    return { id, pieces: out.pieces }
  })
const otherRowsC = () => otherRows('pdf-c')
const inkC = () => rows('pdf-c')
// `modified` is rewritten whenever a row is saved again (undo / redo); everything else must match exactly.
const shape = () => inkC().map((r) => r.note_json.replace(/"modified":"[^"]*"/, '')).sort()
const strokeIds = Object.values(styled).map((m) => m.id)

await check('Pen, Pencil, Marker and Brush each split in two; every piece keeps style, colour, opacity and width; the first keeps its id', async () => {
  const keep = otherRowsC()
  for (const style of ['pen', 'pencil', 'marker', 'brush']) {
    const original = structuredClone(S().strokes.find((m) => m.id === styled[style].id))
    assert.equal(original.penStyle, style)
    assert.equal(S().applyPartialErase(cutAll([original.id])), 1)
    await tick()
    const pieces = S().strokes.filter((m) => m.penStyle === style && m.pageIndex === 0 && Math.abs(m.paths[0][0][1] - original.paths[0][0][1]) < 1e-9)
    assert.equal(pieces.length, 2, `${style}: two pieces`)
    assert.equal(pieces[0].id, original.id, `${style}: first piece keeps the id`)
    assert.notEqual(pieces[1].id, original.id)
    for (const piece of pieces) {
      assert.equal(piece.colorHex, original.colorHex)
      assert.equal(piece.opacity, original.opacity)
      assert.equal(piece.width, original.width)
      assert.equal(piece.createdAt, original.createdAt)
      // persisted row = the piece
      const row = json(piece.id)
      assert.equal(row.type, 'ink')
      assert.equal(row.pdfInk.penStyle, style)
      assert.equal(row.pdfInk.width, original.width)
      assert.deepEqual(row.pdfInk.paths, piece.paths)
      assert.deepEqual(row.style, { colorHex: original.colorHex, opacity: original.opacity })
    }
    assert.ok(pieces[0].paths[0].at(-1)[0] < 0.5 && pieces[1].paths[0][0][0] > 0.5)
  }
  assert.deepEqual(otherRowsC(), keep, 'text markup untouched')
  assert.equal(inkC().length, 8)
})

await check('persistence: leaving the book and reopening restores the cut pieces exactly, in order', async () => {
  const before = S().strokes.map((m) => ({ id: m.id, paths: m.paths, penStyle: m.penStyle, colorHex: m.colorHex, opacity: m.opacity, width: m.width }))
  await openBook('pdf-a')
  await openBook('pdf-c')
  assert.equal(S().strokes.length, 8)
  assert.deepEqual(S().strokes.map((m) => m.id).sort(), before.map((m) => m.id).sort())
  assert.deepEqual(
    S().strokes.map((m) => ({ id: m.id, paths: m.paths, penStyle: m.penStyle, colorHex: m.colorHex, opacity: m.opacity, width: m.width })).sort((a, b) => a.id.localeCompare(b.id)),
    before.sort((a, b) => a.id.localeCompare(b.id)),
  )
})

await check('one gesture over several strokes = ONE undo step; undo restores every original (and removes the extra pieces) in SQLite; redo re-applies', async () => {
  await openBook('pdf-c')
  const single = S().strokes.filter((m) => m.paths[0][0][0] < 0.11 && m.paths[0].at(-1)[0] < 0.49)
  assert.equal(single.length, 4, 'the left pieces')
  const ids = single.map((m) => m.id)
  const snapshot = structuredClone(S().strokes)
  const rowsBefore = shape()
  const pushes = S().pushes
  // a vertical eraser pass across the left pieces' tails + one that wipes a whole left piece
  const edits = ids.map((id, i) => {
    const m = S().strokes.find((s) => s.id === id)
    const y = m.paths[0][0][1]
    const out = sdk.erasePathsWithSweeps(m.paths, m.width, [{ from: [0.3, y], to: [0.3, y] }, ...(i === 0 ? [{ from: [0.05, y], to: [0.5, y] }] : [])], 0.02, 1)
    return { id, pieces: out.pieces }
  })
  assert.equal(edits[0].pieces.length, 0, 'fully covered piece is removed')
  assert.equal(edits[1].pieces.length, 2, 'a cut in the middle splits again')
  assert.equal(S().applyPartialErase(edits), 4)
  await tick()
  assert.equal(S().pushes, pushes + 1)
  const rowsAfter = shape()
  assert.notDeepEqual(rowsAfter, rowsBefore)
  const afterShape = structuredClone(S().strokes)
  pdfUndo()
  await tick()
  assert.deepEqual(shape(), rowsBefore, 'SQLite is back to the original rows')
  assert.deepEqual(S().strokes.map((m) => m.id).sort(), snapshot.map((m) => m.id).sort())
  pdfRedo()
  await tick()
  assert.deepEqual(S().strokes.map((m) => m.id).sort(), afterShape.map((m) => m.id).sort())
  assert.deepEqual(shape(), rowsAfter)
  S().undo()
  await tick()
})

await check('repeated crossings: the result of one gesture is computed from the original, so a long back-and-forth equals the minimal sweeps', async () => {
  const id = strokeIds[0]
  const m = S().strokes.find((s) => s.id === id)
  const y = m.paths[0][0][1]
  const sweeps = [{ from: [0.5, y - 0.05], to: [0.5, y + 0.05] }]
  const once = sdk.erasePathsWithSweeps(m.paths, m.width, sweeps, 0.02, 1)
  const many = sdk.erasePathsWithSweeps(m.paths, m.width, [...sweeps, ...sweeps, { from: [0.5, y + 0.05], to: [0.5, y - 0.05] }, ...sweeps], 0.02, 1)
  assert.deepEqual(many.pieces, once.pieces)
})

await check('only Ink strokes can be edited: highlight ids, unknown ids, empty pieces for nothing — no row changes, nothing recorded', async () => {
  const keep = otherRowsC()
  const ink = inkC().map((r) => r.note_json)
  const pushes = S().pushes
  const callsBefore = calls.length
  assert.equal(S().applyPartialErase(keep.map((r) => ({ id: r.id, pieces: [] }))), 0)
  assert.equal(S().applyPartialErase([{ id: 'missing', pieces: [] }]), 0)
  assert.equal(S().applyPartialErase([]), 0)
  assert.equal(S().pushes, pushes)
  assert.equal(calls.length, callsBefore)
  assert.deepEqual(otherRowsC(), keep)
  assert.deepEqual(inkC().map((r) => r.note_json), ink)
})

await check('invalid pieces (one point, out of the page box) never reach SQLite: a stroke left with no valid piece is removed, never corrupted', async () => {
  const target = S().strokes.at(-1)
  S().applyPartialErase([{ id: target.id, pieces: [[[0.5, 0.5]], [[2, 2], [3, 3]]] }])
  await tick()
  // [[2,2],[3,3]] is clamped into the page box by normalization, so it is still a valid 2-point piece; the 1-point piece is dropped
  const row = S().strokes.find((m) => m.id === target.id)
  assert.ok(row)
  for (const m of S().strokes) assert.ok(sdk.parsePdfInk({ pageIndex: m.pageIndex, paths: m.paths, penStyle: m.penStyle, width: m.width }))
  S().undo()
  await tick()
})

await check('Escape / cancel: the preview never calls the store, so stored strokes and the history stay as they were', async () => {
  const ink = inkC().map((r) => r.note_json)
  const pushes = S().pushes
  const callsBefore = calls.length
  cutAll(strokeIds) // computing a preview is pure
  assert.deepEqual(inkC().map((r) => r.note_json), ink)
  assert.equal(S().pushes, pushes)
  assert.equal(calls.length, callsBefore)
})

await check('a refused save of a cut stroke puts the original back and tells the user', async () => {
  const id = strokeIds[1]
  const original = structuredClone(S().strokes.find((m) => m.id === id))
  toasts.length = 0
  overrides.saveInk = async () => null
  S().applyPartialErase(cutAll([id]))
  await tick()
  overrides.saveInk = null
  const back = S().strokes.find((m) => m.id === id)
  assert.deepEqual(back.paths, original.paths)
  assert.ok(toasts.length > 0)
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

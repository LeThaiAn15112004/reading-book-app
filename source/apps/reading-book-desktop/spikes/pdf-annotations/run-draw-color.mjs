/**
 * Colour of NEW drawings (Freehand and Shapes): the path from the colour control to the saved annotation, with the REAL
 * stores (`pdfInkPrefsStore`, `pdfShapePrefsStore`, `pdfInkStore`, `pdfHighlightsStore`) against the REAL Main IPC and
 * SQLite. The bug it guards: the colour dialog showed the colour being picked (the picker's live `input` value) while the
 * settings only took it on the later `change` — so a drawing made in between used the previous colour. Controls that
 * edit the settings of the NEXT drawing now apply every pick at once (`pickerEventAction`).
 *
 *   1. control    live vs object-edit colour controls: when a pick reaches the settings
 *   2. freehand   a new stroke has the selected colour; per-style colours stay independent (Pen / Pencil / Marker / Brush)
 *   3. shapes     each of the four shapes has the selected colour; the colour is shared by the kinds (one Shape setting)
 *   4. separation Freehand and Shape colours never leak into each other
 *   5. consistency preview colour = committed = persisted = rendered after reopening; existing drawings keep their colour
 *
 * Run: npm run spike:pdf:draw-color   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { invoke } from './electron-stub.mjs'
import { getDatabase } from './db-stub.mjs'

const { OverlayChannels } = await import('../../electron/ipc/channels.ts')
const { registerOverlayIpc } = await import('../../electron/ipc/overlay.ipc.ts')
const sdk = await import('@reading-book/book-reader-sdk')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const tick = (ms = 8) => new Promise((r) => setTimeout(r, ms))

const db = getDatabase()
db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES ('b', 'B', '/b.pdf', 'pdf', 'sha-b', 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
).run()
registerOverlayIpc()

const localStore = new Map()
globalThis.localStorage = { getItem: (k) => localStore.get(k) ?? null, setItem: (k, v) => localStore.set(k, String(v)) }
globalThis.crypto ??= (await import('node:crypto')).webcrypto
globalThis.window = {
  api: {
    overlay: {
      listInk: (id) => invoke(OverlayChannels.listInk, id),
      saveInk: (input) => invoke(OverlayChannels.saveInk, input),
      deleteInk: (input) => invoke(OverlayChannels.deleteInk, input),
      listHighlights: (id) => invoke(OverlayChannels.listHighlights, id),
      saveHighlight: (input) => invoke(OverlayChannels.saveHighlight, input),
      deleteHighlight: (input) => invoke(OverlayChannels.deleteHighlight, input),
    },
  },
}

const { pickerEventAction } = await import('../../src/screens/Reader/components/chrome/inkColorPickerState.ts')
const { usePdfInkPrefsStore, activeInkLook } = await import('../../src/screens/Reader/logic/pdfInk/pdfInkPrefsStore.ts')
const { usePdfShapePrefsStore } = await import('../../src/screens/Reader/logic/pdfShapes/pdfShapePrefsStore.ts')
const { usePdfInkStore, dtoToInkMark } = await import('../../src/screens/Reader/logic/pdfInk/pdfInkStore.ts')
const { usePdfHighlightsStore } = await import('../../src/screens/Reader/logic/pdfHighlights/pdfHighlightsStore.ts')

const ink = () => usePdfInkStore.getState()
const hl = () => usePdfHighlightsStore.getState()
const inkPrefs = () => usePdfInkPrefsStore.getState()
const shapePrefs = () => usePdfShapePrefsStore.getState()
const noteOf = (id) => JSON.parse(db.prepare('SELECT note_json FROM notes WHERE id = ?').get(id).note_json)
const RATIO = 792 / 612

async function openBook() {
  const ctx = { bookId: 'b', onToast: () => {} }
  ink().setContext(ctx)
  hl().setContext({ ...ctx, pdfApiRef: null, onChromeHidden: () => {} })
  ink().resetForNewBook()
  hl().resetForNewBook()
  await ink().loadInk()
  await hl().loadHighlights()
}

/**
 * What the Shape tool does at the end of a drag (ReaderScreen → createShape): the look comes from the settings at THAT
 * moment. Returns the preview colour the renderer paints during the drag (PdfRenderer: `shapePen.colorHex`) too.
 */
function drawShape(kind, page, a, b) {
  const pen = { kind, colorHex: shapePrefs().colorHex, width: shapePrefs().width, opacity: shapePrefs().opacity }
  const previewStroke = sdk.shapeStrokeHex(pen.colorHex)
  const g = sdk.shapeFromDrag(kind, a, b, pen.width, RATIO)
  const row = hl().createShape(page, kind, g, { colorHex: shapeColorOf(pen), opacity: pen.opacity })
  return { row, previewStroke }
}
const shapeColorOf = (pen) => pen.colorHex

/** What the Freehand tool shows while drawing (ReaderScreen `inkPen`) and what it saves (`commitStroke`). */
function drawStroke(page, y) {
  const preview = { penStyle: inkPrefs().tool, ...inkPrefs().styles[inkPrefs().tool] }
  const mark = ink().commitStroke(page, [[0.1, y], [0.5, y + 0.05]])
  return { mark, preview }
}

console.log('1. the colour control')
await check('a control that edits the NEXT drawing applies every pick at once; one that edits an object commits on close only', () => {
  assert.deepEqual(pickerEventAction('input', true), { commit: true, preview: false })
  assert.deepEqual(pickerEventAction('change', true), { commit: true, preview: false })
  assert.deepEqual(pickerEventAction('input', false), { commit: false, preview: true })
  assert.deepEqual(pickerEventAction('change', false), { commit: true, preview: false })
})
await check('the settings stores take a pick as it comes (`input`, no `change` needed) and ignore garbage', () => {
  // The live control calls setStyleColor / setColor on every `input`: the settings are the colour the dialog shows.
  inkPrefs().setStyleColor('pen', '#e534be')
  assert.equal(inkPrefs().styles.pen.colorHex, '#E534BE')
  shapePrefs().setColor('#e534be')
  assert.equal(shapePrefs().colorHex, '#E534BE')
  inkPrefs().setStyleColor('pen', 'not a colour')
  shapePrefs().setColor('#12')
  assert.equal(inkPrefs().styles.pen.colorHex, '#E534BE')
  assert.equal(shapePrefs().colorHex, '#E534BE')
  assert.equal(JSON.parse(localStore.get('readmate.pdfInkPrefsV1') ?? localStore.get('readmate.pdfInkPrefs.v1')).styles.pen.colorHex, '#E534BE', 'persisted through the existing mechanism')
  assert.equal(JSON.parse(localStore.get('readmate.pdfShapePrefs.v1')).colorHex, '#E534BE')
})

await openBook()

console.log('2. freehand')
const strokes = {}
await check('a stroke drawn right after a colour change has the selected colour — preview, committed, persisted', async () => {
  inkPrefs().setStyleColor('pen', '#00796B')
  const { mark, preview } = drawStroke(0, 0.1)
  strokes.first = mark
  assert.equal(preview.colorHex, '#00796B')
  assert.equal(mark.colorHex, '#00796B')
  assert.equal(activeInkLook(inkPrefs()).colorHex, preview.colorHex, 'the preview reads the same settings the commit does')
  await tick()
  assert.equal(noteOf(mark.id).style.colorHex, '#00796B')
})
await check('a second change and another stroke: the new stroke has the NEW colour, the first keeps its own', async () => {
  inkPrefs().setStyleColor('pen', '#FF5722')
  const { mark } = drawStroke(0, 0.3)
  strokes.second = mark
  await tick()
  assert.equal(mark.colorHex, '#FF5722')
  assert.equal(noteOf(mark.id).style.colorHex, '#FF5722')
  assert.equal(ink().strokes.find((m) => m.id === strokes.first.id).colorHex, '#00796B')
  assert.equal(noteOf(strokes.first.id).style.colorHex, '#00796B')
})
await check('Pen, Pencil, Marker and Brush each keep their own colour; switching style never restores an older one', async () => {
  const picks = { pen: '#111111', pencil: '#222222', marker: '#333333', brush: '#444444' }
  for (const [style, hex] of Object.entries(picks)) inkPrefs().setStyleColor(style, hex)
  for (const style of ['marker', 'pen', 'brush', 'pencil', 'pen', 'marker']) {
    inkPrefs().setTool(style)
    assert.equal(activeInkLook(inkPrefs()).colorHex, picks[style], `${style} after switching`)
    const { mark } = drawStroke(1, 0.1)
    assert.equal(mark.colorHex, picks[style])
    assert.equal(mark.penStyle, style)
  }
  // Changing ONE style's colour touches no other.
  inkPrefs().setStyleColor('pencil', '#ABCDEF')
  assert.deepEqual(
    Object.fromEntries(Object.entries(inkPrefs().styles).map(([k, v]) => [k, v.colorHex])),
    { pen: '#111111', pencil: '#ABCDEF', marker: '#333333', brush: '#444444' },
  )
  inkPrefs().setTool('pen')
  await tick()
})

console.log('3. shapes')
const shapes = {}
await check('each shape type drawn after a colour change has the selected colour — preview, committed, persisted', async () => {
  shapePrefs().setColor('#E534BE')
  const specs = [
    ['rectangle', [0.1, 0.2], [0.4, 0.4]],
    ['ellipse', [0.5, 0.4], [0.8, 0.2]],
    ['line', [0.1, 0.6], [0.5, 0.6]],
    ['arrow', [0.9, 0.9], [0.5, 0.7]],
  ]
  for (const [kind, a, b] of specs) {
    const { row, previewStroke } = drawShape(kind, 0, a, b)
    shapes[kind] = row
    assert.equal(previewStroke, '#E534BE', `${kind} preview`)
    assert.equal(sdk.shapeStrokeHex(row.colorHex), '#E534BE', `${kind} committed`)
  }
  await tick()
  for (const kind of Object.keys(shapes)) assert.equal(noteOf(shapes[kind].id).style.colorHex, '#E534BE', `${kind} persisted`)
})
await check('a new colour applies to the next shape of ANY kind; switching kind never restores an older colour; earlier shapes keep theirs', async () => {
  shapePrefs().setColor('#1E88E5')
  for (const kind of ['arrow', 'rectangle', 'line', 'ellipse']) {
    shapePrefs().setKind(kind)
    assert.equal(shapePrefs().colorHex, '#1E88E5')
    const { row } = drawShape(kind, 1, [0.2, 0.2], [0.6, 0.4])
    assert.equal(sdk.shapeStrokeHex(row.colorHex), '#1E88E5', kind)
  }
  await tick()
  for (const kind of Object.keys(shapes)) {
    assert.equal(sdk.shapeStrokeHex(hl().highlights.find((h) => h.id === shapes[kind].id).colorHex), '#E534BE', `${kind} unchanged`)
    assert.equal(noteOf(shapes[kind].id).style.colorHex, '#E534BE')
  }
})
await check('the opacity setting rides in the colour and does not disturb the picked RGB', async () => {
  shapePrefs().setColor('#43A047')
  shapePrefs().setOpacity(0.5)
  const { row } = drawShape('rectangle', 2, [0.1, 0.1], [0.3, 0.2])
  await tick()
  assert.equal(noteOf(row.id).style.colorHex, '#43A04780')
  assert.equal(sdk.shapeStrokeHex(row.colorHex), '#43A047')
  shapePrefs().setOpacity(1)
})

console.log('4. separation')
await check('Freehand and Shape colours are separate settings: changing one never changes the other', () => {
  inkPrefs().setStyleColor('pen', '#010203')
  assert.notEqual(shapePrefs().colorHex, '#010203')
  const penBefore = inkPrefs().styles.pen.colorHex
  shapePrefs().setColor('#0A0B0C')
  assert.equal(inkPrefs().styles.pen.colorHex, penBefore)
  assert.equal(shapePrefs().colorHex, '#0A0B0C')
})

console.log('5. consistency')
await check('reopening the document renders every drawing with the colour it was drawn with', async () => {
  const before = {
    stroke1: strokes.first.id,
    stroke2: strokes.second.id,
  }
  await openBook()
  assert.equal(ink().strokes.find((m) => m.id === before.stroke1).colorHex, '#00796B')
  assert.equal(ink().strokes.find((m) => m.id === before.stroke2).colorHex, '#FF5722')
  for (const kind of Object.keys(shapes)) {
    const row = hl().highlights.find((h) => h.id === shapes[kind].id)
    assert.ok(row, `${kind} restored`)
    assert.equal(sdk.shapeStrokeHex(row.colorHex), '#E534BE', `${kind} rendered colour`)
  }
  // The raw DTO → mark mapping the renderer uses for strokes:
  const dto = (await invoke(OverlayChannels.listInk, 'b')).find((d) => d.id === before.stroke2)
  assert.equal(dtoToInkMark(dto).colorHex, '#FF5722')
})
await check('changing the tool colour later does not recolour anything already drawn (list state and SQLite)', async () => {
  const snapshot = (await invoke(OverlayChannels.listHighlights, 'b')).map((r) => [r.id, r.colorHex]).sort()
  const strokesBefore = ink().strokes.map((m) => [m.id, m.colorHex]).sort()
  inkPrefs().setStyleColor('pen', '#FEDCBA')
  shapePrefs().setColor('#FEDCBA')
  assert.deepEqual((await invoke(OverlayChannels.listHighlights, 'b')).map((r) => [r.id, r.colorHex]).sort(), snapshot)
  assert.deepEqual(ink().strokes.map((m) => [m.id, m.colorHex]).sort(), strokesBefore)
})

console.log(`\n${passed} checks passed`)
process.exit(0)

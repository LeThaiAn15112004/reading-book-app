/**
 * Shape tools on the renderer side (docs/implementation_plan/pdf_shape_tools.md): the REAL zustand stores
 * behind them (`pdfHighlightsStore` = the annotation list / history, `pdfShapePrefsStore`, the shared Ctrl+Z
 * `pdfUndoRouter`, the Ink store for the eraser check) against the REAL Main-side overlay IPC handlers and
 * SQLite schema. Only the IPC hop is a direct call (no window, no Electron).
 *
 *   1. create     each shape type becomes a row of the annotation list at once and of SQLite (type = its kind),
 *                 listed with text markup, restored without duplicates after reopening
 *   2. edit       resize / endpoint move / colour: the same row is updated, one history step each
 *   3. select     selecting focuses the row without a menu; a jump from the list selects the shape and goes to its page
 *   4. undo       create / resize / recolour / delete undo and redo, list and SQLite staying in step
 *   5. safety     refused saves roll back; the eraser never touches a shape; shape prefs persist and reset
 *
 * Run: npm run spike:pdf:shape-store   (builds the SDK bundle first)
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
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
insertBook.run('pdf-a', 'PDF A', '/a.pdf', 'pdf', 'sha-a')
registerOverlayIpc()

const localStore = new Map()
globalThis.localStorage = { getItem: (k) => localStore.get(k) ?? null, setItem: (k, v) => localStore.set(k, String(v)) }
globalThis.crypto ??= (await import('node:crypto')).webcrypto

const overrides = { saveHighlight: null }
globalThis.window = {
  api: {
    overlay: {
      listInk: (id) => invoke(OverlayChannels.listInk, id),
      saveInk: (input) => invoke(OverlayChannels.saveInk, input),
      deleteInk: (input) => invoke(OverlayChannels.deleteInk, input),
      listHighlights: (id) => invoke(OverlayChannels.listHighlights, id),
      saveHighlight: async (input) => (overrides.saveHighlight ? overrides.saveHighlight(input) : invoke(OverlayChannels.saveHighlight, input)),
      deleteHighlight: (input) => invoke(OverlayChannels.deleteHighlight, input),
    },
  },
}

const { usePdfHighlightsStore } = await import('../../src/screens/Reader/logic/pdfHighlights/pdfHighlightsStore.ts')
const { usePdfInkStore } = await import('../../src/screens/Reader/logic/pdfInk/pdfInkStore.ts')
const { usePdfShapePrefsStore, DEFAULT_PDF_SHAPE_PREFS } = await import('../../src/screens/Reader/logic/pdfShapes/pdfShapePrefsStore.ts')
const { pdfUndo, pdfRedo } = await import('../../src/screens/Reader/logic/pdfInk/pdfUndoRouter.ts')

const H = () => usePdfHighlightsStore.getState()
const toasts = []
const nav = []
const row = (id) => db.prepare('SELECT note_json FROM notes WHERE id = ?').get(id)
const note = (id) => JSON.parse(row(id).note_json)
const listed = (id) => H().highlights.find((h) => h.id === id)
const RATIO = 792 / 612

async function openBook() {
  const api = { goToPagePoint: (page, y) => nav.push([page, y]), flashAnnotation: (id) => nav.push(['flash', id]), clearSelection: () => false }
  H().setContext({ bookId: 'pdf-a', onToast: (m) => toasts.push(m), pdfApiRef: { current: api }, onChromeHidden: () => {} })
  usePdfInkStore.getState().setContext({ bookId: 'pdf-a', onToast: (m) => toasts.push(m) })
  H().resetForNewBook()
  usePdfInkStore.getState().resetForNewBook()
  await H().loadHighlights()
}
const geometry = (kind, a, b, w = 0.004) => sdk.shapeFromDrag(kind, a, b, w, RATIO)

console.log('PDF shape tools (renderer stores + Main IPC + SQLite)')
await openBook()
const ids = {}

console.log('1. create')
await check('each shape type is added to the annotation list at once and saved as a notes row of its own type', async () => {
  // A text markup row first, from the same store the Shape tool uses.
  const text = { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.1, y: 0.1, width: 0.5, height: 0.02 }] }
  const hl = await invoke(OverlayChannels.saveHighlight, {
    bookId: 'pdf-a',
    styleKind: 'highlight',
    colorHex: '#FFEB3B',
    locatorRef: sdk.packPdfHighlightLocator(text),
    pdfAnnotationRef: JSON.stringify(text),
  })
  ids.text = hl.id
  await H().loadHighlights()

  const specs = [
    ['rectangle', 0, [0.1, 0.3], [0.5, 0.45]],
    ['ellipse', 1, [0.7, 0.5], [0.3, 0.3]], // dragged up-left
    ['line', 2, [0.2, 0.6], [0.8, 0.6]],
    ['arrow', 2, [0.8, 0.9], [0.4, 0.7]],
  ]
  for (const [kind, page, a, b] of specs) {
    const created = H().createShape(page, kind, geometry(kind, a, b), { colorHex: '#E53935', opacity: 1 })
    assert.ok(created, kind)
    ids[kind] = created.id
    // Immediately in the list state the sidebar reads — no reload, no refresh.
    assert.equal(listed(created.id)?.styleKind, kind)
    assert.equal(listed(created.id)?.page, page + 1)
  }
  await tick()
  assert.equal(H().highlights.length, 5)
  for (const kind of ['rectangle', 'ellipse', 'line', 'arrow']) {
    const n = note(ids[kind])
    assert.equal(n.type, kind)
    assert.equal(n.group, 'annotation')
    assert.equal(n.style.colorHex, '#E53935')
    assert.ok(n.pdfAnnotation.shape.strokeWidth > 0)
    assert.equal(n.locatorExtended.locator.kind, 'page-rect')
  }
  assert.deepEqual(note(ids.arrow).pdfAnnotation.shape.line.length, 4)
  assert.equal(note(ids.text).type, 'highlight', 'the text markup row is untouched')
})
await check('the opacity setting travels inside the colour (#RRGGBBAA) like every annotation', async () => {
  const faded = H().createShape(0, 'rectangle', geometry('rectangle', [0.2, 0.7], [0.4, 0.8]), { colorHex: '#43A047', opacity: 0.5 })
  await tick()
  assert.equal(note(faded.id).style.colorHex, '#43A04780')
  assert.equal(sdk.shapeOpacityOf(listed(faded.id).colorHex), 0.502)
  H().deleteHighlight(faded.id)
  await tick()
})
await check('reopening the book (fresh load) restores every shape once, in the same list as the text markup', async () => {
  await openBook()
  assert.equal(H().highlights.length, 5)
  assert.equal(new Set(H().highlights.map((h) => h.id)).size, 5)
  assert.deepEqual(
    H().highlights.map((h) => h.styleKind).sort(),
    ['arrow', 'ellipse', 'highlight', 'line', 'rectangle'],
  )
  assert.deepEqual(listed(ids.arrow).shape, note(ids.arrow).pdfAnnotation.shape)
  assert.equal(H().history.canUndo(), false, 'undo history is per open')
})
await check('a gesture that is too small creates nothing (the tool never calls createShape for it)', () => {
  assert.equal(geometry('rectangle', [0.2, 0.2], [0.2, 0.2]), null)
  assert.equal(geometry('line', [0.2, 0.2], [0.2005, 0.2]), null)
})

console.log('2. edit')
await check('resizing a rectangle updates the SAME row (geometry + locator), one history step', async () => {
  const before = listed(ids.rectangle)
  const next = sdk.resizeShapeBox(before.rects[0], 'se', [0.8, 0.6], RATIO)
  H().updateShapeGeometry(ids.rectangle, { rect: next, shape: before.shape })
  await tick()
  const after = listed(ids.rectangle)
  assert.equal(after.rects[0].width, next.width)
  assert.equal(after.id, ids.rectangle)
  const n = note(ids.rectangle)
  assert.equal(n.pdfAnnotation.rects[0].width, next.width)
  assert.equal(n.locatorExtended.locator.rect.width, next.width, 'the jump target follows')
  assert.equal(H().highlights.length, 5)
  assert.ok(after.updatedAt >= before.updatedAt)
})
await check('moving an arrow end rewrites its endpoints and its padded box; pen width changes are kept', async () => {
  const before = listed(ids.arrow)
  const moved = sdk.moveShapeEndpoint('arrow', before.shape, 'end', [0.9, 0.5], RATIO)
  H().updateShapeGeometry(ids.arrow, moved)
  await tick()
  assert.deepEqual(note(ids.arrow).pdfAnnotation.shape.line.slice(2), [0.9, 0.5])
  assert.equal(note(ids.arrow).pdfAnnotation.shape.strokeWidth, before.shape.strokeWidth)
})
await check('a colour change updates the row — and never becomes the colour of the next text highlight', async () => {
  const lastUsed = H().lastUsedColorHex
  H().updateHighlightColor(ids.ellipse, '#1E88E5')
  await tick()
  assert.equal(note(ids.ellipse).style.colorHex, '#1E88E5')
  assert.equal(H().lastUsedColorHex, lastUsed)
  H().updateHighlightColor(ids.text, '#FF0000') // a text row still does
  assert.equal(H().lastUsedColorHex, '#FF0000')
  H().updateHighlightColor(ids.text, '#FFEB3B')
})
await check('updateShapeGeometry only works on shapes', async () => {
  const before = JSON.stringify(listed(ids.text))
  H().updateShapeGeometry(ids.text, geometry('rectangle', [0.1, 0.1], [0.5, 0.5]))
  assert.equal(JSON.stringify(listed(ids.text)), before)
})

console.log('3. select / list')
await check('focusing a shape selects it without opening any menu; blank click clears it', async () => {
  H().focusHighlight(ids.line)
  assert.equal(H().focusedHighlightId, ids.line)
  assert.equal(H().activeHighlight, null)
  H().dismissAnnotationUi()
  assert.equal(H().focusedHighlightId, null)
  H().focusHighlight('missing')
  assert.equal(H().focusedHighlightId, null)
})
await check('selecting a shape from the Notes list jumps to its page, pulses it and selects it', async () => {
  nav.length = 0
  H().jumpToHighlight(listed(ids.line))
  assert.equal(nav[0][0], 3, 'page of the shape (1-based)')
  assert.deepEqual(nav.at(-1), ['flash', ids.line])
  assert.equal(H().focusedHighlightId, ids.line)
  // A text row jump does not select anything.
  H().dismissAnnotationUi()
  H().jumpToHighlight(listed(ids.text))
  assert.equal(H().focusedHighlightId, null)
})
await check('deleting through the existing workflow removes the row from the list and SQLite; Delete on the focused shape does the same', async () => {
  H().focusHighlight(ids.line)
  assert.equal(H().hasFocusedHighlight(), true)
  H().deleteFocused()
  await tick()
  assert.equal(listed(ids.line), undefined)
  assert.equal(row(ids.line), undefined)
  assert.equal(H().focusedHighlightId, null)
  assert.equal(H().highlights.length, 4)
})

console.log('4. undo / redo')
await check('undo / redo of delete, recolour, resize and create keep list and SQLite in step', async () => {
  // Fresh history on a known state.
  await openBook()
  const r = H().createShape(0, 'rectangle', geometry('rectangle', [0.1, 0.2], [0.3, 0.4]), { colorHex: '#E53935', opacity: 1 })
  await tick()
  const box0 = listed(r.id).rects[0]
  H().updateShapeGeometry(r.id, { rect: sdk.resizeShapeBox(box0, 'se', [0.6, 0.7], RATIO), shape: listed(r.id).shape })
  H().updateHighlightColor(r.id, '#00ACC1')
  H().deleteHighlight(r.id)
  await tick()
  assert.equal(listed(r.id), undefined)
  assert.equal(row(r.id), undefined)

  H().undo() // delete
  await tick()
  assert.equal(listed(r.id)?.colorHex, '#00ACC1')
  assert.equal(note(r.id).style.colorHex, '#00ACC1')
  H().undo() // colour
  await tick()
  assert.equal(listed(r.id).colorHex, '#E53935')
  assert.equal(note(r.id).style.colorHex, '#E53935')
  H().undo() // resize
  await tick()
  assert.equal(listed(r.id).rects[0].width, box0.width)
  assert.equal(note(r.id).pdfAnnotation.rects[0].width, box0.width)
  H().undo() // create
  await tick()
  assert.equal(listed(r.id), undefined)
  assert.equal(row(r.id), undefined)

  H().redo()
  await tick()
  assert.ok(listed(r.id) && row(r.id), 'create redone')
  H().redo()
  H().redo()
  H().redo()
  await tick()
  assert.equal(listed(r.id), undefined, 'delete redone')
  assert.equal(row(r.id), undefined)
})
await check('the shared Ctrl+Z router undoes a shape edit too (the newest edit first, across Ink and markup)', async () => {
  await openBook()
  const a = H().createShape(1, 'ellipse', geometry('ellipse', [0.2, 0.2], [0.5, 0.4]), { colorHex: '#E53935', opacity: 1 })
  const stroke = usePdfInkStore.getState().commitStroke(1, [[0.1, 0.1], [0.4, 0.2]])
  await tick()
  pdfUndo() // the stroke
  await tick()
  assert.equal(usePdfInkStore.getState().strokes.length, 0)
  assert.ok(listed(a.id), 'the shape is still there')
  pdfUndo() // the shape
  await tick()
  assert.equal(listed(a.id), undefined)
  pdfRedo()
  await tick()
  assert.ok(listed(a.id) && row(a.id))
  assert.ok(stroke)
})

console.log('5. safety')
await check('a refused save rolls the new shape back out of the list and tells the user', async () => {
  await openBook()
  overrides.saveHighlight = async () => null
  toasts.length = 0
  const r = H().createShape(0, 'rectangle', geometry('rectangle', [0.1, 0.1], [0.4, 0.3]), { colorHex: '#E53935', opacity: 1 })
  assert.ok(listed(r.id), 'optimistic')
  await tick()
  assert.equal(listed(r.id), undefined)
  assert.ok(toasts.some((m) => /shape/i.test(m)))
  overrides.saveHighlight = null
})
await check('the Ink eraser (stroke and partial) never touches a shape', async () => {
  await openBook()
  const s = H().createShape(0, 'rectangle', geometry('rectangle', [0.1, 0.1], [0.6, 0.5]), { colorHex: '#E53935', opacity: 1 })
  const stroke = usePdfInkStore.getState().commitStroke(0, [[0.1, 0.3], [0.6, 0.3]])
  await tick()
  assert.equal(usePdfInkStore.getState().eraseStrokes([s.id, stroke.id]), 1, 'only the real stroke is erased')
  await tick()
  assert.ok(listed(s.id) && row(s.id))
  assert.equal(usePdfInkStore.getState().applyPartialErase([{ id: s.id, pieces: [] }]), 0, 'a partial cut of a shape id edits nothing')
  await tick()
  assert.ok(listed(s.id) && row(s.id))
  assert.deepEqual(JSON.parse(JSON.stringify(note(s.id).pdfAnnotation.shape)), listed(s.id).shape)
})
await check('shape preferences are remembered (kind, colour, thickness, opacity), validated, and reset to the defaults', async () => {
  const p = usePdfShapePrefsStore.getState()
  assert.deepEqual({ ...DEFAULT_PDF_SHAPE_PREFS }, { kind: 'rectangle', colorHex: '#E53935', width: sdk.PDF_SHAPE_DEFAULT_STROKE, opacity: 1 })
  p.setKind('arrow')
  p.setColor('#1e88e5')
  p.setWidth(5) // clamped
  p.setOpacity(0.01) // clamped
  p.setKind('hexagon')
  p.setColor('blue')
  const s = usePdfShapePrefsStore.getState()
  assert.equal(s.kind, 'arrow')
  assert.equal(s.colorHex, '#1E88E5')
  assert.equal(s.width, sdk.PDF_SHAPE_MAX_STROKE)
  assert.equal(s.opacity, 0.05)
  assert.equal(JSON.parse(localStore.get('readmate.pdfShapePrefs.v1')).kind, 'arrow')
  assert.equal(s.reset(), true)
  assert.equal(usePdfShapePrefsStore.getState().kind, 'rectangle')
  assert.equal(usePdfShapePrefsStore.getState().opacity, 1)
})

console.log(`\n${passed} checks passed`)
process.exit(0)

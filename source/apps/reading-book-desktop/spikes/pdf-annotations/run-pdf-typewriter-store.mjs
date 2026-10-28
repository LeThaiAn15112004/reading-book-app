/**
 * Typewriter notes on the renderer side (specs/005-typewriter-note, quickstart T-13 / T-15): the REAL zustand stores
 * (`pdfHighlightsStore` = annotation list / history, `typewriterEditorStore`, `pdfTypewriterPrefsStore`, the shared
 * `pdfUndoRouter`) against the REAL Main-side overlay IPC handlers and SQLite schema. Only the IPC hop is a direct
 * call (no window, no Electron). The page layer / editor DOM are covered by the E2E spec `pdf-typewriter`.
 *
 *   1. create     a finished note becomes a row of the annotation list at once and of SQLite (type = typewriter),
 *                 text untrimmed; listed again after "reopening" without duplicates
 *   2. history    create is exactly ONE undo step; undo removes the row (list and SQLite), redo restores it
 *   3. refusals   blank text, an invalid document and a box off the page are refused with a message and store nothing;
 *                 a save refused by Main rolls the row back and toasts
 *   4. editor     a session starts from the prefs (family / size / colour / alignment), typed changes keep the
 *                 document valid, text-level undo / redo, a moved caret drops the pending style, `end` clears it all
 *   5. prefs      defaults, persistence, per-field fallback for invalid stored values, `reset()`
 *
 * Run: npm run spike:pdf:typewriter-store   (builds the SDK bundle first)
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
   VALUES ('pdf-a', 'PDF A', '/a.pdf', 'pdf', 'sha-a', 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
).run()
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
const { useTypewriterEditorStore } = await import('../../src/screens/Reader/logic/pdfTypewriter/typewriterEditorStore.ts')
const { usePdfTypewriterPrefsStore, DEFAULT_PDF_TYPEWRITER_PREFS } = await import('../../src/screens/Reader/logic/pdfTypewriter/pdfTypewriterPrefsStore.ts')
const { pdfUndo, pdfRedo } = await import('../../src/screens/Reader/logic/pdfInk/pdfUndoRouter.ts')

const H = () => usePdfHighlightsStore.getState()
const E = () => useTypewriterEditorStore.getState()
const P = () => usePdfTypewriterPrefsStore.getState()
const toasts = []
const note = (id) => JSON.parse(db.prepare('SELECT note_json FROM notes WHERE id = ?').get(id).note_json)
const rowCount = () => db.prepare(`SELECT COUNT(*) AS n FROM notes WHERE book_id = 'pdf-a'`).get().n
const listed = (id) => H().highlights.find((h) => h.id === id)

async function openBook() {
  const api = { goToPagePoint: () => {}, flashAnnotation: () => {}, clearSelection: () => false }
  H().setContext({ bookId: 'pdf-a', onToast: (m) => toasts.push(m), pdfApiRef: { current: api }, onChromeHidden: () => {} })
  usePdfInkStore.getState().setContext({ bookId: 'pdf-a', onToast: (m) => toasts.push(m) })
  H().resetForNewBook()
  usePdfInkStore.getState().resetForNewBook()
  await H().loadHighlights()
}

const TEXT = '  Xin chào\nthế giới '
const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }
let doc = sdk.emptyTypewriterDoc()
doc = sdk.applyStyle(doc, TEXT, { start: 2, end: 5 }, { bold: true })

console.log('PDF Typewriter (renderer stores + Main IPC + SQLite)')
await openBook()
let id

console.log('1. create')
await check('a note is added to the list at once and saved as a notes row of type typewriter, text untrimmed', async () => {
  const row = H().createTypewriter({ pageIndex: 1, box, text: TEXT, doc })
  assert.ok(row)
  id = row.id
  assert.equal(listed(id)?.styleKind, 'typewriter')
  assert.equal(listed(id)?.note, TEXT)
  assert.equal(listed(id)?.page, 2)
  await tick()
  const stored = note(id)
  assert.equal(stored.type, 'typewriter')
  assert.equal(stored.note, TEXT)
  assert.equal(stored.pdfAnnotation.pageIndex, 1)
  assert.deepEqual(stored.pdfAnnotation.typewriter, doc)
  assert.equal(stored.style.colorHex, doc.base.color)
  assert.equal(toasts.length, 0)
})
await check('reopening lists it once, with its document', async () => {
  await openBook()
  assert.equal(H().highlights.length, 1)
  assert.equal(listed(id)?.note, TEXT)
  assert.deepEqual(listed(id)?.typewriter, doc)
  assert.equal(rowCount(), 1)
})

console.log('2. history')
await check('create is one undo step: undo removes the row everywhere, redo restores it', async () => {
  // Reopening cleared the history: make the row again in this session.
  const base = rowCount()
  const row = H().createTypewriter({ pageIndex: 1, box, text: TEXT, doc })
  assert.ok(row)
  id = row.id
  await tick(30)
  assert.equal(rowCount(), base + 1)
  pdfUndo()
  await tick(30)
  assert.equal(listed(id), undefined)
  assert.equal(rowCount(), base)
  pdfRedo()
  await tick(30)
  assert.equal(listed(id)?.note, TEXT)
  assert.equal(rowCount(), base + 1)
  assert.deepEqual(note(id).pdfAnnotation.typewriter, doc)
  pdfUndo()
  await tick(30)
  pdfUndo() // nothing else is on the stack: must not touch anything
  await tick(30)
  assert.equal(rowCount(), base)
  pdfRedo()
  await tick(30)
  assert.equal(rowCount(), base + 1)
})

console.log('3. refusals')
await check('blank text, an invalid document and a box off the page are refused with a message and store nothing', async () => {
  const before = { rows: rowCount(), listed: H().highlights.length, toasts: toasts.length }
  assert.equal(H().createTypewriter({ pageIndex: 0, box, text: '   ', doc }), null)
  assert.equal(H().createTypewriter({ pageIndex: 0, box, text: 'abc', doc: { ...doc, runs: [{ start: 0, end: 99, style: { bold: true } }] } }), null)
  assert.equal(H().createTypewriter({ pageIndex: 0, box: { ...box, y: 0.95, height: 0.2 }, text: 'abc', doc: sdk.emptyTypewriterDoc() }), null)
  assert.equal(toasts.length, before.toasts + 3)
  assert.equal(H().highlights.length, before.listed)
  assert.equal(rowCount(), before.rows)
})
await check('a save refused by Main rolls the row back and toasts', async () => {
  overrides.saveHighlight = async () => null
  const before = H().highlights.length
  const row = H().createTypewriter({ pageIndex: 0, box, text: 'refused', doc: sdk.emptyTypewriterDoc() })
  assert.ok(row)
  await tick(30)
  overrides.saveHighlight = null
  assert.equal(H().highlights.length, before)
  assert.equal(listed(row.id), undefined)
  assert.match(toasts[toasts.length - 1], /Could not save/)
})

console.log('3b. move / resize / edit (US2)')
await check('move, resize and an edit commit each replace the row in place as exactly ONE undo step; delete and undo restore it', async () => {
  const row = H().createTypewriter({ pageIndex: 0, box, text: 'một hai ba', doc: sdk.emptyTypewriterDoc() })
  assert.ok(row)
  const rid = row.id
  await tick(30)
  const moved = { ...box, x: 0.3, y: 0.5 }
  assert.equal(H().updateTypewriter(rid, { box: moved, text: 'một hai ba', doc: row.typewriter }), true)
  const wider = { ...moved, width: 0.5 }
  assert.equal(H().updateTypewriter(rid, { box: wider, text: 'một hai ba', doc: row.typewriter }), true)
  const edited = sdk.editText(row.typewriter, 'một hai ba', { start: 10, end: 10, insert: ' bốn' })
  assert.equal(H().updateTypewriter(rid, { box: wider, text: edited.text, doc: edited.doc }), true)
  await tick(30)
  assert.equal(listed(rid).note, 'một hai ba bốn')
  assert.equal(note(rid).note, 'một hai ba bốn')
  assert.equal(note(rid).pdfAnnotation.rects[0].width, 0.5)
  assert.equal(H().highlights.filter((h) => h.id === rid).length, 1, 'edited in place, never duplicated')
  pdfUndo() // the edit
  await tick(30)
  assert.equal(listed(rid).note, 'một hai ba')
  assert.equal(listed(rid).rects[0].width, 0.5)
  pdfUndo() // the resize
  await tick(30)
  assert.equal(listed(rid).rects[0].width, box.width)
  assert.equal(listed(rid).rects[0].x, 0.3)
  pdfUndo() // the move
  await tick(30)
  assert.equal(listed(rid).rects[0].x, box.x)
  assert.equal(note(rid).pdfAnnotation.rects[0].x, box.x)
  pdfRedo()
  await tick(30)
  assert.equal(listed(rid).rects[0].x, 0.3)
  H().deleteHighlight(rid)
  await tick(30)
  assert.equal(listed(rid), undefined)
  pdfUndo()
  await tick(30)
  assert.equal(listed(rid)?.note, 'một hai ba')
})
await check('a result that does not fit the page is refused with a message and the stored row stays as it was', async () => {
  const row = H().createTypewriter({ pageIndex: 0, box, text: 'giữ nguyên', doc: sdk.emptyTypewriterDoc() })
  await tick(30)
  const before = JSON.stringify(note(row.id))
  const toastsBefore = toasts.length
  assert.equal(H().updateTypewriter(row.id, { box: { ...box, y: 0.95, height: 0.2 }, text: 'giữ nguyên', doc: row.typewriter }), false)
  assert.equal(H().updateTypewriter(row.id, { box: { ...box, width: 0.01 }, text: 'giữ nguyên', doc: row.typewriter }), false)
  assert.equal(H().updateTypewriter(row.id, { box, text: '   ', doc: row.typewriter }), false)
  assert.equal(H().updateTypewriter('missing', { box, text: 'x', doc: row.typewriter }), false)
  assert.equal(toasts.length, toastsBefore + 3)
  await tick(30)
  assert.equal(JSON.stringify(note(row.id)), before)
  assert.equal(listed(row.id).rects[0].y, box.y)
})

console.log('3b. format (US3)')
const fitSame = (_doc, _text, b) => b
await check('a whole-box format change is ONE undo step; mixed run formatting survives a reload from SQLite', async () => {
  await openBook()
  const row = H().createTypewriter({ pageIndex: 0, box, text: TEXT, doc })
  id = row.id
  await tick(30)
  assert.equal(H().formatTypewriter(id, { align: 'center' }, fitSame), true)
  await tick(30)
  assert.deepEqual(listed(id).typewriter.align.map((a) => a.align), ['center', 'center'].slice(0, listed(id).typewriter.align.length))
  assert.ok(listed(id).typewriter.align.length >= 1)
  assert.equal(note(id).pdfAnnotation.typewriter.align[0].align, 'center')
  pdfUndo()
  await tick(30)
  assert.deepEqual(listed(id).typewriter.align, doc.align)
  pdfRedo()
  await tick(30)
  await openBook()
  assert.equal(listed(id).typewriter.align[0].align, 'center')
  assert.deepEqual(listed(id).typewriter.runs, doc.runs, 'the bold word is still bold after the whole-box change')
})
await check('a colour drag (several changes in a row) coalesces into one undo step', async () => {
  const before = JSON.stringify(listed(id).typewriter)
  for (const c of ['#112233', '#223344', '#334455']) assert.equal(H().formatTypewriter(id, { style: { color: c } }, fitSame), true)
  await tick(30)
  assert.equal(listed(id).typewriter.base.color, '#334455')
  assert.equal(listed(id).colorHex, '#334455')
  assert.equal(note(id).style.colorHex, '#334455')
  pdfUndo()
  await tick(30)
  assert.equal(JSON.stringify(listed(id).typewriter), before)
  pdfRedo()
  await tick(30)
})
await check('a format that does not fit the page is refused with a message and changes nothing', async () => {
  const stored = JSON.stringify(listed(id).typewriter)
  const t = toasts.length
  assert.equal(H().formatTypewriter(id, { style: { size: 0.1 } }, () => null), false)
  assert.equal(toasts.length, t + 1)
  assert.equal(JSON.stringify(listed(id).typewriter), stored)
})
await check('editor: a range gets the style, a collapsed caret gets a pending style, an empty draft formats the whole box', async () => {
  E().begin({ pageIndex: 0, box, heightRatio: 792 / 612, style: P().style, align: 'left' })
  E().formatStyle({ bold: true })
  assert.equal(E().session.doc.base.bold, true, 'empty text: whole box')
  E().end()
  E().beginEdit({ id, pageIndex: 0, box, heightRatio: 792 / 612, text: TEXT, doc: listed(id).typewriter })
  E().select({ start: 8, end: 12 })
  E().formatStyle({ italic: true })
  assert.ok(E().session.doc.runs.some((r) => r.style.italic && r.start <= 8 && r.end >= 12))
  E().select({ start: 4, end: 4 })
  E().formatStyle({ underline: true })
  assert.deepEqual(E().session.pending, { underline: true })
  E().formatAlign('right')
  assert.ok(E().session.doc.align.some((a) => a.align === 'right'))
  E().end()
})

console.log('3c. properties panel target (US4)')
const { useTypewriterPanelStore } = await import('../../src/screens/Reader/logic/pdfTypewriter/typewriterPanelStore.ts')
const { typewriterFormatValues } = await import('../../src/screens/Reader/logic/pdfTypewriter/typewriterFormatValues.ts')
await check('target A → B → none → defaults: each value shown is read from that target; nothing of the previous one is left', async () => {
  await openBook()
  const a = H().createTypewriter({ pageIndex: 0, box, text: 'AAA', doc: sdk.applyStyle(sdk.emptyTypewriterDoc(), 'AAA', null, { color: '#FF0000', family: 'noto-serif' }) })
  const b = H().createTypewriter({ pageIndex: 0, box: { ...box, y: 0.5 }, text: 'BBB', doc: sdk.applyStyle(sdk.emptyTypewriterDoc(), 'BBB', { start: 0, end: 1 }, { bold: true }) })
  const panel = () => useTypewriterPanelStore.getState()
  const valuesOf = (row) => typewriterFormatValues(row.typewriter, row.note, null, null)
  assert.deepEqual(panel().target, { mode: 'defaults' })
  panel().showNote(a.id)
  assert.deepEqual(panel().target, { mode: 'note', id: a.id })
  assert.equal(valuesOf(listed(a.id)).style.color, '#FF0000')
  assert.equal(valuesOf(listed(a.id)).style.family, 'noto-serif')
  panel().showNote(b.id)
  const vb = valuesOf(listed(b.id))
  assert.equal(vb.style.color, sdk.emptyTypewriterDoc().base.color, 'B shows its own colour, not A')
  assert.equal(vb.style.family, 'noto-sans')
  assert.ok(vb.mixed.has('bold'), 'B has a bold range: shown as mixed')
  panel().showDefaults()
  assert.deepEqual(panel().target, { mode: 'defaults' })
  assert.deepEqual(Object.keys(panel().target), ['mode'], 'the panel holds no id, value, selection or field text')
})
await check('formatting note A leaves note B and the defaults alone; defaults leave existing notes alone', async () => {
  const [a, b] = H().highlights.filter((h) => h.styleKind === 'typewriter').slice(-2)
  const bBefore = JSON.stringify(b.typewriter)
  const defaultsBefore = JSON.stringify(P().style)
  assert.equal(H().formatTypewriter(a.id, { style: { color: '#00FF00' } }, (_d, _t, bx) => bx), true)
  assert.equal(JSON.stringify(listed(b.id).typewriter), bBefore)
  assert.equal(JSON.stringify(P().style), defaultsBefore)
  P().setStyle({ color: '#0000FF' })
  assert.equal(listed(a.id).typewriter.base.color, '#00FF00')
  assert.equal(JSON.stringify(listed(b.id).typewriter), bBefore)
  P().reset()
})
await check('an open editing session is dropped by `end`, so the next target starts clean', async () => {
  E().beginEdit({ id: 'x', pageIndex: 0, box, heightRatio: 792 / 612, text: 'abc', doc: sdk.emptyTypewriterDoc() })
  E().select({ start: 0, end: 2 })
  E().setPending({ bold: true })
  E().end()
  assert.equal(E().session, null)
  E().beginEdit({ id: 'y', pageIndex: 0, box, heightRatio: 792 / 612, text: 'abc', doc: sdk.emptyTypewriterDoc() })
  assert.equal(E().session.pending, null)
  assert.deepEqual(E().session.selection, { start: 3, end: 3 })
  E().end()
})

console.log('4. editor session')
await check('a session starts from the prefs and keeps the document valid while typing', async () => {
  P().setStyle({ family: 'noto-serif', size: 20 / 612, color: '#1e88e5', bold: true })
  P().setAlign('center')
  E().begin({ pageIndex: 0, box, heightRatio: 792 / 612, style: P().style, align: P().align })
  const s = E().session
  assert.equal(s.text, '')
  assert.equal(s.doc.base.family, 'noto-serif')
  assert.equal(s.doc.base.color, '#1E88E5')
  assert.equal(s.doc.base.bold, true)
  assert.deepEqual(s.doc.align, [{ start: 0, align: 'center' }])
  const r = sdk.editText(s.doc, s.text, { start: 0, end: 0, insert: 'Chào\nbạn' })
  E().change({ text: r.text, doc: r.doc, selection: { start: 8, end: 8 } })
  assert.ok(sdk.parseTypewriterDoc(E().session.doc, E().session.text), 'valid document')
  assert.deepEqual(E().session.doc.align, [{ start: 0, align: 'center' }, { start: 5, align: 'center' }], 'the new paragraph inherits the alignment')
})
await check('text-level undo / redo of the open session; a moved caret drops the pending style', async () => {
  const typed = E().session.text
  E().undo()
  assert.equal(E().session.text, '')
  E().redo()
  assert.equal(E().session.text, typed)
  E().setPending({ italic: true })
  assert.deepEqual(E().session.pending, { italic: true })
  E().select({ start: 1, end: 1 })
  assert.equal(E().session.pending, null)
})
await check('another session is a clean slate; end clears everything', async () => {
  const first = E().session.id
  E().begin({ pageIndex: 0, box, heightRatio: 792 / 612, style: P().style, align: 'left' })
  assert.notEqual(E().session.id, first)
  assert.equal(E().session.text, '')
  assert.equal(E().undoStack.length, 0)
  E().end()
  assert.equal(E().session, null)
})

console.log('5. prefs')
await check('persist across a reload; invalid stored values fall back per field; reset restores the defaults', async () => {
  assert.equal(JSON.parse(localStore.get('readmate.pdfTypewriterPrefs.v1')).style.family, 'noto-serif')
  localStore.set('readmate.pdfTypewriterPrefs.v1', JSON.stringify({ style: { family: 'nope', size: 'big', color: '#12ab34', bold: 'yes', italic: true }, align: 'sideways' }))
  const reloaded = await import(`../../src/screens/Reader/logic/pdfTypewriter/pdfTypewriterPrefsStore.ts?reload=${Date.now()}`)
  const s = reloaded.usePdfTypewriterPrefsStore.getState()
  assert.equal(s.style.family, DEFAULT_PDF_TYPEWRITER_PREFS.style.family)
  assert.equal(s.style.size, DEFAULT_PDF_TYPEWRITER_PREFS.style.size)
  assert.equal(s.style.color, '#12AB34')
  assert.equal(s.style.bold, false)
  assert.equal(s.style.italic, true)
  assert.equal(s.align, 'left')
  assert.equal(P().reset(), true)
  assert.deepEqual({ style: P().style, align: P().align }, DEFAULT_PDF_TYPEWRITER_PREFS)
  P().setStyle({ size: 5 })
  assert.ok(P().style.size >= sdk.TYPEWRITER_MIN_SIZE, 'size is clamped')
  P().reset()
})

console.log(`\n${passed} checks passed`)

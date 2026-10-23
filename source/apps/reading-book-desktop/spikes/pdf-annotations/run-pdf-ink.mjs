/**
 * Checks for PDF freehand Ink on the Main side (docs/implementation_plan/pdf_freehand_ink_eraser_plan.md,
 * Phase 1): the real `overlay:*Ink` IPC handlers + `SqliteOverlayStore` on the real migrated schema
 * (node:sqlite, no Electron window).
 *
 *   1. save        -> an `ink` row lands in `notes` as page-rect locator + pdfInk + style; DTO round trip
 *   2. validation  -> bad geometry / locator mismatch / bad colour / oversize payloads are refused
 *   3. update      -> editing keeps createdAt; an id of another kind of row is never converted
 *   4. isolation   -> ink never shows up in highlight queries, highlight delete cannot remove it, and
 *                     ink delete cannot remove a highlight or a bookmark; lists are per book
 *   5. persistence -> a fresh store instance (app restart) reads the same strokes back
 *   6. corruption  -> a hand-broken pdfInk never reaches the renderer
 *
 * Run: npm run spike:pdf:ink   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { packPdfInkLocator, packPdfInkRef, packPdfHighlightLocator, pdfAnnotationFromRects } from '@reading-book/book-reader-sdk'
import { invoke } from './electron-stub.mjs'
import { getDatabase } from './db-stub.mjs'

const { OverlayChannels } = await import('../../electron/ipc/channels.ts')
const { registerOverlayIpc } = await import('../../electron/ipc/overlay.ipc.ts')
const { SqliteOverlayStore, getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const db = getDatabase()
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
insertBook.run('pdf-a', 'PDF A', '/a.pdf', 'pdf', 'sha-a')
insertBook.run('pdf-b', 'PDF B', '/b.pdf', 'pdf', 'sha-b')

registerOverlayIpc()
const store = getOverlayStore()
await store.saveBookmark({ bookId: 'pdf-a', locator: { kind: 'page-rect', page: 3, chapterIndex: 2 }, label: 'Page 3' })
const bookmarkId = db.prepare(`SELECT id FROM notes WHERE book_id = 'pdf-a'`).get().id

const highlightRects = [{ page: 3, x: 0.1, y: 0.8, width: 0.7, height: 0.02 }]
const highlightAnnotation = pdfAnnotationFromRects(highlightRects)
await invoke(OverlayChannels.saveHighlight, {
  bookId: 'pdf-a',
  id: 'pdf-h1',
  locatorRef: packPdfHighlightLocator(highlightAnnotation),
  styleKind: 'highlight',
  colorHex: '#ffeb3b',
  tags: [],
  pdfAnnotationRef: JSON.stringify(highlightAnnotation),
})

const stroke = {
  pageIndex: 2,
  paths: [
    [
      [0.1, 0.2],
      [0.25, 0.3],
      [0.4, 0.28],
    ],
  ],
  penStyle: 'pen',
  width: 0.004,
}
const baseInput = {
  bookId: 'pdf-a',
  id: 'ink-1',
  locatorRef: packPdfInkLocator(stroke),
  colorHex: '#1E88E5',
  opacity: 1,
  pdfInkRef: packPdfInkRef(stroke),
  createdAt: '2026-10-23T01:00:00.000Z',
}
const noteRow = (id) => db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id)
const notesCount = () => db.prepare(`SELECT COUNT(*) AS n FROM notes`).get().n

console.log('PDF freehand Ink (Main: IPC + SQLite)')

console.log('1. save')
await check('saveInk stores type ink, a page-rect locator, pdfInk and the style in note_json', async () => {
  const dto = await invoke(OverlayChannels.saveInk, baseInput)
  assert.ok(dto, 'save refused')
  assert.equal(dto.id, 'ink-1')
  const json = JSON.parse(noteRow('ink-1').note_json)
  assert.equal(json.type, 'ink')
  assert.equal(json.group, 'annotation')
  assert.equal(json.locatorExtended.locator.kind, 'page-rect')
  assert.equal(json.locatorExtended.locator.page, 3)
  assert.equal(json.locatorExtended.locator.chapterIndex, 2)
  assert.deepEqual(json.pdfInk, stroke)
  assert.deepEqual(json.style, { colorHex: '#1E88E5', opacity: 1 })
})

await check('listInk returns the stroke exactly as drawn (reopen the book)', async () => {
  const rows = await invoke(OverlayChannels.listInk, 'pdf-a')
  assert.equal(rows.length, 1)
  assert.deepEqual(JSON.parse(rows[0].pdfInkRef), stroke)
  assert.equal(rows[0].colorHex, '#1E88E5')
  assert.equal(rows[0].opacity, 1)
  assert.equal(rows[0].createdAt, '2026-10-23T01:00:00.000Z')
})

console.log('2. validation')
await check('bad geometry, locator mismatch, colour and opacity are refused and nothing is written', async () => {
  const before = notesCount()
  const bad = [
    { ...baseInput, id: 'x1', pdfInkRef: JSON.stringify({ ...stroke, paths: [[[0.1, 2]]] }) },
    { ...baseInput, id: 'x2', pdfInkRef: JSON.stringify({ ...stroke, paths: [[[0.1, 0.1], [Number.NaN, 0.2]]] }) },
    { ...baseInput, id: 'x3', pdfInkRef: JSON.stringify({ ...stroke, width: 5 }) },
    { ...baseInput, id: 'x4', pdfInkRef: JSON.stringify({ ...stroke, penStyle: 'laser' }) },
    { ...baseInput, id: 'x5', pdfInkRef: 'not json' },
    { ...baseInput, id: 'x6', pdfInkRef: 'x'.repeat(300_000) },
    { ...baseInput, id: 'x7', locatorRef: packPdfInkLocator({ ...stroke, pageIndex: 5 }) },
    { ...baseInput, id: 'x8', locatorRef: JSON.stringify({ kind: 'cfi', cfi: 'epubcfi(/6/4)' }) },
    { ...baseInput, id: 'x9', colorHex: 'blue' },
    { ...baseInput, id: 'x10', opacity: 0 },
    { ...baseInput, id: 'x11', opacity: 2 },
    { ...baseInput, id: 'x12', bookId: '   ' },
    { ...baseInput, id: 'x13', pdfInkRef: undefined },
  ]
  for (const input of bad) assert.equal(await invoke(OverlayChannels.saveInk, input), null, `accepted ${input.id}`)
  assert.equal(await invoke(OverlayChannels.saveInk, null), null)
  assert.equal(notesCount(), before)
})

console.log('3. update')
await check('re-saving keeps createdAt; geometry and colour update', async () => {
  const moved = { ...stroke, paths: [[[0.5, 0.5], [0.6, 0.6]]] }
  const dto = await invoke(OverlayChannels.saveInk, { ...baseInput, createdAt: undefined, colorHex: '#E53935', pdfInkRef: packPdfInkRef(moved), locatorRef: packPdfInkLocator(moved) })
  assert.ok(dto)
  assert.equal(dto.createdAt, '2026-10-23T01:00:00.000Z')
  assert.equal(dto.colorHex, '#E53935')
  assert.deepEqual(JSON.parse(noteRow('ink-1').note_json).pdfInk, moved)
  // back to the original for the following checks
  await invoke(OverlayChannels.saveInk, baseInput)
})

await check('an ink save never converts a highlight or a bookmark', async () => {
  const before = noteRow('pdf-h1').note_json
  assert.equal(await invoke(OverlayChannels.saveInk, { ...baseInput, id: 'pdf-h1' }), null)
  assert.equal(await invoke(OverlayChannels.saveInk, { ...baseInput, id: bookmarkId }), null)
  assert.equal(noteRow('pdf-h1').note_json, before)
  assert.equal(JSON.parse(noteRow(bookmarkId).note_json).group, 'bookmark')
})

await check('an ink save cannot take over another book\'s row', async () => {
  assert.equal(await invoke(OverlayChannels.saveInk, { ...baseInput, bookId: 'pdf-b' }), null)
  assert.equal(noteRow('ink-1').book_id, 'pdf-a')
})

console.log('4. isolation')
await check('ink is not a highlight: listHighlights / the planner input never contain it', async () => {
  const rows = await invoke(OverlayChannels.listHighlights, 'pdf-a')
  assert.deepEqual(rows.map((r) => r.id), ['pdf-h1'])
  assert.deepEqual((await store.listHighlights('pdf-a')).map((r) => r.id), ['pdf-h1'])
})

await check('deleteHighlight cannot remove a stroke; deleteInk cannot remove a highlight or a bookmark', async () => {
  assert.deepEqual(await invoke(OverlayChannels.deleteHighlight, { bookId: 'pdf-a', id: 'ink-1' }), { ok: false })
  assert.ok(noteRow('ink-1'))
  assert.deepEqual(await invoke(OverlayChannels.deleteInk, { bookId: 'pdf-a', id: 'pdf-h1' }), { ok: false })
  assert.deepEqual(await invoke(OverlayChannels.deleteInk, { bookId: 'pdf-a', id: bookmarkId }), { ok: false })
  assert.ok(noteRow('pdf-h1'))
  assert.ok(noteRow(bookmarkId))
})

await check('lists are per book and a wrong-book delete is refused', async () => {
  assert.deepEqual(await invoke(OverlayChannels.listInk, 'pdf-b'), [])
  assert.deepEqual(await invoke(OverlayChannels.deleteInk, { bookId: 'pdf-b', id: 'ink-1' }), { ok: false })
  assert.ok(noteRow('ink-1'))
  assert.deepEqual(await invoke(OverlayChannels.listInk, ''), [])
})

console.log('5. persistence')
await check('a new store instance (app restart) reads the same strokes; several strokes keep draw order', async () => {
  const second = { ...stroke, pageIndex: 0, paths: [[[0.2, 0.2], [0.3, 0.4]]] }
  await invoke(OverlayChannels.saveInk, { ...baseInput, id: 'ink-2', locatorRef: packPdfInkLocator(second), pdfInkRef: packPdfInkRef(second), createdAt: '2026-10-23T01:00:05.000Z' })
  const fresh = new SqliteOverlayStore(db)
  const rows = await fresh.listInk('pdf-a')
  assert.deepEqual(rows.map((r) => r.id), ['ink-1', 'ink-2'])
  assert.deepEqual(rows[0].ink, stroke)
  assert.deepEqual(rows[1].ink, second)
})

await check('deleteInk removes exactly that stroke', async () => {
  assert.deepEqual(await invoke(OverlayChannels.deleteInk, { bookId: 'pdf-a', id: 'ink-2' }), { ok: true })
  assert.deepEqual((await invoke(OverlayChannels.listInk, 'pdf-a')).map((r) => r.id), ['ink-1'])
  assert.deepEqual(await invoke(OverlayChannels.deleteInk, { bookId: 'pdf-a', id: 'ink-2' }), { ok: false })
  assert.ok(noteRow('pdf-h1'))
})

console.log('6. corruption')
await check('a hand-broken pdfInk is dropped on read instead of reaching the renderer', async () => {
  const json = JSON.parse(noteRow('ink-1').note_json)
  json.pdfInk.paths[0][0] = [Number.MAX_VALUE, 0]
  db.prepare(`UPDATE notes SET note_json = ? WHERE id = ?`).run(JSON.stringify(json), 'ink-1')
  assert.deepEqual(await invoke(OverlayChannels.listInk, 'pdf-a'), [])
})

console.log(`\n${passed} checks passed`)

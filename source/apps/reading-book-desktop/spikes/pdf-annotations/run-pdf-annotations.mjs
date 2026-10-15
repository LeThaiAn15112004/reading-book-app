/**
 * Checks for PDF text annotations on the Main side (docs/implementation_plan/pdf_text_annotations.md):
 * the real `overlay:*` IPC handlers + `SqliteOverlayStore` on the real migrated schema (node:sqlite).
 *
 *   1. save        -> a PDF row lands in `notes` as page-rect locator + pdfAnnotation; DTO round trip
 *   2. validation  -> bad geometry / locator mismatch / oversize payloads are refused, nothing written
 *   3. update      -> color / note / style edits keep createdAt and the geometry
 *   4. isolation   -> per-book lists, EPUB rows and PDF bookmarks untouched, wrong-book delete refused
 *   5. corruption  -> a hand-broken pdfAnnotation in SQLite never reaches the renderer
 *
 * Run: npm run spike:pdf:annotations   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import {
  highlightDtoToReaderHighlight,
  packPdfHighlightLocator,
  pdfAnnotationFromRects,
  pdfHighlightDtoToReaderHighlight,
} from '@reading-book/book-reader-sdk'
import { invoke } from './electron-stub.mjs'
import { getDatabase } from './db-stub.mjs'

const { OverlayChannels } = await import('../../electron/ipc/channels.ts')
const { registerOverlayIpc } = await import('../../electron/ipc/overlay.ipc.ts')
const { getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')

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
insertBook.run('epub-c', 'EPUB C', '/c.epub', 'epub', 'sha-c')

// An EPUB highlight exactly as the app wrote it before this change (no pdfAnnotation key).
const legacyEpubJson = JSON.stringify({
  schemaVersion: 1,
  type: 'underline',
  group: 'annotation',
  locatorExtended: {
    locator: { kind: 'cfi', cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:12)', chapterIndex: 1 },
    text: { highlight: 'Down the rabbit-hole' },
  },
  textualValue: 'Down the rabbit-hole',
  note: null,
  style: { colorHex: '#4fc3f7' },
  created: '2026-01-02T00:00:00.000Z',
  modified: '2026-01-02T00:00:00.000Z',
})
db.prepare(`INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
  'epub-legacy',
  'epub-c',
  legacyEpubJson,
  '2026-01-02T00:00:00.000Z',
  '2026-01-02T00:00:00.000Z',
)

registerOverlayIpc()
const store = getOverlayStore()
await store.saveBookmark({ bookId: 'pdf-a', locator: { kind: 'page-rect', page: 3, chapterIndex: 2 }, label: 'Page 3' })

/** Two lines at the bottom of page 3 continuing at the top of page 4. */
const rects = [
  { page: 3, x: 0.1, y: 0.8, width: 0.7, height: 0.02 },
  { page: 3, x: 0.1, y: 0.83, width: 0.4, height: 0.02 },
  { page: 4, x: 0.1, y: 0.05, width: 0.3, height: 0.02 },
]
const annotation = pdfAnnotationFromRects(rects)
const baseInput = {
  bookId: 'pdf-a',
  id: 'pdf-h1',
  locatorRef: packPdfHighlightLocator(annotation),
  styleKind: 'highlight',
  colorHex: '#ffeb3b',
  tags: [],
  selectionTextRef: JSON.stringify({ highlight: 'across a page break' }),
  pdfAnnotationRef: JSON.stringify(annotation),
  createdAt: '2026-10-15T01:00:00.000Z',
}
const noteRow = (id) => db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id)
const notesCount = () => db.prepare(`SELECT COUNT(*) AS n FROM notes`).get().n

console.log('PDF text annotations (Main: IPC + SQLite)')

console.log('1. save')
await check('saveHighlight stores a page-rect locator and the normalized pdfAnnotation in note_json', async () => {
  const dto = await invoke(OverlayChannels.saveHighlight, baseInput)
  assert.ok(dto, 'save refused')
  assert.equal(dto.id, 'pdf-h1')
  const json = JSON.parse(noteRow('pdf-h1').note_json)
  assert.equal(json.group, 'annotation')
  assert.equal(json.type, 'highlight')
  assert.deepEqual(json.locatorExtended.locator, {
    kind: 'page-rect',
    page: 3,
    rect: { x: 0.1, y: 0.8, width: 0.7, height: 0.05 },
    chapterIndex: 2,
  })
  assert.deepEqual(json.pdfAnnotation, annotation)
  assert.equal(json.pdfAnnotation.pageIndex, 2)
  assert.deepEqual(json.pdfAnnotation.rects.map((r) => r.pageIndex), [2, 2, 3])
  assert.equal(json.textualValue, 'across a page break')
})

await check('listHighlights → DTO → PdfReaderHighlight restores every rect (reopen the book)', async () => {
  const rows = await invoke(OverlayChannels.listHighlights, 'pdf-a')
  assert.equal(rows.length, 1)
  const row = pdfHighlightDtoToReaderHighlight(rows[0])
  assert.ok(row)
  assert.equal(row.page, 3)
  assert.equal(row.chapterIndex, 2)
  assert.deepEqual(row.rects, rects)
  assert.equal(row.selectionText.highlight, 'across a page break')
  // …and the EPUB mapper never claims a PDF row.
  assert.equal(highlightDtoToReaderHighlight(rows[0]), null)
})

for (const styleKind of ['underline', 'strikethrough', 'textbox']) {
  await check(`${styleKind} saves and lists the same way`, async () => {
    const id = `pdf-${styleKind}`
    assert.ok(await invoke(OverlayChannels.saveHighlight, { ...baseInput, id, styleKind, note: styleKind === 'textbox' ? 'my note' : undefined }))
    const row = pdfHighlightDtoToReaderHighlight((await invoke(OverlayChannels.listHighlights, 'pdf-a')).find((r) => r.id === id))
    assert.equal(row.styleKind, styleKind)
    assert.equal(row.rects.length, 3)
    if (styleKind === 'textbox') assert.equal(row.note, 'my note')
  })
}

console.log('2. validation')
const before = notesCount()
const badPayloads = {
  'unparseable pdfAnnotationRef': { pdfAnnotationRef: '{nope' },
  'empty pdfAnnotationRef': { pdfAnnotationRef: '' },
  'rect outside the page': {
    pdfAnnotationRef: JSON.stringify({ pageIndex: 2, rects: [{ pageIndex: 2, x: 0.9, y: 0.1, width: 0.5, height: 0.1 }] }),
  },
  'non-finite coordinate (null after JSON)': {
    pdfAnnotationRef: JSON.stringify({ pageIndex: 2, rects: [{ pageIndex: 2, x: Infinity, y: 0.1, width: 0.5, height: 0.1 }] }),
  },
  'zero-size rect': {
    pdfAnnotationRef: JSON.stringify({ pageIndex: 2, rects: [{ pageIndex: 2, x: 0.1, y: 0.1, width: 0, height: 0.1 }] }),
  },
  'negative page': {
    pdfAnnotationRef: JSON.stringify({ pageIndex: -1, rects: [{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }] }),
  },
  'oversize payload': { pdfAnnotationRef: ' '.repeat(600 * 1024) },
  'locator on another page': {
    locatorRef: JSON.stringify({ kind: 'page-rect', page: 7, chapterIndex: 6 }),
  },
  'CFI locator with PDF geometry': {
    locatorRef: JSON.stringify({ kind: 'cfi', cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:12)', chapterIndex: 0 }),
  },
}
for (const [label, patch] of Object.entries(badPayloads)) {
  await check(`refuses ${label}`, async () => {
    assert.equal(await invoke(OverlayChannels.saveHighlight, { ...baseInput, id: `bad-${label}`, ...patch }), null)
  })
}
await check('…and none of the refused saves wrote a row', () => {
  assert.equal(notesCount(), before)
})

console.log('3. update')
await check('a re-save with the same id keeps createdAt and geometry, updates color / note / style', async () => {
  const createdAt = noteRow('pdf-h1').created_at
  const dto = await invoke(OverlayChannels.saveHighlight, {
    ...baseInput,
    colorHex: '#ef5350',
    styleKind: 'underline',
    note: 'why this matters',
    createdAt: undefined,
  })
  assert.ok(dto)
  const row = noteRow('pdf-h1')
  assert.equal(row.created_at, createdAt)
  const json = JSON.parse(row.note_json)
  assert.equal(json.style.colorHex, '#ef5350')
  assert.equal(json.type, 'underline')
  assert.equal(json.note, 'why this matters')
  assert.deepEqual(json.pdfAnnotation, annotation)
})

console.log('4. isolation')
await check('another PDF and the EPUB book list only their own rows', async () => {
  assert.deepEqual(await invoke(OverlayChannels.listHighlights, 'pdf-b'), [])
  const epubRows = await invoke(OverlayChannels.listHighlights, 'epub-c')
  assert.equal(epubRows.length, 1)
  assert.equal(epubRows[0].pdfAnnotationRef, undefined)
  const epub = highlightDtoToReaderHighlight(epubRows[0])
  assert.equal(epub.cfiRange, 'epubcfi(/6/4!/4/2,/1:0,/1:12)')
  assert.equal(epub.styleKind, 'underline')
  assert.equal(pdfHighlightDtoToReaderHighlight(epubRows[0]), null)
  assert.equal(noteRow('epub-legacy').note_json, legacyEpubJson, 'EPUB row untouched')
})

await check('the PDF bookmark is untouched and never listed as a highlight', async () => {
  const bookmarks = await invoke(OverlayChannels.listBookmarks, 'pdf-a')
  assert.equal(bookmarks.length, 1)
  assert.equal(JSON.parse(bookmarks[0].locatorRef).page, 3)
  const ids = (await invoke(OverlayChannels.listHighlights, 'pdf-a')).map((r) => r.id)
  assert.ok(!ids.includes(bookmarks[0].id))
})

await check('a highlight save can never overwrite the bookmark row', async () => {
  const bookmarkId = (await invoke(OverlayChannels.listBookmarks, 'pdf-a'))[0].id
  assert.equal(await invoke(OverlayChannels.saveHighlight, { ...baseInput, id: bookmarkId }), null)
  assert.equal(JSON.parse(noteRow(bookmarkId).note_json).group, 'bookmark')
})

await check('delete needs the right book; then the row is gone and the rest stay', async () => {
  assert.deepEqual(await invoke(OverlayChannels.deleteHighlight, { bookId: 'pdf-b', id: 'pdf-h1' }), { ok: false })
  assert.deepEqual(await invoke(OverlayChannels.deleteHighlight, { bookId: 'pdf-a', id: 'pdf-h1' }), { ok: true })
  assert.equal(noteRow('pdf-h1'), undefined)
  assert.equal((await invoke(OverlayChannels.listHighlights, 'pdf-a')).length, 3)
  assert.equal((await invoke(OverlayChannels.listBookmarks, 'pdf-a')).length, 1)
  assert.equal((await invoke(OverlayChannels.listHighlights, 'epub-c')).length, 1)
})

console.log('5. corruption')
await check('a hand-broken pdfAnnotation is dropped on read instead of reaching the renderer', async () => {
  const json = JSON.parse(noteRow('pdf-underline').note_json)
  json.pdfAnnotation.rects[0].width = -1
  db.prepare(`UPDATE notes SET note_json = ? WHERE id = ?`).run(JSON.stringify(json), 'pdf-underline')
  const dto = (await invoke(OverlayChannels.listHighlights, 'pdf-a')).find((r) => r.id === 'pdf-underline')
  assert.ok(dto, 'row still listed (its locator is fine)')
  assert.equal(dto.pdfAnnotationRef, undefined)
  assert.equal(pdfHighlightDtoToReaderHighlight(dto), null)
  assert.equal(highlightDtoToReaderHighlight(dto), null)
})

console.log(`\n${passed} checks passed`)

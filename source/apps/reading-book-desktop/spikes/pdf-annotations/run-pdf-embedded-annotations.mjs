/**
 * Checks for the embedded PDF annotation import (docs/implementation_plan/pdf_embedded_annotation_import.md),
 * end to end without Electron: real PDFs with `/Annots` (e2e/support/build-annotated-pdf.mjs) →
 * the installed pdf.js (legacy build, 5.4.624) → Main's scan (`scanPdfAnnotationBytes`, what the scan
 * worker runs) → `SqliteOverlayStore.syncEmbeddedPdfAnnotations` on the real migrated schema
 * (node:sqlite, migration 023 included). The import rules are checked here through *incomplete*
 * scans (no deletions); deletions, `/NM`, the file watcher and the live sync service are checked by
 * run-pdf-embedded-live.mjs (`npm run spike:pdf:live`).
 *
 *   1. types        -> what pdf.js 5.4.624 actually yields: Highlight / Underline / Squiggly /
 *                      StrikeOut / Text read with geometry, color, comment, author, text under the
 *                      mark; FreeText / Ink / Link / hidden / replies skipped
 *   2. first open   -> everything imported, rows readable by the PDF annotation mapper
 *   3. reopen       -> nothing written
 *   4. never synced -> a book opened before (no ledger) is still imported
 *   5. added        -> two annotations added + every object renumbered: 2 new rows, 5 unchanged
 *   6. edited       -> color / comment changed in the file: the row is updated, created_at kept
 *   7. removed      -> deleted from the file, incomplete scan: the row stays
 *   8. empty        -> a PDF without annotations writes nothing
 *   9. twins        -> identical / overlapping annotations stay separate rows, stable on reopen
 *  10. app rows     -> an app-made row is never touched; an app-edited imported row keeps the app's
 *                      version; an imported row deleted in the app is not imported again
 *  11. failures     -> garbage / truncated bytes and wrong books never crash and never write junk
 *  12. regressions  -> PDF bookmark and a legacy EPUB row byte-identical
 *
 * Run: npm run spike:pdf:embedded   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { highlightDtoToReaderHighlight, pdfHighlightDtoToReaderHighlight } from '@reading-book/book-reader-sdk'
import { invoke } from './electron-stub.mjs'
import { getDatabase } from './db-stub.mjs'
import { SAMPLE_ANNOTATIONS, buildAnnotatedPdf } from '../../e2e/support/build-annotated-pdf.mjs'
import { textPdfLine } from '../../e2e/support/build-text-pdf.mjs'

const { OverlayChannels } = await import('../../electron/ipc/channels.ts')
const { registerOverlayIpc } = await import('../../electron/ipc/overlay.ipc.ts')
const { getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')
const { scanPdfAnnotationBytes } = await import('../../electron/pdf-sync/pdf-annotation-scan.ts')

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
insertBook.run('pdf-c', 'PDF C', '/c.pdf', 'pdf', 'sha-c')
insertBook.run('epub-e', 'EPUB E', '/e.epub', 'epub', 'sha-e')

const legacyEpubJson = JSON.stringify({
  schemaVersion: 1,
  type: 'highlight',
  group: 'annotation',
  locatorExtended: { locator: { kind: 'cfi', cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:12)', chapterIndex: 1 }, text: { highlight: 'Down' } },
  textualValue: 'Down',
  note: null,
  style: { colorHex: '#4fc3f7' },
  created: '2026-01-02T00:00:00.000Z',
  modified: '2026-01-02T00:00:00.000Z',
})
db.prepare(`INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
  'epub-legacy',
  'epub-e',
  legacyEpubJson,
  '2026-01-02T00:00:00.000Z',
  '2026-01-02T00:00:00.000Z',
)

registerOverlayIpc()
const store = getOverlayStore()
await store.saveBookmark({ bookId: 'pdf-a', locator: { kind: 'page-rect', page: 2, chapterIndex: 1 }, label: 'Page 2' })
const bookmarkJson = () => db.prepare(`SELECT note_json FROM notes WHERE book_id = 'pdf-a' AND json_extract(note_json, '$.group') = 'bookmark'`).get().note_json
const bookmarkBefore = bookmarkJson()

/** Main's scan of a PDF's bytes (what the scan worker runs). */
async function scanPdf(bytes) {
  return (await scanPdfAnnotationBytes(new Uint8Array(bytes))).items
}

/**
 * The store sync, as an *incomplete* scan (import rules only — never deletes). The worker → Main hop
 * is a structured clone.
 */
async function sync(bookId, scanned) {
  const items = structuredClone(scanned)
  const outcome = store.syncEmbeddedPdfAnnotations(bookId, items, { complete: false })
  if (!outcome) return { ok: false, inserted: [], updated: [] }
  return { ok: true, ...outcome, managedObjectIds: outcome.managedIndices.map((i) => items[i].objectId) }
}

const pdfRows = async (bookId) =>
  (await invoke(OverlayChannels.listHighlights, bookId)).map(pdfHighlightDtoToReaderHighlight)
const ledgerCount = (bookId) => db.prepare(`SELECT COUNT(*) n FROM pdf_embedded_annotations WHERE book_id = ?`).get(bookId).n
const noteCount = (bookId) => db.prepare(`SELECT COUNT(*) n FROM notes WHERE book_id = ?`).get(bookId).n

const HIGHLIGHT = SAMPLE_ANNOTATIONS[0]
const v1 = buildAnnotatedPdf({ annotations: SAMPLE_ANNOTATIONS })
let firstScan

await check('1. pdf.js 5.4.624 yields the five supported types with full data; the rest is skipped', async () => {
  firstScan = await scanPdf(v1)
  assert.deepEqual(
    firstScan.map((a) => [a.subtype, a.pageIndex]),
    [
      ['Highlight', 0],
      ['Underline', 0],
      ['StrikeOut', 1],
      ['Squiggly', 1],
      ['Text', 2],
    ],
  )
  const [hl, ul, so, sq, tx] = firstScan
  assert.equal(hl.rects.length, 2, 'one rect per quad (two lines)')
  assert.equal(hl.colorHex, '#FFEB3B')
  assert.equal(hl.contents, 'Foxit comment')
  assert.equal(hl.author, 'Alice')
  assert.ok(hl.text.includes(textPdfLine(1, 2)) && hl.text.includes(textPdfLine(1, 3)), `text under the mark: ${hl.text}`)
  assert.equal(ul.text, textPdfLine(1, 5))
  assert.equal(so.text, textPdfLine(2, 1))
  assert.equal(sq.colorHex, '#00B200') // 0.7·255 = 178.5 → 178 (Uint8ClampedArray rounds half to even)
  assert.equal(tx.contents, 'Sticky note')
  assert.equal(tx.text, undefined)
  // Geometry in the displayed page box: line 2 of a Letter page, top-left origin.
  const r = hl.rects[0]
  assert.ok(Math.abs(r.x - 70 / 612) < 1e-4 && Math.abs(r.y - (792 - 707) / 792) < 1e-4, JSON.stringify(r))
  for (const a of firstScan) assert.match(a.objectId, /^\d+R$/)
})

await check('2. first open imports everything as regular PDF annotation rows', async () => {
  const result = await sync('pdf-a', firstScan)
  assert.equal(result.ok, true)
  assert.equal(result.inserted.length, 5)
  assert.equal(result.updated.length, 0)
  assert.deepEqual(result.managedObjectIds, firstScan.map((a) => a.objectId))
  const rows = await pdfRows('pdf-a')
  assert.equal(rows.length, 5)
  assert.ok(rows.every(Boolean), 'every row maps to a PdfReaderHighlight')
  assert.deepEqual(rows.map((r) => r.styleKind).sort(), ['highlight', 'squiggly', 'strikethrough', 'textbox', 'underline'])
  const hl = rows.find((r) => r.styleKind === 'highlight')
  assert.equal(hl.note, 'Foxit comment')
  assert.equal(hl.page, 1)
  assert.equal(hl.rects.length, 2)
  assert.ok(hl.selectionText.highlight.startsWith(textPdfLine(1, 2)))
  assert.equal(rows.find((r) => r.styleKind === 'textbox').note, 'Sticky note')
  assert.equal(ledgerCount('pdf-a'), 5)
})

await check('3. reopening the same file writes nothing', async () => {
  const before = db.prepare(`SELECT id, note_json, updated_at FROM notes WHERE book_id = 'pdf-a' ORDER BY id`).all()
  const result = await sync('pdf-a', await scanPdf(v1))
  assert.equal(result.inserted.length + result.updated.length, 0)
  assert.equal(result.unchanged, 5)
  assert.deepEqual(db.prepare(`SELECT id, note_json, updated_at FROM notes WHERE book_id = 'pdf-a' ORDER BY id`).all(), before)
})

await check('4. a book opened before but never synced is still imported on the next open', async () => {
  // pdf-b was "opened" with the app only (an app-made highlight, no ledger rows at all).
  const scan = await scanPdf(buildAnnotatedPdf({ annotations: SAMPLE_ANNOTATIONS.slice(0, 2) }))
  assert.equal(ledgerCount('pdf-b'), 0)
  const result = await sync('pdf-b', scan)
  assert.equal(result.inserted.length, 2)
  assert.equal(ledgerCount('pdf-b'), 2)
})

const ADDED = [
  { page: 2, subtype: 'Highlight', lines: [6], color: [0.5, 0.8, 0.5], contents: 'Added later in Foxit' },
  { page: 3, subtype: 'Underline', lines: [2], color: [0.6, 0.4, 0.9] },
]
await check('5. annotations added in another viewer (all objects renumbered) are found on the next open', async () => {
  const v2 = buildAnnotatedPdf({ annotations: [...SAMPLE_ANNOTATIONS, ...ADDED], padObjects: 7 })
  const scan = await scanPdf(v2)
  assert.notDeepEqual(scan.slice(0, 5).map((a) => a.objectId), firstScan.map((a) => a.objectId), 'object ids did change')
  const result = await sync('pdf-a', scan)
  assert.equal(result.inserted.length, 2)
  assert.equal(result.unchanged, 5)
  assert.deepEqual(result.inserted.map((h) => h.note ?? null), ['Added later in Foxit', null])
  assert.equal((await pdfRows('pdf-a')).length, 7)
})

let highlightRowId
await check('6. a color / comment edit in another viewer updates the imported row (created_at kept)', async () => {
  highlightRowId = (await pdfRows('pdf-a')).find((r) => r.note === 'Foxit comment').id
  const createdBefore = db.prepare(`SELECT created_at FROM notes WHERE id = ?`).get(highlightRowId).created_at
  const edited = [{ ...HIGHLIGHT, color: [0.31, 0.76, 0.97], contents: 'Edited in Foxit' }, ...SAMPLE_ANNOTATIONS.slice(1), ...ADDED]
  const result = await sync('pdf-a', await scanPdf(buildAnnotatedPdf({ annotations: edited })))
  assert.equal(result.updated.length, 1)
  assert.equal(result.inserted.length, 0)
  assert.equal(result.updated[0].id, highlightRowId)
  const row = (await pdfRows('pdf-a')).find((r) => r.id === highlightRowId)
  assert.equal(row.note, 'Edited in Foxit')
  assert.equal(row.colorHex, '#4FC2F7')
  assert.equal(db.prepare(`SELECT created_at FROM notes WHERE id = ?`).get(highlightRowId).created_at, createdBefore)
  assert.equal((await pdfRows('pdf-a')).length, 7)
})

await check('7. an annotation deleted from the file keeps its row', async () => {
  const without = [{ ...HIGHLIGHT, color: [0.31, 0.76, 0.97], contents: 'Edited in Foxit' }, ...SAMPLE_ANNOTATIONS.slice(2), ...ADDED]
  const result = await sync('pdf-a', await scanPdf(buildAnnotatedPdf({ annotations: without })))
  assert.equal(result.inserted.length + result.updated.length, 0)
  assert.equal((await pdfRows('pdf-a')).length, 7)
  assert.equal(ledgerCount('pdf-a'), 7)
})

await check('8. a PDF without annotations writes nothing', async () => {
  const scan = await scanPdf(buildAnnotatedPdf())
  assert.deepEqual(scan, [])
  const notesBefore = noteCount('pdf-c')
  const result = await sync('pdf-c', scan)
  assert.equal(result.ok, true)
  assert.equal(noteCount('pdf-c'), notesBefore)
  assert.equal(ledgerCount('pdf-c'), 0)
})

await check('9. identical and overlapping annotations stay separate rows, stable on reopen', async () => {
  const twins = buildAnnotatedPdf({
    annotations: [
      { page: 1, subtype: 'Highlight', lines: [7], color: [1, 1, 0], contents: 'same' },
      { page: 1, subtype: 'Highlight', lines: [7], color: [1, 1, 0], contents: 'same' },
      { page: 1, subtype: 'Underline', lines: [7], color: [1, 1, 0] },
      { page: 1, subtype: 'Highlight', lines: [7, 8], color: [1, 1, 0] },
    ],
  })
  const first = await sync('pdf-c', await scanPdf(twins))
  assert.equal(first.inserted.length, 4)
  const again = await sync('pdf-c', await scanPdf(twins))
  assert.equal(again.inserted.length, 0)
  assert.equal(again.unchanged, 4)
  assert.equal((await pdfRows('pdf-c')).length, 4)
})

await check('10. app rows: never overwritten, app edits win, app deletions stick', async () => {
  // An app-made highlight on exactly the same text as an embedded one.
  const embedded = (await pdfRows('pdf-a')).find((r) => r.styleKind === 'strikethrough')
  const appMade = await invoke(OverlayChannels.saveHighlight, {
    bookId: 'pdf-a',
    locatorRef: embedded.locatorRef,
    styleKind: 'strikethrough',
    colorHex: '#81C784',
    pdfAnnotationRef: JSON.stringify({ pageIndex: embedded.page - 1, rects: embedded.rects.map((r) => ({ pageIndex: r.page - 1, x: r.x, y: r.y, width: r.width, height: r.height })) }),
  })
  const appJson = () => db.prepare(`SELECT note_json, updated_at FROM notes WHERE id = ?`).get(appMade.id)
  const appBefore = appJson()

  // The user recolors the imported highlight in the app, then the file edits it again.
  const imported = (await pdfRows('pdf-a')).find((r) => r.id === highlightRowId)
  await invoke(OverlayChannels.saveHighlight, {
    bookId: 'pdf-a',
    id: imported.id,
    locatorRef: imported.locatorRef,
    styleKind: 'highlight',
    colorHex: '#F48FB1',
    note: imported.note,
    selectionTextRef: JSON.stringify(imported.selectionText),
    pdfAnnotationRef: JSON.stringify({ pageIndex: imported.page - 1, rects: imported.rects.map((r) => ({ pageIndex: r.page - 1, x: r.x, y: r.y, width: r.width, height: r.height })) }),
  })
  // …and deletes the imported underline in the app.
  const underline = (await pdfRows('pdf-a')).find((r) => r.styleKind === 'underline' && r.page === 1)
  assert.deepEqual(await invoke(OverlayChannels.deleteHighlight, { bookId: 'pdf-a', id: underline.id }), { ok: true })

  const fileEdit = [{ ...HIGHLIGHT, color: [0, 0, 1], contents: 'Edited again in Foxit' }, ...SAMPLE_ANNOTATIONS.slice(1), ...ADDED]
  const result = await sync('pdf-a', await scanPdf(buildAnnotatedPdf({ annotations: fileEdit })))
  assert.equal(result.keptAppEdits, 1)
  assert.equal(result.dismissed, 1)
  assert.equal(result.inserted.length + result.updated.length, 0)
  const after = (await pdfRows('pdf-a')).find((r) => r.id === highlightRowId)
  assert.equal(after.colorHex, '#F48FB1')
  assert.equal(after.note, 'Edited in Foxit')
  assert.equal((await pdfRows('pdf-a')).some((r) => r.id === underline.id), false, 'deleted row not imported again')
  assert.deepEqual(appJson(), appBefore, 'app-made row untouched')
})

await check('11. garbage / truncated bytes and wrong books never crash or write junk', async () => {
  const notesBefore = noteCount('pdf-c')
  // Not a PDF at all: the document can't be opened — the scan throws, nothing is synced.
  await assert.rejects(scanPdfAnnotationBytes(new Uint8Array(Buffer.from('definitely not a pdf'))))
  // A save caught half-way (the live sync never even scans a file without %%EOF): whatever pdf.js
  // makes of it, the scan returns or throws — it never crashes the process.
  const truncated = new Uint8Array(v1.subarray(0, Math.floor(v1.length * 0.6)))
  await scanPdfAnnotationBytes(truncated).then(
    (r) => assert.ok(Array.isArray(r.items)),
    (err) => assert.ok(err instanceof Error),
  )

  // Wrong / unknown book: the store refuses before writing anything.
  const good = (await scanPdf(buildAnnotatedPdf({ annotations: [{ page: 2, subtype: 'Highlight', lines: [3], color: [1, 1, 0] }] })))[0]
  for (const bookId of ['missing', 'epub-e', '']) {
    assert.equal(store.syncEmbeddedPdfAnnotations(bookId, [good], { complete: true }), null)
  }
  assert.equal(noteCount('epub-e'), 1)
  assert.equal(noteCount('pdf-c'), notesBefore)
  assert.equal(ledgerCount('epub-e') + ledgerCount('missing'), 0)
})

await check('12. PDF bookmark and legacy EPUB row are byte-identical; deleting a book clears its ledger', async () => {
  assert.equal(bookmarkJson(), bookmarkBefore)
  assert.equal(db.prepare(`SELECT note_json FROM notes WHERE id = 'epub-legacy'`).get().note_json, legacyEpubJson)
  const epub = (await invoke(OverlayChannels.listHighlights, 'epub-e')).map(highlightDtoToReaderHighlight)
  assert.equal(epub.length, 1)
  assert.ok(epub[0])
  db.exec('PRAGMA foreign_keys = ON')
  db.prepare(`DELETE FROM books WHERE id = 'pdf-b'`).run()
  assert.equal(ledgerCount('pdf-b'), 0)
})

console.log(`\n${passed} embedded PDF annotation checks passed`)

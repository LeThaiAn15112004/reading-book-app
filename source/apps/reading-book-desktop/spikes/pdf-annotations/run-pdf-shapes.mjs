/**
 * Shape tools (rectangle / ellipse / line / arrow) as first-class annotations
 * (docs/implementation_plan/pdf_shape_tools.md), with the real pieces and real files, no Electron: the
 * overlay IPC handlers (validation) + `SqliteOverlayStore` on the migrated schema, the two-way sync
 * coordinator, the incremental writer + pdf.js read-back, `writeFileSafely`, the signature gate.
 *
 *   1. SQLite     a shape is a row of the SAME table / queries as every annotation: saved with a stable id,
 *                 listed next to text markup, updated in place (no duplicate), deleted, restored after
 *                 "reopening" (fresh store); bad payloads are refused
 *   2. file       shapes are written as standard Square / Circle / Line (+ arrow end) with readmate /NM,
 *                 edits rewrite the same object, deletes remove it, nothing is duplicated by the sync,
 *                 the original bytes stay untouched, a foreign shape in the file is left alone
 *   3. safety     freehand Ink queries / eraser never see a shape; a signed file is not written
 *
 * Run: npm run spike:pdf:shapes   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  pdfHighlightDtoToReaderHighlight,
  pdfShapeAnnotation,
  packPdfHighlightLocator,
  planTwoWaySync,
  shapeFromDrag,
} from '@reading-book/book-reader-sdk'
import { invoke } from './electron-stub.mjs'
import { getDatabase } from './db-stub.mjs'

const { OverlayChannels } = await import('../../electron/ipc/channels.ts')
const { registerOverlayIpc } = await import('../../electron/ipc/overlay.ipc.ts')
const { getOverlayStore, SqliteOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')
const { scanPdfAnnotationBytes } = await import('../../electron/pdf-sync/pdf-annotation-scan.ts')
const { listPdfGraphicsBytes } = await import('../../electron/pdf-sync/pdf-graphics.ts')
const { applyAnnotationOps } = await import('../../electron/pdf-sync/pdf-annotation-write.ts')
const { writeFileSafely } = await import('../../electron/pdf-sync/pdf-annotation-export.ts')
const { createPdfAnnotationSyncService } = await import('../../electron/pdf-sync/pdf-annotation-sync-service.ts')
const { checkPdfWritable } = await import('../../electron/pdf-sync/pdf-write-eligibility.ts')
const { verifyPdf } = await import('../../electron/signature/signature-service.ts')
const { getLibraryStore } = await import('../../electron/persistence/sqlite-library-store.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, timeoutMs = 8000, label = 'condition') {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await sleep(40)
  }
}

/** Two US-Letter pages; page 1 already holds a Square drawn by "another reader". */
function buildPdf() {
  const content = 'BT /F1 18 Tf 72 720 Td (shapes) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R /Annots [6 0 R] >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>',
    '<< /Type /Annot /Subtype /Square /Rect [300 500 400 600] /C [0 0.5 1] /BS << /W 2 >> /F 4 /NM (foreign) >>',
  ]
  let out = '%PDF-1.7\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-shapes-'))
const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, 'pdf', ?, 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
const file = path.join(tmp, 'shapes.pdf')
const original = buildPdf()
fs.writeFileSync(file, original)
insertBook.run('sh', 'Shapes', file, 'sha-sh')
registerOverlayIpc()
const store = getOverlayStore()

const events = []
const signatureOverride = {}
const service = createPdfAnnotationSyncService({
  resolvePdfPath: async (id) => (id === 'sh' && fs.existsSync(file) ? file : null),
  scan: (bytes) => scanPdfAnnotationBytes(bytes),
  sync: (id, items, options) => store.syncEmbeddedPdfAnnotations(id, items, options),
  servedSha256: () => undefined,
  emit: (_t, e) => events.push(e),
  watcherOptions: { debounceMs: 60, stableMs: 120, pollMs: 400, maxWaitMs: 5000 },
  retryTiming: { retryMs: 150, lockedMs: 120, lockedMax: 3 },
  log: () => {},
  twoWay: {
    checkWritable: (id, filePath, bytes, allowSigned) =>
      checkPdfWritable({ filePath, bytes, isReferenced: () => true, verifySignature: (b) => signatureOverride[id] ?? verifyPdf(b), allowSigned }),
    recordFileVersion: (id, sha, size) => getLibraryStore().updateFileFingerprint(id, sha, size),
    plan: async (id, items, complete) => planTwoWaySync({ items, complete, ledger: store.listTwoWayLedger(id), rows: await store.listHighlights(id) }),
    apply: (id, plan, items, after) => store.applyTwoWaySync(id, plan, items, after),
    applyOps: async (bytes, ops) => applyAnnotationOps({ bytes, ops }),
    writeFile: async (p, bytes) => writeFileSafely(p, bytes),
  },
})
const target = { id: 1, isDestroyed: () => false, once: () => {} }

const RATIO = 792 / 612
const rowsOf = async () => (await invoke(OverlayChannels.listHighlights, 'sh')).map(pdfHighlightDtoToReaderHighlight)
const fileItems = async () => (await scanPdfAnnotationBytes(new Uint8Array(fs.readFileSync(file)))).items
const written = async (id) => (await fileItems()).find((i) => i.nm === `readmate:${id}`)

/** A shape exactly as the renderer's Shape tool saves it (same SDK geometry + the same IPC payload). */
function shapeInput(kind, start, end, extra = {}) {
  const g = shapeFromDrag(kind, start, end, 0.004, RATIO)
  assert.ok(g, `${kind} geometry`)
  const annotation = pdfShapeAnnotation(0, g.rect, g.shape)
  return {
    bookId: 'sh',
    styleKind: kind,
    colorHex: '#E53935',
    locatorRef: packPdfHighlightLocator(annotation),
    pdfAnnotationRef: JSON.stringify(annotation),
    ...extra,
  }
}
const save = (input) => invoke(OverlayChannels.saveHighlight, input)

console.log('1. SQLite')
const ids = {}
await check('each shape type is saved through the existing highlight IPC and listed with its text-markup siblings', async () => {
  // A text highlight first: the shapes must not disturb it, and it must not hide them.
  const text = { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.1, y: 0.1, width: 0.5, height: 0.02 }] }
  const hl = await save({ bookId: 'sh', styleKind: 'highlight', colorHex: '#FFEB3B', locatorRef: packPdfHighlightLocator(text), pdfAnnotationRef: JSON.stringify(text) })
  assert.ok(hl)
  ids.text = hl.id
  ids.rectangle = (await save(shapeInput('rectangle', [0.1, 0.3], [0.5, 0.45]))).id
  ids.ellipse = (await save(shapeInput('ellipse', [0.6, 0.45], [0.9, 0.3]))).id // dragged up-right
  ids.line = (await save(shapeInput('line', [0.2, 0.6], [0.8, 0.6]))).id // perfectly horizontal
  ids.arrow = (await save(shapeInput('arrow', [0.8, 0.8], [0.3, 0.7]))).id // dragged left
  const rows = await rowsOf()
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.map((r) => r.styleKind).sort(), ['arrow', 'ellipse', 'highlight', 'line', 'rectangle'])
  for (const row of rows) assert.ok(row, 'every row maps to a renderer row')
  const arrow = rows.find((r) => r.id === ids.arrow)
  assert.equal(arrow.page, 1)
  assert.deepEqual(arrow.shape.line, [0.8, 0.8, 0.3, 0.7])
  assert.ok(arrow.shape.strokeWidth > 0)
})
await check('a shape is a notes row of type = its kind in the same table (no parallel store)', () => {
  const kinds = db.prepare(`SELECT json_extract(note_json, '$.type') AS type FROM notes WHERE book_id = 'sh' ORDER BY type`).all().map((r) => r.type)
  assert.deepEqual(kinds, ['arrow', 'ellipse', 'highlight', 'line', 'rectangle'])
  const row = db.prepare(`SELECT note_json FROM notes WHERE id = ?`).get(ids.rectangle)
  const note = JSON.parse(row.note_json)
  assert.equal(note.group, 'annotation')
  assert.equal(note.style.colorHex, '#E53935')
  assert.ok(note.pdfAnnotation.shape.strokeWidth > 0)
  assert.equal(note.locatorExtended.locator.kind, 'page-rect')
})
await check('update in place (colour, opacity, width, geometry): same id, no duplicate; the list reflects it', async () => {
  const g = shapeFromDrag('rectangle', [0.1, 0.3], [0.6, 0.5], 0.008, RATIO)
  const annotation = pdfShapeAnnotation(0, g.rect, g.shape)
  const updated = await save({
    bookId: 'sh',
    id: ids.rectangle,
    styleKind: 'rectangle',
    colorHex: '#43A04780',
    locatorRef: packPdfHighlightLocator(annotation),
    pdfAnnotationRef: JSON.stringify(annotation),
  })
  assert.equal(updated.id, ids.rectangle)
  const rows = await rowsOf()
  assert.equal(rows.length, 5)
  const row = rows.find((r) => r.id === ids.rectangle)
  assert.equal(row.colorHex, '#43A04780')
  assert.equal(row.shape.strokeWidth, 0.008)
})
await check('a fresh store instance (closing and reopening the app) restores every shape exactly once', async () => {
  const fresh = new SqliteOverlayStore(db)
  const rows = await fresh.listHighlights('sh')
  assert.equal(rows.length, 5)
  assert.equal(new Set(rows.map((r) => r.id)).size, 5)
  assert.equal(rows.find((r) => r.id === ids.line).pdfAnnotation.shape.line.length, 4)
})
await check('invalid payloads are refused: shape kind without geometry, geometry on a text kind, line without endpoints', async () => {
  const good = shapeInput('rectangle', [0.1, 0.3], [0.5, 0.45])
  const parsed = JSON.parse(good.pdfAnnotationRef)
  const { shape: _shape, ...bare } = parsed
  assert.equal(await save({ ...good, pdfAnnotationRef: JSON.stringify(bare) }), null)
  assert.equal(await save({ ...good, styleKind: 'highlight' }), null)
  assert.equal(await save({ ...good, styleKind: 'line' }), null) // a line needs endpoints
  assert.equal(await save({ ...good, styleKind: 'bogus' }), null)
  assert.equal(await save({ ...good, pdfAnnotationRef: JSON.stringify({ ...parsed, shape: { strokeWidth: -1 } }) }), null)
  assert.equal((await rowsOf()).length, 5)
})

console.log('2. the PDF file')
await service.watch(target, 'sh')
await until(() => events.length > 0, 6000, 'open')
await check('every shape is written as a standard annotation named readmate:<id>; the original bytes are untouched', async () => {
  await until(async () => (await fileItems()).filter((i) => i.nm?.startsWith('readmate:')).length === 5, 10000, 'write-back')
  await until(() => events.some((e) => e.writeStatus === 'written'), 8000, 'written event')
  const after = fs.readFileSync(file)
  assert.ok(after.subarray(0, original.length).equals(original), 'incremental update: original bytes untouched')
  const bySubtype = Object.fromEntries((await fileItems()).filter((i) => i.shape).map((i) => [i.nm, i]))
  assert.equal(bySubtype[`readmate:${ids.rectangle}`].subtype, 'Square')
  assert.equal(bySubtype[`readmate:${ids.ellipse}`].subtype, 'Circle')
  assert.equal(bySubtype[`readmate:${ids.line}`].subtype, 'Line')
  const arrow = bySubtype[`readmate:${ids.arrow}`]
  assert.equal(arrow.subtype, 'Line')
  assert.equal(arrow.arrow, true)
  assert.equal(bySubtype[`readmate:${ids.line}`].arrow, undefined)
  const text = after.toString('latin1')
  assert.match(text, /\/LE \[\/None \/OpenArrow\]/)
  assert.match(text, /\/Subtype \/Form/)
})
await check('the file’s geometry equals the row’s (box, endpoints, pen width, colour, opacity)', async () => {
  const rows = await rowsOf()
  for (const kind of ['rectangle', 'ellipse', 'line', 'arrow']) {
    const row = rows.find((r) => r.id === ids[kind])
    const item = await written(ids[kind])
    assert.ok(item, `${kind} in the file`)
    const rect = row.rects[0]
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(item.rects[0][key] - rect[key]) < 2e-3, `${kind} ${key}`)
    if (row.shape.line) row.shape.line.forEach((v, i) => assert.ok(Math.abs(item.shape.line[i] - v) < 2e-3, `${kind} line[${i}]`))
    assert.ok(Math.abs(item.shape.strokeWidth - row.shape.strokeWidth) < 2e-4, `${kind} width`)
  }
  const rect = await written(ids.rectangle)
  assert.equal(rect.colorHex, '#43A047')
  assert.ok(Math.abs(rect.opacity - 0.502) < 0.01)
})
await check('the sync does not loop or duplicate; the foreign shape is neither imported nor touched', async () => {
  const before = fs.readFileSync(file)
  await sleep(1500)
  assert.ok(fs.readFileSync(file).equals(before), 'no further write')
  assert.equal((await rowsOf()).length, 5, 'no row was imported from the file')
  const names = (await fileItems()).map((i) => i.nm)
  assert.equal(names.filter((n) => n === 'foreign').length, 0, 'the foreign shape is not an annotation of the app')
  const graphics = await listPdfGraphicsBytes(new Uint8Array(before))
  assert.equal(graphics.objects.length, 1, 'only the foreign Square is a graphic object (Readmate’s own are annotations)')
  assert.equal(graphics.objects[0].subtype, 'Square')
  assert.match(before.toString('latin1'), /\/NM \(foreign\)/)
})
await check('an edit in the app rewrites the SAME file object; a delete removes it', async () => {
  const before = await written(ids.arrow)
  const g = shapeFromDrag('arrow', [0.8, 0.8], [0.2, 0.5], 0.01, RATIO)
  const annotation = pdfShapeAnnotation(0, g.rect, g.shape)
  await save({ bookId: 'sh', id: ids.arrow, styleKind: 'arrow', colorHex: '#1E88E5', locatorRef: packPdfHighlightLocator(annotation), pdfAnnotationRef: JSON.stringify(annotation) })
  service.notifyAppChange('sh')
  await until(async () => (await written(ids.arrow))?.colorHex === '#1E88E5', 10000, 'rewrite')
  const after = await written(ids.arrow)
  assert.equal(after.objectId, before.objectId)
  assert.ok(Math.abs(after.shape.line[2] - 0.2) < 2e-3)
  assert.ok(Math.abs(after.shape.strokeWidth - 0.01) < 2e-4)
  assert.equal((await fileItems()).filter((i) => i.nm === `readmate:${ids.arrow}`).length, 1)

  const removed = await invoke(OverlayChannels.deleteHighlight, { bookId: 'sh', id: ids.line })
  assert.equal(removed.ok, true)
  service.notifyAppChange('sh')
  await until(async () => !(await written(ids.line)), 10000, 'delete in file')
  assert.equal((await rowsOf()).length, 4)
})
await check('reopening (stop and start watching) neither duplicates rows nor file annotations', async () => {
  service.unwatch(target, 'sh')
  const before = (await fileItems()).length
  events.length = 0
  await service.watch(target, 'sh')
  await until(() => events.length > 0, 6000, 'second open')
  await sleep(800)
  assert.equal((await rowsOf()).length, 4)
  assert.equal((await fileItems()).length, before)
})

console.log('3. safety')
await check('Ink queries and the eraser never see a shape', async () => {
  assert.deepEqual(await invoke(OverlayChannels.listInk, 'sh'), [])
  const result = await invoke(OverlayChannels.deleteInk, { bookId: 'sh', id: ids.rectangle })
  assert.equal(result.ok, false)
  assert.ok((await rowsOf()).some((r) => r.id === ids.rectangle), 'the shape is still there')
})
await check('a signed PDF is not written (announced, data kept in SQLite)', async () => {
  signatureOverride.sh = { status: 'valid', signerName: 'Test Signer' }
  const fileBefore = fs.readFileSync(file)
  events.length = 0
  const extra = await save(shapeInput('ellipse', [0.2, 0.2], [0.4, 0.3]))
  service.notifyAppChange('sh')
  await until(() => events.some((e) => e.writeStatus === 'signed'), 10000, 'signed event')
  assert.ok(fs.readFileSync(file).equals(fileBefore), 'the signed file is byte-identical')
  assert.ok((await rowsOf()).some((r) => r.id === extra.id), 'the shape stays in SQLite')
  delete signatureOverride.sh
})

service.disposeAll?.()
console.log(`\n${passed} checks passed`)
process.exit(0)

/**
 * PDF file attachment (specs/007-pdf-file-attachment), Main side on real temp files: the REAL
 * `createPdfAttachment` operation with the REAL live-sync service (two-way mode), incremental writer, streamed
 * write + read-back, `checkPdfWritable` and `SqliteOverlayStore` on the migrated schema (node:sqlite, db-stub).
 * Only the file picker is stubbed and the worker requests run in-process. Quickstart §1 scenarios:
 *
 *    1. attach        1 B, 1 MB, 50 MB, exactly 100 MB; classic xref, xref stream, rotated page, cropped page;
 *                     a PDF with highlights and a Foxit-style FileAttachment: pdf.js finds it on the page at the
 *                     row's place, content identical, other annotations and getAttachments() unchanged
 *    4. cancel        picker cancelled → nothing changed
 *   11. same names    two files with the same name on one page → both kept, distinct, both intact
 *   12. live sync     opening / syncing after attaching → no duplicate rows, rows linked, a later ordinary
 *                     annotation write keeps every attachment
 *   (US2–US5 add their scenarios here: 2, 3, 5–10, 13.)
 *
 * Run: npm run spike:pdf:attachment-write   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planTwoWaySync } from '@reading-book/book-reader-sdk'
import { getDatabase } from '../pdf-annotations/db-stub.mjs'
import { buildAnnotatedPdf, lineQuads } from '../../e2e/support/build-annotated-pdf.mjs'
import { buildPdf } from './pdf-fixtures.mjs'

const { getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')
const { scanPdfAnnotationBytes, verifyPdfAttachmentBytes } = await import('../../electron/pdf-sync/pdf-annotation-scan.ts')
const { planAttachmentAppend } = await import('../../electron/pdf-sync/pdf-incremental-writer.ts')
const { applyAnnotationOps } = await import('../../electron/pdf-sync/pdf-annotation-write.ts')
const { writeFileSafely } = await import('../../electron/pdf-sync/pdf-annotation-export.ts')
const { createPdfAnnotationSyncService } = await import('../../electron/pdf-sync/pdf-annotation-sync-service.ts')
const { checkPdfWritable } = await import('../../electron/pdf-sync/pdf-write-eligibility.ts')
const { createPdfAttachment } = await import('../../electron/pdf-sync/pdf-attachment-operations.ts')
const { loadPdfjs } = await import('../../electron/chunking/pdf-text.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const MB = 1024 * 1024
const sha = (b) => createHash('sha256').update(b).digest('hex')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-attach-write-'))
const staging = path.join(tmp, 'staging')
const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, 'pdf', ?, 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
const store = getOverlayStore()
const paths = {}
let nextBook = 1
function addBook(bytes, label) {
  const id = `b${nextBook++}`
  const file = path.join(tmp, `${id}-${label}.pdf`)
  fs.writeFileSync(file, bytes)
  insertBook.run(id, label, file, `sha-${id}`) // books.sha256 is unique; identical fixtures share content
  paths[id] = file
  return { id, file }
}

const service = createPdfAnnotationSyncService({
  resolvePdfPath: async (id) => paths[id] ?? null,
  scan: scanPdfAnnotationBytes,
  sync: (id, items, options) => store.syncEmbeddedPdfAnnotations(id, items, options),
  servedSha256: () => undefined,
  emit: (_t, e) => events.push(e),
  watcherOptions: { debounceMs: 60, stableMs: 120, pollMs: 400, maxWaitMs: 5000 },
  retryTiming: { retryMs: 150, lockedMs: 120, lockedMax: 3 },
  twoWay: {
    checkWritable: (_id, filePath, bytes, allowSigned) => checkPdfWritable({ filePath, bytes, isReferenced: () => true, verifySignature: () => ({ status: 'unsigned' }), allowSigned }),
    plan: async (id, items, complete) => planTwoWaySync({ items, complete, ledger: store.listTwoWayLedger(id), rows: await store.listHighlights(id) }),
    apply: (id, plan, items, after) => store.applyTwoWaySync(id, plan, items, after),
    applyOps: async (bytes, ops) => applyAnnotationOps({ bytes, ops }),
    writeFile: writeFileSafely,
  },
})
const events = []

/** What the next picker returns (a path, or null = cancelled). */
let picked = null
let pickerCalls = 0
const deps = {
  resolvePdfPath: async (id) => paths[id] ?? null,
  runFileOperation: (bookId, op) => service.runFileOperation(bookId, op),
  checkWritable: (filePath, bytes, allowSigned) => checkPdfWritable({ filePath, bytes, isReferenced: () => true, verifySignature: () => ({ status: 'unsigned' }), allowSigned }),
  chooseFile: async () => {
    pickerCalls++
    return picked
  },
  scan: scanPdfAnnotationBytes,
  plan: async (bytes, page, annotation, file) => planAttachmentAppend(bytes, page, annotation, file),
  verify: verifyPdfAttachmentBytes,
  saveRow: (input) => store.writeHighlight(input),
  stagingRoot: staging,
}

function sourceFile(name, size, kind = 'random') {
  const dir = path.join(tmp, 'src', randomBytes(4).toString('hex'))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  const fd = fs.openSync(file, 'w')
  for (let left = size; left > 0; ) {
    const n = Math.min(left, MB)
    fs.writeSync(fd, kind === 'random' ? randomBytes(n) : Buffer.alloc(n, 0x61))
    left -= n
  }
  fs.closeSync(fd)
  return file
}

async function attach(book, sourcePath, pageIndex = 0, point = { x: 0.3, y: 0.3 }) {
  picked = sourcePath
  return createPdfAttachment(deps, { bookId: book.id, pageIndex, point })
}

/** Every FileAttachment pdf.js sees: page, rect (normalised to the displayed page), name, content hash. */
async function fileAttachments(file) {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0, isEvalSupported: false, disableFontFace: true }).promise
  const out = []
  let docLevel = 0
  try {
    const attachments = await doc.getAttachments()
    docLevel = attachments ? Object.keys(attachments).length : 0
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const vp = page.getViewport({ scale: 1 })
      for (const a of await page.getAnnotations({ intent: 'any' })) {
        if (a.subtype !== 'FileAttachment') continue
        const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1])
        const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3])
        out.push({
          pageIndex: n - 1,
          rect: { x: Math.min(x1, x2) / vp.width, y: Math.min(y1, y2) / vp.height },
          name: a.file?.filename,
          sha256: a.file?.content ? sha(a.file.content) : null,
          id: a.id,
        })
      }
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return { attachments: out, docLevel }
}

const rowsOf = async (bookId, kind) => (await store.listHighlights(bookId)).filter((r) => !kind || r.styleKind === kind)

function annotatedPdf(options = {}) {
  return buildAnnotatedPdf({
    annotations: [
      { page: 1, subtype: 'Highlight', lines: [1], color: [1, 1, 0], nm: 'foxit-hl-1' },
      { page: 2, subtype: 'Underline', lines: [2], color: [0, 0, 1] },
      { page: 1, subtype: 'Text', rect: [500, 740, 522, 762], contents: 'Sticky' },
    ],
    ...options,
  })
}

console.log('PDF file attachment — Main side')

// ---- 1. attach
const fixtures = [
  ['classic xref + highlights', () => annotatedPdf()],
  ['xref stream (object streams)', () => annotatedPdf({ objectStreams: true })],
  ['rotated page (/Rotate 90)', () => annotatedPdf({ pageBoxes: [{ rotate: 90 }] })],
  ['cropped page', () => annotatedPdf({ pageBoxes: [{ cropBox: [50, 100, 500, 700] }] })],
  ['Foxit-style FileAttachment already on the page', () => buildPdf({ pages: 2, docFiles: [{ name: 'doc.txt', data: Buffer.from('doc') }], pageFiles: [{ page: 1, name: 'foxit.txt', data: Buffer.from('foxit') }] })],
]
for (const [label, make] of fixtures) {
  await check(`1. attach on ${label}: in the file at the row's place, content identical, nothing else changed`, async () => {
    const book = addBook(make(), label.replace(/\W+/g, '-'))
    const before = await fileAttachments(book.file)
    const scannedBefore = await scanPdfAnnotationBytes(new Uint8Array(fs.readFileSync(book.file)))
    const src = sourceFile('notes.txt', 1024)
    const result = await attach(book, src, 0, { x: 0.25, y: 0.4 })
    assert.equal(result.ok, true, JSON.stringify(result))
    const row = result.highlight
    assert.equal(row.styleKind, 'attachment')
    assert.equal(row.pdfAnnotation.attachment.sha256, sha(fs.readFileSync(src)))
    const after = await fileAttachments(book.file)
    assert.equal(after.attachments.length, before.attachments.length + 1)
    assert.equal(after.docLevel, before.docLevel, 'getAttachments() unchanged')
    const ours = after.attachments.find((a) => !before.attachments.some((b) => b.id === a.id))
    assert.equal(ours.pageIndex, 0)
    assert.equal(ours.name, 'notes.txt')
    assert.equal(ours.sha256, row.pdfAnnotation.attachment.sha256)
    assert.ok(Math.abs(ours.rect.x - row.pdfAnnotation.rects[0].x) < 0.002 && Math.abs(ours.rect.y - row.pdfAnnotation.rects[0].y) < 0.002, `rect ${JSON.stringify(ours.rect)} vs ${JSON.stringify(row.pdfAnnotation.rects[0])}`)
    const scannedAfter = await scanPdfAnnotationBytes(new Uint8Array(fs.readFileSync(book.file)))
    for (const item of scannedBefore.items) assert.ok(scannedAfter.items.some((i) => i.objectId === item.objectId), `annotation ${item.objectId} kept`)
    assert.equal(scannedAfter.items.filter((i) => i.subtype === 'FileAttachment').length, 1)
    assert.deepEqual(scannedAfter.pageAttachments.map((a) => a.name), scannedBefore.pageAttachments.map((a) => a.name), 'foreign page attachments unchanged')
  })
}

for (const [label, size] of [['1 byte', 1], ['1 MB', MB], ['50 MB', 50 * MB], ['exactly 100 MB', 100 * MB]]) {
  await check(`1. attach a ${label} file: stored byte-identical (the original may then be deleted)`, async () => {
    const book = addBook(annotatedPdf(), `size-${size}`)
    const src = sourceFile(`data-${size}.bin`, size)
    const expected = sha(fs.readFileSync(src))
    const result = await attach(book, src)
    assert.equal(result.ok, true, JSON.stringify(result))
    fs.rmSync(src)
    const after = await fileAttachments(book.file)
    assert.equal(after.attachments.length, 1)
    assert.equal(after.attachments[0].sha256, expected)
    assert.equal(result.highlight.pdfAnnotation.attachment.sizeBytes, size)
  })
}

await check('1. an icon placed at the page corner stays wholly inside the page', async () => {
  const book = addBook(annotatedPdf(), 'corner')
  const result = await attach(book, sourceFile('c.txt', 10), 0, { x: 1, y: 1 })
  assert.equal(result.ok, true)
  const r = result.highlight.pdfAnnotation.rects[0]
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 1 + 1e-9 && r.y + r.height <= 1 + 1e-9, JSON.stringify(r))
  assert.ok(r.width > 0 && r.height > 0)
})

await check('1. no staging copy or temp file is left behind', async () => {
  assert.deepEqual(fs.existsSync(staging) ? fs.readdirSync(staging) : [], [])
  const temps = fs.readdirSync(tmp).filter((n) => n.includes('.readmate-') && n.endsWith('.tmp'))
  assert.deepEqual(temps, [])
})

// ---- 4. cancel
await check('4. a cancelled picker changes nothing', async () => {
  const book = addBook(annotatedPdf(), 'cancel')
  const before = sha(fs.readFileSync(book.file))
  const calls = pickerCalls
  const result = await attach(book, null)
  assert.deepEqual(result, { ok: false, code: 'cancelled' })
  assert.equal(pickerCalls, calls + 1)
  assert.equal(sha(fs.readFileSync(book.file)), before)
  assert.equal((await rowsOf(book.id, 'attachment')).length, 0)
})

// ---- 11. same names
await check('11. two files with the same name on one page are both kept, distinct and intact', async () => {
  const book = addBook(annotatedPdf(), 'same-names')
  const a = sourceFile('report.docx', 2000)
  const b = sourceFile('report.docx', 3000)
  const first = await attach(book, a, 0, { x: 0.2, y: 0.2 })
  const second = await attach(book, b, 0, { x: 0.2, y: 0.2 })
  assert.equal(first.ok && second.ok, true)
  assert.notEqual(first.highlight.id, second.highlight.id)
  const after = await fileAttachments(book.file)
  assert.deepEqual(after.attachments.map((x) => x.name), ['report.docx', 'report.docx'])
  assert.deepEqual(new Set(after.attachments.map((x) => x.sha256)), new Set([sha(fs.readFileSync(a)), sha(fs.readFileSync(b))]))
})

// ---- 12. live sync
await check('12. opening and syncing after attaching: no duplicate rows, rows linked, later writes keep the attachment', async () => {
  const book = addBook(annotatedPdf(), 'live')
  const one = await attach(book, sourceFile('one.pdf', 4000), 0, { x: 0.1, y: 0.5 })
  const two = await attach(book, sourceFile('two.png', 5000), 1, { x: 0.6, y: 0.2 })
  assert.equal(one.ok && two.ok, true)
  const target = { id: 77, isDestroyed: () => false, once: () => {} }
  events.length = 0
  assert.equal((await service.watch(target, book.id)).ok, true)
  await service.whenIdle(target)
  const rows = await rowsOf(book.id, 'attachment')
  assert.equal(rows.length, 2, 'no duplicate rows')
  const ledger = store.listTwoWayLedger(book.id)
  for (const id of [one.highlight.id, two.highlight.id]) assert.ok(ledger.some((e) => e.noteId === id), `row ${id} linked`)
  // The fixture's own highlight / underline / sticky note are imported on this first open; no attachment is.
  assert.equal((events[0]?.outcome.inserted ?? []).filter((r) => r.styleKind === 'attachment').length, 0, 'the open sync imported no attachment')

  // An ordinary annotation saved in Readmate → the two-way cycle writes it; the attachments stay in the file and in SQLite.
  const written = store.writeHighlight({
    bookId: book.id,
    locator: { kind: 'page-rect', page: 1, chapterIndex: 0 },
    styleKind: 'highlight',
    colorHex: '#FFEB3B',
    pdfAnnotation: { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.1, y: 0.1, width: 0.4, height: 0.02 }] },
    tags: [],
  })
  service.notifyAppChange(book.id)
  await new Promise((r) => setTimeout(r, 500))
  await service.whenIdle(target)
  const after = await fileAttachments(book.file)
  assert.equal(after.attachments.length, 2, 'both attachments still in the file after a two-way write')
  assert.equal((await rowsOf(book.id, 'attachment')).length, 2)
  const scanned = await scanPdfAnnotationBytes(new Uint8Array(fs.readFileSync(book.file)))
  const highlightId = written.id
  assert.ok(highlightId && scanned.items.some((i) => i.subtype === 'Highlight' && i.nm === `readmate:${highlightId}`), 'the highlight was written')

  // Re-open: still no duplicates.
  assert.equal((await service.watch(target, book.id)).ok, true)
  await service.whenIdle(target)
  assert.equal((await rowsOf(book.id, 'attachment')).length, 2)
  service.unwatch(target, book.id)
})

service.disposeAll()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} attachment write checks passed`)

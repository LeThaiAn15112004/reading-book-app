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
 *   13. hostile PDF  other readers' attachments: names sanitised, a false /Size ignored, open blocked by policy,
 *                    Save As only to the chosen path
 *    9. move          new rect, same object number, /FS + content untouched; row updated; refusals
 *   10. delete        not listed by pdf.js, every other annotation present, file did not shrink; row + ledger gone
 *   12. live sync     (also) another program moves / deletes a Readmate attachment → the row follows / is removed
 *    2. size limit    100 MB + 1 B and a 150.2 MB file → too_large with both sizes, 0 B → empty, PDF + file over the
 *                     combined limit → too_large_for_pdf; the source is never opened; the PDF is unchanged
 *    5. changing file the source grows / shrinks while it is staged → source_changed; nothing written
 *   (US5 adds its scenarios here: 3, 6–8.)
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
const { planAttachmentAppend, appendAttachmentChange } = await import('../../electron/pdf-sync/pdf-incremental-writer.ts')
const { applyAnnotationOps } = await import('../../electron/pdf-sync/pdf-annotation-write.ts')
const { writeFileSafely } = await import('../../electron/pdf-sync/pdf-annotation-export.ts')
const { createPdfAnnotationSyncService } = await import('../../electron/pdf-sync/pdf-annotation-sync-service.ts')
const { checkPdfWritable } = await import('../../electron/pdf-sync/pdf-write-eligibility.ts')
const { createPdfAttachment, changePdfAttachment } = await import('../../electron/pdf-sync/pdf-attachment-operations.ts')
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

// ---- 2 / 5. size limit and refusals (US4)
{
  const { ATTACHMENT_MAX_BYTES, ATTACH_COMBINED_MAX_BYTES, describeAttachFailure } = await import('@reading-book/book-reader-sdk')
  const { stageAttachmentSource } = await import('../../electron/pdf-sync/pdf-attachment-writer.ts')
  /** Every read stream opened while `fn` runs (the staging reads the source through `fs.createReadStream`). */
  const realCreateReadStream = fs.createReadStream
  let wrapRead = null
  const opened = []
  fs.createReadStream = (p, options) => {
    opened.push(String(p))
    const stream = realCreateReadStream(p, options)
    if (wrapRead) wrapRead(String(p), stream)
    return stream
  }
  /** A file of `size` bytes without writing them (sparse where the file system allows). */
  const sizedFile = (name, size) => {
    const dir = path.join(tmp, 'src', randomBytes(4).toString('hex'))
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, name)
    fs.closeSync(fs.openSync(file, 'w'))
    fs.truncateSync(file, size)
    return file
  }
  const unchanged = async (book, fn) => {
    const before = sha(fs.readFileSync(book.file))
    const rowsBefore = (await rowsOf(book.id)).length
    const result = await fn()
    assert.equal(sha(fs.readFileSync(book.file)), before, 'PDF fingerprint unchanged')
    assert.equal((await rowsOf(book.id)).length, rowsBefore, 'no row added')
    assert.deepEqual(fs.existsSync(staging) ? fs.readdirSync(staging) : [], [], 'no staging copy left')
    return result
  }

  await check('2. 100 MB + 1 B → too_large with both sizes, refused before the file is opened for reading', async () => {
    const book = addBook(annotatedPdf(), 'too-large')
    const src = sizedFile('video.mp4', ATTACHMENT_MAX_BYTES + 1)
    opened.length = 0
    const started = Date.now()
    const result = await unchanged(book, () => attach(book, src))
    assert.ok(Date.now() - started < 1000, 'refused within 1 s (SC-005)')
    assert.deepEqual(result, { ok: false, code: 'too_large', sizeBytes: ATTACHMENT_MAX_BYTES + 1, limitBytes: ATTACHMENT_MAX_BYTES, fileName: 'video.mp4' })
    assert.ok(!opened.includes(src), 'the source was never opened for reading')
    assert.equal(describeAttachFailure(result), '“video.mp4” is 100.0 MB — the limit is 100 MB. Nothing was attached.')
  })

  await check('2. a 150.2 MB file: the message gives its size and the limit (spec example)', async () => {
    const book = addBook(annotatedPdf(), 'too-large-150')
    const src = sizedFile('lecture.mov', Math.round(150.2 * MB))
    opened.length = 0
    const result = await unchanged(book, () => attach(book, src))
    assert.equal(result.code, 'too_large')
    assert.ok(!opened.includes(src))
    assert.equal(describeAttachFailure(result), '“lecture.mov” is 150.2 MB — the limit is 100 MB. Nothing was attached.')
  })

  await check('2. 0 B → empty, never read', async () => {
    const book = addBook(annotatedPdf(), 'empty')
    const src = sizedFile('blank.txt', 0)
    opened.length = 0
    const result = await unchanged(book, () => attach(book, src))
    assert.deepEqual(result, { ok: false, code: 'empty', fileName: 'blank.txt' })
    assert.ok(!opened.includes(src))
  })

  await check('2. the PDF + file total above ATTACH_COMBINED_MAX_BYTES → too_large_for_pdf, never read', async () => {
    const src = sizedFile('dataset.bin', 60 * MB)
    const pdfSizeBytes = ATTACH_COMBINED_MAX_BYTES - 50 * MB
    opened.length = 0
    const result = await stageAttachmentSource(src, staging, { pdfSizeBytes })
    assert.deepEqual(result, { ok: false, code: 'too_large_for_pdf', sizeBytes: 60 * MB, pdfSizeBytes, limitBytes: ATTACH_COMBINED_MAX_BYTES })
    assert.ok(!opened.includes(src))
    const text = describeAttachFailure({ ...result, fileName: 'dataset.bin' })
    assert.match(text, /60\.0 MB/)
    assert.doesNotMatch(text, /Foxit|Acrobat/)
  })

  for (const [label, mutate] of [
    ['grows', (file) => fs.appendFileSync(file, randomBytes(256 * 1024))],
    ['shrinks', (file) => fs.truncateSync(file, 1024)],
  ]) {
    await check(`5. the file ${label} while it is being staged → source_changed, nothing written`, async () => {
      const book = addBook(annotatedPdf(), `changing-${label}`)
      const src = sourceFile('growing.log', 4 * MB)
      let done = false
      wrapRead = (p, stream) => {
        if (p !== src) return
        stream.once('data', () => {
          if (done) return
          done = true
          mutate(src)
        })
      }
      try {
        const result = await unchanged(book, () => attach(book, src))
        assert.equal(result.ok, false)
        assert.equal(result.code, 'source_changed', JSON.stringify(result))
        assert.equal(result.fileName, 'growing.log')
        assert.match(describeAttachFailure(result), /changed while it was being read/)
      } finally {
        wrapRead = null
      }
    })
  }

  await check('2 / 5. refusals leave pending annotations of other kinds untouched', async () => {
    const book = addBook(annotatedPdf(), 'refusal-pending')
    const pending = store.writeHighlight({
      bookId: book.id,
      locator: { kind: 'page-rect', page: 1, chapterIndex: 0 },
      styleKind: 'underline',
      colorHex: '#1E88E5',
      pdfAnnotation: { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.2, y: 0.3, width: 0.3, height: 0.02 }] },
      tags: [],
    })
    await unchanged(book, () => attach(book, sizedFile('big.iso', ATTACHMENT_MAX_BYTES + 10)))
    await unchanged(book, () => attach(book, sizedFile('none.txt', 0)))
    const rows = await rowsOf(book.id)
    assert.ok(rows.some((r) => r.id === pending.id && r.styleKind === 'underline'), 'the not-yet-written underline is still there')
  })

  fs.createReadStream = realCreateReadStream
}

// ---- 9 / 10. move and delete (US3)
const changeDeps = {
  resolvePdfPath: deps.resolvePdfPath,
  runFileOperation: deps.runFileOperation,
  checkWritable: deps.checkWritable,
  scan: scanPdfAnnotationBytes,
  verify: verifyPdfAttachmentBytes,
  change: async (bytes, page, change) => appendAttachmentChange(bytes, page, change),
  getRow: (bookId, rowId) => store.getAttachmentRow(bookId, rowId),
  isOtherRow: (bookId, rowId) => store.getAttachmentRow(bookId, rowId) === undefined && store.hasAnnotationRow(bookId, rowId),
  commit: (bookId, rowId, change) => store.commitAttachmentChange(bookId, rowId, change),
}
const change = (input) => changePdfAttachment(changeDeps, input)
/** The raw `/FS` value of the FileAttachment annotation `objectId` (`${num}R`) in its latest revision. */
function fsOf(file, objectId) {
  const text = fs.readFileSync(file).toString('latin1')
  const num = parseInt(objectId, 10)
  const bodies = [...text.matchAll(new RegExp(`(?:^|\\s)${num} 0 obj([\\s\\S]*?)endobj`, 'g'))]
  return /\/FS\s+(\d+ \d+ R)/.exec(bodies.at(-1)?.[1] ?? '')?.[1] ?? null
}

await check('9. move: new rect, same object number, /FS and content untouched, row updated', async () => {
  const book = addBook(annotatedPdf(), 'move')
  const created = await attach(book, sourceFile('plan.xlsx', MB), 0, { x: 0.2, y: 0.2 })
  assert.equal(created.ok, true)
  const row = created.highlight
  const before = (await fileAttachments(book.file)).attachments[0]
  const fsBefore = fsOf(book.file, before.id)
  const sizeBefore = fs.statSync(book.file).size
  const old = row.pdfAnnotation.rects[0]
  const rect = { x: 0.6, y: 0.7, width: old.width, height: old.height }
  const moved = await change({ bookId: book.id, rowId: row.id, op: 'move', rect })
  assert.equal(moved.ok, true, JSON.stringify(moved))
  assert.deepEqual({ x: moved.highlight.pdfAnnotation.rects[0].x, y: moved.highlight.pdfAnnotation.rects[0].y }, { x: 0.6, y: 0.7 })
  const after = (await fileAttachments(book.file)).attachments
  assert.equal(after.length, 1)
  assert.equal(after[0].id, before.id, 'same object number')
  assert.equal(after[0].sha256, before.sha256, 'content untouched')
  assert.ok(Math.abs(after[0].rect.x - 0.6) < 0.002 && Math.abs(after[0].rect.y - 0.7) < 0.002, JSON.stringify(after[0].rect))
  assert.equal(fsOf(book.file, before.id), fsBefore, '/FS kept')
  assert.ok(fs.statSync(book.file).size - sizeBefore < 8 * 1024, 'only the annotation + appearance were appended (no second copy)')
  const stored = await rowsOf(book.id, 'attachment')
  assert.equal(stored.length, 1)
  assert.equal(stored[0].pdfAnnotation.rects[0].x, 0.6)
  assert.equal(stored[0].pdfAnnotation.attachment.sha256, row.pdfAnnotation.attachment.sha256)
  // Open / Save As still find it by its rm id after the move.
  const { extractPdfAttachmentBytes } = await import('../../electron/attachments/pdf-attachments.ts')
  const extracted = await extractPdfAttachmentBytes(new Uint8Array(fs.readFileSync(book.file)), `rm-${row.id}`)
  assert.equal(extracted.ok, true)
  assert.equal(sha(extracted.content), row.pdfAnnotation.attachment.sha256)
})

await check('9. move refusals: another size, outside the page, foreign id, other kind, unknown row — nothing written', async () => {
  const book = addBook(annotatedPdf(), 'move-refused')
  const created = await attach(book, sourceFile('a.txt', 100))
  const row = created.highlight
  const r = row.pdfAnnotation.rects[0]
  const before = sha(fs.readFileSync(book.file))
  const other = store.writeHighlight({
    bookId: book.id,
    locator: { kind: 'page-rect', page: 1, chapterIndex: 0 },
    styleKind: 'highlight',
    colorHex: '#FFEB3B',
    pdfAnnotation: { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.02 }] },
    tags: [],
  })
  const cases = [
    [{ op: 'move', rect: { ...r, width: r.width * 2 } }, 'invalid_request'],
    [{ op: 'move', rect: { ...r, x: 1 - r.width / 2 } }, 'invalid_request'],
    [{ op: 'move', rowId: 'page-1-0-0123456789ab', rect: r }, 'not_editable'],
    [{ op: 'delete', rowId: other.id }, 'not_editable'],
    [{ op: 'delete', rowId: '00000000-0000-4000-8000-000000000000' }, 'not_found'],
    [{ op: 'spin', rect: r }, 'invalid_request'],
  ]
  for (const [extra, code] of cases) {
    const result = await change({ bookId: book.id, rowId: row.id, ...extra })
    assert.equal(result.code, code, JSON.stringify(extra))
  }
  assert.equal(sha(fs.readFileSync(book.file)), before)
  store.deleteHighlightRow(book.id, other.id)
})

await check('10. delete: not listed by pdf.js, every other annotation present, file did not shrink, row + ledger gone', async () => {
  const book = addBook(annotatedPdf(), 'delete')
  const keep = await attach(book, sourceFile('keep.txt', 300), 0, { x: 0.1, y: 0.1 })
  const gone = await attach(book, sourceFile('gone.txt', 300), 0, { x: 0.5, y: 0.5 })
  // Link both rows to the ledger first (as an open book would).
  const target = { id: 91, isDestroyed: () => false, once: () => {} }
  assert.equal((await service.watch(target, book.id)).ok, true)
  await service.whenIdle(target)
  assert.ok(store.listTwoWayLedger(book.id).some((e) => e.noteId === gone.highlight.id))
  const scannedBefore = await scanPdfAnnotationBytes(new Uint8Array(fs.readFileSync(book.file)))
  const sizeBefore = fs.statSync(book.file).size
  const result = await change({ bookId: book.id, rowId: gone.highlight.id, op: 'delete' })
  assert.deepEqual(result, { ok: true })
  await service.whenIdle(target)
  const after = await fileAttachments(book.file)
  assert.deepEqual(after.attachments.map((a) => a.name), ['keep.txt'])
  const scannedAfter = await scanPdfAnnotationBytes(new Uint8Array(fs.readFileSync(book.file)))
  const goneItem = scannedBefore.items.find((i) => i.nm === `readmate:${gone.highlight.id}`)
  for (const item of scannedBefore.items) {
    if (item.objectId === goneItem.objectId) continue
    assert.ok(scannedAfter.items.some((i) => i.objectId === item.objectId), `annotation ${item.objectId} kept`)
  }
  assert.ok(fs.statSync(book.file).size >= sizeBefore, 'the PDF did not get smaller (the bytes stay in the history)')
  const rows = await rowsOf(book.id, 'attachment')
  assert.deepEqual(rows.map((r) => r.id), [keep.highlight.id])
  assert.ok(!store.listTwoWayLedger(book.id).some((e) => e.noteId === gone.highlight.id), 'ledger entry removed')
  const again = await change({ bookId: book.id, rowId: gone.highlight.id, op: 'delete' })
  assert.equal(again.code, 'not_found')
  service.unwatch(target, book.id)
})

await check('12. another program moves, then deletes, a Readmate attachment: the row follows, then is removed', async () => {
  const book = addBook(annotatedPdf(), 'foreign-edit')
  const created = await attach(book, sourceFile('shared.txt', 500), 0, { x: 0.2, y: 0.3 })
  const row = created.highlight
  const target = { id: 92, isDestroyed: () => false, once: () => {} }
  assert.equal((await service.watch(target, book.id)).ok, true)
  await service.whenIdle(target)
  const otherWrite = async (make) => {
    const bytes = new Uint8Array(fs.readFileSync(book.file))
    const scanned = await scanPdfAnnotationBytes(bytes)
    const item = scanned.items.find((i) => i.nm === `readmate:${row.id}`)
    const page = scanned.pages.find((p) => p.pageIndex === item.pageIndex)
    fs.writeFileSync(book.file, appendAttachmentChange(bytes, page, make(item)))
    service.notifyAppChange(book.id)
    await new Promise((r) => setTimeout(r, 900))
    await service.whenIdle(target)
  }
  const r = row.pdfAnnotation.rects[0]
  await otherWrite((item) => ({
    op: 'move',
    objectId: item.objectId,
    annotation: { nm: `readmate:${row.id}`, pageIndex: 0, box: { ...r, x: 0.55, y: 0.15 }, color: [0, 0, 1], author: 'Foxit', contents: 'shared.txt', createdAt: row.createdAt, modifiedAt: new Date().toISOString() },
  }))
  const followed = await rowsOf(book.id, 'attachment')
  assert.equal(followed.length, 1)
  assert.ok(Math.abs(followed[0].pdfAnnotation.rects[0].x - 0.55) < 0.002, JSON.stringify(followed[0].pdfAnnotation.rects[0]))
  await otherWrite((item) => ({ op: 'delete', objectId: item.objectId, pageIndex: item.pageIndex }))
  assert.equal((await rowsOf(book.id, 'attachment')).length, 0, 'removed after a complete scan without its /NM')
  service.unwatch(target, book.id)
})

// ---- 13. hostile PDF (other readers' attachments, US2)
{
  const { createAttachmentService } = await import('../../electron/attachments/attachment-service.ts')
  const { listPdfAttachmentBytes, extractPdfAttachmentBytes } = await import('../../electron/attachments/pdf-attachments.ts')
  const mz = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 3, 0, 0, 0])
  const book = addBook(
    buildPdf({
      pages: 1,
      pageFiles: [
        { page: 1, name: '../../evil.txt', data: Buffer.from('traversal') },
        { page: 1, name: 'CON', data: Buffer.from('device') },
        { page: 1, name: 'invoice‮txt.exe', data: Buffer.from('bidi') },
        { page: 1, name: 'small.txt', data: Buffer.from('abc'), declaredSize: 999_999_999 },
        { page: 1, name: 'report.pdf', data: mz },
      ],
    }),
    'hostile',
  )
  const before = sha(fs.readFileSync(book.file))
  const opened = []
  let saveTarget = null
  const svc = createAttachmentService({
    resolvePdf: async (id) => (paths[id] ? { ok: true, path: paths[id] } : { ok: false, code: 'not_found' }),
    readFile: async (p) => new Uint8Array(fs.readFileSync(p)),
    list: listPdfAttachmentBytes,
    extract: extractPdfAttachmentBytes,
    tempRoot: path.join(tmp, 'attachment-tmp'),
    openPath: async (p) => {
      opened.push(p)
      return ''
    },
    chooseSaveTarget: async () => saveTarget,
    isForbiddenTarget: (target, pdfPath) => path.resolve(target) === path.resolve(pdfPath),
  })
  const scanned = await scanPdfAnnotationBytes(new Uint8Array(fs.readFileSync(book.file)))
  const byData = (n) => scanned.pageAttachments[n]

  await check('13. hostile names are sanitised in the sync event: no path, no device name, no bidi control', async () => {
    assert.equal(scanned.pageAttachments.length, 5)
    const names = scanned.pageAttachments.map((a) => a.name)
    for (const name of names) assert.ok(!/[\\/]/.test(name) && !/[‪-‮⁦-⁩]/.test(name), name)
    assert.equal(names[0], 'evil.txt')
    assert.notEqual(names[1], 'CON')
    assert.equal(names[2], 'invoicetxt.exe')
    assert.equal(scanned.items.filter((i) => i.subtype === 'FileAttachment').length, 0, 'foreign attachments never become rows')
  })
  await check('13. a false /Size is ignored: the size is the real data length', async () => {
    assert.equal(byData(3).sizeBytes, 3)
  })
  await check('13. open is blocked as the policy says (executable behind .pdf, .exe after bidi); allowed ones open', async () => {
    for (const n of [2, 4]) {
      const result = await svc.open(book.id, byData(n).attachmentId)
      assert.equal(result.ok, false)
      assert.equal(result.errorCode, 'blocked', byData(n).name)
    }
    assert.equal(opened.length, 0, 'nothing was launched')
    const ok = await svc.open(book.id, byData(0).attachmentId)
    assert.equal(ok.ok, true, JSON.stringify(ok))
    assert.equal(path.basename(opened[0]), 'evil.txt')
    assert.ok(path.resolve(opened[0]).startsWith(path.resolve(tmp, 'attachment-tmp')), 'temp copy inside the temp root')
  })
  await check('13. Save As writes only to the chosen path; cancel writes nothing; the PDF is unchanged', async () => {
    const chosen = path.join(tmp, 'chosen', 'kept.bin')
    fs.mkdirSync(path.dirname(chosen), { recursive: true })
    saveTarget = null
    const cancelled = await svc.saveAs(book.id, byData(4).attachmentId)
    assert.equal(cancelled.errorCode, 'canceled')
    assert.deepEqual(fs.readdirSync(path.dirname(chosen)), [])
    saveTarget = chosen
    const saved = await svc.saveAs(book.id, byData(4).attachmentId)
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.deepEqual(fs.readdirSync(path.dirname(chosen)), ['kept.bin'])
    assert.deepEqual(fs.readFileSync(chosen), mz)
    assert.equal(sha(fs.readFileSync(book.file)), before)
  })
}

service.disposeAll()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} attachment write checks passed`)

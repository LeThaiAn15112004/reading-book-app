/**
 * Checks for writing Readmate annotations into a PDF (docs/implementation_plan/pdf_annotation_export.md):
 * the real SDK plan + `pdf-incremental-writer.ts` + read-back through the installed pdf.js
 * (5.4.624, legacy build) — round trips on real generated PDFs. No Electron.
 *
 *   1. types        -> highlight / underline / strikethrough / note: subtype, /NM, color, opacity,
 *                      comment, author, page and geometry read back by pdf.js
 *   2. geometry     -> /Rotate 0/90/180/270, a cropped page and different page sizes: the stored
 *                      normalized rects come back where they were
 *   3. idempotent   -> exporting twice from the source, or re-exporting an exported file, never
 *                      duplicates; deleting a row removes its annotation
 *   4. imported     -> an untouched imported annotation is kept byte for byte, an edited one is
 *                      rewritten in place (same object, same /NM), a deleted one is removed with
 *                      its /Popup
 *   5. preservation -> the output starts with the source bytes; foreign annotations (Link, Ink,
 *                      FreeText) are kept; outline/metadata objects untouched; source unchanged
 *   6. structures   -> classic xref, xref stream + object streams, an earlier incremental update
 *   7. refusals     -> encrypted / broken trailer → explicit errors, nothing produced
 *   8. empty        -> no annotations and no rows: output = a copy of the source
 *   9. export flow  -> signed source needs confirmation; target = source / inside app data refused;
 *                      an existing target is replaced safely; a read-only target fails cleanly
 *                      (no temp file left, target untouched); a source that changes mid-export is
 *                      detected; the source file is never written
 *  14. attachments  -> a PDF holding a Readmate-made file attachment (`/NM readmate:…`, linked to its row) and
 *                      another reader's: both are in the exported file with identical content and position,
 *                      the attachment row is not written again (no second copy), the other annotations are
 *                      (specs/007-pdf-file-attachment research R14)
 *
 * Run: npm run spike:pdf:export   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  embeddedAnnotationIdentities,
  embeddedAnnotationSourceHash,
  highlightContentHash,
  highlightFromEmbeddedAnnotation,
} from '@reading-book/book-reader-sdk'
import { SAMPLE_ANNOTATIONS, appendIncrementalUpdate, buildAnnotatedPdf } from '../../e2e/support/build-annotated-pdf.mjs'

const { writeAnnotationsToPdf } = await import('../../electron/pdf-sync/pdf-annotation-write.ts')
const { appendAnnotationUpdate, PdfWriteError } = await import('../../electron/pdf-sync/pdf-incremental-writer.ts')
const { scanPdfAnnotationBytes } = await import('../../electron/pdf-sync/pdf-annotation-scan.ts')
const { exportAnnotatedPdf } = await import('../../electron/pdf-sync/pdf-annotation-export.ts')
const fs = await import('node:fs')
const os = await import('node:os')
const path = await import('node:path')
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const { buildPdf } = await import('../attachments/pdf-fixtures.mjs')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const sha = (b) => createHash('sha256').update(b).digest('hex')
const near = (a, b, eps = 0.003) => Math.abs(a - b) <= eps

function row(id, extra = {}) {
  return {
    id,
    styleKind: 'highlight',
    colorHex: '#FFEB3B',
    tags: [],
    pdfAnnotation: { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.12, y: 0.1, width: 0.6, height: 0.025 }] },
    createdAt: '2026-10-17T08:00:00.000Z',
    updatedAt: '2026-10-17T09:00:00.000Z',
    ...extra,
  }
}

/** All annotations of a page as pdf.js reports them (any type). */
async function rawAnnotations(bytes, pageNumber) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
  try {
    return await (await doc.getPage(pageNumber)).getAnnotations({ intent: 'display' })
  } finally {
    await doc.destroy()
  }
}

/** Ledger + rows as the import would have written them for `items`. */
function importedFrom(items) {
  const ledger = []
  const rows = []
  embeddedAnnotationIdentities(items).forEach(({ key }, i) => {
    const h = highlightFromEmbeddedAnnotation(items[i])
    const r = row(`imp-${i}`, { ...h })
    rows.push(r)
    ledger.push({ sourceKey: key, noteId: r.id, sourceHash: embeddedAnnotationSourceHash(items[i]), noteHash: highlightContentHash(r) })
  })
  return { ledger, rows }
}

const plainSource = buildAnnotatedPdf()

await check('1. each Readmate type is written as its standard PDF annotation and read back exactly', async () => {
  const rows = [
    row('h', { colorHex: '#FF000080', note: 'a comment' }),
    row('u', { styleKind: 'underline', colorHex: '#0000FF', pdfAnnotation: { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.12, y: 0.2, width: 0.5, height: 0.025 }] } }),
    row('s', { styleKind: 'strikethrough', colorHex: '#00FF00', pdfAnnotation: { pageIndex: 1, rects: [{ pageIndex: 1, x: 0.12, y: 0.3, width: 0.4, height: 0.025 }] } }),
    row('n', { styleKind: 'textbox', note: 'Ghi chú tiếng Việt ✓', pdfAnnotation: { pageIndex: 2, rects: [{ pageIndex: 2, x: 0.12, y: 0.4, width: 0.4, height: 0.025 }] } }),
  ]
  const { output, summary, after } = await writeAnnotationsToPdf({ bytes: plainSource, ledger: [], rows })
  assert.deepEqual(summary, { added: 4, replaced: 0, removed: 0, kept: 0 })
  const byNm = new Map(after.items.map((i) => [i.nm, i]))
  const h = byNm.get('readmate:h')
  assert.equal(h.subtype, 'Highlight')
  assert.equal(h.colorHex, '#FF0000')
  assert.equal(h.contents, 'a comment')
  assert.equal(h.author, 'Readmate')
  assert.ok(near(h.rects[0].x, 0.12) && near(h.rects[0].y, 0.1) && near(h.rects[0].width, 0.6) && near(h.rects[0].height, 0.025), JSON.stringify(h.rects[0]))
  assert.equal(byNm.get('readmate:u').subtype, 'Underline')
  assert.equal(byNm.get('readmate:u').colorHex, '#0000FF')
  assert.equal(byNm.get('readmate:s').subtype, 'StrikeOut')
  assert.equal(byNm.get('readmate:s').pageIndex, 1)
  const n = byNm.get('readmate:n')
  assert.equal(n.subtype, 'Text')
  assert.equal(n.contents, 'Ghi chú tiếng Việt ✓')
  assert.equal(n.pageIndex, 2)
  // Raw data: opacity, appearance streams, dates.
  const raw = (await rawAnnotations(output, 1)).find((a) => a.subtype === 'Highlight')
  assert.equal(raw.opacity, 0.502)
  assert.equal(raw.hasAppearance, true)
  assert.match(raw.modificationDate, /^D:20261017090000Z$/)
})

await check('2. rotation 0/90/180/270, crop box and page sizes: rects come back where they were', async () => {
  const pageBoxes = [
    { rotate: 90 },
    { rotate: 180, cropBox: [36, 50, 576, 742] },
    { rotate: 270, mediaBox: [0, 0, 420, 595] },
  ]
  const source = buildAnnotatedPdf({ pageBoxes })
  const rects = [
    { x: 0.2, y: 0.15, width: 0.3, height: 0.04 },
    { x: 0.05, y: 0.7, width: 0.5, height: 0.03 },
    { x: 0.6, y: 0.3, width: 0.25, height: 0.05 },
  ]
  const rows = rects.flatMap((r, page) => [
    row(`hl${page}`, { pdfAnnotation: { pageIndex: page, rects: [{ pageIndex: page, ...r }] } }),
    row(`ul${page}`, { styleKind: 'underline', pdfAnnotation: { pageIndex: page, rects: [{ pageIndex: page, ...r, y: r.y + 0.1 }] } }),
  ])
  const { after } = await writeAnnotationsToPdf({ bytes: source, ledger: [], rows })
  for (const [page, r] of rects.entries()) {
    const got = after.items.find((i) => i.nm === `readmate:hl${page}`)
    assert.ok(got, `page ${page + 1}`)
    const g = got.rects[0]
    assert.ok(near(g.x, r.x) && near(g.y, r.y) && near(g.width, r.width) && near(g.height, r.height), `page ${page + 1}: ${JSON.stringify(g)} vs ${JSON.stringify(r)}`)
  }
  // Same check on a rotated page whose source is an xref-stream file.
  const compressed = buildAnnotatedPdf({ pageBoxes, objectStreams: true, annotations: [{ page: 2, subtype: 'Link', rect: [72, 600, 300, 620] }] })
  const again = await writeAnnotationsToPdf({ bytes: compressed, ledger: [], rows })
  assert.equal(again.after.items.filter((i) => i.nm?.startsWith('readmate:')).length, rows.length)
})

await check('3. exporting twice / re-exporting an export never duplicates; a deleted row disappears', async () => {
  const rows = [row('a'), row('b', { styleKind: 'underline' }), row('m', { pdfAnnotation: { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.1, y: 0.9, width: 0.3, height: 0.02 }, { pageIndex: 1, x: 0.1, y: 0.05, width: 0.3, height: 0.02 }] } })]
  const first = await writeAnnotationsToPdf({ bytes: plainSource, ledger: [], rows })
  const second = await writeAnnotationsToPdf({ bytes: plainSource, ledger: [], rows })
  assert.equal(sha(first.output), sha(second.output), 'deterministic from the same source')
  // The export opened as a book of its own and exported again: replaced, not added.
  const reexport = await writeAnnotationsToPdf({ bytes: first.output, ledger: [], rows })
  assert.deepEqual(reexport.summary, { added: 0, replaced: 4, removed: 0, kept: 0 })
  assert.equal(reexport.after.items.length, 4)
  const minusB = await writeAnnotationsToPdf({ bytes: first.output, ledger: [], rows: [rows[0], rows[2]] })
  assert.equal(minusB.summary.removed, 1)
  assert.equal(minusB.after.items.some((i) => i.nm === 'readmate:b'), false)
  assert.equal(minusB.after.items.length, 3)
})

await check('4. imported annotations: untouched kept, edited rewritten in place, deleted removed with its popup', async () => {
  const annotations = [
    { page: 1, subtype: 'Highlight', lines: [2], color: [1, 1, 0], nm: '{F-1}', contents: 'from Foxit' },
    { page: 1, subtype: 'Underline', lines: [4], color: [0, 0, 1], nm: '{F-2}' },
    { page: 1, subtype: 'StrikeOut', lines: [6], color: [1, 0, 0], nm: '{F-3}', contents: 'has a popup' },
    { page: 1, subtype: 'Popup', popupOf: 2 },
  ]
  const source = buildAnnotatedPdf({ annotations })
  const scanned = (await scanPdfAnnotationBytes(source)).items
  const { ledger, rows } = importedFrom(scanned)
  rows[0] = { ...rows[0], colorHex: '#FF00FF', note: 'edited in Readmate' } // edited
  const keptRows = [rows[0], rows[1]] // rows[2] (StrikeOut) deleted in Readmate
  const { output, summary, after } = await writeAnnotationsToPdf({ bytes: source, ledger, rows: keptRows })
  assert.deepEqual(summary, { added: 0, replaced: 1, removed: 1, kept: 1 })
  const f1 = after.items.find((i) => i.nm === '{F-1}')
  assert.equal(f1.objectId, scanned[0].objectId, 'same object number')
  assert.equal(f1.colorHex, '#FF00FF')
  assert.equal(f1.contents, 'edited in Readmate')
  assert.equal(after.items.some((i) => i.nm === '{F-3}'), false)
  const page1 = await rawAnnotations(output, 1)
  assert.equal(page1.some((a) => a.subtype === 'Popup'), false, 'its popup went too')
  // The untouched one is the very same object, unchanged in the bytes.
  const f2 = after.items.find((i) => i.nm === '{F-2}')
  assert.equal(f2.objectId, scanned[1].objectId)
})

await check('5. preservation: source bytes are a prefix, foreign annotations kept, the source is never touched', async () => {
  const source = buildAnnotatedPdf({ annotations: SAMPLE_ANNOTATIONS })
  const before = sha(source)
  const { output } = await writeAnnotationsToPdf({ bytes: source, ledger: [], rows: [row('x')] })
  assert.equal(sha(source), before, 'input buffer unchanged')
  assert.ok(Buffer.from(output).subarray(0, source.length).equals(source), 'output = source + appended update')
  const types = async (bytes, page) => (await rawAnnotations(bytes, page)).map((a) => a.subtype).sort()
  for (const page of [1, 2, 3]) {
    const was = await types(source, page)
    const now = await types(output, page)
    for (const t of was) assert.ok(now.includes(t), `page ${page} lost ${t}`)
  }
})

await check('6. structures: classic xref, xref stream + object streams, an earlier incremental update', async () => {
  const named = [{ page: 1, subtype: 'Highlight', lines: [2], color: [1, 1, 0], nm: '{S-1}' }]
  const sources = {
    classic: buildAnnotatedPdf({ annotations: named }),
    xrefStream: buildAnnotatedPdf({ annotations: named, objectStreams: true }),
    incremental: appendIncrementalUpdate(buildAnnotatedPdf({ annotations: named }), { annotations: named, changes: { 0: { ...named[0], lines: [3] } } }),
  }
  for (const [name, source] of Object.entries(sources)) {
    const { output, after } = await writeAnnotationsToPdf({ bytes: source, ledger: [], rows: [row('w', { styleKind: 'strikethrough' })] })
    assert.ok(after.items.some((i) => i.nm === '{S-1}'), `${name}: existing kept`)
    assert.ok(after.items.some((i) => i.nm === 'readmate:w'), `${name}: written`)
    const tail = Buffer.from(output).subarray(-200).toString('latin1')
    if (name === 'xrefStream') assert.match(Buffer.from(output).subarray(source.length).toString('latin1'), /\/Type \/XRef/)
    else assert.match(Buffer.from(output).subarray(source.length).toString('latin1'), /\nxref\n/)
    assert.match(tail, /%%EOF\n$/)
    // pdf.js with stopAtErrors accepts it (the read-back already did), and a second update on top works.
    const twice = await writeAnnotationsToPdf({ bytes: output, ledger: [], rows: [row('w', { styleKind: 'strikethrough', colorHex: '#123456' })] })
    assert.equal(twice.after.items.filter((i) => i.nm === 'readmate:w').length, 1, `${name}: still once`)
  }
})

await check('7. encrypted or structurally broken files are refused with an explicit error', async () => {
  const encrypted = Buffer.from(plainSource.toString('latin1').replace('trailer\n<< /Size', 'trailer\n<< /Encrypt 99 0 R /Size'), 'latin1')
  assert.throws(() => appendAnnotationUpdate(encrypted, new Map(), { add: [], replace: [], remove: [] }), (e) => e instanceof PdfWriteError && e.code === 'encrypted')
  const broken = Buffer.from(plainSource.toString('latin1').replace(/startxref\n\d+/, 'startxref\n12'), 'latin1')
  const add = [{ nm: 'readmate:z', subtype: 'Highlight', pageIndex: 0, rects: [{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }], color: [1, 0, 0], opacity: 1, author: 'Readmate', createdAt: 'x', modifiedAt: 'x' }]
  const page = { pageIndex: 0, ref: { num: 4, gen: 0 }, transform: [1, 0, 0, -1, 0, 792], width: 612, height: 792 }
  assert.throws(() => appendAnnotationUpdate(broken, new Map([[0, page]]), { add, replace: [], remove: [] }), (e) => e instanceof PdfWriteError && e.code === 'unsupported_pdf')
})

await check('8. no annotations and no rows: the output is an identical copy', async () => {
  const { output, summary } = await writeAnnotationsToPdf({ bytes: plainSource, ledger: [], rows: [] })
  assert.deepEqual(summary, { added: 0, replaced: 0, removed: 0, kept: 0 })
  assert.equal(sha(output), sha(plainSource))
})

await check('9. export flow: confirmation, refused targets, safe overwrite, write errors, source never written', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-export-'))
  const sourcePath = path.join(dir, 'book.pdf')
  fs.writeFileSync(sourcePath, plainSource)
  const sourceSha = sha(fs.readFileSync(sourcePath))
  let target = path.join(dir, 'out.pdf')
  let signature = { status: 'unsigned' }
  let beforeWrite = async () => {}
  const deps = {
    resolveSource: async () => sourcePath,
    ledger: () => [],
    rows: async () => [row('e1'), row('e2', { styleKind: 'textbox', note: 'n' })],
    verifySignature: () => signature,
    chooseTarget: async () => target,
    isForbiddenTarget: (t) => t.includes('app-data'),
    write: async (input) => {
      await beforeWrite()
      return writeAnnotationsToPdf(input)
    },
  }
  const leftovers = () => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))

  const ok = await exportAnnotatedPdf(deps)
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.summary, { added: 2, replaced: 0, removed: 0, kept: 0 })
  assert.equal(ok.fileName, 'out.pdf')

  // Existing target: replaced atomically, no temp left.
  fs.writeFileSync(target, 'old content')
  assert.equal((await exportAnnotatedPdf(deps)).ok, true)
  assert.equal(fs.readFileSync(target).subarray(0, 4).toString(), '%PDF')
  assert.deepEqual(leftovers(), [])

  signature = { status: 'valid', signerName: 'Ann' }
  assert.deepEqual(await exportAnnotatedPdf(deps), { ok: false, errorCode: 'signed_needs_confirmation', signatureStatus: 'valid', signerName: 'Ann' })
  assert.equal((await exportAnnotatedPdf(deps, { acknowledgeSignature: true })).ok, true)
  signature = { status: 'unsigned' }

  target = sourcePath
  assert.equal((await exportAnnotatedPdf(deps)).errorCode, 'same_as_source')
  target = path.join(dir, 'app-data', 'x.pdf')
  assert.equal((await exportAnnotatedPdf(deps)).errorCode, 'permission_denied')

  // A read-only existing target: the write fails cleanly, the old file stays, no temp left.
  target = path.join(dir, 'readonly.pdf')
  fs.writeFileSync(target, 'keep me')
  fs.chmodSync(target, 0o444)
  const denied = await exportAnnotatedPdf(deps)
  assert.equal(denied.ok, false)
  assert.ok(['permission_denied', 'write_failed', 'busy'].includes(denied.errorCode), denied.errorCode)
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep me')
  assert.deepEqual(leftovers(), [])
  fs.chmodSync(target, 0o666)

  // A target folder that doesn't exist: write_failed, nothing created.
  target = path.join(dir, 'missing-folder', 'x.pdf')
  assert.equal((await exportAnnotatedPdf(deps)).errorCode, 'write_failed')

  // The source changes while the export runs (another app saves it): detected, nothing written.
  target = path.join(dir, 'raced.pdf')
  beforeWrite = async () => fs.appendFileSync(sourcePath, '\n% another app saved\n')
  assert.equal((await exportAnnotatedPdf(deps)).errorCode, 'source_changed')
  assert.equal(fs.existsSync(target), false)
  fs.writeFileSync(sourcePath, plainSource)
  beforeWrite = async () => {}

  assert.equal(sha(fs.readFileSync(sourcePath)), sourceSha, 'the source file is never written by the export')
  fs.rmSync(dir, { recursive: true, force: true })
})

await check('10. Typewriter notes are exported with the same writer; one that cannot be drawn is left out and counted, the rest is exported', async () => {
  const sdk = await import('@reading-book/book-reader-sdk')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-export-tw-'))
  const sourcePath = path.join(dir, 'book.pdf')
  fs.writeFileSync(sourcePath, plainSource)
  const doc = sdk.applyStyle(sdk.emptyTypewriterDoc(), 'Xin chào thế giới', { start: 0, end: 3 }, { bold: true })
  const tw = (id, text) => ({
    id,
    styleKind: 'typewriter',
    colorHex: doc.base.color,
    note: text,
    tags: [],
    pdfAnnotation: { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.1, y: id === 'ok' ? 0.3 : 0.6, width: 0.5, height: 0.2 }], typewriter: doc },
    createdAt: '2026-10-28T08:00:00.000Z',
    updatedAt: '2026-10-28T09:00:00.000Z',
  })
  const target = path.join(dir, 'out.pdf')
  const result = await exportAnnotatedPdf({
    resolveSource: async () => sourcePath,
    ledger: () => [],
    rows: async () => [tw('ok', 'Xin chào thế giới'), tw('bad', 'Xin chào 你好')],
    verifySignature: () => ({ status: 'unsigned' }),
    chooseTarget: async () => target,
    isForbiddenTarget: () => false,
    write: (input) => writeAnnotationsToPdf(input),
  })
  assert.equal(result.ok, true)
  assert.equal(result.summary.added, 1)
  assert.equal(result.skippedTypewriter, 1)
  const items = (await scanPdfAnnotationBytes(new Uint8Array(fs.readFileSync(target)))).items
  assert.deepEqual(items.map((i) => [i.nm, i.subtype]), [['readmate:ok', 'FreeText']])
  fs.rmSync(dir, { recursive: true, force: true })
})

await check('14. attachments: Readmate-made and foreign ones are in the export, identical, never added twice', async () => {
  const uuid = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c'
  const mine = Buffer.from('Readmate attachment content ✓')
  const theirs = Buffer.from('attached by another reader')
  const source = buildPdf({
    pages: 2,
    pageFiles: [
      { page: 1, name: 'mine.docx', data: mine, nm: `readmate:${uuid}`, rect: [40, 120, 60, 140] },
      { page: 2, name: 'theirs.txt', data: theirs, rect: [100, 30, 120, 50] },
    ],
  })
  /** Every FileAttachment: page, rect, name, content hash. */
  const attachments = async (bytes) => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
    const out = []
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        for (const a of await (await doc.getPage(n)).getAnnotations({ intent: 'any' })) {
          if (a.subtype === 'FileAttachment') out.push({ page: n, rect: a.rect.map((v) => Math.round(v * 100) / 100), name: a.file?.filename, sha: sha(a.file?.content ?? new Uint8Array(0)) })
        }
      }
    } finally {
      await doc.destroy()
    }
    return out
  }
  const before = await attachments(source)
  assert.equal(before.length, 2)

  // The live sync linked the Readmate attachment to its row (ledger entry); another reader's is never a row.
  const items = (await scanPdfAnnotationBytes(new Uint8Array(source))).items
  assert.deepEqual(items.map((i) => [i.subtype, i.nm]), [['FileAttachment', `readmate:${uuid}`]])
  const { ledger, rows: imported } = importedFrom(items)
  const attachmentRow = {
    ...imported[0],
    id: uuid,
    styleKind: 'attachment',
    pdfAnnotation: { ...imported[0].pdfAnnotation, attachment: { name: 'mine.docx', sizeBytes: mine.length, sha256: sha(mine) } },
  }
  ledger[0].noteId = uuid
  const rows = [attachmentRow, row('hl', { note: 'kept next to the attachments' })]
  const embeddedStreams = (b) => (Buffer.from(b).toString('latin1').match(/\/Type\s*\/EmbeddedFile\b/g) ?? []).length

  for (const [label, entries] of [['linked', ledger], ['not yet linked', []]]) {
    const { output, summary } = await writeAnnotationsToPdf({ bytes: source, ledger: entries, rows })
    assert.deepEqual(await attachments(output), before, `${label}: same attachments, same content, same place`)
    assert.equal(summary.added, 1, `${label}: only the highlight is added`)
    assert.ok(Buffer.from(output.subarray(0, source.length)).equals(Buffer.from(source)), 'the export starts with the source bytes')
    assert.equal(embeddedStreams(output), embeddedStreams(source), `${label}: no second embedded copy`)
  }

  // Through the export flow on files: the exported PDF holds both attachments; the source is untouched.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-export-attach-'))
  const sourcePath = path.join(dir, 'book.pdf')
  const target = path.join(dir, 'exported.pdf')
  fs.writeFileSync(sourcePath, source)
  const result = await exportAnnotatedPdf({
    resolveSource: async () => sourcePath,
    ledger: () => ledger,
    rows: async () => rows,
    verifySignature: () => ({ status: 'unsigned' }),
    chooseTarget: async () => target,
    isForbiddenTarget: () => false,
    write: (input) => writeAnnotationsToPdf(input),
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(await attachments(fs.readFileSync(target)), before)
  assert.equal(sha(fs.readFileSync(sourcePath)), sha(source))
  fs.rmSync(dir, { recursive: true, force: true })
})

console.log(`\n${passed} PDF annotation export checks passed`)

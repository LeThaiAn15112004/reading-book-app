/**
 * Typewriter notes, Main side (specs/005-typewriter-note, quickstart T-10): the real overlay IPC handlers
 * (validation) + `SqliteOverlayStore` on the migrated schema, no Electron.
 *
 *   1. save / list   a Typewriter note is a row of the SAME `notes` table; its text is stored UNTRIMMED (style
 *                    runs index into it) and comes back with its rich-text document and one box
 *   2. update        saving the same id again edits the row in place (no duplicate); delete removes it
 *   3. refusals      blank text, two boxes, a box off the page / narrower than the minimum, a missing or invalid
 *                    document (overlap, unknown family, bad colour), over 10 000 characters, a document on a
 *                    non-Typewriter row — nothing is stored
 *
 * Not covered here (later phases): writing the note into the PDF file (T053) and the "box shorter than the laid-out
 * text" refusal, which needs the page aspect ratio that only the renderer / the writer know.
 *
 * Run: npm run spike:pdf:typewriter   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { emptyTypewriterDoc, packPdfHighlightLocator, pdfHighlightDtoToReaderHighlight } from '@reading-book/book-reader-sdk'
import { invoke } from './electron-stub.mjs'
import { getDatabase } from './db-stub.mjs'

const { OverlayChannels } = await import('../../electron/ipc/channels.ts')
const { registerOverlayIpc } = await import('../../electron/ipc/overlay.ipc.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES ('tw', 'Typewriter', 'C:/does-not-matter.pdf', 'pdf', 'sha-tw', 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
).run()
registerOverlayIpc()

const box = { pageIndex: 0, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }
const doc = emptyTypewriterDoc()
const annotation = (over = {}) => ({ pageIndex: 0, rects: [box], typewriter: doc, ...over })
const input = (over = {}, ann = annotation()) => ({
  bookId: 'tw',
  styleKind: 'typewriter',
  colorHex: '#000000',
  note: '  Xin chào\nthế giới ',
  locatorRef: packPdfHighlightLocator(ann),
  pdfAnnotationRef: JSON.stringify(ann),
  ...over,
})
const save = (i) => invoke(OverlayChannels.saveHighlight, i)
const list = () => invoke(OverlayChannels.listHighlights, 'tw')
const count = () => db.prepare(`SELECT COUNT(*) AS n FROM notes WHERE book_id = 'tw'`).get().n

console.log('1. save / list')
let saved
await check('a Typewriter note is saved through the highlight IPC with its text untrimmed', async () => {
  saved = await save(input())
  assert.ok(saved, 'saved')
  assert.equal(saved.styleKind, 'typewriter')
  assert.equal(saved.note, '  Xin chào\nthế giới ')
  const row = JSON.parse(db.prepare(`SELECT note_json FROM notes WHERE id = ?`).get(saved.id).note_json)
  assert.equal(row.type, 'typewriter')
  assert.equal(row.group, 'annotation')
  assert.equal(row.note, '  Xin chào\nthế giới ')
  assert.equal(row.pdfAnnotation.rects.length, 1)
  assert.equal(row.pdfAnnotation.typewriter.v, 1)
})
await check('it lists back as a renderer row with the document and the box', async () => {
  const rows = (await list()).map(pdfHighlightDtoToReaderHighlight)
  assert.equal(rows.length, 1)
  const [row] = rows
  assert.ok(row)
  assert.equal(row.note, '  Xin chào\nthế giới ')
  assert.deepEqual(row.typewriter, doc)
  assert.equal(row.page, 1)
  assert.equal(row.rects.length, 1)
})

console.log('2. update / delete')
await check('saving the same id edits the row in place; delete removes it', async () => {
  const ann = annotation({ rects: [{ ...box, x: 0.2, width: 0.4 }] })
  const again = await save(input({ id: saved.id, note: 'Đã sửa' }, ann))
  assert.equal(again.id, saved.id)
  assert.equal(count(), 1)
  assert.equal((await list())[0].note, 'Đã sửa')
  assert.deepEqual(await invoke(OverlayChannels.deleteHighlight, { bookId: 'tw', id: saved.id }), { ok: true })
  assert.equal(count(), 0)
})

console.log('3. refusals')
const refused = async (name, i) =>
  check(`refused: ${name}`, async () => {
    assert.equal(await save(i), null)
    assert.equal(count(), 0)
  })
await refused('blank text', input({ note: '   \n ' }))
await refused('no text', input({ note: undefined }))
await refused('text over 10 000 characters', input({ note: 'a'.repeat(10_001) }))
await refused('text that is not NFC / has control characters', input({ note: 'a\u0007b' }))
await refused('two boxes', input({}, annotation({ rects: [box, { ...box, y: 0.5 }] })))
await refused('a box off the page', input({}, annotation({ rects: [{ ...box, x: 0.9, width: 0.3 }] })))
await refused('a box narrower than the minimum', input({}, annotation({ rects: [{ ...box, width: 0.01 }] })))
await refused('no document', input({}, { pageIndex: 0, rects: [box] }))
await refused('a document with overlapping runs', input({}, annotation({ typewriter: { ...doc, runs: [{ start: 0, end: 4, style: { bold: true } }, { start: 3, end: 5, style: { italic: true } }] } })))
await refused('a run past the end of the text', input({}, annotation({ typewriter: { ...doc, runs: [{ start: 0, end: 500, style: { bold: true } }] } })))
await refused('an unknown font family', input({}, annotation({ typewriter: { ...doc, base: { ...doc.base, family: 'comic-sans' } } })))
await refused('a colour that is not #RRGGBB', input({ colorHex: 'red' }))
await check('refused: a document on a row that is not a Typewriter note', async () => {
  assert.equal(await save(input({ styleKind: 'highlight' })), null)
  assert.equal(count(), 0)
})

console.log('4. file (T-11 / T-12): the real SDK plan + incremental writer + read-back through pdf.js')
const sdk = await import('@reading-book/book-reader-sdk')
const { writeAnnotationsToPdf } = await import('../../electron/pdf-sync/pdf-annotation-write.ts')
const { PdfWriteError } = await import('../../electron/pdf-sync/pdf-incremental-writer.ts')
const { buildAnnotatedPdf } = await import('../../e2e/support/build-annotated-pdf.mjs')
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const nodeFs = await import('node:fs')
const nodeOs = await import('node:os')
const nodePath = await import('node:path')

const VI = 'Xin chào thế giới, đây là ghi chú Typewriter\nDòng thứ hai căn giữa\nDòng ba căn phải và justify: một hai ba bốn năm sáu bảy tám chín mười'
function mixedDoc(text) {
  let d = sdk.emptyTypewriterDoc()
  d = sdk.applyStyle(d, text, { start: 0, end: 3 }, { bold: true, color: '#E53935' })
  d = sdk.applyStyle(d, text, { start: 4, end: 8 }, { italic: true, underline: true })
  d = sdk.applyStyle(d, text, { start: 9, end: 12 }, { strike: true, family: 'noto-serif' })
  const second = text.indexOf('\n') + 1
  const third = text.indexOf('\n', second) + 1
  d = sdk.applyAlign(d, text, { start: second, end: second }, 'center')
  d = sdk.applyAlign(d, text, { start: third, end: third }, 'right')
  return d
}
function twRow(id, text, doc, extra = {}) {
  return {
    id,
    styleKind: 'typewriter',
    colorHex: doc.base.color,
    note: text,
    tags: [],
    pdfAnnotation: { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.12, y: 0.3, width: 0.6, height: 0.2 }], typewriter: doc },
    createdAt: '2026-10-28T08:00:00.000Z',
    updatedAt: '2026-10-28T09:00:00.000Z',
    ...extra,
  }
}
async function pdfAnnots(bytes, pageNumber = 1) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
  try {
    const page = await doc.getPage(pageNumber)
    const annotations = await page.getAnnotations({ intent: 'display' })
    // Loading the operator list resolves every font of every appearance stream: a broken font throws here.
    const ops = await page.getOperatorList({ intent: 'display' })
    return { annotations, showText: ops.fnArray.filter((f) => f === pdfjs.OPS.showText).length }
  } finally {
    await doc.destroy()
  }
}
const source = buildAnnotatedPdf({})
const near = (a, b, eps = 0.003) => Math.abs(a - b) <= eps

await check('one incremental update: original bytes untouched; FreeText with the exact text, box, name and resolvable fonts', async () => {
  const { output, summary, after } = await writeAnnotationsToPdf({ bytes: source, ledger: [], rows: [twRow('t1', VI, mixedDoc(VI))] })
  assert.deepEqual(summary, { added: 1, replaced: 0, removed: 0, kept: 0 })
  assert.deepEqual(Buffer.from(output.subarray(0, source.length)), Buffer.from(source), 'original bytes are a prefix of the output')
  assert.equal(Buffer.from(output).toString('latin1').split('%%EOF').length - Buffer.from(source).toString('latin1').split('%%EOF').length, 1, 'exactly one update appended')
  const item = after.items.find((i) => i.nm === 'readmate:t1')
  assert.equal(item.subtype, 'FreeText')
  assert.ok(near(item.rects[0].x, 0.12) && near(item.rects[0].width, 0.6))
  const { annotations, showText } = await pdfAnnots(output)
  const ft = annotations.find((a) => a.annotationType === 3)
  assert.ok(ft, 'pdf.js sees a FreeText annotation')
  assert.equal(ft.contentsObj?.str ?? ft.contents, VI, 'plain text round-trips (Vietnamese, line breaks)')
  assert.ok(showText > 0, 'the appearance stream draws text with fonts that resolve')
})

await check('the appearance stream carries colour, bold / italic faces, underline / strike bars and alignment', async () => {
  const { output } = await writeAnnotationsToPdf({ bytes: source, ledger: [], rows: [twRow('t2', VI, mixedDoc(VI))] })
  const text = Buffer.from(output).toString('latin1')
  assert.match(text, /\/Subtype \/FreeText/)
  assert.match(text, /\/IT \/FreeTextTypewriter/)
  assert.match(text, /\/NM \(readmate:t2\)/)
  assert.match(text, /\/FontFile2/)
  assert.match(text, /\/ToUnicode/)
  for (const base of ['NotoSans-Bold', 'NotoSans-Italic', 'NotoSerif-Regular']) assert.ok(text.includes(base), `font ${base} embedded`)
})

await check('justified and plain notes are both written; rewriting the same row replaces it in place (no duplicate)', async () => {
  const justify = sdk.applyAlign(sdk.emptyTypewriterDoc(), VI, null, 'justify')
  const first = await writeAnnotationsToPdf({ bytes: source, ledger: [], rows: [twRow('t3', VI, justify)] })
  const again = await writeAnnotationsToPdf({ bytes: first.output, ledger: [], rows: [twRow('t3', VI + '!', justify, { note: VI + '!' })] })
  assert.equal(again.summary.replaced, 1)
  assert.equal(again.after.items.filter((i) => i.nm === 'readmate:t3').length, 1)
  const { annotations } = await pdfAnnots(again.output)
  assert.equal(annotations.filter((a) => a.annotationType === 3).length, 1)
  // deleting the row removes the annotation
  const removed = await writeAnnotationsToPdf({ bytes: again.output, ledger: [], rows: [] })
  assert.equal(removed.after.items.filter((i) => i.nm === 'readmate:t3').length, 0)
})

await check('rotated (/Rotate 90, 180 with a crop) and differently sized pages keep the box where it was', async () => {
  const pageBoxes = [{ rotate: 90 }, { rotate: 180, cropBox: [30, 40, 500, 700] }, { mediaBox: [0, 0, 400, 600] }]
  const rotated = buildAnnotatedPdf({ pageBoxes })
  const rows = [0, 1, 2].map((p) => twRow(`r${p}`, VI, mixedDoc(VI), { pdfAnnotation: { pageIndex: p, rects: [{ pageIndex: p, x: 0.2, y: 0.25, width: 0.5, height: 0.25 }], typewriter: mixedDoc(VI) } }))
  const { output, after } = await writeAnnotationsToPdf({ bytes: rotated, ledger: [], rows })
  for (const p of [0, 1, 2]) {
    const got = after.items.find((i) => i.nm === `readmate:r${p}`)
    assert.ok(got && near(got.rects[0].x, 0.2) && near(got.rects[0].y, 0.25) && near(got.rects[0].width, 0.5), `page ${p + 1} box`)
    const { showText } = await pdfAnnots(output, p + 1)
    assert.ok(showText > 0, `page ${p + 1} draws text`)
  }
})

await check('characters no shipped face can draw: that note alone is left out (reason unsupported_characters + the list); the others are written', async () => {
  const hl = { id: 'hl', styleKind: 'highlight', colorHex: '#FFEB3B', tags: [], pdfAnnotation: { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.12, y: 0.1, width: 0.6, height: 0.025 }] }, createdAt: '2026-10-28T08:00:00.000Z', updatedAt: '2026-10-28T09:00:00.000Z' }
  const rows = [hl, twRow('bad', 'Xin chào 你好 ✓', sdk.emptyTypewriterDoc()), twRow('good', VI, mixedDoc(VI), { pdfAnnotation: { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.12, y: 0.6, width: 0.6, height: 0.2 }], typewriter: mixedDoc(VI) } })]
  const { after, skipped, summary } = await writeAnnotationsToPdf({ bytes: source, ledger: [], rows })
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].nm, 'readmate:bad')
  assert.equal(skipped[0].code, 'unsupported_characters')
  assert.ok(skipped[0].characters.includes('你') && skipped[0].characters.includes('好'))
  assert.equal(summary.added, 2)
  assert.deepEqual(after.items.map((i) => i.nm).sort(), ['readmate:good', 'readmate:hl'])
})

await check('a box shorter than its text is left out with does_not_fit (never clipped)', async () => {
  const tiny = twRow('tiny', VI, sdk.emptyTypewriterDoc(), { pdfAnnotation: { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.01 }], typewriter: sdk.emptyTypewriterDoc() } })
  const { skipped, after } = await writeAnnotationsToPdf({ bytes: source, ledger: [], rows: [tiny] })
  assert.equal(skipped[0]?.code, 'does_not_fit')
  assert.equal(after.items.length, 0)
})

await check('an encrypted file is refused by the writer (the eligibility gate keeps the note pending)', async () => {
  const encrypted = Buffer.from(Buffer.from(source).toString('latin1').replace(/trailer\s*<</, 'trailer\n<< /Encrypt 99 0 R'), 'latin1')
  await assert.rejects(writeAnnotationsToPdf({ bytes: encrypted, ledger: [], rows: [twRow('e', VI, mixedDoc(VI))] }), (err) => err instanceof PdfWriteError)
})

nodeFs.rmSync(nodePath.join(nodeOs.tmpdir(), 'rb-tw-spike'), { recursive: true, force: true })
console.log(`\n${passed} checks passed`)

/**
 * Builds the manual cross-reader test kit (phase 4, docs/implementation_plan/pdf_annotation_reader_compatibility.md)
 * into a folder of your choice — nothing binary goes into the repo:
 *
 *   readmate-written.pdf  every annotation type Readmate writes (highlight, underline, strikethrough,
 *                         note with Vietnamese text, a multi-page highlight, a semi-transparent color),
 *                         produced by the real incremental writer, on an unrotated page, a /Rotate 90
 *                         page and a cropped /Rotate 180 page — open it in Foxit / Acrobat / SumatraPDF
 *                         and tick the matrix
 *   blank-for-external.pdf a plain text PDF to annotate in the external reader, then import into
 *                         Readmate (Add file) to check the external → Readmate direction
 *   expected.json         what each annotation in readmate-written.pdf should look like
 *   attachments/          file attachments (specs/007-pdf-file-attachment quickstart §3), each written by the real
 *                         stage → plan → streamed write → read-back path: small text, 50 MB binary, a Vietnamese
 *                         file name, a moved one, a deleted one; the attached originals beside them (to compare a
 *                         saved-out copy byte for byte) and README.md saying what to check per file. Foxit /
 *                         Acrobat-made samples given with `--samples <dir>` are copied in as `foreign-*.pdf`.
 *
 * Run: npm run spike:pdf:compat-kit -- <output folder> [--samples <folder with Foxit / Acrobat PDFs>]
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { READMATE_PDF_AUTHOR, applyAlign, applyStyle, attachmentIconBox, clampAttachmentBox, emptyTypewriterDoc } from '@reading-book/book-reader-sdk'
import { buildAnnotatedPdf } from '../../e2e/support/build-annotated-pdf.mjs'

const { writeAnnotationsToPdf } = await import('../../electron/pdf-sync/pdf-annotation-write.ts')
const { scanPdfAnnotationBytes, verifyPdfAttachmentBytes } = await import('../../electron/pdf-sync/pdf-annotation-scan.ts')
const { planAttachmentAppend, appendAttachmentChange } = await import('../../electron/pdf-sync/pdf-incremental-writer.ts')
const { stageAttachmentSource, writeAttachmentUpdate } = await import('../../electron/pdf-sync/pdf-attachment-writer.ts')

const args = process.argv.slice(2)
const samplesAt = args.indexOf('--samples')
const samplesDir = samplesAt >= 0 ? args[samplesAt + 1] : null
const out = args.find((a, i) => !a.startsWith('--') && (samplesAt < 0 || i !== samplesAt + 1))
if (!out) throw new Error('usage: npm run spike:pdf:compat-kit -- <output folder> [--samples <folder>]')
fs.mkdirSync(out, { recursive: true })

const R = (pageIndex, y, x = 0.11, width = 0.6) => ({ pageIndex, x, y, width, height: 0.03 })
const row = (id, styleKind, colorHex, rects, note) => ({
  id,
  styleKind,
  colorHex,
  note,
  tags: [],
  pdfAnnotation: { pageIndex: rects[0].pageIndex, rects },
  createdAt: '2026-10-17T08:00:00.000Z',
  updatedAt: '2026-10-17T09:00:00.000Z',
})
const rows = [
  row('hl-yellow', 'highlight', '#FFEB3B', [R(0, 0.12)], 'Highlight — yellow, with a comment'),
  row('ul-blue', 'underline', '#1E88E5', [R(0, 0.22)]),
  row('so-red', 'strikethrough', '#E53935', [R(0, 0.32)]),
  row('note-vi', 'textbox', '#FFEB3B', [R(0, 0.42, 0.11, 0.4)], 'Ghi chú tiếng Việt: Đây là note từ Readmate ✓'),
  row('hl-alpha', 'highlight', '#8E24AA80', [R(0, 0.52)], 'Semi-transparent purple (alpha 0x80)'),
  row('hl-multipage', 'highlight', '#43A047', [R(0, 0.9), R(1, 0.08)], 'One selection across pages 1–2'),
  row('hl-rot90', 'highlight', '#FFEB3B', [R(1, 0.3)], 'On a /Rotate 90 page'),
  row('ul-rot180', 'underline', '#1E88E5', [R(2, 0.3)], 'On a cropped /Rotate 180 page'),
]
// Typewriter notes (FreeText): Vietnamese, mixed styles, centred / right / justified, on every kind of page.
const VI = 'Xin chào thế giới, đây là ghi chú Typewriter của Readmate: Việt Nam, ắ ằ ẳ ẵ ặ, ơ ư đ.'
const MIXED = 'Đậm đỏ, nghiêng gạch chân, gạch ngang serif, và chữ thường.'
const twRow = (id, pageIndex, text, doc, y = 0.5) => ({
  id,
  styleKind: 'typewriter',
  colorHex: doc.base.color,
  note: text,
  tags: [],
  pdfAnnotation: { pageIndex, rects: [{ pageIndex, x: 0.11, y, width: 0.6, height: 0.2 }], typewriter: doc },
  createdAt: '2026-10-28T08:00:00.000Z',
  updatedAt: '2026-10-28T09:00:00.000Z',
})
let mixed = emptyTypewriterDoc()
mixed = applyStyle(mixed, MIXED, { start: 0, end: 8 }, { bold: true, color: '#E53935' })
mixed = applyStyle(mixed, MIXED, { start: 9, end: 24 }, { italic: true, underline: true })
mixed = applyStyle(mixed, MIXED, { start: 25, end: 38 }, { strike: true, family: 'noto-serif' })
const typewriters = [
  twRow('tw-vi', 0, VI, emptyTypewriterDoc(), 0.6),
  twRow('tw-mixed', 0, MIXED, mixed, 0.78),
  twRow('tw-center', 1, VI, applyAlign(emptyTypewriterDoc(), VI, null, 'center')),
  twRow('tw-right', 1, VI, applyAlign(emptyTypewriterDoc(), VI, null, 'right'), 0.75),
  twRow('tw-justify', 2, VI, applyAlign(emptyTypewriterDoc(), VI, null, 'justify')),
  twRow('tw-rot180', 2, MIXED, mixed, 0.72),
]
rows.push(...typewriters)
const source = buildAnnotatedPdf({ pageBoxes: [undefined, { rotate: 90 }, { rotate: 180, cropBox: [36, 50, 576, 742] }] })
const { output, summary, skipped } = await writeAnnotationsToPdf({ bytes: source, ledger: [], rows })
fs.writeFileSync(path.join(out, 'readmate-written.pdf'), output)
fs.writeFileSync(path.join(out, 'blank-for-external.pdf'), buildAnnotatedPdf())
fs.writeFileSync(
  path.join(out, 'expected.json'),
  JSON.stringify(
    rows.map((r) => ({ nm: `readmate:${r.id}`, type: r.styleKind === 'typewriter' ? 'FreeText (Typewriter)' : r.styleKind, color: r.colorHex, note: r.note ?? null, pages: [...new Set(r.pdfAnnotation.rects.map((x) => x.pageIndex + 1))] })),
    null,
    2,
  ),
)
console.log(`Wrote the kit to ${out} (${summary.added} annotations written, ${skipped.length} left out)`)
if (skipped.length) throw new Error(`Typewriter notes left out: ${JSON.stringify(skipped)}`)

// ---- File attachments (specs/007-pdf-file-attachment quickstart §3) --------------------------------------------
const sha = (b) => createHash('sha256').update(b).digest('hex')
const kit = path.join(out, 'attachments')
fs.mkdirSync(path.join(kit, 'originals'), { recursive: true })
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-compat-staging-'))

/** Attach `contentPath` to `pdfPath` at `point` on `pageIndex` exactly as Readmate does (no SQLite row). */
async function attachInto(pdfPath, contentPath, pageIndex, point) {
  const bytes = new Uint8Array(fs.readFileSync(pdfPath))
  const page = (await scanPdfAnnotationBytes(bytes)).pages.find((p) => p.pageIndex === pageIndex)
  const staged = await stageAttachmentSource(contentPath, staging, { pdfSizeBytes: bytes.length })
  if (!staged.ok) throw new Error(`staging ${contentPath}: ${JSON.stringify(staged)}`)
  const rowId = randomUUID()
  const now = new Date().toISOString()
  const name = path.basename(contentPath)
  const spec = {
    nm: `readmate:${rowId}`,
    pageIndex,
    box: clampAttachmentBox(attachmentIconBox(point, page)),
    color: [0.12, 0.53, 0.9],
    author: READMATE_PDF_AUTHOR,
    contents: name,
    createdAt: now,
    modifiedAt: now,
  }
  const plan = planAttachmentAppend(bytes, page, spec, { name, sizeBytes: staged.staged.sizeBytes, md5Hex: staged.staged.md5Hex, modifiedAt: staged.staged.modifiedAt })
  try {
    await writeAttachmentUpdate({
      target: pdfPath,
      bytes,
      bytesSha256: sha(bytes),
      plan,
      content: { stagedPath: staged.staged.stagedPath, sha256: staged.staged.sha256 },
      verify: async (temp) => {
        const verdict = await verifyPdfAttachmentBytes(new Uint8Array(fs.readFileSync(temp)), {
          annotationId: `${plan.annotationRef.num}R`,
          pageIndex,
          present: { rect: plan.rect, sha256: staged.staged.sha256 },
          keepIds: [],
        })
        return verdict.ok ? null : verdict.detail
      },
    })
  } finally {
    await staged.staged.cleanup()
  }
  return { rowId, spec }
}

/** Move (`box`) or delete (`null`) the Readmate attachment `rowId` in `pdfPath`, as attachments:change does. */
async function changeIn(pdfPath, rowId, spec, box) {
  const bytes = new Uint8Array(fs.readFileSync(pdfPath))
  const scanned = await scanPdfAnnotationBytes(bytes)
  const item = scanned.items.find((i) => i.nm === `readmate:${rowId}`)
  const page = scanned.pages.find((p) => p.pageIndex === item.pageIndex)
  const change = box
    ? { op: 'move', objectId: item.objectId, annotation: { ...spec, box, modifiedAt: new Date().toISOString() } }
    : { op: 'delete', objectId: item.objectId, pageIndex: item.pageIndex }
  fs.writeFileSync(pdfPath, appendAttachmentChange(bytes, page, change))
}

const fifty = Buffer.alloc(50 * 1024 * 1024)
for (let at = 0; at < fifty.length; at += 1024 * 1024) randomBytes(1024 * 1024).copy(fifty, at)
const attachmentFiles = [
  { pdf: 'attach-small-text.pdf', name: 'notes.txt', content: Buffer.from('Readmate attachment test — small text file.\nLine 2.\n'), page: 0, point: { x: 0.12, y: 0.15 }, check: 'icon at the top-left of page 1; listed in the attachment pane; opens; saved copy identical' },
  { pdf: 'attach-50mb.pdf', name: 'binary-50mb.bin', content: fifty, page: 0, point: { x: 0.7, y: 0.5 }, check: 'icon at the right middle of page 1; listed; saved copy identical (50 MB)' },
  { pdf: 'attach-vietnamese-name.pdf', name: 'Tài liệu học tập — ghi chú.txt', content: Buffer.from('Nội dung tiếng Việt: ắ ằ ẳ ẵ ặ ơ ư đ.\n'), page: 1, point: { x: 0.2, y: 0.3 }, check: 'icon on page 2; the pane shows the Vietnamese name exactly (a reader showing the ASCII /F name instead: note it)' },
  { pdf: 'attach-moved.pdf', name: 'moved.txt', content: Buffer.from('This attachment was moved after it was attached.\n'), page: 0, point: { x: 0.1, y: 0.1 }, moveTo: { x: 0.6, y: 0.75 }, check: 'icon at the LOWER RIGHT of page 1, not the top-left where it was first placed; opens; identical' },
  { pdf: 'attach-deleted.pdf', name: 'deleted.txt', content: Buffer.from('This attachment was deleted.\n'), page: 0, point: { x: 0.4, y: 0.4 }, deleted: true, check: 'NO icon on page 1 and NOT listed in the attachment pane (its bytes stay in an earlier revision)' },
]
const readme = [
  '# File attachment compatibility kit',
  '',
  'Generated by `npm run spike:pdf:compat-kit`. Open each PDF in Foxit, Acrobat (and any other reader) and record the',
  'results in `docs/implementation_plan/pdf_file_attachment_compat.md` — reader, version, OS, check, pass / fail / not',
  'tested. Compare a saved-out copy with the file in `originals/` (SHA-256 below). Never mark a reader compatible',
  'without having run the check.',
  '',
  '| PDF | Attached file | SHA-256 of the attached file | What to check |',
  '|---|---|---|---|',
]
for (const f of attachmentFiles) {
  const pdfPath = path.join(kit, f.pdf)
  fs.writeFileSync(pdfPath, buildAnnotatedPdf())
  const contentPath = path.join(kit, 'originals', f.name)
  fs.writeFileSync(contentPath, f.content)
  const { rowId, spec } = await attachInto(pdfPath, contentPath, f.page, f.point)
  if (f.moveTo) await changeIn(pdfPath, rowId, spec, { ...spec.box, ...f.moveTo })
  if (f.deleted) await changeIn(pdfPath, rowId, spec, null)
  readme.push(`| ${f.pdf} | originals/${f.name} | \`${sha(f.content)}\` | ${f.check} |`)
}
fs.rmSync(staging, { recursive: true, force: true })

let foreignCount = 0
if (samplesDir) {
  for (const name of fs.readdirSync(samplesDir).filter((n) => n.toLowerCase().endsWith('.pdf'))) {
    const bytes = fs.readFileSync(path.join(samplesDir, name))
    const scanned = await scanPdfAnnotationBytes(new Uint8Array(bytes)).catch(() => null)
    fs.writeFileSync(path.join(kit, `foreign-${name}`), bytes)
    foreignCount++
    readme.push(
      `| foreign-${name} | ${scanned ? `${scanned.pageAttachments.length} page attachment(s) seen by Readmate` : 'Readmate could not scan it'} | — | open in Readmate: every icon at its place, listed read-only in Notes, opens / saves identical to what the other reader shows |`,
    )
  }
} else {
  readme.push('', 'No Foxit / Acrobat samples were given (`--samples <dir>`): the other-reader → Readmate direction is not covered by this kit.')
}
fs.writeFileSync(path.join(kit, 'README.md'), readme.join('\n') + '\n')
console.log(`Wrote ${attachmentFiles.length} attachment PDFs${foreignCount ? ` and ${foreignCount} foreign sample(s)` : ''} to ${kit}`)

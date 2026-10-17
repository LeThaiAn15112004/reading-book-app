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
 *
 * Run: npm run spike:pdf:compat-kit -- <output folder>
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildAnnotatedPdf } from '../../e2e/support/build-annotated-pdf.mjs'

const { writeAnnotationsToPdf } = await import('../../electron/pdf-sync/pdf-annotation-write.ts')

const out = process.argv[2]
if (!out) throw new Error('usage: npm run spike:pdf:compat-kit -- <output folder>')
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
const source = buildAnnotatedPdf({ pageBoxes: [undefined, { rotate: 90 }, { rotate: 180, cropBox: [36, 50, 576, 742] }] })
const { output, summary } = await writeAnnotationsToPdf({ bytes: source, ledger: [], rows })
fs.writeFileSync(path.join(out, 'readmate-written.pdf'), output)
fs.writeFileSync(path.join(out, 'blank-for-external.pdf'), buildAnnotatedPdf())
fs.writeFileSync(
  path.join(out, 'expected.json'),
  JSON.stringify(
    rows.map((r) => ({ nm: `readmate:${r.id}`, type: r.styleKind, color: r.colorHex, note: r.note ?? null, pages: [...new Set(r.pdfAnnotation.rects.map((x) => x.pageIndex + 1))] })),
    null,
    2,
  ),
)
console.log(`Wrote the kit to ${out} (${summary.added} annotations written)`)

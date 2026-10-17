/**
 * Deterministic PDF with annotations embedded the way Foxit / Acrobat store them (a `/Annots` array
 * of annotation dictionaries per page), for the embedded-annotation import checks
 * (docs/implementation_plan/pdf_embedded_annotation_import.md). No external tools.
 *
 * Text layout matches build-text-pdf.mjs: `ANNOTATED_PDF_PAGES` US-Letter pages, line K of page N is
 * `textPdfLine(N, K)` in 16 pt Helvetica at baseline y = 720 − 28·(K − 1). `lineQuad` gives the box
 * a viewer would store for selecting a whole line.
 *
 * Every call writes the whole file from scratch. `padObjects` inserts unused objects first, which
 * renumbers every annotation — like a non-incremental "Save" in another viewer. `objectStreams`
 * stores the annotations compressed in an object stream with an xref stream (PDF 1.5, as Acrobat's
 * compressed saves do). `appendIncrementalUpdate` appends new versions of some annotations after
 * the original bytes — like an incremental "Save" in Foxit.
 *
 * Usage: node e2e/support/build-annotated-pdf.mjs <out.pdf>   (sample annotations; also imported)
 */
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { textPdfLine } from './build-text-pdf.mjs'

export const ANNOTATED_PDF_PAGES = 3
export const ANNOTATED_PDF_LINES = 8

/** Baseline of line `line` (1-based). */
export function lineBaseline(line) {
  return 720 - (line - 1) * 28
}

/** User-space box `[x1, y1, x2, y2]` around line `line` (glyphs, descenders, a little air). */
export function lineBox(line) {
  const b = lineBaseline(line)
  return [70, b - 5, 545, b + 15]
}

/** QuadPoints for whole lines, in the order viewers write them (UL, UR, LL, LR). */
export function lineQuads(lines) {
  return lines.flatMap((line) => {
    const [x1, y1, x2, y2] = lineBox(line)
    return [x1, y2, x2, y2, x1, y1, x2, y1]
  })
}

function pdfString(value) {
  return `(${String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`
}

function stream(content) {
  return `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
}

/**
 * One annotation dictionary. `a`:
 *   { page, subtype, lines?, rect?, color?: [r, g, b] (0–1), contents?, author?, flags?, nm?, irt? }
 * `irt` = index (in the annotations list) of the annotation this one replies to.
 */
function annotationDict(a, refOf, all = []) {
  const parts = [`/Type /Annot /Subtype /${a.subtype}`]
  if (a.subtype === 'Popup') {
    parts.push(`/Parent ${refOf(a.popupOf)} 0 R /Rect [${(a.rect ?? [300, 300, 500, 400]).join(' ')}] /Open false`)
    return `<< ${parts.join(' ')} >>`
  }
  const popup = all.findIndex((other) => other.subtype === 'Popup' && other.popupOf === all.indexOf(a))
  if (popup >= 0) parts.push(`/Popup ${refOf(popup)} 0 R`)
  let rect = a.rect
  if (a.lines) {
    const boxes = a.lines.map(lineBox)
    rect ??= [
      Math.min(...boxes.map((b) => b[0])),
      Math.min(...boxes.map((b) => b[1])),
      Math.max(...boxes.map((b) => b[2])),
      Math.max(...boxes.map((b) => b[3])),
    ]
    parts.push(`/QuadPoints [${lineQuads(a.lines).join(' ')}]`)
  } else if (a.quadPoints) {
    parts.push(`/QuadPoints [${a.quadPoints.join(' ')}]`)
  }
  parts.push(`/Rect [${rect.join(' ')}]`)
  if (a.color) parts.push(`/C [${a.color.join(' ')}]`)
  if (a.contents !== undefined) parts.push(`/Contents ${pdfString(a.contents)}`)
  if (a.author !== undefined) parts.push(`/T ${pdfString(a.author)}`)
  if (a.nm !== undefined) parts.push(`/NM ${pdfString(a.nm)}`)
  parts.push(`/F ${a.flags ?? 4}`)
  if (a.irt !== undefined) parts.push(`/IRT ${refOf(a.irt)} 0 R`)
  if (a.subtype === 'FreeText') parts.push('/DA (/Helv 12 Tf 0 g)')
  if (a.subtype === 'Ink') parts.push(`/InkList [[${rect[0]} ${rect[1]} ${rect[2]} ${rect[3]}]]`)
  if (a.subtype === 'Link') parts.push('/A << /S /URI /URI (https://example.com/) >>')
  return `<< ${parts.join(' ')} >>`
}

/** Object number of annotation `index` (same numbering in `buildAnnotatedPdf` and the update). */
function annotationRefs(padObjects) {
  const firstAnnot = 3 + padObjects + 1 + ANNOTATED_PDF_PAGES * 2
  return (index) => firstAnnot + index
}

/**
 * `pageBoxes[n - 1]` may give page n its own `/MediaBox`, `/CropBox` and `/Rotate` (default: an
 * unrotated US-Letter page). A `{ subtype: 'Popup', popupOf: i }` entry is the popup of annotation i.
 * An annotation gives its geometry as `lines` (whole text lines) or as `rect` + `quadPoints`.
 * @param {{ annotations?: object[], padObjects?: number, objectStreams?: boolean, pageBoxes?: ({ mediaBox?: number[], cropBox?: number[], rotate?: number } | undefined)[] }} [options]
 * @returns {Buffer}
 */
export function buildAnnotatedPdf({ annotations = [], padObjects = 0, objectStreams = false, pageBoxes = [] } = {}) {
  // 1 catalog, 2 pages tree, 3 font, padding, then (page, content) per page, then annotations.
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  for (let i = 0; i < padObjects; i++) objects.push(`<< /Padding ${i} >>`)
  const refOf = annotationRefs(padObjects)

  const pageRefs = []
  for (let n = 1; n <= ANNOTATED_PDF_PAGES; n++) {
    const pageNo = objects.length + 1
    pageRefs.push(pageNo)
    const annots = annotations.map((a, i) => (a.page === n ? `${refOf(i)} 0 R` : null)).filter(Boolean)
    const box = pageBoxes[n - 1] ?? {}
    const boxes = `/MediaBox [${(box.mediaBox ?? [0, 0, 612, 792]).join(' ')}]${box.cropBox ? ` /CropBox [${box.cropBox.join(' ')}]` : ''}${box.rotate ? ` /Rotate ${box.rotate}` : ''}`
    objects.push(
      `<< /Type /Page /Parent 2 0 R ${boxes} /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNo + 1} 0 R${
        annots.length ? ` /Annots [${annots.join(' ')}]` : ''
      } >>`,
    )
    const lines = []
    for (let k = 1; k <= ANNOTATED_PDF_LINES; k++) {
      lines.push(`BT /F1 16 Tf 72 ${lineBaseline(k)} Td (${textPdfLine(n, k)}) Tj ET`)
    }
    objects.push(stream(lines.join('\n')))
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((p) => `${p} 0 R`).join(' ')}] /Count ${ANNOTATED_PDF_PAGES} >>`
  if (objectStreams && annotations.length > 0) return withObjectStream(objects, annotations.map((a) => annotationDict(a, refOf, annotations)))
  for (const a of annotations) objects.push(annotationDict(a, refOf, annotations))

  let out = '%PDF-1.4\n'
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

/** Plain `objects`, then `compressed` (numbered right after them) inside one object stream. */
function withObjectStream(objects, compressed) {
  const firstCompressed = objects.length + 1
  const streamNo = firstCompressed + compressed.length
  const xrefNo = streamNo + 1
  let out = '%PDF-1.5\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  let header = ''
  let bodies = ''
  compressed.forEach((body, i) => {
    header += `${firstCompressed + i} ${bodies.length} `
    bodies += `${body}\n`
  })
  const packed = deflateSync(Buffer.from(header + bodies, 'latin1'))
  const streamOffset = Buffer.byteLength(out, 'latin1')
  out += `${streamNo} 0 obj\n<< /Type /ObjStm /N ${compressed.length} /First ${header.length} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n${packed.toString('latin1')}\nendstream\nendobj\n`
  const xrefOffset = Buffer.byteLength(out, 'latin1')
  // xref stream rows: [type, field 2 (4 bytes), field 3 (2 bytes)].
  const rows = [[0, 0, 65535]]
  for (let i = 0; i < objects.length; i++) rows.push([1, offsets[i], 0])
  compressed.forEach((_, i) => rows.push([2, streamNo, i]))
  rows.push([1, streamOffset, 0])
  rows.push([1, xrefOffset, 0])
  const data = Buffer.alloc(rows.length * 7)
  rows.forEach(([t, f2, f3], i) => {
    data.writeUInt8(t, i * 7)
    data.writeUInt32BE(f2, i * 7 + 1)
    data.writeUInt16BE(f3, i * 7 + 5)
  })
  out += `${xrefNo} 0 obj\n<< /Type /XRef /Size ${rows.length} /W [1 4 2] /Root 1 0 R /Length ${data.length} >>\nstream\n${data.toString('latin1')}\nendstream\nendobj\n`
  out += `startxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/**
 * Append an incremental update to a file made by `buildAnnotatedPdf({ annotations, padObjects })`:
 * new versions of the annotations at the indices of `changes` (same object numbers), a new xref
 * section and a trailer with `/Prev` — the original bytes stay untouched, as in Foxit's saves.
 * @param {Buffer} base
 * @param {{ annotations: object[], padObjects?: number, changes: Record<number, object> }} update
 */
export function appendIncrementalUpdate(base, { annotations, padObjects = 0, changes }) {
  const refOf = annotationRefs(padObjects)
  const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(base.toString('latin1'))?.[1])
  if (!Number.isFinite(prev)) throw new Error('base has no startxref')
  let out = base.toString('latin1')
  if (!out.endsWith('\n')) out += '\n'
  const entries = []
  for (const [index, annotation] of Object.entries(changes)) {
    const num = refOf(Number(index))
    entries.push([num, Buffer.byteLength(out, 'latin1')])
    out += `${num} 0 obj\n${annotationDict(annotation, refOf, annotations)}\nendobj\n`
  }
  const size = refOf(annotations.length)
  const xref = Buffer.byteLength(out, 'latin1')
  out += 'xref\n0 1\n0000000000 65535 f \n'
  for (const [num, offset] of entries) out += `${num} 1\n${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${size} /Root 1 0 R /Prev ${prev} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** A representative set: one of each supported type, plus types / states the import must skip. */
export const SAMPLE_ANNOTATIONS = [
  { page: 1, subtype: 'Highlight', lines: [2, 3], color: [1, 0.92, 0.23], contents: 'Foxit comment', author: 'Alice' },
  { page: 1, subtype: 'Underline', lines: [5], color: [0, 0.6, 1], author: 'Alice' },
  { page: 2, subtype: 'StrikeOut', lines: [1], color: [1, 0, 0] },
  { page: 2, subtype: 'Squiggly', lines: [4], color: [0, 0.7, 0] },
  { page: 3, subtype: 'Text', rect: [520, 730, 540, 750], color: [1, 1, 0], contents: 'Sticky note', author: 'Bob' },
  // Must be ignored:
  { page: 1, subtype: 'FreeText', rect: [300, 100, 500, 140], contents: 'Typed on the page' },
  { page: 1, subtype: 'Ink', rect: [100, 100, 200, 160], color: [0, 0, 0] },
  { page: 2, subtype: 'Link', rect: [72, 600, 300, 620] },
  { page: 2, subtype: 'Highlight', lines: [7], color: [1, 0, 1], flags: 2 }, // Hidden flag
  { page: 1, subtype: 'Text', rect: [520, 600, 540, 620], contents: 'A reply', irt: 0 }, // reply to #0
]

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const target = process.argv[2]
  if (!target) throw new Error('usage: build-annotated-pdf.mjs <out.pdf>')
  writeFileSync(target, buildAnnotatedPdf({ annotations: SAMPLE_ANNOTATIONS }))
  console.log(`Wrote ${target}`)
}

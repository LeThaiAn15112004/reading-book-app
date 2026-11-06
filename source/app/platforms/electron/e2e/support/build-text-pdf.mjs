/**
 * Deterministic text PDF for the PDF annotation E2E specs (no external tools).
 *
 * `TEXT_PDF_PAGES` US-Letter pages; page N holds `TEXT_PDF_LINES` lines, each its own text item (so
 * the PDF.js text layer gives one span per line): "Page N line K: <sentence>". Every line is unique,
 * so a spec can select exact lines and find them again.
 *
 * Usage: node e2e/support/build-text-pdf.mjs <out.pdf>   (also imported by the E2E specs)
 */
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const TEXT_PDF_PAGES = 14
export const TEXT_PDF_LINES = 8

export function textPdfLine(page, line) {
  return `Page ${page} line ${line}: the quick brown fox jumps over the lazy dog`
}

function stream(content) {
  return `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
}

export function buildTextPdf() {
  // 1 catalog, 2 pages tree, 3 font, then (page, content) per page.
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const pageRefs = []
  for (let n = 1; n <= TEXT_PDF_PAGES; n++) {
    const pageNo = objects.length + 1
    pageRefs.push(pageNo)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNo + 1} 0 R >>`,
    )
    const lines = []
    for (let k = 1; k <= TEXT_PDF_LINES; k++) {
      lines.push(`BT /F1 16 Tf 72 ${720 - (k - 1) * 28} Td (${textPdfLine(n, k)}) Tj ET`)
    }
    objects.push(stream(lines.join('\n')))
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((p) => `${p} 0 R`).join(' ')}] /Count ${TEXT_PDF_PAGES} >>`

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

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const target = process.argv[2]
  if (!target) throw new Error('usage: build-text-pdf.mjs <out.pdf>')
  writeFileSync(target, buildTextPdf())
  console.log(`Wrote ${target}`)
}

/**
 * Writes the PDF search fixtures (no external tools): a text PDF and an image-only "scanned" PDF.
 *
 *   text.pdf    -> 3 pages. p1: "Hello Readmate" + a sentence with one "fox"; p2: "fox" three times
 *                  over two lines; p3: no "fox". Helvetica, one text item per line.
 *   scanned.pdf -> 2 pages that only paint a 2×2 RGB image (no text operators at all).
 *
 * Run: npm run spike:pdf:fixtures (also run by spike:pdf:search)
 */
import { mkdirSync, writeFileSync } from 'node:fs'

const outDir = new URL('./fixtures/', import.meta.url)
mkdirSync(outDir, { recursive: true })

/** Minimal PDF writer: objects in order, xref with exact byte offsets. */
function buildPdf(objects) {
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

function stream(content) {
  return `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
}

function textPage(lines) {
  const ops = lines
    .map((line, i) => `BT /F1 18 Tf 72 ${720 - i * 28} Td (${line}) Tj ET`)
    .join('\n')
  return stream(ops)
}

// text.pdf — 1 catalog, 2 pages tree, 3 font, then (page, content) pairs.
const textPages = [
  ['Hello Readmate', 'The quick brown fox jumps.'],
  ['A fox and another fox', 'met a third fox today.'],
  ['Nothing to find on this page.'],
]
{
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const kids = []
  textPages.forEach((lines) => {
    const pageNo = objects.length + 1
    kids.push(`${pageNo} 0 R`)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNo + 1} 0 R >>`,
    )
    objects.push(textPage(lines))
  })
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`
  writeFileSync(new URL('text.pdf', outDir), buildPdf(objects))
}

// scanned.pdf — every page only draws an image XObject.
{
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]).toString('latin1')
  const image = `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', image]
  const kids = []
  for (let i = 0; i < 2; i++) {
    const pageNo = objects.length + 1
    kids.push(`${pageNo} 0 R`)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 3 0 R >> >> /Contents ${pageNo + 1} 0 R >>`,
    )
    objects.push(stream('q 500 0 0 700 56 46 cm /Im1 Do Q'))
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`
  writeFileSync(new URL('scanned.pdf', outDir), buildPdf(objects))
}

console.log('PDF search fixtures written to spikes/pdf-search/fixtures/')

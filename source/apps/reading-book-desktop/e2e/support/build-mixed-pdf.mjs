/**
 * Deterministic PDF whose pages have different sizes, for the Fit page E2E (no external tools).
 *   page 1: portrait 612×792 pt, page 2: landscape 792×612 pt, page 3: small 300×400 pt.
 * Page N shows "Page N marker".
 */
export const MIXED_PDF_PAGES = [
  { w: 612, h: 792 },
  { w: 792, h: 612 },
  { w: 300, h: 400 },
]

export function buildMixedPdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const kids = []
  MIXED_PDF_PAGES.forEach(({ w, h }, i) => {
    const pageNo = objects.length + 1
    kids.push(`${pageNo} 0 R`)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNo + 1} 0 R >>`,
    )
    const content = `BT /F1 20 Tf 24 ${h - 48} Td (Page ${i + 1} marker) Tj ET`
    objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`)
  })
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`

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

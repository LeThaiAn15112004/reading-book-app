/**
 * Deterministic PDF with a nested outline for the TOC-sync E2E specs (no external tools).
 *
 * 30 pages; page N shows "Page N marker" (one text item) so a spec can tell which page is visible.
 * Outline (title -> 1-based destination page), in document order:
 *   Part One -> 1      > Section 1.1 -> 2, Section 1.2 -> 4
 *   Part Two -> 6      > Section 2.1 -> 6, Section 2.2 -> 8
 *   Appendix -> 10     > A.1 -> 11 … A.20 -> 30   (long enough that the sidebar list must scroll)
 *
 * Usage: node e2e/support/build-toc-pdf.mjs <out.pdf>   (also imported by the E2E fixture)
 */
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const TOC_PDF_PAGES = 30

export const TOC_PDF_OUTLINE = [
  { title: 'Part One', page: 1, children: [{ title: 'Section 1.1', page: 2 }, { title: 'Section 1.2', page: 4 }] },
  { title: 'Part Two', page: 6, children: [{ title: 'Section 2.1', page: 6 }, { title: 'Section 2.2', page: 8 }] },
  {
    title: 'Appendix',
    page: 10,
    children: Array.from({ length: 20 }, (_, i) => ({ title: `A.${i + 1}`, page: 11 + i })),
  },
]

function stream(content) {
  return `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
}

export function buildTocPdf() {
  // 1 catalog, 2 pages tree, 3 font, 4 outline root, then pages (page, content), then outline items.
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '']
  const pageRefs = []
  for (let n = 1; n <= TOC_PDF_PAGES; n++) {
    const pageNo = objects.length + 1
    pageRefs.push(pageNo)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNo + 1} 0 R >>`,
    )
    objects.push(stream(`BT /F1 24 Tf 72 700 Td (Page ${n} marker) Tj ET`))
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R /PageMode /UseOutlines >>'
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((p) => `${p} 0 R`).join(' ')}] /Count ${TOC_PDF_PAGES} >>`

  // Reserve object numbers for every outline item in document order.
  const flat = []
  const assign = (nodes, parent) =>
    nodes.map((node) => {
      const entry = { node, parent, obj: objects.length + 1 + flat.length, kids: [] }
      flat.push(entry)
      entry.kids = assign(node.children ?? [], entry)
      return entry
    })
  const top = assign(TOC_PDF_OUTLINE, null)
  const count = (entries) => entries.reduce((sum, e) => sum + 1 + count(e.kids), 0)
  const link = (entries) => {
    entries.forEach((e, i) => {
      const parts = [
        `/Title (${e.node.title})`,
        `/Parent ${e.parent ? e.parent.obj : 4} 0 R`,
        `/Dest [${pageRefs[e.node.page - 1]} 0 R /XYZ null null null]`,
      ]
      if (i > 0) parts.push(`/Prev ${entries[i - 1].obj} 0 R`)
      if (i < entries.length - 1) parts.push(`/Next ${entries[i + 1].obj} 0 R`)
      if (e.kids.length) {
        parts.push(`/First ${e.kids[0].obj} 0 R`, `/Last ${e.kids.at(-1).obj} 0 R`, `/Count ${count(e.kids)}`)
      }
      e.body = `<< ${parts.join(' ')} >>`
      link(e.kids)
    })
  }
  link(top)
  objects[3] = `<< /Type /Outlines /First ${top[0].obj} 0 R /Last ${top.at(-1).obj} 0 R /Count ${count(top)} >>`
  for (const e of flat) objects.push(e.body)

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
  if (!target) throw new Error('usage: build-toc-pdf.mjs <out.pdf>')
  writeFileSync(target, buildTocPdf())
  console.log(`Wrote ${target}`)
}

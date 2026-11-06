/**
 * Test helper: the annotations Readmate itself wrote into a PDF (write-back is always on), turned back
 * into `build-annotated-pdf.mjs` annotation specs — so a spec can simulate "another app saves the file"
 * the way a real viewer does: every annotation it doesn't own is kept, `/NM` and all.
 */
import { readFileSync } from 'node:fs'

/** Readmate's own annotations (`/T (Readmate)`, `/NM (readmate:…)`) of `file`, as builder specs. */
export async function readmateAnnotationSpecs(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const bytes = readFileSync(file)
  const text = bytes.toString('latin1')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
  const specs = []
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      for (const a of await page.getAnnotations({ intent: 'display' })) {
        if (a.titleObj?.str !== 'Readmate') continue
        const num = /^(\d+)R/.exec(a.id)?.[1]
        const at = num === undefined ? -1 : text.lastIndexOf(`\n${num} 0 obj`)
        const nm = at < 0 ? undefined : /\/NM \((readmate:[^)]+)\)/.exec(text.slice(at, text.indexOf('endobj', at)))?.[1]
        const quads = a.quadPoints ? Array.from(a.quadPoints) : []
        specs.push({
          page: pageNumber,
          subtype: a.subtype,
          rect: Array.from(a.rect),
          quadPoints: quads.length > 0 ? quads : undefined,
          color: a.color ? Array.from(a.color).map((c) => c / 255) : undefined,
          contents: a.contentsObj?.str || undefined,
          author: 'Readmate',
          nm,
        })
      }
    }
  } finally {
    await doc.destroy()
  }
  return specs
}

/**
 * Scan the annotations embedded in a PDF's bytes: PDF.js (Node `legacy` build) for the annotation
 * data, `pdf-raw-objects.ts` for each annotation's `/NM`. Runs inside the scan worker thread
 * (pdf-annotation-scan.worker.ts), never on the Main event loop; also imported by the spikes.
 * Must not import `electron`.
 */
import {
  EMBEDDED_PDF_SCAN_MAX_ANNOTATIONS,
  READMATE_NM_PREFIX,
  clampShapeStroke,
  isEmbeddedShapeSubtype,
  parseScannedPdfAnnotation,
  readPdfJsAnnotation,
  type ScannedPdfAnnotation,
} from '@reading-book/book-reader-sdk'
import { loadPdfjs } from '../chunking/pdf-text'
import { PdfRawObjects, parsePdfJsRef, readAnnotationNames } from './pdf-raw-objects'
import type { PageGeometry } from './pdf-incremental-writer'
import { dictValue, parseDict } from './pdf-syntax'

type ShapeExtras = { arrow?: true; opacity?: number; /** `/L`, user space, in the file's own order (PDF.js sorts it into a box). */ line?: number[]; /** `/BS /W`, user units (PDF.js drops it for some types). */ width?: number }

/** `/LE` (an arrow end), `/CA` and `/L` of a shape the app wrote — read from the file's own dictionary (PDF.js exposes `/LE` / `/CA` not at all and `/L` only normalized, i.e. without direction). */
function readShapeExtras(bytes: Uint8Array, objectIds: readonly string[]): Map<string, ShapeExtras> {
  const out = new Map<string, ShapeExtras>()
  if (objectIds.length === 0) return out
  const objects = new PdfRawObjects(bytes)
  if (objects.encrypted) return out
  for (const id of objectIds) {
    const ref = parsePdfJsRef(id)
    const body = ref ? objects.body(ref.num, ref.gen) : undefined
    if (body === undefined) continue
    try {
      const dict = parseDict(body)
      const extras: ShapeExtras = {}
      const l = dictValue(body, dict, 'L')
      if (l?.trim().startsWith('[')) {
        const values = l.replace(/[[\]]/g, ' ').trim().split(/\s+/).map(Number)
        if (values.length === 4 && values.every((n) => Number.isFinite(n))) extras.line = values
      }
      const bs = dictValue(body, dict, 'BS')
      if (bs?.trim().startsWith('<<')) {
        const w = Number(dictValue(bs, parseDict(bs), 'W'))
        if (Number.isFinite(w) && w > 0) extras.width = w
      }
      const le = dictValue(body, dict, 'LE')
      const ends = le?.replace(/[[\]]/g, ' ').trim().split(/\s+/) ?? []
      if (ends.length === 2 && ends[1] !== '/None' && ends[0] === '/None') extras.arrow = true
      const ca = Number(dictValue(body, dict, 'CA'))
      if (Number.isFinite(ca) && ca >= 0 && ca < 1) extras.opacity = ca
      out.set(id, extras)
    } catch {
      // An unreadable dictionary keeps PDF.js's view of the item.
    }
  }
  return out
}

export type PdfAnnotationScanResult = {
  /** Supported annotations in page order, then `/Annots` order (the order identity keys count in). */
  items: ScannedPdfAnnotation[]
  /**
   * True only when every page's annotations were read without an error and the item cap was not
   * hit — the condition for treating a missing annotation as deleted from the file.
   */
  complete: boolean
  pageCount: number
  /** Every page's object and scale-1 viewport (what the writer maps coordinates with). */
  pages: PageGeometry[]
}

/**
 * Throws when the document itself can't be opened (broken / truncated / password-protected file):
 * the caller then keeps everything as it is and retries on the next change.
 */
export async function scanPdfAnnotationBytes(bytes: Uint8Array): Promise<PdfAnnotationScanResult> {
  const pdfjs = await loadPdfjs()
  // PDF.js takes ownership of (detaches) the buffer it is given — keep `bytes` for `/NM` — and
  // refuses Node Buffers: always hand it a plain Uint8Array copy.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
  })
  const scanned: ScannedPdfAnnotation[] = []
  let complete = true
  let pageCount = 0
  const pages: PageGeometry[] = []
  try {
    const doc = await task.promise
    pageCount = doc.numPages
    scan: for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      try {
        const page = await doc.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 1 })
        if (page.ref) {
          pages.push({ pageIndex: pageNumber - 1, ref: { num: page.ref.num, gen: page.ref.gen }, transform: [...viewport.transform], width: viewport.width, height: viewport.height })
        }
        const annotations: unknown[] = await page.getAnnotations({ intent: 'display' })
        if (annotations.length > 0) {
          const info = { pageIndex: pageNumber - 1, transform: viewport.transform, width: viewport.width, height: viewport.height }
          for (const raw of annotations) {
            const item = readPdfJsAnnotation(raw, info)
            if (!item) continue
            if (scanned.length >= EMBEDDED_PDF_SCAN_MAX_ANNOTATIONS) {
              complete = false
              break scan
            }
            scanned.push(item)
          }
        }
        page.cleanup()
      } catch {
        complete = false
      }
    }
  } finally {
    await task.destroy()
  }

  const names = readAnnotationNames(bytes, scanned.map((a) => a.objectId))
  const extras = readShapeExtras(bytes, scanned.filter((a) => isEmbeddedShapeSubtype(a.subtype)).map((a) => a.objectId))
  const items: ScannedPdfAnnotation[] = []
  for (const item of scanned) {
    const nm = names.get(item.objectId)
    // A shape another reader drew stays the FILE's own graphic object (hover / select / edit in place, see
    // pdf_graphic_objects.md): only the shapes Readmate wrote itself (`readmate:<id>`) are annotations here.
    if (isEmbeddedShapeSubtype(item.subtype) && !nm?.startsWith(READMATE_NM_PREFIX)) continue
    const { line, width, ...more } = extras.get(item.objectId) ?? {}
    let shape = item.shape
    const page = line || width ? pages.find((p) => p.pageIndex === item.pageIndex) : undefined
    if (shape && width && page) shape = { ...shape, strokeWidth: clampShapeStroke((width * Math.hypot(page.transform[0]!, page.transform[1]!)) / page.width) }
    if (shape && line && page) {
      const [a, b, c, d, e, f] = page.transform as [number, number, number, number, number, number]
      const at = (x: number, y: number): [number, number] => [Math.min(1, Math.max(0, (a * x + c * y + e) / page.width)), Math.min(1, Math.max(0, (b * x + d * y + f) / page.height))]
      const p1 = at(line[0]!, line[1]!)
      const p2 = at(line[2]!, line[3]!)
      shape = { ...shape, line: [p1[0], p1[1], p2[0], p2[1]] }
    }
    const checked = parseScannedPdfAnnotation({ ...item, ...(shape ? { shape } : {}), ...(nm ? { nm } : {}), ...more })
    if (checked) items.push(checked)
    else complete = false
  }
  return { items, complete, pageCount, pages }
}

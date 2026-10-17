/**
 * Scan the annotations embedded in a PDF's bytes: PDF.js (Node `legacy` build) for the annotation
 * data, `pdf-raw-objects.ts` for each annotation's `/NM`. Runs inside the scan worker thread
 * (pdf-annotation-scan.worker.ts), never on the Main event loop; also imported by the spikes.
 * Must not import `electron`.
 */
import {
  EMBEDDED_PDF_SCAN_MAX_ANNOTATIONS,
  parseScannedPdfAnnotation,
  readPdfJsAnnotation,
  type ScannedPdfAnnotation,
} from '@reading-book/book-reader-sdk'
import { loadPdfjs } from '../chunking/pdf-text'
import { readAnnotationNames } from './pdf-raw-objects'
import type { PageGeometry } from './pdf-incremental-writer'

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
  const items: ScannedPdfAnnotation[] = []
  for (const item of scanned) {
    const nm = names.get(item.objectId)
    const checked = parseScannedPdfAnnotation(nm ? { ...item, nm } : item)
    if (checked) items.push(checked)
    else complete = false
  }
  return { items, complete, pageCount, pages }
}

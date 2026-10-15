/**
 * Scan the annotations embedded in the open PDF (Foxit / Acrobat markup, sticky notes) — read-only,
 * on the PDFDocumentProxy that is already loaded for rendering, so the file is neither re-read nor
 * re-parsed. See docs/implementation_plan/pdf_embedded_annotation_import.md.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  EMBEDDED_PDF_SCAN_MAX_ANNOTATIONS,
  readPdfJsAnnotation,
  type ScannedPdfAnnotation,
} from '@reading-book/book-reader-sdk'

/** Pages between two yields to the event loop (PDF.js does the parsing in its worker). */
const YIELD_EVERY_PAGES = 25

/**
 * Every supported annotation of `pdf`, in page order then `/Annots` order (the order identity keys
 * count duplicates in). `intent: 'display'` leaves out hidden / NoView annotations and makes PDF.js
 * extract the text under each text-markup annotation (`overlaidText`).
 *
 * A page whose annotations can't be read is skipped (logged) — the sync never deletes, so a partial
 * scan only means fewer imports this time. Stops early, returning what it has, when `isCancelled()`
 * turns true or `EMBEDDED_PDF_SCAN_MAX_ANNOTATIONS` is reached.
 */
export async function scanEmbeddedPdfAnnotations(
  pdf: PDFDocumentProxy,
  isCancelled: () => boolean,
): Promise<ScannedPdfAnnotation[]> {
  const found: ScannedPdfAnnotation[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    if (isCancelled()) return found
    try {
      const page = await pdf.getPage(pageNumber)
      const annotations: unknown[] = await page.getAnnotations({ intent: 'display' })
      if (annotations.length > 0) {
        const viewport = page.getViewport({ scale: 1 })
        const info = {
          pageIndex: pageNumber - 1,
          transform: viewport.transform,
          width: viewport.width,
          height: viewport.height,
        }
        for (const raw of annotations) {
          const item = readPdfJsAnnotation(raw, info)
          if (!item) continue
          found.push(item)
          if (found.length >= EMBEDDED_PDF_SCAN_MAX_ANNOTATIONS) return found
        }
      }
    } catch (err) {
      if (isCancelled()) return found
      console.warn('[PdfRenderer] could not read the annotations of page', pageNumber, err)
    }
    if (pageNumber % YIELD_EVERY_PAGES === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return found
}

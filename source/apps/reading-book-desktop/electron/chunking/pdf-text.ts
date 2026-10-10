/**
 * PDF text for search / word count — runs in the chunk worker thread (never the UI thread).
 *
 * Uses the installed pdfjs-dist (pinned 5.4.624) through its `legacy` build, which is the one
 * meant for Node; the worker module is loaded in-thread (`globalThis.pdfjsWorker`), so no extra
 * worker file has to be located. `pdfjs-dist` is external in the Main build (vite.config.ts) and
 * loads from node_modules, like the other large runtime packages.
 *
 * Page text is built exactly like the PDF.js text layer the Reader paints search hits on
 * (`reader/renderers/pdf/pdfSearchDom.ts`): every text item's `str` in order, plus a line break
 * after items flagged `hasEOL`. Same text on both sides → same matcher hits → Main's
 * "occurrence k of page n" lands on the same words in the renderer.
 */
import fsp from 'node:fs/promises'
import type { TextParagraph } from '@reading-book/book-reader-sdk'

type PdfTextItem = { str?: string; hasEOL?: boolean }

/** One page's searchable text from `getTextContent().items` (marked-content items have no `str`). */
export function pdfPageText(items: readonly PdfTextItem[]): string {
  let text = ''
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    text += item.str
    if (item.hasEOL) text += '\n'
  }
  return text
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let pdfjsPromise: Promise<PdfjsModule> | null = null

function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const holder = globalThis as { pdfjsWorker?: unknown }
    holder.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    return pdfjs
  })()
  return pdfjsPromise
}

/**
 * One paragraph per page with text (`chapterIndex` = 0-based page index, `offset` 0). Pages
 * without text yield nothing, so an image-only (scanned) PDF yields no paragraphs at all → no
 * chunks → search reports "no text" instead of an empty result list.
 */
export async function* pdfParagraphs(filePath: string): AsyncGenerator<TextParagraph> {
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(await fsp.readFile(filePath))
  const task = pdfjs.getDocument({
    data,
    verbosity: 0,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  })
  try {
    const doc = await task.promise
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      page.cleanup()
      const text = pdfPageText(content.items as PdfTextItem[])
      if (text.trim()) yield { chapterIndex: pageNumber - 1, offset: 0, text }
    }
  } finally {
    await task.destroy()
  }
}

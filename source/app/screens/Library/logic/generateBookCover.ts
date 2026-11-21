import { libraryApi } from '../../../bridge'
import { startStep } from '../../../hooks/app/stepTimer'
import { useLibraryBooksStore } from '../../../hooks/library/libraryBooksStore'

/** Spec 016 (FR-006): pdf.js asks for ranges; each call to Main / the local server reads at most 1 MiB. */
const RANGE_MAX_BYTES = 1024 * 1024
/** First bytes handed to pdf.js up front (header + often the xref of a linearized file). */
const PDF_INITIAL_BYTES = 64 * 1024

const COVER_W = 400
const COVER_H = 560

/** Formats whose first page can be rendered here (an EPUB only when Main found no cover image). */
const RENDERABLE = new Set(['pdf', 'txt', 'md', 'epub'])

/** Books already tried this session (success or not) — a failing file is never retried in a loop. */
const attempted = new Set<string>()

export function canGenerateCover(format: string): boolean {
  return RENDERABLE.has(format.toLowerCase())
}

export function markCoverAttempted(bookId: string): boolean {
  if (attempted.has(bookId)) return false
  attempted.add(bookId)
  return true
}

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = COVER_W
  canvas.height = COVER_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  return { canvas, ctx }
}

/** `length` bytes from `offset`, in calls of at most 1 MiB. */
async function readRange(bookId: string, offset: number, length: number): Promise<Uint8Array> {
  const out = new Uint8Array(length)
  let done = 0
  while (done < length) {
    const take = Math.min(RANGE_MAX_BYTES, length - done)
    const result = await libraryApi.readBookRange(bookId, offset + done, take)
    if (!result.ok) throw new Error(`range read failed: ${result.errorCode}`)
    out.set(new Uint8Array(result.data), done)
    done += take
  }
  return out
}

/**
 * First page of a PDF, scaled to fit the cover box. Spec 016 (FR-006): pdf.js reads the file by ranges
 * (`PDFDataRangeTransport`, no auto-fetch, no streaming) — only the xref and page 1's objects, never the whole book.
 */
async function renderPdfFirstPage(bookId: string, sizeBytes: number): Promise<HTMLCanvasElement> {
  const { getDocument, GlobalWorkerOptions, PDFDataRangeTransport } = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  GlobalWorkerOptions.workerSrc = workerUrl
  const initial = await readRange(bookId, 0, Math.min(sizeBytes, PDF_INITIAL_BYTES))
  const transport = new PDFDataRangeTransport(sizeBytes, initial)
  transport.requestDataRange = (begin: number, end: number) => {
    void readRange(bookId, begin, Math.min(end, sizeBytes) - begin).then(
      (chunk) => transport.onDataRange(begin, chunk),
      () => transport.abort(),
    )
  }
  const task = getDocument({ range: transport, length: sizeBytes, disableAutoFetch: true, disableStream: true })
  try {
    const pdf = await task.promise
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(COVER_W / base.width, COVER_H / base.height) * 2
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, canvas, viewport }).promise
    return canvas
  } finally {
    await task.destroy()
  }
}

/** A white page with the first lines of text — the "first page" of formats without a cover. */
function renderTextPage(text: string): HTMLCanvasElement {
  const { canvas, ctx } = newCanvas()
  ctx.fillStyle = '#fbfaf6'
  ctx.fillRect(0, 0, COVER_W, COVER_H)
  ctx.fillStyle = '#222222'
  ctx.font = '20px Georgia, "Times New Roman", serif'
  ctx.textBaseline = 'top'
  const margin = 32
  const maxWidth = COVER_W - margin * 2
  const lineHeight = 28
  let y = margin
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      y += lineHeight / 2
      continue
    }
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width > maxWidth && line) {
        ctx.fillText(line, margin, y)
        y += lineHeight
        line = word
        if (y > COVER_H - margin) return canvas
      } else {
        line = next
      }
    }
    ctx.fillText(line, margin, y)
    y += lineHeight
    if (y > COVER_H - margin) return canvas
  }
  return canvas
}

/**
 * Text of the first spine document that has any (EPUB without a cover image). Spec 016: the documents come from
 * `getCoverSource` (read by ranges by the host) instead of the whole book; the text is taken exactly as before.
 */
function epubFirstText(documents: readonly string[]): string {
  for (const html of documents) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('script,style').forEach((n) => n.remove())
    const text = (doc.body?.innerText ?? doc.body?.textContent ?? '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim()
    if (text.length > 40) return text
  }
  return ''
}

async function renderCover(bookId: string, format: string): Promise<HTMLCanvasElement | null> {
  // Spec 016 (FR-006): never the whole book — the host sends only what the first page needs.
  const source = await libraryApi.getCoverSource(bookId)
  if (!source.ok) return null
  if (source.kind === 'pdf') return format === 'pdf' ? renderPdfFirstPage(bookId, source.sizeBytes) : null
  if (source.kind === 'html') {
    const text = epubFirstText(source.documents).slice(0, 4000)
    return text ? renderTextPage(text) : null
  }
  const text = source.text.slice(0, 4000)
  if (!text.trim()) return null
  return renderTextPage(format === 'md' ? text.replace(/^[#>*\-\s`]+/gm, '') : text)
}

/** One stuck file must not hold up the covers of every book after it. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)
    work.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** Render the book's first page and store it as its cover. Resolves true when a cover was saved. */
export async function generateBookCover(bookId: string, format: string): Promise<boolean> {
  // Spec 016: `cover` step timing (size unknown here: 0).
  const mark = startStep('import', 'cover', { format: format.toLowerCase(), sizeBytes: 0 })
  try {
    const canvas = await withTimeout(renderCover(bookId, format.toLowerCase()), 30_000)
    if (!canvas) {
      console.warn('[cover] nothing to render', bookId, format)
      return false
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return false
    const result = await libraryApi.setGeneratedCover(bookId, await blob.arrayBuffer())
    if (!result.ok) {
      console.warn('[cover] not saved', bookId, format)
      return false
    }
    // Spec 016 (FR-006): patch this one Library entry — no reload of the whole list.
    useLibraryBooksStore.getState().patchBook(bookId, { coverUrl: result.coverUrl })
    mark.end()
    return true
  } catch (err) {
    console.warn('[cover] generation failed', bookId, err)
    return false
  }
}

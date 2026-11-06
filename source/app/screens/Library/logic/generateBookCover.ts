import { libraryApi, txtApi } from '../../../bridge'

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

/** First page of a PDF, scaled to fit the cover box. */
async function renderPdfFirstPage(data: ArrayBuffer): Promise<HTMLCanvasElement> {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  GlobalWorkerOptions.workerSrc = workerUrl
  const task = getDocument({ data: new Uint8Array(data.slice(0)) })
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

/** Text of the first spine document that has any (EPUB without a cover image). */
async function epubFirstText(data: ArrayBuffer): Promise<string> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(data)
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const opfPath = container
    ? parse(container).querySelector('rootfile')?.getAttribute('full-path')
    : null
  if (!opfPath) return ''
  const opf = parse((await zip.file(opfPath)?.async('string')) ?? '')
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const hrefById = new Map<string, string>()
  for (const item of Array.from(opf.querySelectorAll('manifest > item'))) {
    hrefById.set(item.getAttribute('id') ?? '', item.getAttribute('href') ?? '')
  }
  for (const ref of Array.from(opf.querySelectorAll('spine > itemref'))) {
    const href = hrefById.get(ref.getAttribute('idref') ?? '')
    if (!href) continue
    const html = await zip.file(decodeURIComponent(dir + href))?.async('string')
    if (!html) continue
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
  if (format === 'txt') {
    const opened = await txtApi.open(bookId)
    return opened.ok && opened.text?.trim() ? renderTextPage(opened.text.slice(0, 4000)) : null
  }
  const content = await libraryApi.openBookContent(bookId)
  if (!content.ok || !content.data) return null
  switch (format) {
    case 'pdf':
      return renderPdfFirstPage(content.data)
    case 'epub': {
      const text = (await epubFirstText(content.data)).slice(0, 4000)
      return text ? renderTextPage(text) : null
    }
    case 'md': {
      const text = new TextDecoder('utf-8').decode(content.data).slice(0, 4000)
      return text.trim() ? renderTextPage(text.replace(/^[#>*\-\s`]+/gm, '')) : null
    }
    default:
      return null
  }
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
  try {
    const canvas = await withTimeout(renderCover(bookId, format.toLowerCase()), 30_000)
    if (!canvas) {
      console.warn('[cover] nothing to render', bookId, format)
      return false
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return false
    const result = await libraryApi.setGeneratedCover(bookId, await blob.arrayBuffer())
    if (!result.ok) console.warn('[cover] not saved', bookId, format)
    return result.ok
  } catch (err) {
    console.warn('[cover] generation failed', bookId, err)
    return false
  }
}

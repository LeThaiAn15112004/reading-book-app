/**
 * PDF surface — continuous vertical scrolling (see docs/implementation_plan/pdf_continuous_scroll.md).
 *
 * Every page gets a placeholder slot sized from its PDF viewport, stacked in document order. The
 * Reader's zoom viewport (`ReaderZoomViewport mode="native"`) is the one scroll container; this
 * component never scrolls itself. It lays pages out at `zoom` (no CSS transform), and only the
 * pages in / near the viewport hold a canvas + text layer — the rest are released on the way out.
 *
 * Navigation is exposed through `apiRef` so the shared Reader controls (footer, shortcuts, TOC)
 * drive it the same way they drive the EPUB renderer. Bytes come from `library.openBookContent`;
 * no file paths or Node APIs here.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist'
import { PageRectLocation } from '@reading-book/book-reader-sdk'
// `?url` makes Vite emit the worker as a local asset in dist/ — never loaded from a CDN.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/** PDF points → CSS px (72 → 96 dpi), so zoom 100% is the page's real size. */
const PDF_TO_CSS = 96 / 72
const PAGE_GAP_PX = 12
const PAD_PX = 16
/** Pages rendered beyond the visible range in each direction. */
const RENDER_AHEAD = 2
/** Rendered pages farther than this from the visible range are released. */
const KEEP_AROUND = 6
/** Cap one canvas' backing store (high zoom × HiDPI) — the page just gets a little softer. */
const MAX_CANVAS_PIXELS = 16_777_216
/** Assumed page size (A4) until the first page is measured. */
const FALLBACK_SIZE: PageSize = { w: 595, h: 842 }

type PageSize = { w: number; h: number }

export type PdfNavState = {
  /** 1-based page currently being read. */
  pageCurrent: number
  pageTotal: number
}

export type PdfOutlineItem = {
  id: string
  label: string
  /** 1-based target page; null when the entry has no in-document destination (e.g. a URL). */
  page: number | null
  level: number
  children: PdfOutlineItem[]
}

export interface PdfRendererApi {
  goToPage: (page: number) => void
  nextPage: () => void
  prevPage: () => void
  getNavState: () => PdfNavState
  getCurrentLocation: () => PageRectLocation | undefined
}

export interface PdfRendererProps {
  data: ArrayBuffer
  /** Reader view zoom (1 = 100%); pages are laid out and rasterized at this scale. */
  zoom: number
  /** The scroll container (Reader zoom viewport) — used for page tracking and navigation. */
  getScrollRoot: () => HTMLElement | null
  /** 1-based page to open at (restored reading position). */
  initialPage?: number
  apiRef?: MutableRefObject<PdfRendererApi | null>
  onNavState?: (state: PdfNavState) => void
  onOutline?: (items: PdfOutlineItem[]) => void
}

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

type RenderEntry = {
  scale: number
  page: PDFPageProxy | null
  task: ReturnType<PDFPageProxy['render']> | null
  textLayer: TextLayer | null
  canvas: HTMLCanvasElement | null
  text: HTMLDivElement | null
}

function isCancelled(err: unknown): boolean {
  return err instanceof Error && (err.name === 'RenderingCancelledException' || err.name === 'AbortException')
}

async function resolveOutline(doc: PDFDocumentProxy): Promise<PdfOutlineItem[]> {
  const outline = await doc.getOutline()
  if (!outline?.length) return []
  let nextId = 0
  type OutlineNode = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number]

  async function pageOf(dest: OutlineNode['dest']): Promise<number | null> {
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      if (!Array.isArray(explicit) || explicit.length === 0) return null
      const target: unknown = explicit[0]
      if (typeof target === 'number') return target + 1
      if (target && typeof target === 'object') {
        return (await doc.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1
      }
    } catch {
      // Broken destination — keep the entry, just not clickable.
    }
    return null
  }

  async function map(nodes: OutlineNode[], level: number): Promise<PdfOutlineItem[]> {
    return Promise.all(
      nodes.map(async (node) => ({
        id: `pdf-outline-${nextId++}`,
        label: node.title?.trim() || 'Untitled',
        page: await pageOf(node.dest),
        level,
        children: node.items?.length ? await map(node.items as OutlineNode[], level + 1) : [],
      })),
    )
  }

  return map(outline, 0)
}

export function PdfRenderer({
  data,
  zoom,
  getScrollRoot,
  initialPage = 1,
  apiRef,
  onNavState,
  onOutline,
}: PdfRendererProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  const slotsRef = useRef<(HTMLDivElement | null)[]>([])
  const renderedRef = useRef(new Map<number, RenderEntry>())
  /** 0-based page being read. */
  const currentRef = useRef(0)
  /** Page a navigation just scrolled to: it stays "current" while still on screen (end of doc). */
  const lockRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const restoredRef = useRef(false)
  /** Kept across a page-size refresh so the reader doesn't jump. */
  const anchorRef = useRef<{ index: number; fraction: number } | null>(null)

  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const getScrollRootRef = useRef(getScrollRoot)
  getScrollRootRef.current = getScrollRoot
  const onNavStateRef = useRef(onNavState)
  onNavStateRef.current = onNavState
  const onOutlineRef = useRef(onOutline)
  onOutlineRef.current = onOutline
  const initialPageRef = useRef(initialPage)
  const docRef = useRef(doc)
  docRef.current = doc
  const pageCountRef = useRef(0)
  pageCountRef.current = sizes.length

  const cssScale = PDF_TO_CSS * zoom
  const gap = Math.round(PAGE_GAP_PX * zoom)
  const pad = Math.round(PAD_PX * zoom)

  const reportCurrent = useCallback((index: number) => {
    currentRef.current = index
    onNavStateRef.current?.({ pageCurrent: index + 1, pageTotal: pageCountRef.current })
  }, [])

  const release = useCallback((index: number) => {
    const entry = renderedRef.current.get(index)
    if (!entry) return
    renderedRef.current.delete(index)
    entry.task?.cancel()
    entry.textLayer?.cancel()
    if (entry.canvas) {
      // Drop the backing store right away instead of waiting for GC.
      entry.canvas.width = 0
      entry.canvas.height = 0
      entry.canvas.remove()
    }
    entry.text?.remove()
    entry.page?.cleanup()
  }, [])

  const ensureRendered = useCallback((index: number, scale: number) => {
    const pdf = docRef.current
    if (!pdf) return
    const previous = renderedRef.current.get(index)
    if (previous && previous.scale === scale) return
    previous?.task?.cancel()
    previous?.textLayer?.cancel()
    // The previous canvas / text stay on screen (stretched to the new slot size) until replaced.
    const entry: RenderEntry = {
      scale,
      page: previous?.page ?? null,
      task: null,
      textLayer: null,
      canvas: previous?.canvas ?? null,
      text: previous?.text ?? null,
    }
    renderedRef.current.set(index, entry)
    const stale = () => renderedRef.current.get(index) !== entry

    void (async () => {
      const page = entry.page ?? (await pdf.getPage(index + 1))
      entry.page = page
      if (stale()) return
      const slot = slotsRef.current[index]
      if (!slot) return
      const viewport = page.getViewport({ scale })

      const canvas = document.createElement('canvas')
      const area = viewport.width * viewport.height
      let ratio = window.devicePixelRatio || 1
      if (area * ratio * ratio > MAX_CANVAS_PIXELS) ratio = Math.sqrt(MAX_CANVAS_PIXELS / area)
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.className = 'pointer-events-none absolute inset-0 block h-full w-full'
      entry.task = page.render({
        canvas,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      })
      await entry.task.promise
      if (stale()) {
        canvas.width = 0
        canvas.height = 0
        return
      }
      if (entry.canvas) {
        entry.canvas.width = 0
        entry.canvas.height = 0
        entry.canvas.remove()
      }
      slot.prepend(canvas)
      entry.canvas = canvas

      const text = document.createElement('div')
      text.className = 'textLayer'
      text.style.setProperty('--scale-factor', String(viewport.scale))
      text.style.setProperty('--user-unit', String(viewport.userUnit ?? 1))
      entry.textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: text,
        viewport,
      })
      await entry.textLayer.render()
      if (stale()) return
      entry.text?.remove()
      slot.append(text)
      entry.text = text
    })().catch((err: unknown) => {
      if (isCancelled(err)) return
      console.warn('[PdfRenderer] page render failed', index + 1, err)
    })
  }, [])

  /** Visible range + current page from the scroll container's geometry, then render / release. */
  const updateView = useCallback(() => {
    frameRef.current = null
    const root = getScrollRootRef.current()
    const slots = slotsRef.current
    const count = pageCountRef.current
    if (!root || !docRef.current || count === 0) return
    const rootRect = root.getBoundingClientRect()
    const top = rootRect.top
    const bottom = rootRect.top + root.clientHeight

    // First slot whose bottom edge is below the viewport top (slots are in document order).
    let lo = 0
    let hi = count - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const el = slots[mid]
      if (el && el.getBoundingClientRect().bottom <= top) lo = mid + 1
      else hi = mid
    }
    const first = lo
    let last = first
    let best = first
    let bestVisible = -1
    for (let i = first; i < count; i++) {
      const el = slots[i]
      if (!el) break
      const rect = el.getBoundingClientRect()
      if (rect.top >= bottom && i > first) break
      last = i
      const visible = Math.min(rect.bottom, bottom) - Math.max(rect.top, top)
      // Strictly greater: with several fully visible pages the first one is "current".
      if (visible > bestVisible + 0.5) {
        bestVisible = visible
        best = i
      }
    }

    const lock = lockRef.current
    if (lock !== null && lock >= first && lock <= last) best = lock
    else lockRef.current = null
    if (best !== currentRef.current) reportCurrent(best)

    const scale = PDF_TO_CSS * zoomRef.current
    for (let i = Math.max(0, first - RENDER_AHEAD); i <= Math.min(count - 1, last + RENDER_AHEAD); i++) {
      ensureRendered(i, scale)
    }
    for (const index of [...renderedRef.current.keys()]) {
      if (index < first - KEEP_AROUND || index > last + KEEP_AROUND) release(index)
    }
  }, [ensureRendered, release, reportCurrent])

  const scheduleUpdate = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(updateView)
  }, [updateView])

  const scrollToIndex = useCallback(
    (index: number) => {
      const root = getScrollRootRef.current()
      const count = pageCountRef.current
      if (!root || count === 0) return
      const target = Math.min(Math.max(index, 0), count - 1)
      const slot = slotsRef.current[target]
      if (!slot) return
      const offset = slot.getBoundingClientRect().top - root.getBoundingClientRect().top
      root.scrollTop += offset - Math.round(PAGE_GAP_PX * zoomRef.current)
      lockRef.current = target
      reportCurrent(target)
      scheduleUpdate()
    },
    [reportCurrent, scheduleUpdate],
  )

  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      goToPage: (page) => scrollToIndex(page - 1),
      nextPage: () => scrollToIndex(currentRef.current + 1),
      prevPage: () => scrollToIndex(currentRef.current - 1),
      getNavState: () => ({ pageCurrent: currentRef.current + 1, pageTotal: pageCountRef.current }),
      getCurrentLocation: () =>
        pageCountRef.current > 0 ? new PageRectLocation(currentRef.current + 1) : undefined,
    }
    return () => {
      apiRef.current = null
    }
  }, [apiRef, scrollToIndex])

  // Open the document. PDF.js transfers the buffer to its worker, so hand it a copy and keep the
  // caller's ArrayBuffer intact.
  useEffect(() => {
    setStatus({ kind: 'loading' })
    setDoc(null)
    setSizes([])
    restoredRef.current = false
    const task = getDocument({ data: new Uint8Array(data.slice(0)) })
    let cancelled = false
    const rendered = renderedRef.current

    void (async () => {
      try {
        const pdf = await task.promise
        if (cancelled) return
        const first = (await pdf.getPage(1)).getViewport({ scale: 1 })
        if (cancelled) return
        const base: PageSize = first.width > 0 ? { w: first.width, h: first.height } : FALLBACK_SIZE
        setSizes(Array.from({ length: pdf.numPages }, () => base))
        setDoc(pdf)
        setStatus({ kind: 'ready' })

        resolveOutline(pdf).then(
          (items) => {
            if (!cancelled) onOutlineRef.current?.(items)
          },
          () => {
            if (!cancelled) onOutlineRef.current?.([])
          },
        )

        // Measure every page in the background so mixed-size documents lay out exactly. One state
        // update at the end; the reading position is anchored across it.
        const measured: PageSize[] = []
        let differs = false
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return
          const vp = (await pdf.getPage(i)).getViewport({ scale: 1 })
          const size = { w: vp.width, h: vp.height }
          measured.push(size)
          if (Math.abs(size.w - base.w) > 0.5 || Math.abs(size.h - base.h) > 0.5) differs = true
          // Yield now and then so a 1000-page file doesn't hog the main thread.
          if (i % 50 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
        }
        if (cancelled || !differs) return
        const root = getScrollRootRef.current()
        const slot = slotsRef.current[currentRef.current]
        if (root && slot) {
          const rect = slot.getBoundingClientRect()
          const rootTop = root.getBoundingClientRect().top
          anchorRef.current = {
            index: currentRef.current,
            fraction: rect.height > 0 ? (rootTop - rect.top) / rect.height : 0,
          }
        }
        setSizes(measured)
      } catch (err) {
        if (cancelled || isCancelled(err)) return
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not open this PDF.' })
      }
    })()

    return () => {
      cancelled = true
      for (const index of [...rendered.keys()]) {
        const entry = rendered.get(index)
        rendered.delete(index)
        entry?.task?.cancel()
        entry?.textLayer?.cancel()
        if (entry?.canvas) {
          entry.canvas.width = 0
          entry.canvas.height = 0
        }
      }
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      // Destroys the document and terminates its worker-side state.
      void task.destroy()
    }
  }, [data])

  // First layout: jump to the saved page, then keep the reader's place across size refreshes.
  useLayoutEffect(() => {
    if (!doc || sizes.length === 0) return
    if (!restoredRef.current) {
      restoredRef.current = true
      const start = Math.min(Math.max(initialPageRef.current, 1), sizes.length) - 1
      if (start > 0) scrollToIndex(start)
      else reportCurrent(0)
      return
    }
    const anchor = anchorRef.current
    anchorRef.current = null
    const root = getScrollRootRef.current()
    const slot = anchor ? slotsRef.current[anchor.index] : null
    if (anchor && root && slot) {
      const rect = slot.getBoundingClientRect()
      root.scrollTop += rect.top + anchor.fraction * rect.height - root.getBoundingClientRect().top
    }
  }, [doc, sizes, reportCurrent, scrollToIndex])

  // Scroll / resize of the container, zoom and layout changes → recompute what's on screen.
  useEffect(() => {
    if (!doc) return
    const root = getScrollRootRef.current()
    if (!root) return
    root.addEventListener('scroll', scheduleUpdate, { passive: true })
    const resize = new ResizeObserver(scheduleUpdate)
    resize.observe(root)
    return () => {
      root.removeEventListener('scroll', scheduleUpdate)
      resize.disconnect()
    }
  }, [doc, scheduleUpdate])

  useEffect(() => {
    scheduleUpdate()
  }, [zoom, sizes, scheduleUpdate])

  if (status.kind === 'error') {
    return (
      <div className="flex h-full w-full" data-pdf-status="error">
        <p role="alert" className="m-auto text-sm">
          {status.message}
        </p>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col items-center"
      style={{ gap, padding: pad }}
      data-pdf-status={status.kind}
      data-pdf-pages={sizes.length}
    >
      {status.kind === 'loading' ? <p className="mt-6 text-sm">Loading PDF…</p> : null}
      {sizes.map((size, index) => (
        <div
          key={index}
          ref={(el) => {
            slotsRef.current[index] = el
          }}
          className="relative shrink-0 bg-white shadow"
          style={{ width: Math.floor(size.w * cssScale), height: Math.floor(size.h * cssScale) }}
          data-page-number={index + 1}
        />
      ))}
    </div>
  )
}

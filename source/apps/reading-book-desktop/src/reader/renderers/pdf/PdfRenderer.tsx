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
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  AnnotationMode,
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist'
import {
  PageRectLocation,
  pdfMarkAt,
  type InteractionTool,
  type ScannedPdfAnnotation,
  type TextMatcher,
} from '@reading-book/book-reader-sdk'
import {
  createHandHoverDwell,
  exceedsDragThreshold,
  isInCenterTapZone,
  type HandHoverDwell,
} from '../../interaction'
import { pickSectionMatch, rangeForMatch } from '../epub/search/epubSearchDom'
import {
  buildPdfTextLayerIndex,
  clearPdfSearchHighlights,
  paintPdfSearchHighlights,
  pdfPageSearchRanges,
} from './pdfSearchDom'
import { readPdfSelection, readPdfSelectionAt, type PdfSelectionInfo } from './pdfSelection'
import { attachTextLayerSelection, detachTextLayerSelection } from './pdfTextLayerSelection'
import { scanEmbeddedPdfAnnotations } from './pdfEmbeddedAnnotations'
import {
  PdfPageAnnotations,
  type PdfAnnotationFlash,
  type PdfAnnotationMark,
} from './PdfAnnotationLayer'
import { PAD_PX, PAGE_GAP_PX, PDF_TO_CSS, type PdfPageCssSize } from './pdfLayout'
// `?url` makes Vite emit the worker as a local asset in dist/ — never loaded from a CDN.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/** Pages rendered beyond the visible range in each direction. */
const RENDER_AHEAD = 2
/** Rendered pages farther than this from the visible range are released. */
const KEEP_AROUND = 6
/** Cap one canvas' backing store (high zoom × HiDPI) — the page just gets a little softer. */
const MAX_CANVAS_PIXELS = 16_777_216
/** How long a search jump waits for the target page's text layer before giving up on the hit. */
const TEXT_LAYER_WAIT_MS = 4000
/** How long a jumped-to annotation pulses. */
const ANNOTATION_FLASH_MS = 1200
/** Extra reach around an annotation rect for a click, in CSS px. */
const ANNOTATION_HIT_SLOP_PX = 2
/** Assumed page size (A4) until the first page is measured. */
const FALLBACK_SIZE: PageSize = { w: 595, h: 842 }

type PageSize = { w: number; h: number }


/** A click / right-click that landed on an annotation; `rect` = its box (client px) to anchor UI. */
export type PdfAnnotationHit = { id: string; rect: DOMRect }

/** Markup tools (Highlight / Underline / Strikethrough): a drag that selects text marks it. */
type MarkupTool = Extract<InteractionTool, 'highlight' | 'underline' | 'strikethrough'>

function markupToolOf(tool: InteractionTool): MarkupTool | null {
  return tool === 'highlight' || tool === 'underline' || tool === 'strikethrough' ? tool : null
}

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
  /**
   * Scroll 1-based `page` into view with the normalized `y` (0–1 of the page height) near the top
   * third of the view — an annotation's position. `y` undefined behaves like `goToPage`.
   */
  goToPagePoint: (page: number, y?: number) => void
  /** Pulse an annotation's marks (after a jump from the sidebar). */
  flashAnnotation: (id: string) => void
  nextPage: () => void
  prevPage: () => void
  getNavState: () => PdfNavState
  getCurrentLocation: () => PageRectLocation | undefined
  /** Paint every hit of `matcher` on the rendered pages (kept across re-renders / zoom), or clear. */
  setSearchHighlights: (matcher: TextMatcher | null) => void
  /**
   * Scroll to Main's `occurrence`-th of `count` matches on 0-based page `pageIndex` and mark it as
   * the current hit (falls back to the page when its text layer can't be matched).
   */
  goToSearchMatch: (target: PdfSearchTarget) => Promise<void>
  /** Drop a text selection made in the PDF; false when there was none (Escape falls through). */
  clearSelection: () => boolean
  /**
   * Rasterize 1-based `page` into a new canvas `cssWidth` CSS px wide (Page layout thumbnails).
   * Thumbnail renders run one at a time (shared queue); null when aborted or unavailable.
   */
  renderThumbnail: (page: number, cssWidth: number, signal: AbortSignal) => Promise<HTMLCanvasElement | null>
  /** Measure 1-based `page` from the document itself (its own size and rotation); null if unavailable. */
  measurePage: (page: number) => Promise<PdfPageCssSize | null>
}

export type PdfSearchTarget = { pageIndex: number; occurrence: number; count: number }

export interface PdfRendererProps {
  data: ArrayBuffer
  /** Reader view zoom (1 = 100%); pages are laid out and rasterized at this scale. */
  zoom: number
  /** The scroll container (Reader zoom viewport) — used for page tracking and navigation. */
  getScrollRoot: () => HTMLElement | null
  /** 1-based page to open at (restored reading position). */
  initialPage?: number
  /**
   * Toolbar tool. `hand`: the shared Hand model (grab cursor; I-beam after resting on text, then a
   * press on text selects; any other press drags the pages). Anything else (`select`, and the markup
   * tools PDF doesn't offer yet): native text selection on the PDF.js text layer.
   */
  interactionTool?: InteractionTool
  /** Hand drag deltas — the Reader scrolls its zoom viewport (the PDF's one scroll container). */
  onHandPanBy?: (dx: number, dy: number) => void
  /** A plain click (no drag, no selection) in the middle half of the page area. */
  onCenterTap?: () => void
  /**
   * Right-click inside a live text selection on the text layer, at client (`x`, `y`) — the
   * Reader's own window coordinates (no iframe / transform on the PDF surface). The native context
   * menu is always suppressed on the pages; a right-click anywhere else fires nothing.
   */
  onSelectionContextMenu?: (selection: PdfSelectionInfo, x: number, y: number) => void
  /** Text markup to paint (normalized rects, see PdfAnnotationLayer). */
  annotations?: readonly PdfAnnotationMark[]
  /** The annotation whose marks get the focus outline. */
  focusedAnnotationId?: string | null
  /** A plain click (no drag, no selection) on an annotation's mark / note icon. */
  onAnnotationClick?: (hit: PdfAnnotationHit) => void
  /** Right-click on an annotation (outside any live text selection). */
  onAnnotationContextMenu?: (hit: PdfAnnotationHit) => void
  /** A plain click that hit no annotation (anywhere on the pages) — dismisses annotation UI. */
  onBlankClick?: () => void
  /**
   * A Highlight / Underline / Strikethrough tool is armed and a press just ended with text
   * selected — the selection to mark with that tool.
   */
  onMarkupSelection?: (selection: PdfSelectionInfo, tool: MarkupTool) => void
  /**
   * Called once per opened document with the annotations embedded in the file (scanned in the
   * background, every open). Resolves to the `objectId`s the app now paints itself — their own
   * appearance is then hidden on the canvas so a mark isn't drawn twice — or null to change nothing.
   */
  onEmbeddedAnnotations?: (annotations: ScannedPdfAnnotation[]) => Promise<readonly string[] | null>
  apiRef?: MutableRefObject<PdfRendererApi | null>
  onNavState?: (state: PdfNavState) => void
  onOutline?: (items: PdfOutlineItem[]) => void
}

/** One primary-button press on the pages, from pointerdown to pointerup. */
type PointerGesture = {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  /** Travelled at least `PAN_DRAG_THRESHOLD_PX` — a drag, never a tap. */
  moved: boolean
  /** Hand press that pans (pointer captured, grabbing cursor) — not a text selection. */
  pan: boolean
}

/** Surface flags set imperatively (not through React) so CSS applies before the next event. */
type SurfaceFlag = 'data-pdf-hover-text' | 'data-pdf-grabbing' | 'data-pdf-has-selection'

function hasTextSelection(): boolean {
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed && selection.toString().trim() !== ''
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
  interactionTool = 'select',
  onHandPanBy,
  onCenterTap,
  onSelectionContextMenu,
  annotations,
  focusedAnnotationId = null,
  onAnnotationClick,
  onAnnotationContextMenu,
  onBlankClick,
  onMarkupSelection,
  onEmbeddedAnnotations,
  apiRef,
  onNavState,
  onOutline,
}: PdfRendererProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  const rootRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<PointerGesture | null>(null)
  const dwellRef = useRef<HandHoverDwell | null>(null)
  const hand = interactionTool === 'hand'
  const handRef = useRef(hand)
  handRef.current = hand
  const onHandPanByRef = useRef(onHandPanBy)
  onHandPanByRef.current = onHandPanBy
  const onCenterTapRef = useRef(onCenterTap)
  onCenterTapRef.current = onCenterTap
  const onSelectionContextMenuRef = useRef(onSelectionContextMenu)
  onSelectionContextMenuRef.current = onSelectionContextMenu
  const markupTool = markupToolOf(interactionTool)
  const markupToolRef = useRef(markupTool)
  markupToolRef.current = markupTool
  const onMarkupSelectionRef = useRef(onMarkupSelection)
  onMarkupSelectionRef.current = onMarkupSelection
  const onAnnotationClickRef = useRef(onAnnotationClick)
  onAnnotationClickRef.current = onAnnotationClick
  const onAnnotationContextMenuRef = useRef(onAnnotationContextMenu)
  onAnnotationContextMenuRef.current = onAnnotationContextMenu
  const onBlankClickRef = useRef(onBlankClick)
  onBlankClickRef.current = onBlankClick
  const onEmbeddedAnnotationsRef = useRef(onEmbeddedAnnotations)
  onEmbeddedAnnotationsRef.current = onEmbeddedAnnotations
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations

  /** Marks per 1-based page (a mark spanning pages is listed on each). */
  const marksByPage = useMemo(() => {
    const byPage = new Map<number, PdfAnnotationMark[]>()
    for (const mark of annotations ?? []) {
      for (const page of new Set(mark.rects.map((r) => r.page))) {
        const list = byPage.get(page)
        if (list) list.push(mark)
        else byPage.set(page, [mark])
      }
    }
    return byPage
  }, [annotations])
  const [flash, setFlash] = useState<PdfAnnotationFlash | null>(null)

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
  /** Search hits to paint (null = none) and the hit last jumped to. */
  const searchMatcherRef = useRef<TextMatcher | null>(null)
  const searchHitRef = useRef<PdfSearchTarget | null>(null)
  const searchFrameRef = useRef<number | null>(null)
  /** Jumps waiting for a page's text layer, by page index. */
  const textWaitersRef = useRef(new Map<number, Array<() => void>>())

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

  /**
   * Repaint search hits over every page that currently has a text layer. Returns the current hit's
   * Range (if its page is rendered) so a jump can scroll it into view.
   */
  const repaintSearch = useCallback((): Range | null => {
    searchFrameRef.current = null
    const matcher = searchMatcherRef.current
    if (!matcher) {
      clearPdfSearchHighlights(document)
      return null
    }
    const hit = searchHitRef.current
    const ranges: Range[] = []
    let current: Range | null = null
    const pages = [...renderedRef.current.entries()].sort((a, b) => a[0] - b[0])
    for (const [index, entry] of pages) {
      if (!entry.text) continue
      ranges.push(...pdfPageSearchRanges(entry.text, matcher))
      if (hit && hit.pageIndex === index) {
        const textIndex = buildPdfTextLayerIndex(entry.text)
        const match = pickSectionMatch(matcher.find(textIndex.text), hit.occurrence, hit.count)
        current = match ? rangeForMatch(document, textIndex, match) : null
      }
    }
    paintPdfSearchHighlights(document, ranges, current)
    return current
  }, [])

  const scheduleSearchRepaint = useCallback(() => {
    if (searchFrameRef.current !== null || !searchMatcherRef.current) return
    searchFrameRef.current = requestAnimationFrame(() => {
      repaintSearch()
    })
  }, [repaintSearch])

  const notifyTextLayer = useCallback(
    (index: number) => {
      const waiters = textWaitersRef.current.get(index)
      if (waiters) {
        textWaitersRef.current.delete(index)
        for (const resolve of waiters) resolve()
      }
      scheduleSearchRepaint()
    },
    [scheduleSearchRepaint],
  )

  /** Resolves once page `index` has an up-to-date text layer (or after a timeout). */
  const waitForTextLayer = useCallback((index: number): Promise<void> => {
    const entry = renderedRef.current.get(index)
    if (entry?.text && entry.scale === PDF_TO_CSS * zoomRef.current) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, TEXT_LAYER_WAIT_MS)
      const list = textWaitersRef.current.get(index) ?? []
      list.push(() => {
        window.clearTimeout(timer)
        resolve()
      })
      textWaitersRef.current.set(index, list)
    })
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
    detachTextLayerSelection(entry.text)
    entry.text?.remove()
    entry.page?.cleanup()
    scheduleSearchRepaint()
  }, [scheduleSearchRepaint])

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
        // Honors the `noView` entries `hideEmbeddedAnnotations` puts in the document's storage;
        // with none there it draws exactly like the default mode.
        annotationMode: AnnotationMode.ENABLE_STORAGE,
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
      const userUnit = viewport.userUnit ?? 1
      text.style.setProperty('--scale-factor', String(viewport.scale))
      text.style.setProperty('--user-unit', String(userUnit))
      // The text layer sizes its spans (and itself) from `--total-scale-factor`, which
      // pdf_viewer.css only defines under `.pdfViewer .page` — not used here. Without it the
      // invisible text drifts off the canvas, so a selection doesn't land on the visible words.
      text.style.setProperty('--total-scale-factor', String(viewport.scale * userUnit))
      entry.textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: text,
        viewport,
      })
      await entry.textLayer.render()
      if (stale()) return
      // pdf.js viewer's `.endOfContent` trick: dragging through gaps no longer jumps to the end.
      attachTextLayerSelection(text)
      detachTextLayerSelection(entry.text)
      entry.text?.remove()
      slot.append(text)
      entry.text = text
      notifyTextLayer(index)
    })().catch((err: unknown) => {
      if (isCancelled(err)) return
      console.warn('[PdfRenderer] page render failed', index + 1, err)
    })
  }, [notifyTextLayer])

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

  /**
   * Stop drawing the file's own appearance of embedded annotations the app now paints (or that the
   * user deleted in the app). Only the document in memory changes — never the file. Rendered pages
   * holding one are re-rendered; the old canvas stays up until the new one replaces it.
   */
  const hideEmbeddedAnnotations = useCallback(
    (pdf: PDFDocumentProxy, pageIndices: ReadonlySet<number>, objectIds: readonly string[]) => {
      if (docRef.current !== pdf) return
      for (const id of objectIds) pdf.annotationStorage.setValue(id, { noView: true })
      for (const index of pageIndices) {
        const entry = renderedRef.current.get(index)
        if (entry) entry.scale = -1
      }
      scheduleUpdate()
    },
    [scheduleUpdate],
  )

  // Embedded annotations: scan every time a document is opened (never "once per book" — the file
  // may have gained or changed annotations in another app since), then hand them to the reader.
  // One scan per loaded document; a newer document cancels it. Failures never affect reading.
  useEffect(() => {
    if (!doc || !onEmbeddedAnnotationsRef.current) return
    let cancelled = false
    void (async () => {
      try {
        const scanned = await scanEmbeddedPdfAnnotations(doc, () => cancelled)
        if (cancelled || scanned.length === 0) return
        const managed = await onEmbeddedAnnotationsRef.current?.(scanned)
        if (cancelled || !managed?.length) return
        const ids = new Set(managed)
        const pages = new Set(scanned.filter((a) => ids.has(a.objectId)).map((a) => a.pageIndex))
        hideEmbeddedAnnotations(doc, pages, managed)
      } catch (err) {
        if (!cancelled && !isCancelled(err)) console.warn('[PdfRenderer] embedded annotation import failed', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, hideEmbeddedAnnotations])

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

  /** Serialises thumbnail renders so a scrolled Page layout grid never floods PDF.js. */
  const thumbQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  const renderThumbnail = useCallback(
    (pageNumber: number, cssWidth: number, signal: AbortSignal): Promise<HTMLCanvasElement | null> => {
      const run = async (): Promise<HTMLCanvasElement | null> => {
        const pdf = docRef.current
        if (signal.aborted || !pdf || pageNumber < 1 || pageNumber > pdf.numPages || cssWidth <= 0) return null
        const page = await pdf.getPage(pageNumber)
        if (signal.aborted) return null
        const base = page.getViewport({ scale: 1 })
        const ratio = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: (cssWidth * ratio) / base.width })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(viewport.width))
        canvas.height = Math.max(1, Math.floor(viewport.height))
        const task = page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE_STORAGE })
        const cancel = () => task.cancel()
        signal.addEventListener('abort', cancel, { once: true })
        try {
          await task.promise
        } catch (err) {
          canvas.width = 0
          canvas.height = 0
          if (isCancelled(err)) return null
          throw err
        } finally {
          signal.removeEventListener('abort', cancel)
        }
        return signal.aborted ? null : canvas
      }
      const result = thumbQueueRef.current.then(run, run)
      thumbQueueRef.current = result.catch(() => null)
      return result
    },
    [],
  )

  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      renderThumbnail,
      measurePage: async (pageNumber) => {
        const pdf = docRef.current
        if (!pdf || pageNumber < 1 || pageNumber > pdf.numPages) return null
        const viewport = (await pdf.getPage(pageNumber)).getViewport({ scale: 1 })
        return { width: viewport.width * PDF_TO_CSS, height: viewport.height * PDF_TO_CSS }
      },
      goToPage: (page) => scrollToIndex(page - 1),
      goToPagePoint: (page, y) => {
        scrollToIndex(page - 1)
        const root = getScrollRootRef.current()
        const slot = slotsRef.current[page - 1]
        if (y === undefined || !root || !slot) return
        // The page top is now at the top of the view; bring a point lower down to the upper third
        // (a point already in the upper third keeps the page top visible).
        const rect = slot.getBoundingClientRect()
        const shift = rect.top + y * rect.height - root.getBoundingClientRect().top - root.clientHeight / 3
        if (shift > 0) root.scrollTop += shift
      },
      flashAnnotation: (id) => setFlash({ id, nonce: Date.now() }),
      nextPage: () => scrollToIndex(currentRef.current + 1),
      prevPage: () => scrollToIndex(currentRef.current - 1),
      getNavState: () => ({ pageCurrent: currentRef.current + 1, pageTotal: pageCountRef.current }),
      getCurrentLocation: () =>
        pageCountRef.current > 0 ? new PageRectLocation(currentRef.current + 1) : undefined,
      setSearchHighlights: (matcher) => {
        searchMatcherRef.current = matcher
        if (!matcher) searchHitRef.current = null
        repaintSearch()
      },
      goToSearchMatch: async (target) => {
        searchHitRef.current = target
        scrollToIndex(target.pageIndex)
        await waitForTextLayer(target.pageIndex)
        // A newer jump (rapid Next) or a cleared search took over meanwhile.
        if (searchHitRef.current !== target) return
        const current = repaintSearch()
        const root = getScrollRootRef.current()
        if (!current || !root) return
        const rect = current.getBoundingClientRect()
        const rootRect = root.getBoundingClientRect()
        // Bring the hit to the upper third unless it is already comfortably on screen.
        if (rect.top < rootRect.top || rect.bottom > rootRect.top + root.clientHeight) {
          root.scrollTop += rect.top - rootRect.top - root.clientHeight / 3
        }
      },
      clearSelection: () => {
        const selection = window.getSelection()
        const pages = rootRef.current
        if (!selection || selection.isCollapsed || !pages?.contains(selection.anchorNode)) return false
        selection.removeAllRanges()
        return true
      },
    }
    return () => {
      apiRef.current = null
    }
  }, [apiRef, scrollToIndex, repaintSearch, waitForTextLayer, renderThumbnail])

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
    const textWaiters = textWaitersRef.current

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
        detachTextLayerSelection(entry?.text)
        if (entry?.canvas) {
          entry.canvas.width = 0
          entry.canvas.height = 0
        }
      }
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      if (searchFrameRef.current !== null) cancelAnimationFrame(searchFrameRef.current)
      searchFrameRef.current = null
      textWaiters.clear()
      clearPdfSearchHighlights(document)
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

  const setSurfaceFlag = useCallback((flag: SurfaceFlag, on: boolean) => {
    rootRef.current?.toggleAttribute(flag, on)
  }, [])

  // Hand hover dwell (shared rules, `reader/interaction/hand-gesture.ts`): arms the I-beam over
  // text after HAND_HOVER_CURSOR_DELAY_MS — CSS `[data-pdf-hover-text]` in index.css.
  useEffect(() => {
    const dwell = createHandHoverDwell((armed) => setSurfaceFlag('data-pdf-hover-text', armed))
    dwellRef.current = dwell
    return () => {
      dwell.dispose()
      dwellRef.current = null
    }
  }, [setSurfaceFlag])

  // A jump's pulse ends on its own (a newer flash restarts the timer).
  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), ANNOTATION_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])

  /**
   * The annotation under client (`x`, `y`): a note icon first (small, may sit past the page edge),
   * then the topmost mark rect on the page there. Marks never take pointer events themselves.
   */
  const annotationAt = (x: number, y: number): PdfAnnotationHit | null => {
    const marks = annotationsRef.current
    const root = rootRef.current
    if (!marks?.length || !root) return null
    const within = (r: DOMRect) =>
      x >= r.left - ANNOTATION_HIT_SLOP_PX &&
      x <= r.right + ANNOTATION_HIT_SLOP_PX &&
      y >= r.top - ANNOTATION_HIT_SLOP_PX &&
      y <= r.bottom + ANNOTATION_HIT_SLOP_PX
    for (const icon of root.querySelectorAll<HTMLElement>('[data-pdf-annot-note]')) {
      const rect = icon.getBoundingClientRect()
      if (icon.dataset.pdfAnnotId && within(rect)) return { id: icon.dataset.pdfAnnotId, rect }
    }
    const slot = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-page-number]')
    if (!slot || !root.contains(slot)) return null
    const box = slot.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return null
    const mark = pdfMarkAt(
      marks.filter((m) => m.styleKind !== 'textbox'),
      Number(slot.dataset.pageNumber),
      (x - box.left) / box.width,
      (y - box.top) / box.height,
      ANNOTATION_HIT_SLOP_PX / box.width,
      ANNOTATION_HIT_SLOP_PX / box.height,
    )
    if (!mark) return null
    // Anchor UI to the mark's boxes on this page (their union).
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const el of slot.querySelectorAll<HTMLElement>(`[data-pdf-annot-id="${CSS.escape(mark.id)}"]`)) {
      const r = el.getBoundingClientRect()
      left = Math.min(left, r.left)
      top = Math.min(top, r.top)
      right = Math.max(right, r.right)
      bottom = Math.max(bottom, r.bottom)
    }
    const rect = Number.isFinite(left) ? new DOMRect(left, top, right - left, bottom - top) : new DOMRect(x, y, 0, 0)
    return { id: mark.id, rect }
  }

  // While the PDF holds a text selection, keep its text selectable (CSS `[data-pdf-has-selection]`).
  // Hand only allows selection while the pointer rests on text; without this, moving off the text —
  // e.g. into the selection menu — turned `user-select` back to none, and Chromium stops painting
  // (and `toString()`-ing) a selection inside user-select:none content, so it looked lost.
  useEffect(() => {
    const update = () => {
      const selection = window.getSelection()
      const root = rootRef.current
      setSurfaceFlag(
        'data-pdf-has-selection',
        !!selection && !selection.isCollapsed && !!root?.contains(selection.anchorNode),
      )
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [setSurfaceFlag])

  /** PDF hit-test for the dwell: a glyph run of the text layer (no link layer is rendered). */
  const isTextAt = (clientX: number, clientY: number): boolean => {
    const span = document.elementFromPoint(clientX, clientY)?.closest('.textLayer span')
    return !!span && !!rootRef.current?.contains(span)
  }

  /** Forget the current press; a pan also gives the pointer back and drops the grabbing cursor. */
  const endGesture = useCallback((): PointerGesture | null => {
    const gesture = gestureRef.current
    gestureRef.current = null
    if (gesture?.pan) {
      const el = rootRef.current
      try {
        if (el?.hasPointerCapture(gesture.pointerId)) el.releasePointerCapture(gesture.pointerId)
      } catch {
        /* element already detached */
      }
    }
    setSurfaceFlag('data-pdf-grabbing', false)
    return gesture
  }, [setSurfaceFlag])

  // Switching Hand ↔ Select mid-press (or unmounting) ends that press and drops the I-beam.
  useEffect(
    () => () => {
      endGesture()
      dwellRef.current?.disarm()
    },
    [hand, endGesture],
  )

  // Window blur mid-drag (Alt+Tab): no pointerup will come — end the press, back to grab.
  useEffect(() => {
    const onBlur = () => {
      endGesture()
      dwellRef.current?.disarm()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [endGesture])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return
    // Hand: a press on text the dwell has armed selects natively; every other press pans.
    const pan =
      handRef.current &&
      !(dwellRef.current?.isArmed() && isTextAt(event.clientX, event.clientY))
    if (pan) {
      dwellRef.current?.disarm()
      // Synchronously, so `user-select: none` is in place before a selection could start.
      setSurfaceFlag('data-pdf-grabbing', true)
      event.preventDefault()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
    }
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      pan,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture) {
      // Hover (no button): feed the dwell. Never while a press is in progress.
      if (handRef.current && (event.buttons & 1) === 0) {
        dwellRef.current?.update(isTextAt(event.clientX, event.clientY))
      }
      return
    }
    if (event.pointerId !== gesture.pointerId) return
    if ((event.buttons & 1) === 0) {
      // Released somewhere we never heard about (e.g. outside the window while selecting).
      endGesture()
      return
    }
    const dx = event.clientX - gesture.lastX
    const dy = event.clientY - gesture.lastY
    gesture.lastX = event.clientX
    gesture.lastY = event.clientY
    if (
      !gesture.moved &&
      exceedsDragThreshold(gesture.startX, gesture.startY, event.clientX, event.clientY)
    ) {
      gesture.moved = true
    }
    if (!gesture.pan) return
    if (onHandPanByRef.current) {
      onHandPanByRef.current(dx, dy)
    } else {
      const root = getScrollRootRef.current()
      if (root) {
        root.scrollLeft -= dx
        root.scrollTop -= dy
      }
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || event.pointerId !== gesture.pointerId) return
    endGesture()
    if (event.button !== 0) return
    // Markup tool armed: a press that leaves text selected (drag, double / triple click) marks it.
    const tool = markupToolRef.current
    if (tool && !gesture.pan && rootRef.current) {
      const selection = readPdfSelection(rootRef.current)
      if (selection) {
        onMarkupSelectionRef.current?.(selection, tool)
        return
      }
    }
    if (gesture.moved) return
    // A press that leaves a selection behind (double / triple click on text) is not a tap. A pan
    // press can't select, so an older selection there is just what the tap should clear.
    if (!gesture.pan && hasTextSelection()) return
    const hit = annotationAt(event.clientX, event.clientY)
    if (hit) {
      onAnnotationClickRef.current?.(hit)
      return
    }
    onBlankClickRef.current?.()
    const root = getScrollRootRef.current()
    if (root && isInCenterTapZone(event.clientX, root.getBoundingClientRect())) {
      onCenterTapRef.current?.()
    }
  }

  // Like the EPUB surface: never the native menu on the pages; inside a selection, ours; on an
  // annotation (outside a selection), that annotation's menu.
  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const root = rootRef.current
    if (!root) return
    const selection = readPdfSelectionAt(root, event.clientX, event.clientY)
    if (selection) {
      onSelectionContextMenuRef.current?.(selection, event.clientX, event.clientY)
      return
    }
    const hit = annotationAt(event.clientX, event.clientY)
    if (hit) onAnnotationContextMenuRef.current?.(hit)
  }

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
      ref={rootRef}
      // Cursor + text selection per tool come from `[data-pdf-tool]` rules in index.css (they must
      // beat pdf_viewer.css, and `ReaderShell` is `select-none` for the whole reader).
      className="flex flex-col items-center"
      style={{ gap, padding: pad }}
      data-pdf-status={status.kind}
      data-pdf-pages={sizes.length}
      data-pdf-tool={hand ? 'hand' : 'select'}
      // Highlight / Underline / Strikethrough: Select's surface with the tool's pen cursor.
      data-pdf-markup={markupTool ?? undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => void endGesture()}
      onContextMenu={onContextMenu}
      onLostPointerCapture={() => {
        if (gestureRef.current?.pan) endGesture()
      }}
      onPointerLeave={() => {
        if (!gestureRef.current) dwellRef.current?.update(false)
      }}
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
          // Ctrl+wheel / toolbar zoom anchors to the page under the focal point (ReaderZoomViewport).
          data-zoom-anchor=""
        >
          {marksByPage.has(index + 1) ? (
            <PdfPageAnnotations
              page={index + 1}
              marks={marksByPage.get(index + 1)!}
              focusedId={focusedAnnotationId}
              flash={flash}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}

import {
  Component,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  classifyMdImageSrc,
  classifyMdLink,
  collectMdReferenceDefinitions,
  findHeadingForAnchor,
  splitMdSource,
} from '@reading-book/book-reader-sdk'
import { mdReadingLocation, type MarkupInteractionTool, type MdHeadingInfo, type MdPoint } from '@reading-book/book-reader-sdk'
import type { TextSurfaceApi } from '../textSurface'
import {
  boxOfRange,
  clearMdMarkPaint,
  insertionPointAt,
  lineBoxOfCollapsed,
  markAtPoint,
  paintMdMarks,
  pointAtTop,
  rangeForAnchor,
  readMdSelection,
  type MdInsertionInfo,
  type MdMark,
  type MdPainted,
  type MdSelectionInfo,
} from './mdAnnotations'
import { mdAssetUrl } from './mdSource'
import './md.css'

type MarginMode = 'narrow' | 'normal' | 'wide' | 'off'

// Same column widths as the TXT surface, so switching between the two feels the same.
const MARGIN: Record<MarginMode, string> = {
  narrow: 'max-w-[580px]',
  normal: 'max-w-[680px]',
  wide: 'max-w-[780px]',
  off: 'max-w-full px-3',
}

const MARGIN_IMMERSIVE: Record<MarginMode, string> = {
  narrow: 'max-w-[min(760px,92vw)]',
  normal: 'max-w-[min(960px,94vw)]',
  wide: 'max-w-[min(1140px,96vw)]',
  off: 'max-w-full px-4 sm:px-6',
}

/** Id of the not-yet-saved Inserted Text caret among the painted marks. */
const DRAFT_CARET_ID = 'md-draft-caret'

/** Pieces of a long document mounted right away; the rest follow one per tick. */
const EAGER_SEGMENTS = 2

export type MdRendererApi = TextSurfaceApi & {
  /** Scroll to the N-th heading of the document (mounts the rest first when it is not there yet). */
  scrollToHeading: (index: number) => void
  /** Scroll to an annotation (mounts the rest of a long document first when it is not there yet). */
  scrollToAnnotation: (id: string) => void
}

/** What a click / hover on an annotation reports: its id and the box to anchor a popup to. */
export type MdAnnotationHit = { id: string; rect: DOMRect }

/** A caret drawn for an Inserted Text mark (client geometry already converted to the overlay's space). */
type CaretBox = { id: string; left: number; top: number; width: number; height: number; color: string }

export type MdRendererProps = {
  bookId: string
  /** Canonical Markdown text (see `decodeMdSource`). */
  source: string
  /** The file was not valid UTF-8 and some characters were replaced. */
  lossy: boolean
  margin: MarginMode
  chromeHidden: boolean
  /** A tap in the margins around the text: toggle the chrome. */
  onMarginClick: () => void
  /** Share scrolled, 0–1. */
  onProgress: (fraction: number) => void
  /** Open an http(s) / mailto link (goes to Main, which validates it again). */
  onOpenExternal: (url: string) => void
  /** The headings now in the page, in reading order (grows while a long document mounts). */
  onHeadings?: (headings: MdHeadingInfo[]) => void
  /** The heading the reader is in (index among all headings), null before the first one. */
  onActiveHeading?: (index: number | null) => void
  /** An in-document link (`#id`) whose target heading does not exist. */
  onAnchorNotFound?: (anchor: string) => void
  /** How many pieces of a long document to mount at once (tests render everything). */
  eagerSegments?: number
  /** Where to open: the text point saved with the reading session (undefined = the top). */
  initialPoint?: MdPoint
  /** The text point at the top of the reading area changed (scroll). Not sent until the saved spot is restored. */
  onLocation?: (point: MdPoint) => void
  /** Saved annotations to paint (each carries its anchor; stale ones are skipped). */
  annotations?: readonly MdMark[]
  /** An Inserted Text caret that is placed but not saved yet. */
  draftCaret?: { point: MdPoint; colorHex: string } | null
  focusedAnnotationId?: string | null
  /** An armed markup tool: a drag marks instead of just selecting. */
  markupTool?: MarkupInteractionTool | null
  onMarkupSelection?: (selection: MdSelectionInfo, tool: MarkupInteractionTool) => void
  /** Insert Text tool: a click at an insertion point. */
  onInsertPoint?: (info: MdInsertionInfo) => void
  /** Right-click inside a text selection. */
  onSelectionContextMenu?: (selection: MdSelectionInfo, x: number, y: number) => void
  onAnnotationClick?: (hit: MdAnnotationHit) => void
  onAnnotationContextMenu?: (hit: MdAnnotationHit) => void
  /** The pointer moved onto (hit) or off (null) an annotation — drives the Replace / Insert preview. */
  onAnnotationHover?: (hit: MdAnnotationHit | null) => void
  /** A plain click on text with no annotation under it. */
  onBlankClick?: () => void
  /** The reading area scrolled (a popup anchored to a point on screen should close). */
  onScrolled?: () => void
  apiRef?: MutableRefObject<MdRendererApi | null>
}

/**
 * A parser/renderer failure must never take the Reader down: the piece that failed is shown as
 * plain text with a notice, the rest of the document is unaffected.
 */
class MdErrorBoundary extends Component<
  { resetKey: string; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidUpdate(prev: { resetKey: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function MdImage({ bookId, src, alt, title }: { bookId: string; src?: string; alt?: string; title?: string }) {
  const [failed, setFailed] = useState(false)
  const ref = classifyMdImageSrc(src)
  if (ref.kind !== 'relative') {
    const why =
      ref.reason === 'remote'
        ? 'Remote images are blocked.'
        : 'Only images next to the document can be shown.'
    return (
      <span className="md-image-blocked" title={why} data-md-image="blocked">
        [Image not shown{alt ? `: ${alt}` : ''}]
      </span>
    )
  }
  if (failed) {
    return (
      <span className="md-image-blocked" title="The image could not be loaded." data-md-image="missing">
        [Image not found{alt ? `: ${alt}` : ''}]
      </span>
    )
  }
  return (
    <img
      src={mdAssetUrl(bookId, ref.path)}
      alt={alt ?? ''}
      title={title}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      data-md-image="ok"
      onError={() => setFailed(true)}
    />
  )
}

/** One independently parsed piece of the document. Memoised: scrolling never re-parses it. */
const MdSegment = memo(function MdSegment({ text, components }: { text: string; components: Components }) {
  return (
    <MdErrorBoundary
      resetKey={String(text.length)}
      fallback={
        <>
          <p className="md-notice" role="status">
            This part could not be formatted, so it is shown as plain text.
          </p>
          <pre className="md-plain">{text}</pre>
        </>
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        // Our own policy lives in `components.a` / `components.img`; every URL reaches them untouched.
        urlTransform={(url) => url}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </MdErrorBoundary>
  )
})

/**
 * Read-only Markdown surface (docs/implementation_plan/markdown_reader.md). The text is parsed by
 * react-markdown into React elements — never `innerHTML`. Raw HTML in the file is dropped
 * (`skipHtml`), links never navigate the window (no `href` is rendered; clicks go through the SDK
 * link policy), images are only shown when they sit next to the document (served by Main).
 * A long document is split at safe boundaries and mounted piece by piece so the window stays
 * responsive while it is parsed.
 */
export function MdRenderer({
  bookId,
  source,
  lossy,
  margin,
  chromeHidden,
  onMarginClick,
  onProgress,
  onOpenExternal,
  onHeadings,
  onActiveHeading,
  onAnchorNotFound,
  eagerSegments = EAGER_SEGMENTS,
  initialPoint,
  onLocation,
  annotations,
  draftCaret,
  focusedAnnotationId,
  markupTool,
  onMarkupSelection,
  onInsertPoint,
  onSelectionContextMenu,
  onAnnotationClick,
  onAnnotationContextMenu,
  onAnnotationHover,
  onBlankClick,
  onScrolled,
  apiRef,
}: MdRendererProps) {
  const scrollerRef = useRef<HTMLElement | null>(null)
  const articleRef = useRef<HTMLElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  const onOpenExternalRef = useRef(onOpenExternal)
  onOpenExternalRef.current = onOpenExternal
  const onHeadingsRef = useRef(onHeadings)
  onHeadingsRef.current = onHeadings
  const onActiveHeadingRef = useRef(onActiveHeading)
  onActiveHeadingRef.current = onActiveHeading
  const onAnchorNotFoundRef = useRef(onAnchorNotFound)
  onAnchorNotFoundRef.current = onAnchorNotFound
  const marginRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const markupToolRef = useRef(markupTool ?? null)
  markupToolRef.current = markupTool ?? null
  const handlersRef = useRef({
    onMarkupSelection,
    onInsertPoint,
    onSelectionContextMenu,
    onAnnotationClick,
    onAnnotationContextMenu,
    onAnnotationHover,
    onBlankClick,
    onScrolled,
  })
  handlersRef.current = {
    onMarkupSelection,
    onInsertPoint,
    onSelectionContextMenu,
    onAnnotationClick,
    onAnnotationContextMenu,
    onAnnotationHover,
    onBlankClick,
    onScrolled,
  }
  const paintedRef = useRef<MdPainted | null>(null)
  const markOrderRef = useRef<string[]>([])
  const pendingAnnotationRef = useRef<string | null>(null)
  const [caretBoxes, setCaretBoxes] = useState<CaretBox[]>([])
  const [layoutTick, setLayoutTick] = useState(0)
  const headingElsRef = useRef<HTMLElement[]>([])
  const headingsKeyRef = useRef('')
  const activeRef = useRef<number | null | undefined>(undefined)

  const pieces = useMemo(() => {
    const parts = splitMdSource(source)
    const definitions = parts.length > 1 ? collectMdReferenceDefinitions(source) : ''
    return parts.map((part) => (definitions ? `${part}\n\n${definitions}\n` : part))
  }, [source])
  const total = pieces.length
  // Pieces up to the saved position must exist before it can be scrolled to.
  const [mounted, setMounted] = useState(() =>
    Math.min(total, Math.max(1, eagerSegments, (initialPoint?.segment ?? -1) + 1)),
  )
  /** False until the saved position has been scrolled to (or there is none to restore). */
  const restoredRef = useRef(!initialPoint)
  const lastPointRef = useRef<MdPoint | null>(null)
  const onLocationRef = useRef(onLocation)
  onLocationRef.current = onLocation
  const pendingRef = useRef<{ anchor?: string; fraction?: number; heading?: number }>({})

  // A different document starts again from its first pieces.
  const sourceRef = useRef(source)
  useEffect(() => {
    if (sourceRef.current === source) return
    sourceRef.current = source
    setMounted(Math.min(total, Math.max(1, eagerSegments)))
  }, [source, total, eagerSegments])

  // Mount the rest one piece per tick, yielding to input and painting in between.
  useEffect(() => {
    if (mounted >= total) return
    const timer = window.setTimeout(() => setMounted((m) => Math.min(total, m + 1)), 40)
    return () => window.clearTimeout(timer)
  }, [mounted, total])

  const progress = useCallback((): number => {
    const scroller = scrollerRef.current
    if (!scroller) return 0
    const range = scroller.scrollHeight - scroller.clientHeight
    return range <= 0 ? 0 : Math.min(1, Math.max(0, scroller.scrollTop / range))
  }, [])

  /** The last heading whose top has reached the top of the reading area. */
  const updateActiveHeading = useCallback(() => {
    const scroller = scrollerRef.current
    const els = headingElsRef.current
    if (!scroller || els.length === 0) return
    // A heading counts as reached once it is in the top part of the reading area (the page has top
    // padding, so a heading at the very start sits a little below the edge).
    const top = scroller.getBoundingClientRect().top + Math.min(120, scroller.clientHeight * 0.25)
    let lo = 0
    let hi = els.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (els[mid]!.getBoundingClientRect().top <= top) {
        found = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    const next = found < 0 ? null : found
    if (activeRef.current === next) return
    activeRef.current = next
    onActiveHeadingRef.current?.(next)
  }, [])

  /** The text point at the top of the reading area (what a saved session reopens on). */
  const currentPoint = useCallback((): MdPoint | null => {
    const scroller = scrollerRef.current
    const article = articleRef.current
    if (!scroller || !article) return null
    const outer = scroller.getBoundingClientRect()
    const inner = article.getBoundingClientRect()
    return pointAtTop(article, inner.left + Math.min(inner.width / 2, 200), outer.top)
  }, [])

  const reportLocation = useCallback(() => {
    if (!restoredRef.current) return
    const point = currentPoint()
    if (!point) return
    const last = lastPointRef.current
    if (last && last.segment === point.segment && last.offset === point.offset) return
    lastPointRef.current = point
    onLocationRef.current?.(point)
  }, [currentPoint])

  const reportProgress = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      onProgressRef.current(progress())
      updateActiveHeading()
      reportLocation()
    })
  }, [progress, updateActiveHeading, reportLocation])

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  /**
   * Put `el` at the top of THIS surface's own scroll area. Not `scrollIntoView` (it can also scroll
   * ancestors, and the window) and not `window.scrollTo`: only the reading area moves. Rect deltas are
   * divided by the viewport zoom (a CSS transform scales rects but not `scrollTop`).
   */
  const scrollElementToTop = useCallback((el: HTMLElement) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const box = scroller.getBoundingClientRect()
    const scale = scroller.offsetHeight > 0 && box.height > 0 ? box.height / scroller.offsetHeight : 1
    const delta = (el.getBoundingClientRect().top - box.top) / scale
    scroller.scrollTop += delta - 16
  }, [])

  const scrollToAnchorNow = useCallback((anchor: string): boolean => {
    const article = articleRef.current
    if (!article) return false
    const headings = Array.from(article.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
    const index = findHeadingForAnchor(
      headings.map((h) => h.textContent ?? ''),
      anchor,
    )
    if (index < 0) return false
    scrollElementToTop(headings[index]!)
    return true
  }, [scrollElementToTop])

  const scrollToHeadingNow = useCallback((index: number): boolean => {
    const el = headingElsRef.current[index]
    if (!el) return false
    scrollElementToTop(el)
    return true
  }, [scrollElementToTop])

  const scrollToFractionNow = useCallback((fraction: number) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * Math.min(1, Math.max(0, fraction))
  }, [])

  // Reopen where the reader left off: once the saved piece is in the page, put its line at the top.
  useLayoutEffect(() => {
    if (restoredRef.current) return
    const article = articleRef.current
    const scroller = scrollerRef.current
    if (!article || !scroller || !initialPoint) {
      restoredRef.current = true
      return
    }
    const range = rangeForAnchor(article, initialPoint, initialPoint)
    if (!range) {
      // Not mounted yet: wait for it; a point that never appears (the file shrank) just opens at the top.
      if (mounted >= total) restoredRef.current = true
      return
    }
    const line = lineBoxOfCollapsed(range)
    if (line) {
      const outer = scroller.getBoundingClientRect()
      const scale = scroller.offsetHeight > 0 && outer.height > 0 ? outer.height / scroller.offsetHeight : 1
      scroller.scrollTop += (line.top - outer.top) / scale - 12
    }
    restoredRef.current = true
    lastPointRef.current = initialPoint
    reportProgress()
  }, [mounted, total, source, initialPoint, reportProgress])

  // Seeking or following an anchor needs the whole document in place: mount the rest first.
  useLayoutEffect(() => {
    // Headings now in the page (the outline grows while a long document mounts).
    const article = articleRef.current
    const els = article ? Array.from(article.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')) : []
    headingElsRef.current = els
    const infos: MdHeadingInfo[] = els.map((el) => ({
      level: Number(el.tagName.slice(1)),
      text: el.textContent ?? '',
    }))
    const key = infos.map((i) => `${i.level}:${i.text}`).join('\u0001')
    if (key !== headingsKeyRef.current) {
      headingsKeyRef.current = key
      onHeadingsRef.current?.(infos)
    }
    onProgressRef.current(progress())
    updateActiveHeading()
    if (mounted < total) return
    const pending = pendingRef.current
    pendingRef.current = {}
    if (pending.anchor !== undefined) {
      // The whole document is mounted now: a miss is final.
      if (!scrollToAnchorNow(pending.anchor)) onAnchorNotFoundRef.current?.(pending.anchor)
    }
    else if (pending.heading !== undefined) scrollToHeadingNow(pending.heading)
    else if (pending.fraction !== undefined) scrollToFractionNow(pending.fraction)
  }, [mounted, total, source, progress, updateActiveHeading, scrollToAnchorNow, scrollToHeadingNow, scrollToFractionNow])

  const marks = useMemo<readonly MdMark[]>(() => {
    const base = annotations ?? []
    if (!draftCaret) return base
    const { point, colorHex } = draftCaret
    return [
      ...base,
      {
        id: DRAFT_CARET_ID,
        styleKind: 'insert' as const,
        colorHex,
        startSegment: point.segment,
        startOffset: point.offset,
        endSegment: point.segment,
        endOffset: point.offset,
        caret: true as const,
      },
    ]
  }, [annotations, draftCaret])

  /** Put an annotation near the top of the reading area (false while its piece is not mounted). */
  const scrollToMarkNow = useCallback((id: string): boolean => {
    const scroller = scrollerRef.current
    const painted = paintedRef.current
    if (!scroller || !painted) return false
    const range = painted.ranges.get(id) ?? painted.carets.find((c) => c.id === id)?.range
    if (!range) return false
    const box = boxOfRange(range) ?? lineBoxOfCollapsed(range)
    if (!box) return false
    const outer = scroller.getBoundingClientRect()
    const scale = scroller.offsetHeight > 0 && outer.height > 0 ? outer.height / scroller.offsetHeight : 1
    scroller.scrollTop += (box.top - outer.top) / scale - Math.min(120, scroller.clientHeight * 0.25)
    return true
  }, [])

  // Paint the marks and place the insertion carets whenever pieces mount, marks change or the layout moves.
  useLayoutEffect(() => {
    const article = articleRef.current
    const margin = marginRef.current
    if (!article || !margin) return
    const painted = paintMdMarks(article, marks)
    paintedRef.current = painted
    markOrderRef.current = marks.map((m) => m.id)
    const base = margin.getBoundingClientRect()
    const scale = margin.offsetWidth > 0 && base.width > 0 ? base.width / margin.offsetWidth : 1
    const colors = new Map(marks.map((m) => [m.id, m.colorHex]))
    const boxes: CaretBox[] = []
    for (const { id, range } of painted.carets) {
      const line = lineBoxOfCollapsed(range)
      if (!line) continue
      const width = line.height * 0.6
      const height = line.height * 0.55
      boxes.push({
        id,
        left: (line.left - width / 2 - base.left) / scale,
        top: (line.bottom - line.height * 0.25 - base.top) / scale,
        width: width / scale,
        height: height / scale,
        color: colors.get(id) ?? '#ec407a',
      })
    }
    setCaretBoxes((prev) =>
      prev.length === boxes.length &&
      prev.every((b, i) => {
        const n = boxes[i]!
        return b.id === n.id && Math.abs(b.left - n.left) < 0.5 && Math.abs(b.top - n.top) < 0.5 && b.color === n.color
      })
        ? prev
        : boxes,
    )
    const pending = pendingAnnotationRef.current
    if (pending && (scrollToMarkNow(pending) || mounted >= total)) pendingAnnotationRef.current = null
  }, [marks, mounted, total, source, layoutTick, margin, chromeHidden, scrollToMarkNow])

  // Marks live in the page-wide highlight registry: drop them when this surface goes away.
  useEffect(() => () => clearMdMarkPaint(), [])

  // Wrapping, font and window changes move the text without touching React: re-place the carets.
  useEffect(() => {
    const article = articleRef.current
    if (!article || typeof ResizeObserver === 'undefined') return
    let frame: number | null = null
    const observer = new ResizeObserver(() => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        setLayoutTick((t) => t + 1)
      })
    })
    observer.observe(article)
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])

  /** The annotation under client (`x`, `y`): an insertion caret first, then the topmost painted text mark. */
  const hitAt = useCallback((x: number, y: number, caretsOnly = false): MdAnnotationHit | null => {
    const overlay = overlayRef.current
    if (overlay) {
      for (const el of overlay.querySelectorAll<HTMLElement>('[data-md-caret-id]')) {
        const r = el.getBoundingClientRect()
        const id = el.dataset.mdCaretId
        if (id && id !== DRAFT_CARET_ID && x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 3 && y <= r.bottom + 3) {
          return { id, rect: r }
        }
      }
    }
    const painted = paintedRef.current
    if (!painted || caretsOnly) return null
    const id = markAtPoint(painted.ranges, markOrderRef.current, x, y)
    if (!id) return null
    const box = boxOfRange(painted.ranges.get(id)!)
    return { id, rect: box ? new DOMRect(box.left, box.top, box.width, box.height) : new DOMRect(x, y, 0, 0) }
  }, [])

  const hoveredIdRef = useRef<string | null>(null)
  const reportHover = useCallback((hit: MdAnnotationHit | null) => {
    const id = hit?.id ?? null
    if (id === hoveredIdRef.current) return
    hoveredIdRef.current = id
    handlersRef.current.onAnnotationHover?.(hit)
  }, [])
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.buttons & 1) !== 0) {
      reportHover(null)
      return
    }
    reportHover(hitAt(event.clientX, event.clientY))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('a, button, input, textarea')) return
    const article = articleRef.current
    if (!article) return
    const { clientX: x, clientY: y } = event
    const tool = markupToolRef.current
    const h = handlersRef.current
    if (tool === 'insert') {
      // Insert Text: the press marks a point, never a selection; a saved caret under it opens instead.
      window.getSelection()?.removeAllRanges()
      // (Only a caret counts: text under the pointer may already carry a highlight and still take an insertion.)
      const existing = hitAt(x, y, true)
      if (existing) {
        h.onAnnotationClick?.(existing)
        return
      }
      const info = insertionPointAt(article, x, y)
      if (info) h.onInsertPoint?.(info)
      else h.onBlankClick?.()
      return
    }
    const selection = readMdSelection(article)
    if (tool && selection) {
      h.onMarkupSelection?.(selection, tool)
      return
    }
    // A drag-select is left alone (copy, or the context menu); only a plain click opens / dismisses.
    if (selection) return
    const hit = hitAt(x, y)
    if (hit) h.onAnnotationClick?.(hit)
    else if (target.closest('[data-md-content]')) h.onBlankClick?.()
  }

  const onContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    const article = articleRef.current
    if (!article) return
    event.preventDefault()
    const h = handlersRef.current
    const selection = readMdSelection(article)
    if (selection) {
      h.onSelectionContextMenu?.(selection, event.clientX, event.clientY)
      return
    }
    const hit = hitAt(event.clientX, event.clientY)
    if (hit) h.onAnnotationContextMenu?.(hit)
  }

  const scrollToAnchor = useCallback(
    (anchor: string) => {
      if (scrollToAnchorNow(anchor)) return
      if (mounted < total) {
        pendingRef.current = { anchor }
        setMounted(total)
        return
      }
      onAnchorNotFoundRef.current?.(anchor)
    },
    [mounted, total, scrollToAnchorNow],
  )
  const scrollToAnchorRef = useRef(scrollToAnchor)
  scrollToAnchorRef.current = scrollToAnchor

  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      getProgress: progress,
      getCurrentLocation: () => {
        if (!restoredRef.current) return undefined
        // While the book sits in a background tab nothing is laid out: keep the last point that was seen.
        const point = currentPoint() ?? lastPointRef.current
        return point ? mdReadingLocation(point) : undefined
      },
      scrollToFraction: (fraction) => {
        if (mounted < total) {
          pendingRef.current = { fraction }
          setMounted(total)
          return
        }
        scrollToFractionNow(fraction)
      },
      scrollByPage: (direction) => {
        scrollerRef.current?.scrollBy({ top: direction * scrollerRef.current.clientHeight * 0.9 })
      },
      scrollToHeading: (index) => {
        if (scrollToHeadingNow(index)) return
        if (mounted < total) {
          pendingRef.current = { heading: index }
          setMounted(total)
        }
      },
      scrollToAnnotation: (id) => {
        if (scrollToMarkNow(id)) return
        if (mounted < total) {
          pendingAnnotationRef.current = id
          setMounted(total)
        }
      },
    }
    return () => {
      apiRef.current = null
    }
  }, [apiRef, progress, currentPoint, mounted, total, scrollToFractionNow, scrollToHeadingNow, scrollToMarkNow])

  // Stable for the life of the book: callbacks are read through refs, so scrolling (which updates
  // the parent) never invalidates the memoised pieces.
  const components = useMemo<Components>(() => {
    return {
      a({ href, children }) {
        const link = classifyMdLink(href)
        if (link.kind === 'blocked') return <span className="md-link-blocked">{children}</span>
        const activate = () => {
          if (link.kind === 'anchor') scrollToAnchorRef.current(link.id)
          else onOpenExternalRef.current(link.url)
        }
        // No `href`: the browser can never navigate (or open a window) from this element.
        return (
          <a
            role="link"
            tabIndex={0}
            className="md-link"
            title={link.kind === 'external' ? link.url : undefined}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              activate()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                activate()
              }
            }}
          >
            {children}
          </a>
        )
      },
      img({ src, alt, title }) {
        return <MdImage bookId={bookId} src={typeof src === 'string' ? src : undefined} alt={alt} title={title} />
      },
      table({ children }) {
        return (
          <div className="md-table-wrap">
            <table>{children}</table>
          </div>
        )
      },
    }
  }, [bookId])

  const onMainClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      // The click that ends a drag-select must not count as a tap in the margin (it would toggle the chrome).
      if (window.getSelection()?.toString()) return
      if (event.target === event.currentTarget || (event.target as HTMLElement).dataset.mdMargin !== undefined) {
        onMarginClick()
      }
    },
    [onMarginClick],
  )

  const widthClass = (chromeHidden ? MARGIN_IMMERSIVE : MARGIN)[margin]

  return (
    <main
      ref={scrollerRef}
      data-md-surface=""
      className="app-scroll relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pt-8 pb-20 overscroll-y-contain"
      onScroll={() => {
        reportProgress()
        reportHover(null)
        handlersRef.current.onScrolled?.()
      }}
      onClick={onMainClick}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      onPointerLeave={() => reportHover(null)}
      onContextMenu={onContextMenu}
    >
      <div
        ref={marginRef}
        data-md-margin=""
        className={`relative mx-auto w-full transition-[max-width] duration-300 ${widthClass}`}
      >
        {lossy ? (
          <p className="md-notice" role="status" data-md-notice="lossy">
            This file is not valid UTF-8. Some characters could not be read and are shown as �.
          </p>
        ) : null}
        <article
          ref={articleRef}
          className="md-content"
          data-md-content=""
          data-md-segments={total}
          data-md-mounted={mounted}
        >
          {source.trim().length === 0 ? (
            <p className="md-empty" data-md-empty="">
              This Markdown file is empty.
            </p>
          ) : (
            pieces.slice(0, mounted).map((text, index) => (
              <div key={index} data-md-seg={index} className="md-seg">
                <MdSegment text={text} components={components} />
              </div>
            ))
          )}
          {mounted < total ? (
            <p className="md-notice" role="status" data-md-loading="">
              Loading the rest of the document…
            </p>
          ) : null}
        </article>
        <div ref={overlayRef} className="md-annot-overlay" aria-hidden>
          {caretBoxes.map((box) => (
            <span
              key={box.id}
              className="md-caret"
              data-md-caret-id={box.id}
              data-focused={focusedAnnotationId === box.id ? '' : undefined}
              style={{
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                ['--md-caret-color' as string]: box.color,
              }}
            />
          ))}
        </div>
      </div>
      <div className="min-h-[40vh]" aria-hidden />
    </main>
  )
}

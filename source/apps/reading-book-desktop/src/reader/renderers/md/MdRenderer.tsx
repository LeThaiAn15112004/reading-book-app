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
import type { MdHeadingInfo } from '@reading-book/book-reader-sdk'
import type { TextSurfaceApi } from '../textSurface'
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

/** Pieces of a long document mounted right away; the rest follow one per tick. */
const EAGER_SEGMENTS = 2

export type MdRendererApi = TextSurfaceApi & {
  /** Scroll to the N-th heading of the document (mounts the rest first when it is not there yet). */
  scrollToHeading: (index: number) => void
}

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
  /** How many pieces of a long document to mount at once (tests render everything). */
  eagerSegments?: number
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
  eagerSegments = EAGER_SEGMENTS,
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
  const headingElsRef = useRef<HTMLElement[]>([])
  const headingsKeyRef = useRef('')
  const activeRef = useRef<number | null | undefined>(undefined)

  const pieces = useMemo(() => {
    const parts = splitMdSource(source)
    const definitions = parts.length > 1 ? collectMdReferenceDefinitions(source) : ''
    return parts.map((part) => (definitions ? `${part}\n\n${definitions}\n` : part))
  }, [source])
  const total = pieces.length
  const [mounted, setMounted] = useState(() => Math.min(total, Math.max(1, eagerSegments)))
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
    const top = scroller.getBoundingClientRect().top + 24
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

  const reportProgress = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      onProgressRef.current(progress())
      updateActiveHeading()
    })
  }, [progress, updateActiveHeading])

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  const scrollToAnchorNow = useCallback((anchor: string): boolean => {
    const article = articleRef.current
    if (!article) return false
    const headings = Array.from(article.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
    const index = findHeadingForAnchor(
      headings.map((h) => h.textContent ?? ''),
      anchor,
    )
    if (index < 0) return false
    headings[index]!.scrollIntoView({ block: 'start' })
    return true
  }, [])

  const scrollToHeadingNow = useCallback((index: number): boolean => {
    const el = headingElsRef.current[index]
    if (!el) return false
    el.scrollIntoView({ block: 'start' })
    return true
  }, [])

  const scrollToFractionNow = useCallback((fraction: number) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * Math.min(1, Math.max(0, fraction))
  }, [])

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
    if (pending.anchor !== undefined) scrollToAnchorNow(pending.anchor)
    else if (pending.heading !== undefined) scrollToHeadingNow(pending.heading)
    else if (pending.fraction !== undefined) scrollToFractionNow(pending.fraction)
  }, [mounted, total, source, progress, updateActiveHeading, scrollToAnchorNow, scrollToHeadingNow, scrollToFractionNow])

  const scrollToAnchor = useCallback(
    (anchor: string) => {
      if (scrollToAnchorNow(anchor)) return
      if (mounted < total) {
        pendingRef.current = { anchor }
        setMounted(total)
      }
    },
    [mounted, total, scrollToAnchorNow],
  )
  const scrollToAnchorRef = useRef(scrollToAnchor)
  scrollToAnchorRef.current = scrollToAnchor

  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      getProgress: progress,
      getCurrentLocation: () => undefined,
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
    }
    return () => {
      apiRef.current = null
    }
  }, [apiRef, progress, mounted, total, scrollToFractionNow, scrollToHeadingNow])

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
      onScroll={reportProgress}
      onClick={onMainClick}
    >
      <div
        data-md-margin=""
        className={`mx-auto w-full transition-[max-width] duration-300 ${widthClass}`}
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
              <MdSegment key={index} text={text} components={components} />
            ))
          )}
          {mounted < total ? (
            <p className="md-notice" role="status" data-md-loading="">
              Loading the rest of the document…
            </p>
          ) : null}
        </article>
      </div>
      <div className="min-h-[40vh]" aria-hidden />
    </main>
  )
}

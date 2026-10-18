import {
  Component,
  useCallback,
  useEffect,
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
  findHeadingForAnchor,
} from '@reading-book/book-reader-sdk'
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

export type MdRendererApi = TextSurfaceApi

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
  apiRef?: MutableRefObject<MdRendererApi | null>
}

/**
 * A parser/renderer failure must never take the Reader down: show the source as plain text and say
 * why. Reset when the document changes.
 */
class MdErrorBoundary extends Component<
  { resetKey: string; fallback: ReactNode; children: ReactNode },
  { failedKey: string | null }
> {
  state = { failedKey: null as string | null }

  static getDerivedStateFromError(): { failedKey: string | null } {
    return { failedKey: '__failed__' }
  }

  componentDidUpdate(prev: { resetKey: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.failedKey !== null) {
      this.setState({ failedKey: null })
    }
  }

  render(): ReactNode {
    return this.state.failedKey !== null ? this.props.fallback : this.props.children
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

/**
 * Read-only Markdown surface (docs/implementation_plan/markdown_reader.md). The text is parsed by
 * react-markdown into React elements — never `innerHTML`. Raw HTML in the file is dropped
 * (`skipHtml`), links never navigate the window (no `href` is rendered; clicks go through the SDK
 * link policy), images are only shown when they sit next to the document (served by Main).
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
  apiRef,
}: MdRendererProps) {
  const scrollerRef = useRef<HTMLElement | null>(null)
  const articleRef = useRef<HTMLElement | null>(null)
  const frameRef = useRef<number | null>(null)

  const progress = useCallback((): number => {
    const scroller = scrollerRef.current
    if (!scroller) return 0
    const range = scroller.scrollHeight - scroller.clientHeight
    return range <= 0 ? 0 : Math.min(1, Math.max(0, scroller.scrollTop / range))
  }, [])

  const onScroll = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      onProgress(progress())
    })
  }, [onProgress, progress])

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  useEffect(() => {
    onProgress(progress())
  }, [source, onProgress, progress])

  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      getProgress: progress,
      getCurrentLocation: () => undefined,
      scrollToFraction: (fraction) => {
        const scroller = scrollerRef.current
        if (!scroller) return
        scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * Math.min(1, Math.max(0, fraction))
      },
      scrollByPage: (direction) => {
        scrollerRef.current?.scrollBy({ top: direction * scrollerRef.current.clientHeight * 0.9 })
      },
    }
    return () => {
      apiRef.current = null
    }
  }, [apiRef, progress])

  const scrollToAnchor = useCallback((anchor: string) => {
    const article = articleRef.current
    if (!article) return
    const headings = Array.from(article.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
    const index = findHeadingForAnchor(
      headings.map((h) => h.textContent ?? ''),
      anchor,
    )
    headings[index]?.scrollIntoView({ block: 'start' })
  }, [])

  const components = useMemo<Components>(() => {
    return {
      a({ href, children }) {
        const link = classifyMdLink(href)
        if (link.kind === 'blocked') return <span className="md-link-blocked">{children}</span>
        const activate = () => {
          if (link.kind === 'anchor') scrollToAnchor(link.id)
          else onOpenExternal(link.url)
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
  }, [bookId, onOpenExternal, scrollToAnchor])

  const onMainClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.target === event.currentTarget || (event.target as HTMLElement).dataset.mdMargin !== undefined) {
        onMarginClick()
      }
    },
    [onMarginClick],
  )

  const widthClass = (chromeHidden ? MARGIN_IMMERSIVE : MARGIN)[margin]
  const plainFallback = (
    <>
      <p className="md-notice" role="status">
        This Markdown could not be formatted, so it is shown as plain text.
      </p>
      <pre className="md-plain">{source}</pre>
    </>
  )

  return (
    <main
      ref={scrollerRef}
      data-md-surface=""
      className="app-scroll relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pt-8 pb-20 overscroll-y-contain"
      onScroll={onScroll}
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
        <article ref={articleRef} className="md-content" data-md-content="">
          {source.trim().length === 0 ? (
            <p className="md-empty" data-md-empty="">
              This Markdown file is empty.
            </p>
          ) : (
            <MdErrorBoundary resetKey={`${bookId}:${source.length}`} fallback={plainFallback}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                // Our own policy lives in `components.a` / `components.img`; every URL reaches them untouched.
                urlTransform={(url) => url}
                components={components}
              >
                {source}
              </ReactMarkdown>
            </MdErrorBoundary>
          )}
        </article>
      </div>
      <div className="min-h-[40vh]" aria-hidden />
    </main>
  )
}

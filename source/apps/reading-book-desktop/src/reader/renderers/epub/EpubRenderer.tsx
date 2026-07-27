import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { ReaderTheme } from '@reading-book/shared/models'
import {
  openEpubjs,
  type EpubjsHandle,
  type EpubNavState,
  type EpubPageLayout,
  type EpubPageMode,
} from './openEpubjs'

/** Imperative nav for parent footer scrub / section jump. */
export type EpubRendererApi = Pick<
  EpubjsHandle,
  | 'nextPage'
  | 'prevPage'
  | 'nextSection'
  | 'prevSection'
  | 'goToSpineIndex'
  | 'getSpineLength'
  | 'getNavState'
  | 'setFontSize'
>

type EpubRendererProps = {
  data: ArrayBuffer
  theme: ReaderTheme
  layout?: EpubPageLayout
  pageMode?: EpubPageMode
  /** Reflow zoom — px (same scale as Aa font size). */
  fontSize?: number
  className?: string
  /** Disable edge click page-turn (e.g. place-stamp tools). */
  pageTurnEnabled?: boolean
  onNavState?: (state: EpubNavState) => void
  apiRef?: MutableRefObject<EpubRendererApi | null>
}

function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name?: string }).name === 'AbortError'
  )
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  )
}

function hasTextSelection(): boolean {
  const sel = window.getSelection()
  return !!sel && !sel.isCollapsed && (sel.toString()?.length ?? 0) > 0
}

function toApi(handle: EpubjsHandle): EpubRendererApi {
  return {
    nextPage: () => handle.nextPage(),
    prevPage: () => handle.prevPage(),
    nextSection: () => handle.nextSection(),
    prevSection: () => handle.prevSection(),
    goToSpineIndex: (i) => handle.goToSpineIndex(i),
    getSpineLength: () => handle.getSpineLength(),
    getNavState: () => handle.getNavState(),
    setFontSize: (px) => handle.setFontSize(px),
  }
}

/**
 * Production EPUB surface (T3.3) — epubjs from ArrayBuffer; no FS paths.
 * Dual layout draws a center gutter; spine order includes cover as a normal page.
 * T3.5: page/section nav + relocated state for footer scrub.
 */
export function EpubRenderer({
  data,
  theme,
  layout = 'single',
  pageMode = 'paginated',
  fontSize = 18,
  className,
  pageTurnEnabled = true,
  onNavState,
  apiRef,
}: EpubRendererProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<EpubjsHandle | null>(null)
  const onNavStateRef = useRef(onNavState)
  onNavStateRef.current = onNavState
  const apiRefProp = useRef(apiRef)
  apiRefProp.current = apiRef

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const ac = new AbortController()
    setStatus('loading')
    setErrorMessage(null)
    if (apiRefProp.current) apiRefProp.current.current = null

    const timeout = window.setTimeout(() => {
      if (!ac.signal.aborted) {
        ac.abort()
        handleRef.current?.destroy()
        handleRef.current = null
        if (apiRefProp.current) apiRefProp.current.current = null
        setStatus('error')
        setErrorMessage('Opening this EPUB timed out. Try again.')
      }
    }, 20000)

    openEpubjs(data, host, {
      theme,
      layout,
      pageMode,
      fontSize,
      signal: ac.signal,
    })
      .then((handle) => {
        if (ac.signal.aborted) {
          handle.destroy()
          return
        }
        handleRef.current = handle
        if (apiRefProp.current) apiRefProp.current.current = toApi(handle)

        const onRelocated = () => {
          onNavStateRef.current?.(handle.getNavState())
        }
        handle.rendition.on('relocated', onRelocated)
        onNavStateRef.current?.(handle.getNavState())
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || isAbortError(err)) return
        handleRef.current = null
        if (apiRefProp.current) apiRefProp.current.current = null
        setStatus('error')
        setErrorMessage(
          err instanceof Error ? err.message : 'Could not open this EPUB.',
        )
      })
      .finally(() => {
        window.clearTimeout(timeout)
      })

    return () => {
      ac.abort()
      window.clearTimeout(timeout)
      handleRef.current?.destroy()
      handleRef.current = null
      if (apiRefProp.current) apiRefProp.current.current = null
    }
    // Re-open when bytes / pagination mode change; layout toggles via setLayout.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theme/layout applied below
  }, [data, pageMode])

  useEffect(() => {
    handleRef.current?.setTheme(theme)
  }, [theme])

  useEffect(() => {
    handleRef.current?.setLayout(layout)
  }, [layout])

  useEffect(() => {
    handleRef.current?.setFontSize(fontSize)
  }, [fontSize])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => {
      handleRef.current?.resize()
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [status])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      const handle = handleRef.current
      if (!handle) return

      const meta = e.ctrlKey || e.metaKey
      const isSectionKey =
        (meta && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) ||
        e.key === '[' ||
        e.key === ']'

      if (isSectionKey) {
        e.preventDefault()
        if (e.key === 'ArrowRight' || e.key === ']') {
          void handle.nextSection()
        } else {
          void handle.prevSection()
        }
        return
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        void (e.key === 'ArrowRight' ? handle.nextPage() : handle.prevPage())
        return
      }

      // Scroll mode: don't hijack wheel; Space / Page* still turn pages if engine supports.
      if (e.key === ' ' || e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault()
        if (e.key === 'PageUp') void handle.prevPage()
        else void handle.nextPage()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const effectivePageTurn =
    pageTurnEnabled &&
    status === 'ready' &&
    (pageMode === 'paginated' || layout === 'dual')

  function onEdgeClick(side: 'prev' | 'next') {
    if (!effectivePageTurn || hasTextSelection()) return
    const handle = handleRef.current
    if (!handle) return
    void (side === 'next' ? handle.nextPage() : handle.prevPage())
  }

  const showGutter = layout === 'dual' && status === 'ready'

  return (
    <main
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${className ?? ''}`}
      data-epub-status={status}
      data-epub-layout={layout}
      data-epub-page-mode={pageMode}
    >
      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
          <div
            className="size-9 shrink-0 animate-spin rounded-full border-[3px] border-current/20 border-t-current opacity-80"
            aria-hidden
          />
          <span className="text-sm opacity-70">Opening book…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-sm text-rose-300">
          {errorMessage ?? 'Could not open this EPUB.'}
        </div>
      )}
      {/* Dual-page center gutter — matches physical book fold. */}
      {showGutter ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-1/2 z-[6] w-px -translate-x-1/2 bg-lib-border"
          aria-hidden
        />
      ) : null}
      {/* Paginated edge click zones (~25% each side). Center stays free for selection. */}
      {effectivePageTurn ? (
        <>
          <button
            type="button"
            aria-label="Previous page"
            className="absolute inset-y-0 left-0 z-[5] w-1/4 cursor-w-resize border-0 bg-transparent p-0"
            onClick={() => onEdgeClick('prev')}
          />
          <button
            type="button"
            aria-label="Next page"
            className="absolute inset-y-0 right-0 z-[5] w-1/4 cursor-e-resize border-0 bg-transparent p-0"
            onClick={() => onEdgeClick('next')}
          />
        </>
      ) : null}
      <div
        ref={hostRef}
        className="h-full w-full min-h-0 flex-1 [&_iframe]:h-full [&_iframe]:w-full"
        tabIndex={-1}
      />
    </main>
  )
}

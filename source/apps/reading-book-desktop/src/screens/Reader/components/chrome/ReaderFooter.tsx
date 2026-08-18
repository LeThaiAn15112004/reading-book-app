import { useEffect, useState } from 'react'
import type { ZoomLayoutPreset } from '../../logic'
import type { PageLayout, PageMode } from '@reading-book/shared/models'
import { ZoomControl } from './ZoomControl'
import { FullscreenButton } from './FullscreenButton'

const modeGroupClass =
  'inline-flex items-center gap-0.5 rounded-lg bg-lib-hint/70 p-0.5'
const modeButtonClass =
  'inline-flex h-7 w-8 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-lib-muted transition-colors hover:bg-lib-chip hover:text-lib-text-strong'
const modeButtonActiveClass =
  'bg-lib-text-strong/12 text-lib-text-strong hover:bg-lib-text-strong/18'

const layoutOptions: Array<{
  id: PageLayout
  count: 1 | 2
  label: string
}> = [
  { id: 'single', count: 1, label: '1 page' },
  { id: 'dual', count: 2, label: '2 pages' },
]

function PageCountIcon({ count }: { count: 1 | 2 }) {
  return (
    <span className="flex items-center gap-[2px]" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <span
          key={index}
          className="h-4 w-[7px] rounded-[2px] border border-current/75 bg-current/10"
        />
      ))}
    </span>
  )
}

function ContinuousIcon() {
  return (
    <span className="flex flex-col gap-[2px]" aria-hidden>
      <span className="h-[6px] w-4 rounded-[2px] border border-current/75 bg-current/10" />
      <span className="h-[6px] w-4 rounded-[2px] border border-current/75 bg-current/10" />
      <span className="h-[6px] w-4 rounded-[2px] border border-current/75 bg-current/10" />
    </span>
  )
}

function PageTurnIcon() {
  return (
    <span
      className="relative inline-flex h-4 w-4 items-center justify-center"
      aria-hidden
    >
      <span className="absolute h-4 w-3 rounded-[2px] border border-current/75 bg-current/10" />
      <span className="absolute right-[1px] h-3 w-px bg-current/70" />
    </span>
  )
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill={filled ? 'currentColor' : 'none'}
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      className="size-4"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"
      />
    </svg>
  )
}

type ReaderFooterProps = {
  pageCurrent: number
  pageTotal: number
  /** False until the EPUB reference-page model is available. */
  pageCountReady?: boolean
  onPreviousPage: () => void
  onNextPage: () => void
  onGoToPage: (page: number) => void
  layout: PageLayout
  pageMode: PageMode
  onLayoutChange: (layout: PageLayout) => void
  onPageModeChange: (pageMode: PageMode) => void
  zoom: number
  onZoomChange: (scale: number) => void
  onZoomStep: (direction: 1 | -1) => void
  onZoomLayoutPreset: (preset: ZoomLayoutPreset) => void
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  /** Immersive fullscreen: slide footer away until bottom-edge reveal. */
  immersiveHidden?: boolean
  bookmarkActive?: boolean
  onToggleBookmark?: () => void
}

export function ReaderFooter({
  pageCurrent,
  pageTotal,
  pageCountReady = true,
  onPreviousPage,
  onNextPage,
  onGoToPage,
  layout,
  pageMode,
  onLayoutChange,
  onPageModeChange,
  zoom,
  onZoomChange,
  onZoomStep,
  onZoomLayoutPreset,
  fullscreen = false,
  onToggleFullscreen,
  immersiveHidden = false,
  bookmarkActive = false,
  onToggleBookmark,
}: ReaderFooterProps) {
  const [pageInput, setPageInput] = useState(String(pageCurrent))

  useEffect(() => {
    setPageInput(String(pageCurrent))
  }, [pageCurrent])

  function submitPage() {
    const requestedPage = Number.parseInt(pageInput, 10)
    if (!Number.isFinite(requestedPage) || requestedPage < 1) {
      setPageInput(String(pageCurrent))
      return
    }
    if (!pageCountReady) {
      setPageInput(String(pageCurrent))
      onGoToPage(requestedPage)
      return
    }
    if (pageTotal <= 0) {
      setPageInput(String(pageCurrent))
      return
    }

    const page = Math.min(Math.max(requestedPage, 1), pageTotal)
    setPageInput(String(page))
    onGoToPage(page)
  }

  const atStart = pageCountReady && pageCurrent <= 1
  const atEnd = pageCountReady && pageTotal > 0 && pageCurrent >= pageTotal
  const inputWidthCh = pageCountReady
    ? Math.max(String(pageTotal).length + 1, 5)
    : Math.max(String(pageCurrent).length + 1, 5)

  return (
    <footer
      data-immersive-chrome=""
      className={`fixed inset-x-0 bottom-0 z-[90] flex h-10 items-center justify-between gap-3 border-t border-lib-border-soft bg-lib-surface-strong pl-12 pr-4 backdrop-blur-md transition-all duration-300 sm:h-10 sm:pl-14 ${
        immersiveHidden
          ? 'pointer-events-none translate-y-full opacity-0'
          : 'translate-y-0 opacity-100'
      }`}
      onClick={(e) => e.stopPropagation()}
      onPointerEnter={(e) => e.stopPropagation()}
    >
      <div className="inline-flex min-w-0 items-center gap-3">
        <span className="inline-flex min-w-0 items-center gap-3 text-xs font-semibold tracking-wide text-lib-text-strong">
        <button
          type="button"
          className="rounded px-2 py-1 text-sm hover:bg-lib-chip disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="First page"
          disabled={atStart}
          onClick={() => onGoToPage(1)}
        >
          &lt;&lt;
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-sm hover:bg-lib-chip disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous page"
          disabled={atStart}
          onClick={onPreviousPage}
        >
          &lt;
        </button>
        {pageCurrent > 0 ? (
          <span
            className="inline-flex items-center gap-1"
            aria-busy={!pageCountReady}
            aria-live="polite"
          >
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Current page"
              className="rounded border border-transparent bg-transparent px-1 py-0.5 text-right font-semibold outline-none hover:border-lib-border-soft focus:border-lib-accent focus:bg-lib-chip"
              style={{
                width: `${inputWidthCh}ch`,
              }}
              value={pageInput}
              onChange={(event) =>
                setPageInput(event.target.value.replace(/\D/g, ''))
              }
              onFocus={(event) => event.currentTarget.select()}
              onBlur={submitPage}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submitPage()
                  event.currentTarget.blur()
                } else if (event.key === 'Escape') {
                  setPageInput(String(pageCurrent))
                  event.currentTarget.blur()
                }
              }}
            />
            <span aria-hidden="true">/</span>
            {pageCountReady && pageTotal > 0 ? (
              <span aria-label="Total pages">{pageTotal}</span>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 text-lib-muted"
                aria-label="Calculating page count"
              >
                <span
                  className="size-3 shrink-0 animate-spin rounded-full border-2 border-current/20 border-t-current"
                  aria-hidden
                />
                <span>Calculating…</span>
              </span>
            )}
          </span>
        ) : null}
        <button
          type="button"
          className="rounded px-2 py-1 text-sm hover:bg-lib-chip disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next page"
          disabled={atEnd}
          onClick={onNextPage}
        >
          &gt;
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-sm hover:bg-lib-chip disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Last page"
          disabled={!pageCountReady || atEnd}
          onClick={() => onGoToPage(pageTotal)}
        >
          &gt;&gt;
        </button>
        </span>

        {onToggleBookmark ? (
          <button
            type="button"
            className={`${modeButtonClass} ${
              bookmarkActive
                ? 'bg-lib-accent-soft text-lib-accent hover:bg-lib-accent-soft hover:text-lib-accent'
                : ''
            }`}
            title={bookmarkActive ? 'Remove bookmark' : 'Bookmark this place'}
            aria-label={
              bookmarkActive ? 'Remove bookmark' : 'Bookmark this place'
            }
            aria-pressed={bookmarkActive}
            onClick={onToggleBookmark}
          >
            <BookmarkIcon filled={bookmarkActive} />
          </button>
        ) : null}

        <span className={modeGroupClass} aria-label="Page count">
          {layoutOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`${modeButtonClass} ${
                layout === option.id ? modeButtonActiveClass : ''
              }`}
              title={option.label}
              aria-label={option.label}
              aria-pressed={layout === option.id}
              onClick={() => onLayoutChange(option.id)}
            >
              <PageCountIcon count={option.count} />
            </button>
          ))}
        </span>

        <span className={modeGroupClass} aria-label="Reading flow">
          <button
            type="button"
            className={`${modeButtonClass} ${
              pageMode === 'scroll' ? modeButtonActiveClass : ''
            }`}
            title="Continuous vertical scroll"
            aria-label="Continuous vertical scroll"
            aria-pressed={pageMode === 'scroll'}
            onClick={() => onPageModeChange('scroll')}
          >
            <ContinuousIcon />
          </button>
          <button
            type="button"
            className={`${modeButtonClass} ${
              pageMode === 'paginated' ? modeButtonActiveClass : ''
            }`}
            title="Page-turn"
            aria-label="Page-turn"
            aria-pressed={pageMode === 'paginated'}
            onClick={() => onPageModeChange('paginated')}
          >
            <PageTurnIcon />
          </button>
        </span>
      </div>

      <div className="inline-flex items-center gap-1">
        <ZoomControl
          zoom={zoom}
          onZoomChange={onZoomChange}
          onZoomStep={onZoomStep}
          onLayoutPreset={onZoomLayoutPreset}
        />
        {onToggleFullscreen ? (
          <FullscreenButton
            fullscreen={fullscreen}
            onToggle={onToggleFullscreen}
          />
        ) : null}
      </div>
    </footer>
  )
}

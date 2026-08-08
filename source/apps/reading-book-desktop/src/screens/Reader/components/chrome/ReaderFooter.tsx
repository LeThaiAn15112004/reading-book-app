import { useEffect, useState } from 'react'
import type { ZoomLayoutPreset } from '../../logic'
import type { PageLayout, PageMode } from '@reading-book/shared/models'
import { ZoomControl } from './ZoomControl'

const modeGroupClass =
  'inline-flex items-center gap-0.5 rounded-lg bg-lib-hint/70 p-0.5'
const modeButtonClass =
  'inline-flex h-7 w-8 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-lib-muted transition-colors hover:bg-lib-chip hover:text-lib-text-strong'
const modeButtonActiveClass =
  'bg-lib-text-strong/12 text-lib-text-strong hover:bg-lib-text-strong/18'

const layoutOptions: Array<{
  id: PageLayout
  count: 1 | 2 | 3
  label: string
}> = [
  { id: 'single', count: 1, label: '1 page' },
  { id: 'dual', count: 2, label: '2 pages' },
  { id: 'triple', count: 3, label: '3 pages' },
]

function PageCountIcon({ count }: { count: 1 | 2 | 3 }) {
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
  bookmarkActive?: boolean
  onToggleBookmark?: () => void
}

export function ReaderFooter({
  pageCurrent,
  pageTotal,
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
  bookmarkActive = false,
  onToggleBookmark,
}: ReaderFooterProps) {
  const [pageInput, setPageInput] = useState(String(pageCurrent))

  useEffect(() => {
    setPageInput(String(pageCurrent))
  }, [pageCurrent])

  function submitPage() {
    const requestedPage = Number.parseInt(pageInput, 10)
    if (!Number.isFinite(requestedPage) || pageTotal <= 0) {
      setPageInput(String(pageCurrent))
      return
    }

    const page = Math.min(Math.max(requestedPage, 1), pageTotal)
    setPageInput(String(page))
    onGoToPage(page)
  }

  return (
    <footer
      className="fixed inset-x-0 bottom-0 z-[90] flex h-10 items-center justify-between gap-3 border-t border-lib-border-soft bg-lib-surface-strong pl-12 pr-4 backdrop-blur-md sm:h-10 sm:pl-14"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="inline-flex min-w-0 items-center gap-3">
        <span className="inline-flex min-w-0 items-center gap-3 text-xs font-semibold tracking-wide text-lib-text-strong">
        <button
          type="button"
          className="rounded px-2 py-1 text-sm hover:bg-lib-chip disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="First page"
          disabled={pageCurrent <= 1}
          onClick={() => onGoToPage(1)}
        >
          &lt;&lt;
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-sm hover:bg-lib-chip disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous page"
          disabled={pageCurrent <= 1}
          onClick={onPreviousPage}
        >
          &lt;
        </button>
        {pageTotal > 0 ? (
          <span className="inline-flex items-center gap-1">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Current page"
              className="rounded border border-transparent bg-transparent px-1 py-0.5 text-right font-semibold outline-none hover:border-lib-border-soft focus:border-lib-accent focus:bg-lib-chip"
              style={{
                width: `${Math.max(String(pageTotal).length + 1, 5)}ch`,
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
            <span>{pageTotal}</span>
          </span>
        ) : null}
        <button
          type="button"
          className="rounded px-2 py-1 text-sm hover:bg-lib-chip disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next page"
          disabled={pageTotal <= 0 || pageCurrent >= pageTotal}
          onClick={onNextPage}
        >
          &gt;
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-sm hover:bg-lib-chip disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Last page"
          disabled={pageTotal <= 0 || pageCurrent >= pageTotal}
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

      <ZoomControl
        zoom={zoom}
        onZoomChange={onZoomChange}
        onZoomStep={onZoomStep}
        onLayoutPreset={onZoomLayoutPreset}
      />
    </footer>
  )
}

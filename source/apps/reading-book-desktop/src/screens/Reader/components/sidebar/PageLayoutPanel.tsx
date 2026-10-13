import { useEffect, useRef, useState } from 'react'

/** Rasterizes a 1-based page into a canvas `cssWidth` CSS px wide (PDF: `PdfRendererApi.renderThumbnail`). */
export type PageThumbnailRenderer = (
  page: number,
  cssWidth: number,
  signal: AbortSignal,
) => Promise<HTMLCanvasElement | null>

type PageLayoutPanelProps = {
  /** 1-based current page / section. */
  pageCurrent: number
  pageTotal: number
  /** Card titles indexed by 0-based position. */
  sectionLabels?: string[]
  onGoToPage: (page: number) => void
  /** Fixed-layout surfaces (PDF) draw the real page; without it cards show a stylised placeholder. */
  renderThumbnail?: PageThumbnailRenderer
}

/** Narrowest card — the grid fits as many columns as the sidebar width allows (auto-fill). */
const CARD_MIN_WIDTH_PX = 104
/** Thumbnails re-render only when a card grows past this factor of the width they were drawn at. */
const RERENDER_GROWTH = 1.25
/** Start rendering a little before a card scrolls into view. */
const PRELOAD_MARGIN = '200px 0px'

function PlaceholderLines() {
  return (
    <>
      <span className="block h-1.5 w-full rounded-full bg-lib-muted/20" aria-hidden />
      <span className="block h-1.5 w-full rounded-full bg-lib-muted/20" aria-hidden />
      <span className="block h-1.5 w-4/5 rounded-full bg-lib-muted/15" aria-hidden />
    </>
  )
}

/**
 * The page itself, drawn lazily: only while the card is near the visible part of the list, at the
 * card's width (redrawn when the sidebar is widened enough to make it blurry).
 */
function PageThumbnail({ page, render }: { page: number; render: PageThumbnailRenderer }) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [width, setWidth] = useState(0)
  const [aspect, setAspect] = useState<string>('3 / 4')
  const [drawn, setDrawn] = useState(false)
  const drawnWidthRef = useRef(0)

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), {
      rootMargin: PRELOAD_MARGIN,
    })
    const ro = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0)
      if (next > 0) setWidth(next)
    })
    io.observe(el)
    ro.observe(el)
    return () => {
      io.disconnect()
      ro.disconnect()
    }
  }, [])

  // Width that actually needs a (re)draw: the first measurement, then only real growth.
  const needed = drawnWidthRef.current > 0 && width <= drawnWidthRef.current * RERENDER_GROWTH ? 0 : width

  useEffect(() => {
    const frame = frameRef.current
    if (!visible || needed <= 0 || !frame) return
    const controller = new AbortController()
    void render(page, needed, controller.signal)
      .then((canvas) => {
        if (!canvas || controller.signal.aborted) return
        canvas.className = 'absolute inset-0 block h-full w-full'
        canvas.setAttribute('aria-hidden', 'true')
        frame.querySelector('canvas')?.remove()
        frame.prepend(canvas)
        drawnWidthRef.current = needed
        setAspect(`${canvas.width} / ${canvas.height}`)
        setDrawn(true)
      })
      .catch((err: unknown) => console.warn('[PageLayoutPanel] thumbnail failed', page, err))
    return () => controller.abort()
  }, [visible, needed, page, render])

  return (
    <div
      ref={frameRef}
      className="relative w-full overflow-hidden bg-white"
      style={{ aspectRatio: aspect }}
      data-thumbnail-page={page}
      data-thumbnail-drawn={drawn ? '' : undefined}
    >
      {drawn ? null : (
        <div className="flex h-full w-full flex-col gap-1.5 bg-lib-surface p-2">
          <PlaceholderLines />
        </div>
      )}
    </div>
  )
}

function PageCard({
  page,
  label,
  active,
  onSelect,
  renderThumbnail,
}: {
  page: number
  label: string
  active: boolean
  onSelect: () => void
  renderThumbnail?: PageThumbnailRenderer
}) {
  return (
    <button
      type="button"
      className="group flex w-full min-w-0 cursor-pointer flex-col gap-1 border-none bg-transparent p-0 text-left"
      aria-label={`Go to ${label}`}
      aria-current={active ? 'page' : undefined}
      onClick={onSelect}
    >
      <div
        className={`relative w-full overflow-hidden rounded-md border transition-[border-color,box-shadow] duration-300 ease-out group-hover:border-lib-accent-ring group-hover:shadow-sm ${
          active ? 'border-lib-accent ring-2 ring-lib-accent-ring/60' : 'border-lib-border-soft'
        }`}
      >
        {renderThumbnail ? (
          // The real page — nothing drawn over it; the label below names it.
          <PageThumbnail page={page} render={renderThumbnail} />
        ) : (
          <div className="flex aspect-[3/4] w-full flex-col gap-1.5 bg-lib-surface p-2">
            <PlaceholderLines />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-1 pt-4 pb-1 text-center text-xs font-semibold text-white">
              {page}
            </span>
          </div>
        )}
      </div>

      <span
        className={`truncate text-center text-[11px] font-semibold ${
          active ? 'text-lib-accent' : 'text-lib-muted group-hover:text-lib-text'
        }`}
        title={label}
      >
        {label}
      </span>
    </button>
  )
}

export function PageLayoutPanel({
  pageCurrent,
  pageTotal,
  sectionLabels,
  onGoToPage,
  renderThumbnail,
}: PageLayoutPanelProps) {
  if (pageTotal <= 0) {
    return (
      <p className="m-0 px-2 py-6 text-center text-[13px] leading-relaxed text-lib-faint">
        Sections are not available yet.
      </p>
    )
  }

  return (
    <div
      className="grid gap-x-2 gap-y-3"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN_WIDTH_PX}px, 1fr))` }}
    >
      {Array.from({ length: pageTotal }, (_, index) => {
        const page = index + 1
        return (
          <PageCard
            key={page}
            page={page}
            label={sectionLabels?.[index] ?? `Section ${page}`}
            active={page === pageCurrent}
            onSelect={() => onGoToPage(page)}
            renderThumbnail={renderThumbnail}
          />
        )
      })}
    </div>
  )
}

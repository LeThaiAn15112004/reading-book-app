type ReaderFooterProps = {
  chromeHidden: boolean
  locationLabel: string
  /** Current page (1-based). */
  pageCurrent: number
  /** Total pages / spine sections. */
  pageTotal: number
  progress: number
  onScrub: (progress: number) => void
  /** Zoom level as percent of base (100 = default). */
  zoomPercent: number
  onZoomOut: () => void
  onZoomIn: () => void
  onZoomReset: () => void
}

export function ReaderFooter({
  chromeHidden,
  locationLabel,
  pageCurrent,
  pageTotal,
  progress,
  onScrub,
  zoomPercent,
  onZoomOut,
  onZoomIn,
  onZoomReset,
}: ReaderFooterProps) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100)
  const pageLabel =
    pageTotal > 0 ? `${pageCurrent} / ${pageTotal}` : '— / —'

  return (
    <footer
      className={`z-50 flex h-14 shrink-0 items-center border-t border-lib-border-soft bg-lib-surface-strong px-4 backdrop-blur-md transition-all duration-300 sm:h-16 ${
        chromeHidden
          ? 'pointer-events-none translate-y-full opacity-0'
          : 'translate-y-0 opacity-100'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex w-full items-center gap-3">
        <div className="flex max-w-[42%] shrink-0 items-center gap-2">
          <span
            className="tabular-nums text-xs font-bold tracking-wide text-lib-text-strong"
            title="Current page / total"
            aria-label={`Page ${pageCurrent} of ${pageTotal}`}
          >
            {pageLabel}
          </span>
          <span
            className="min-w-0 truncate text-xs font-semibold tracking-wide text-lib-muted"
            title="Current location"
          >
            {locationLabel}
          </span>
        </div>
        <div
          className="relative h-5 flex-1 cursor-pointer"
          role="slider"
          aria-label="Jump to location in document"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          tabIndex={0}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const ratio = (e.clientX - rect.left) / rect.width
            onScrub(Math.min(1, Math.max(0, ratio)))
          }}
        >
          <div className="absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 rounded-sm bg-lib-chip">
            <div
              className="h-full rounded-sm bg-lib-accent"
              style={{ width: `${pct}%` }}
            />
            <div
              className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-lib-accent bg-white"
              style={{ left: `${pct}%` }}
            />
          </div>
        </div>
        <div
          className="flex shrink-0 items-center gap-0.5"
          role="group"
          aria-label="Zoom"
        >
          <button
            type="button"
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-sm font-bold text-lib-muted hover:bg-lib-hint hover:text-lib-text-strong"
            aria-label="Zoom out"
            title="Zoom out (Ctrl/Cmd −)"
            onClick={onZoomOut}
          >
            −
          </button>
          <button
            type="button"
            className="min-w-11 cursor-pointer rounded-md border-none bg-transparent px-1 text-center text-[11px] font-bold tabular-nums text-lib-muted hover:bg-lib-hint hover:text-lib-text-strong"
            aria-label="Reset zoom"
            title="Reset zoom (Ctrl/Cmd 0)"
            onClick={onZoomReset}
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-sm font-bold text-lib-muted hover:bg-lib-hint hover:text-lib-text-strong"
            aria-label="Zoom in"
            title="Zoom in (Ctrl/Cmd +)"
            onClick={onZoomIn}
          >
            +
          </button>
        </div>
      </div>
    </footer>
  )
}

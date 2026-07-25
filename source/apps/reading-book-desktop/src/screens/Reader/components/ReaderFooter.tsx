type ReaderFooterProps = {
  chromeHidden: boolean
  locationLabel: string
  progress: number
  onScrub: (progress: number) => void
}

export function ReaderFooter({
  chromeHidden,
  locationLabel,
  progress,
  onScrub,
}: ReaderFooterProps) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100)

  return (
    <footer
      className={`z-50 flex h-14 shrink-0 items-center border-t border-slate-600/30 bg-slate-900/95 px-4 backdrop-blur-md transition-all duration-300 sm:h-16 ${
        chromeHidden
          ? 'pointer-events-none translate-y-full opacity-0'
          : 'translate-y-0 opacity-100'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex w-full items-center gap-3">
        <span
          className="shrink-0 text-xs font-semibold tracking-wide text-slate-400 uppercase"
          title="Current location"
        >
          {locationLabel}
        </span>
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
          <div className="absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 rounded-sm bg-slate-700/80">
            <div
              className="h-full rounded-sm bg-amber-500"
              style={{ width: `${pct}%` }}
            />
            <div
              className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-amber-500 bg-white"
              style={{ left: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </footer>
  )
}

import { useEffect, useState } from 'react'

const iconButton =
  'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[14px] font-semibold text-lib-text-strong active:bg-lib-hint disabled:opacity-40'

/** Top bar (spec 008, T102): back to Library, title, bookmark here, and zoom for PDF. */
export function MobileReaderTopBar({
  title,
  onBack,
  bookmarked,
  onToggleBookmark,
  zoom,
}: {
  title: string
  onBack: () => void
  bookmarked: boolean
  onToggleBookmark?: () => void
  /** PDF only: zoom out / in buttons (pinch zoom of the page is the WebView's own). */
  zoom?: { percent: number; onStep: (direction: 1 | -1) => void }
}) {
  return (
    <header
      className="fixed inset-x-0 top-0 z-[300] border-b border-lib-border bg-lib-topbar/95 backdrop-blur"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex min-h-[52px] items-center gap-1 px-1">
        <button type="button" className={iconButton} onClick={onBack} aria-label="Back to Library">
          <span aria-hidden className="text-[22px] leading-none">‹</span>
        </button>
        <h1 className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold text-lib-text-strong">{title}</h1>
        {zoom ? (
          <>
            <button type="button" className={iconButton} onClick={() => zoom.onStep(-1)} aria-label="Zoom out">
              −
            </button>
            <span className="w-11 text-center text-[12px] text-lib-muted tabular-nums">{zoom.percent}%</span>
            <button type="button" className={iconButton} onClick={() => zoom.onStep(1)} aria-label="Zoom in">
              +
            </button>
          </>
        ) : null}
        {onToggleBookmark ? (
          <button
            type="button"
            className={iconButton}
            onClick={onToggleBookmark}
            aria-pressed={bookmarked}
            aria-label={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
          >
            <svg aria-hidden viewBox="0 0 24 24" width="20" height="20" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M6 3h12v18l-6-4-6 4z" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
      </div>
    </header>
  )
}

/**
 * Bottom bar (spec 008, T102): previous / next page, the progress slider (moved = go to that place), and the three
 * panels. The slider's value follows the reader until the finger lifts, then jumps once.
 */
export function MobileReaderBottomBar({
  progress,
  progressLabel,
  onGoToProgress,
  onPrev,
  onNext,
  onOpenToc,
  onOpenMarks,
  onOpenAppearance,
  tocAvailable,
}: {
  progress: number
  progressLabel: string
  onGoToProgress?: (fraction: number) => void
  onPrev: () => void
  onNext: () => void
  onOpenToc: () => void
  onOpenMarks: () => void
  onOpenAppearance: () => void
  tocAvailable: boolean
}) {
  const [dragging, setDragging] = useState<number | null>(null)
  useEffect(() => {
    if (dragging === null) return
    const end = () => setDragging(null)
    window.addEventListener('pointerup', end)
    return () => window.removeEventListener('pointerup', end)
  }, [dragging])
  const shown = dragging ?? progress

  return (
    <footer
      className="fixed inset-x-0 bottom-0 z-[300] border-t border-lib-border bg-lib-topbar/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center gap-1 px-1 pt-1">
        <button type="button" className={iconButton} onClick={onPrev} aria-label="Previous page">
          <span aria-hidden className="text-[20px] leading-none">‹</span>
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(Math.min(1, Math.max(0, shown)) * 1000)}
          disabled={!onGoToProgress}
          aria-label="Reading progress"
          aria-valuetext={progressLabel}
          className="h-11 min-w-0 flex-1 accent-[var(--color-lib-accent)]"
          onChange={(event) => setDragging(Number(event.target.value) / 1000)}
          onPointerUp={(event) => {
            const value = Number((event.target as HTMLInputElement).value) / 1000
            setDragging(null)
            onGoToProgress?.(value)
          }}
          onKeyUp={(event) => onGoToProgress?.(Number((event.target as HTMLInputElement).value) / 1000)}
        />
        <span className="w-14 text-right text-[12px] text-lib-muted tabular-nums">{progressLabel}</span>
        <button type="button" className={iconButton} onClick={onNext} aria-label="Next page">
          <span aria-hidden className="text-[20px] leading-none">›</span>
        </button>
      </div>
      <nav className="flex items-center justify-around px-2 pb-1" aria-label="Reader panels">
        <button type="button" className={`${iconButton} flex-1`} onClick={onOpenToc} disabled={!tocAvailable}>
          Contents
        </button>
        <button type="button" className={`${iconButton} flex-1`} onClick={onOpenMarks}>
          Notes
        </button>
        <button type="button" className={`${iconButton} flex-1`} onClick={onOpenAppearance}>
          Aa
        </button>
      </nav>
    </footer>
  )
}

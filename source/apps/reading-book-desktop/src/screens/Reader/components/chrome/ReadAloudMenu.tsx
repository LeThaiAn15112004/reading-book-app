import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { READ_ALOUD_RATES, useDismissOnOutsideOrEscape, type ReadAloudStatus } from '../../logic'

type ReadAloudMenuProps = {
  open: boolean
  /** The toolbar's Audio button; the menu hangs below it and ignores clicks on it. */
  anchorRef: RefObject<HTMLButtonElement | null>
  status: ReadAloudStatus
  rate: number
  volume: number
  /** False for non-EPUB books or when the system has no speech synthesis. */
  available: boolean
  onClose: () => void
  onReadViewport: () => void
  onReadFromPosition: () => void
  onTogglePlayPause: () => void
  onStop: () => void
  onRateChange: (rate: number) => void
  onVolumeChange: (volume: number) => void
}

const MENU_WIDTH = 288
const VIEWPORT_MARGIN = 8

const itemClass =
  'flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-lib-text transition-colors hover:bg-lib-surface-hover hover:text-lib-text-strong disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent'

const controlClass =
  'inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-lib-border text-xs font-semibold text-lib-text transition-colors hover:border-lib-accent hover:bg-lib-accent-soft hover:text-lib-text-strong disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-lib-border disabled:hover:bg-transparent'

const sectionTitle = 'px-3 pt-2 pb-1.5 text-[11px] font-bold tracking-wide text-lib-faint uppercase'

function Icon({ d, filled = false }: { d: string; filled?: boolean }) {
  return (
    <svg
      className="size-4 shrink-0"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

const ICON_VIEW = 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11ZM8 9.5h8M8 12h8M8 14.5h5'
const ICON_FROM_HERE = 'M6 5v14M10 7.5l8 4.5-8 4.5v-9Z'
const ICON_PLAY = 'M8 5.5v13a.75.75 0 0 0 1.14.64l10.4-6.5a.75.75 0 0 0 0-1.28L9.14 4.86A.75.75 0 0 0 8 5.5Z'
const ICON_PAUSE = 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z'
const ICON_STOP = 'M6.5 6.5h11v11h-11z'

function formatRate(rate: number): string {
  return `${rate}×`
}

/**
 * Read-aloud dropdown for the toolbar's Audio button. Portaled to `document.body`: the tools
 * strip scrolls horizontally (would clip it) and the topbar is transformed (breaks `fixed`).
 */
export function ReadAloudMenu({ open, ...props }: ReadAloudMenuProps) {
  return open ? <ReadAloudMenuPanel {...props} /> : null
}

function ReadAloudMenuPanel({
  anchorRef,
  status,
  rate,
  volume,
  available,
  onClose,
  onReadViewport,
  onReadFromPosition,
  onTogglePlayPause,
  onStop,
  onRateChange,
  onVolumeChange,
}: Omit<ReadAloudMenuProps, 'open'>) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const sync = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const maxLeft = window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN
      const left = Math.min(Math.max(rect.left + rect.width / 2 - MENU_WIDTH / 2, VIEWPORT_MARGIN), maxLeft)
      setPosition({ top: rect.bottom + 8, left })
    }
    sync()
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [anchorRef])

  useDismissOnOutsideOrEscape(menuRef, onClose, { ignoreRef: anchorRef, consumeEscape: true })

  if (!position) return null

  const playing = status === 'playing' || status === 'loading'
  const idle = status === 'idle'

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[400] rounded-xl border border-lib-border bg-lib-surface-strong p-1.5 shadow-xl backdrop-blur-md"
      style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
      role="menu"
      aria-label="Read aloud"
      onClick={(e) => e.stopPropagation()}
    >
      <div className={sectionTitle}>Read aloud</div>
      <button className={itemClass} type="button" role="menuitem" disabled={!available} onClick={onReadViewport}>
        <Icon d={ICON_VIEW} />
        Read current view
      </button>
      <button className={itemClass} type="button" role="menuitem" disabled={!available} onClick={onReadFromPosition}>
        <Icon d={ICON_FROM_HERE} />
        Read from current position
      </button>
      {!available && (
        <p className="px-3 pb-1 text-xs text-lib-faint">Read aloud is available for EPUB books.</p>
      )}

      <div className="mx-1.5 my-1 h-px bg-lib-border-soft" />

      <div className="flex gap-2 px-1.5 py-1.5">
        <button
          className={controlClass}
          type="button"
          disabled={!available}
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={onTogglePlayPause}
        >
          <Icon d={playing ? ICON_PAUSE : ICON_PLAY} filled />
          {playing ? 'Pause' : 'Play'}
        </button>
        <button className={controlClass} type="button" disabled={idle} aria-label="Stop" onClick={onStop}>
          <Icon d={ICON_STOP} filled />
          Stop
        </button>
      </div>

      <div className="mx-1.5 my-1 h-px bg-lib-border-soft" />

      <div className={sectionTitle}>Volume</div>
      <div className="flex items-center gap-3 px-3 pb-2">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          aria-label="Volume"
          className="flex-1 accent-lib-accent"
          onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
        />
        <span className="min-w-10 text-right text-xs font-bold text-lib-text-strong">
          {Math.round(volume * 100)}%
        </span>
      </div>

      <div className={sectionTitle}>Speed</div>
      <div className="mx-1.5 mb-1 flex gap-1 rounded-lg bg-lib-hint p-1" role="group" aria-label="Speed">
        {READ_ALOUD_RATES.map((option) => {
          const active = option === rate
          return (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`h-8 flex-1 cursor-pointer rounded-md text-xs font-semibold transition-colors ${
                active ? 'bg-lib-bg-mid text-lib-accent' : 'text-lib-muted hover:text-lib-text-strong'
              }`}
              onClick={() => onRateChange(option)}
            >
              {formatRate(option)}
            </button>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}

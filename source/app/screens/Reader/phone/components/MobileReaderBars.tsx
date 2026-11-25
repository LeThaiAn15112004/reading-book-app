import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ChromeLayer } from '@core'
import { useT } from '../../../../i18n'
import { usePhoneReaderChromeStore } from '../logic/phoneReaderChromeStore'
import type { ReadingSurface } from '../logic/readingSurface'
import { MobileReaderIcon } from './MobileReaderIcons'

const iconButton =
  'focus-ring flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-lib-text-strong active:bg-lib-hint disabled:opacity-40'

/** Bars fade (FR-009): opacity + visibility only, so the text under them never moves or re-lays out. */
const fade =
  'transition-[opacity,visibility] duration-[180ms] ease-out motion-reduce:transition-none'

const fadeState = (visible: boolean) => (visible ? 'visible opacity-100' : 'invisible opacity-0')

/**
 * Top bar (spec 019, FR-010): Back, the book title, the bookmark (absent for TXT). Its measured height places the
 * toast (FR-012). PDF zoom lives in Appearance now.
 */
export function MobileReaderTopBar({
  visible,
  title,
  onBack,
  bookmarks,
}: {
  visible: boolean
  title: string
  onBack: () => void
  bookmarks?: ReadingSurface['bookmarks']
}) {
  const t = useT()
  const ref = useRef<HTMLElement | null>(null)
  const dispatch = usePhoneReaderChromeStore((s) => s.dispatch)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const report = () => dispatch({ type: 'top-inset', px: Math.round(el.getBoundingClientRect().height) })
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [dispatch])

  return (
    <header
      ref={ref}
      aria-hidden={!visible}
      className={`fixed inset-x-0 top-0 z-[300] border-b border-lib-border bg-lib-topbar/95 backdrop-blur ${fade} ${fadeState(visible)}`}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex min-h-[52px] items-center gap-1 px-1">
        <button type="button" className={iconButton} onClick={onBack} aria-label={t('reader.phone.bars.back')}>
          <MobileReaderIcon name="back" />
        </button>
        <h1 className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold text-lib-text-strong">{title}</h1>
        {bookmarks ? (
          <button
            type="button"
            className={iconButton}
            onClick={bookmarks.toggle}
            aria-pressed={bookmarks.isHere}
            aria-label={bookmarks.isHere ? t('reader.phone.bars.removeBookmark') : t('reader.phone.bars.addBookmark')}
          >
            <MobileReaderIcon name={bookmarks.isHere ? 'bookmarkFilled' : 'bookmark'} />
          </button>
        ) : null}
      </div>
    </header>
  )
}

const KEY_COMMIT_MS = 400

/**
 * The progress slider (FR-011, research R13): a drag goes to the released place exactly once, wherever the finger is
 * lifted; keys move the value and go there on key-up (or 400 ms after the last key), not on every repeat. While held,
 * a bubble shows the target and the bars' idle countdown pauses.
 */
function ProgressSlider({ surface }: { surface: ReadingSurface }) {
  const t = useT()
  const dispatch = usePhoneReaderChromeStore((s) => s.dispatch)
  const [held, setHeld] = useState<number | null>(null)
  const valueRef = useRef<number | null>(null)
  const keyTimerRef = useRef<number | null>(null)
  const goRef = useRef(surface.goToProgress)
  goRef.current = surface.goToProgress

  const commit = () => {
    if (keyTimerRef.current !== null) window.clearTimeout(keyTimerRef.current)
    keyTimerRef.current = null
    const value = valueRef.current
    valueRef.current = null
    setHeld(null)
    dispatch({ type: 'slider-drag', on: false })
    if (value !== null) goRef.current(value)
  }
  const commitRef = useRef(commit)
  commitRef.current = commit

  useEffect(
    () => () => {
      if (keyTimerRef.current !== null) window.clearTimeout(keyTimerRef.current)
      dispatch({ type: 'slider-drag', on: false })
    },
    [dispatch],
  )

  const onPointerDown = () => {
    dispatch({ type: 'slider-drag', on: true })
    const end = () => {
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)
      commitRef.current()
    }
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)
  }

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return
    dispatch({ type: 'slider-drag', on: true })
    if (keyTimerRef.current !== null) window.clearTimeout(keyTimerRef.current)
    keyTimerRef.current = window.setTimeout(() => commitRef.current(), KEY_COMMIT_MS)
  }

  const shown = held ?? surface.progress
  const percent = Math.round(Math.min(1, Math.max(0, shown)) * 100)
  return (
    <div className="relative min-w-0 flex-1">
      {held !== null ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-7 rounded-md bg-lib-surface-strong px-2 py-0.5 text-[12px] font-semibold text-lib-text-strong tabular-nums shadow"
          style={{ left: `calc(${percent}% - 18px)` }}
        >
          {t('reader.phone.place.percent', { value: percent })}
        </span>
      ) : null}
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(Math.min(1, Math.max(0, shown)) * 1000)}
        aria-label={t('reader.phone.bars.progress')}
        aria-valuetext={surface.placeText.detail}
        className="focus-ring block h-11 w-full accent-[var(--color-lib-accent)]"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onKeyUp={() => {
          if (valueRef.current !== null) commitRef.current()
        }}
        onChange={(event) => {
          const value = Number(event.target.value) / 1000
          valueRef.current = value
          setHeld(value)
        }}
      />
    </div>
  )
}

/**
 * Bottom bar (spec 019, FR-010 / FR-010a / FR-017, SC-004): one compact block of at most 64 dp plus the gesture area —
 * the place (chapter name and place in it) above the slider and three icon buttons. Screen-reader order: Previous /
 * Next page (visually hidden, Page view), place, slider, Contents, Notes, Appearance.
 */
export function MobileReaderBottomBar({
  visible,
  surface,
  onOpen,
}: {
  visible: boolean
  surface: ReadingSurface
  onOpen: (layer: Extract<ChromeLayer, 'toc' | 'marks' | 'appearance'>) => void
}) {
  const t = useT()
  const turn = surface.turn
  return (
    <footer
      aria-hidden={!visible}
      className={`fixed inset-x-0 bottom-0 z-[300] border-t border-lib-border bg-lib-topbar/95 backdrop-blur ${fade} ${fadeState(visible)}`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {turn ? (
        <>
          <button type="button" className="sr-only" onClick={() => turn('prev')}>
            {t('reader.phone.bars.previousPage')}
          </button>
          <button type="button" className="sr-only" onClick={() => turn('next')}>
            {t('reader.phone.bars.nextPage')}
          </button>
        </>
      ) : null}
      <div className="flex min-h-[18px] items-baseline gap-2 px-3 pt-1.5 text-[12px] leading-tight">
        <span className="min-w-0 flex-1 truncate font-semibold text-lib-text-strong">{surface.placeText.name ?? ''}</span>
        <span className="shrink-0 text-lib-muted tabular-nums">{surface.placeText.detail}</span>
      </div>
      <div className="flex items-center gap-0.5 pr-1 pl-3">
        <ProgressSlider surface={surface} />
        <nav className="flex shrink-0 items-center" aria-label={t('reader.phone.bars.panels')}>
          {surface.toc.length > 0 ? (
            <button type="button" className={iconButton} onClick={() => onOpen('toc')} aria-label={t('reader.phone.bars.contents')}>
              <MobileReaderIcon name="contents" />
            </button>
          ) : null}
          <button type="button" className={iconButton} onClick={() => onOpen('marks')} aria-label={t('reader.phone.bars.notes')}>
            <MobileReaderIcon name="notes" />
          </button>
          <button type="button" className={iconButton} onClick={() => onOpen('appearance')} aria-label={t('reader.phone.bars.appearance')}>
            <MobileReaderIcon name="appearance" />
          </button>
        </nav>
      </div>
    </footer>
  )
}

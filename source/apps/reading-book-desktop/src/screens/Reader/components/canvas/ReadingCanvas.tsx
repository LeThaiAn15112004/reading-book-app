import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  createHandHoverDwell,
  exceedsDragThreshold,
  isHandHoverCursorTargetAtPoint,
  isInCenterTapZone,
  isTextNodeAtPoint,
  type HandHoverDwell,
} from '../../../../reader/interaction'
import type { InteractionTool } from '@reading-book/book-reader-sdk'
import type { FakeChapter } from '../../logic'

type MarginMode = 'narrow' | 'normal' | 'wide' | 'off'

type ReadingCanvasProps = {
  chapter: FakeChapter
  chapterIndex: number
  margin: MarginMode
  chromeHidden: boolean
  layout: 'single' | 'dual'
  interactionTool?: InteractionTool
  onCanvasBackgroundClick: () => void
  onSelectionDismiss: () => void
  /** Hand pan deltas — scroll the outer zoom viewport when provided. */
  onHandPanBy?: (dx: number, dy: number) => void
}

function hasTextSelection(): boolean {
  const sel = window.getSelection()
  return !!sel && !sel.isCollapsed && !!sel.toString().trim()
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return !!el.closest(
    'a, button, input, textarea, select, summary, [role="button"], [contenteditable="true"]',
  )
}

function isCenterTap(event: MouseEvent<HTMLElement>): boolean {
  return isInCenterTapZone(event.clientX, event.currentTarget.getBoundingClientRect())
}

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

export function ReadingCanvas({
  chapter,
  chapterIndex,
  margin,
  chromeHidden,
  layout,
  interactionTool = 'hand',
  onCanvasBackgroundClick,
  onSelectionDismiss,
  onHandPanBy,
}: ReadingCanvasProps) {
  const renderedChapters = [chapter]

  const marginLayout = chromeHidden ? MARGIN_IMMERSIVE : MARGIN
  const areaLayout =
    layout === 'dual'
      ? 'max-w-[min(1200px,95vw)] columns-1 min-[900px]:columns-2 min-[900px]:gap-16 min-[900px]:[column-rule:1px_dashed_rgb(51_65_85_/_0.45)]'
      : marginLayout[margin]
  const mode = interactionTool
  const modeRef = useRef(mode)
  modeRef.current = mode
  const surfaceRef = useRef<HTMLElement | null>(null)
  const gestureRef = useRef<{
    startX: number
    startY: number
    lastX: number
    lastY: number
    hitText: boolean
    panned: boolean
    scrollTop: number
  } | null>(null)

  /** Hand mode: I-beam once the hover dwell has armed it over text (shared Hand rules). */
  const [handOverText, setHandOverText] = useState(false)
  const handPanningRef = useRef(false)
  const dwellRef = useRef<HandHoverDwell | null>(null)

  useEffect(() => {
    const dwell = createHandHoverDwell(setHandOverText)
    dwellRef.current = dwell
    return () => {
      dwell.dispose()
      dwellRef.current = null
    }
  }, [])

  const applySurfaceSelect = (allowSelect: boolean) => {
    const root = surfaceRef.current
    if (!root) return
    const value = allowSelect ? 'text' : 'none'
    root.style.userSelect = value
    root.style.setProperty('-webkit-user-select', value)
    root.querySelectorAll<HTMLElement>('[data-reader-text]').forEach((el) => {
      el.style.userSelect = value
      el.style.setProperty('-webkit-user-select', value)
    })
  }

  useEffect(() => {
    applySurfaceSelect(true)
  }, [])

  useEffect(() => {
    if (mode !== 'hand') dwellRef.current?.disarm()
  }, [mode])

  /** End a pan press: selection back on (it was suppressed while dragging). */
  const endPan = () => {
    gestureRef.current = null
    if (!handPanningRef.current) return
    handPanningRef.current = false
    applySurfaceSelect(true)
  }

  // Window blur mid-drag (Alt+Tab): no pointerup will come.
  useEffect(() => {
    const onBlur = () => {
      endPan()
      dwellRef.current?.disarm()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
    // `endPan` only touches refs and the surface element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return

    // Hand (shared rules): only text the hover dwell has armed (I-beam) selects; any other press
    // pans, even one that starts on text. Select (unchanged): text selects, margin pans.
    const selectsText =
      mode === 'hand'
        ? !!dwellRef.current?.isArmed() &&
          isHandHoverCursorTargetAtPoint(document, event.clientX, event.clientY)
        : isTextNodeAtPoint(document, event.clientX, event.clientY)
    if (selectsText) {
      gestureRef.current = null
      return
    }

    event.preventDefault()
    handPanningRef.current = true
    dwellRef.current?.disarm()
    applySurfaceSelect(false)
    gestureRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      hitText: false,
      panned: false,
      scrollTop: event.currentTarget.scrollTop,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    // Hand hover cursor: grab, then I-beam after resting on text (no button down).
    if (modeRef.current === 'hand' && !handPanningRef.current && (event.buttons & 1) === 0) {
      dwellRef.current?.update(
        isHandHoverCursorTargetAtPoint(document, event.clientX, event.clientY),
      )
    }

    const g = gestureRef.current
    if (!g) return
    if ((event.buttons & 1) === 0) {
      // Released somewhere we never heard about.
      endPan()
      return
    }
    const dx = event.clientX - g.lastX
    const dy = event.clientY - g.lastY
    g.lastX = event.clientX
    g.lastY = event.clientY
    if (!g.panned && exceedsDragThreshold(g.startX, g.startY, event.clientX, event.clientY)) {
      g.panned = true
    }
    if (onHandPanBy) {
      onHandPanBy(dx, dy)
    } else {
      event.currentTarget.scrollTop -= dy
      event.currentTarget.scrollLeft -= dx
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gestureRef.current
    endPan()
    if (!g || event.button !== 0) return
    if (g.panned) return
    // Margin tap: toggle chrome (toolbar tool unchanged).
    if (!isInteractiveTarget(event.target) && isCenterTap(event)) {
      if (!hasTextSelection()) onSelectionDismiss()
      onCanvasBackgroundClick()
    }
  }

  const cursorClass =
    mode === 'select'
      ? 'cursor-select-tool'
      : handOverText
        ? 'cursor-select-tool'
        : 'cursor-hand-tool active:cursor-hand-tool-active'

  function renderChapterPage(
    renderedChapter: FakeChapter,
    renderedChapterIndex: number,
  ) {
    return (
      <div
        key={`${renderedChapter.num}-${renderedChapterIndex}`}
        data-tw-chapter=""
        className={`relative mx-auto w-full min-h-[calc(100%-48px)] snap-start transition-[max-width] duration-300 ${areaLayout}`}
      >
        <div className="mb-9 border-b border-dashed border-current/15 pb-6 text-center">
          <h2 className="m-0 px-2 font-['Playfair_Display',Georgia,serif] text-[clamp(24px,6vw,32px)] leading-tight font-semibold text-current">
            {renderedChapter.title}
          </h2>
        </div>

        <div
          data-reader-text=""
          className="min-w-0"
          style={{
            fontFamily: 'var(--reader-font-reading)',
            fontSize: 'var(--reader-reading-size)',
            fontWeight: 'var(--reader-reading-weight)' as unknown as number,
            lineHeight: 'var(--reader-reading-line-height)',
            textAlign: 'var(--reader-reading-align)' as 'left',
            color: 'var(--reader-text, #cbd5e1)',
            userSelect: 'text',
          }}
        >
          {renderedChapter.paragraphs.map((text, i) => (
            <div
              key={`${renderedChapter.num}-${i}`}
              className="relative mb-[1.5em] rounded-md"
            >
              <p
                className={`relative m-0 ${i === 0 ? 'indent-0' : 'indent-[1.5em]'} ${
                  i === 0
                    ? 'first-letter:float-left first-letter:mt-1 first-letter:pr-2.5 first-letter:font-["Playfair_Display",Georgia,serif] first-letter:text-[clamp(2.2em,8vw,3.2em)] first-letter:leading-[0.85] first-letter:font-bold first-letter:text-amber-500'
                    : ''
                }`}
              >
                {text}
              </p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <main
      ref={surfaceRef}
      key={chapter.num}
      className={`app-scroll relative min-h-0 flex-1 snap-y snap-mandatory overflow-x-hidden overflow-y-auto px-6 pt-8 pb-20 overscroll-y-contain ${cursorClass}`}
      style={{ userSelect: 'text' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endPan}
      onPointerLeave={() => {
        if (!handPanningRef.current) dwellRef.current?.update(false)
      }}
      onClick={(e) => {
        if (e.defaultPrevented) return
        if (isInteractiveTarget(e.target)) return
        if (hasTextSelection()) return
        onSelectionDismiss()
        // Text / empty click in the center zone toggles chrome; tool stays put.
        if (isTextNodeAtPoint(document, e.clientX, e.clientY)) {
          if (!isCenterTap(e)) return
          onCanvasBackgroundClick()
          return
        }
        // Margin clicks without a pan gesture are handled in pointerup.
      }}
    >
      <div className="contents">
        {renderedChapters.map((renderedChapter) =>
          renderChapterPage(renderedChapter, chapterIndex),
        )}
      </div>

      <div
        className="min-h-[40vh]"
        aria-hidden
        onClick={onCanvasBackgroundClick}
      />
    </main>
  )
}

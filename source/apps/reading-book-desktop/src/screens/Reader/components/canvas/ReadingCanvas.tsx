import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  isTextNodeAtPoint,
  PAN_DRAG_THRESHOLD_PX,
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
  const rect = event.currentTarget.getBoundingClientRect()
  const x = event.clientX - rect.left
  return x >= rect.width * 0.25 && x <= rect.width * 0.75
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

  /** Hand mode: I-beam only while hovering a real text node. */
  const [handOverText, setHandOverText] = useState(false)
  const handPanningRef = useRef(false)

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
    if (mode !== 'hand') setHandOverText(false)
  }, [mode])

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return

    const hitText = isTextNodeAtPoint(document, event.clientX, event.clientY)
    // Hand / Select: text → native select; margin → pan.
    if (hitText) {
      gestureRef.current = null
      return
    }

    event.preventDefault()
    handPanningRef.current = true
    setHandOverText(false)
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
    // Hand hover cursor: I-beam on text nodes, grab elsewhere.
    if (modeRef.current === 'hand' && !handPanningRef.current) {
      const overText = isTextNodeAtPoint(document, event.clientX, event.clientY)
      setHandOverText((prev) => (prev === overText ? prev : overText))
    }

    const g = gestureRef.current
    if (!g || (event.buttons & 1) === 0) return
    const dx = event.clientX - g.lastX
    const dy = event.clientY - g.lastY
    g.lastX = event.clientX
    g.lastY = event.clientY
    const total = Math.hypot(event.clientX - g.startX, event.clientY - g.startY)
    if (!g.panned && total >= PAN_DRAG_THRESHOLD_PX) g.panned = true
    if (onHandPanBy) {
      onHandPanBy(dx, dy)
    } else {
      event.currentTarget.scrollTop -= dy
      event.currentTarget.scrollLeft -= dx
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gestureRef.current
    gestureRef.current = null
    handPanningRef.current = false
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
      onPointerCancel={() => {
        gestureRef.current = null
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

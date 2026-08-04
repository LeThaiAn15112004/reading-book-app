import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { rangeToHighlightHandleRect, elementToHighlightHandleRect } from '../../../../reader/renderers/epub/selection-cfi'
import {
  isPointInTextSelection,
  isTextNodeAtPoint,
  PAN_DRAG_THRESHOLD_PX,
} from '../../../../reader/interaction-hit'
import type { FakeChapter } from '../../fakeReaderContent'
import type {
  AnnotateTool,
  ESignStamp,
  HighlightHandleRect,
  InteractionTool,
  PendingSelection,
  ReaderComment,
  ReaderHighlight,
  TypewriterMark,
} from '../../readerSession'

type MarginMode = 'narrow' | 'normal' | 'wide' | 'off'

type ReadingCanvasProps = {
  chapters: FakeChapter[]
  chapter: FakeChapter
  chapterIndex: number
  margin: MarginMode
  chromeHidden: boolean
  pageMode: 'scroll' | 'paginated'
  layout: 'single' | 'dual' | 'triple'
  activeTool: AnnotateTool
  highlights: ReaderHighlight[]
  comments: ReaderComment[]
  typewriterMarks: TypewriterMark[]
  eSignStamps: ESignStamp[]
  onCanvasBackgroundClick: () => void
  onParagraphClick: (chapterIndex: number, paragraphIndex: number) => void
  onSelectionContextMenu: (
    selection: PendingSelection,
    anchor: { x: number; y: number },
  ) => void
  /** Text Select / Highlight: finished native selection. */
  onTextSelected?: (selection: PendingSelection) => void
  onSelectionDismiss: () => void
  /** Highlight mode: click an existing fake highlight → color edit panel. */
  onHighlightClick?: (
    highlight: Extract<ReaderHighlight, { source: 'fake' }>,
    rect: HighlightHandleRect,
    click: { x: number; y: number },
  ) => void
  onPlaceTypewriter: (chapterIndex: number, xPct: number, yPct: number) => void
  onPlaceESign: (chapterIndex: number, xPct: number, yPct: number) => void
  onTypewriterChange: (id: string, text: string) => void
  onRequestInteractionTool?: (tool: InteractionTool) => void
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
  narrow: 'max-w-[720px]',
  normal: 'max-w-[min(920px,90vw)]',
  wide: 'max-w-[min(1100px,95vw)]',
  off: 'max-w-full px-3',
}

function buildFakeSelection(
  chapterIndex: number,
  paragraphIndex: number,
): PendingSelection | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return null
  const text = sel.toString().trim()
  const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null
  if (!range) return null
  return {
    source: 'fake',
    chapterIndex,
    paragraphIndex,
    selectedText: text,
    rect: rangeToHighlightHandleRect(range),
  }
}

function interactionToolOf(activeTool: AnnotateTool): InteractionTool {
  if (activeTool === 'highlight') return 'highlight'
  if (activeTool === 'select') return 'select'
  return 'hand'
}

export function ReadingCanvas({
  chapters,
  chapter,
  chapterIndex,
  margin,
  chromeHidden,
  pageMode,
  layout,
  activeTool,
  highlights,
  comments,
  typewriterMarks,
  eSignStamps,
  onCanvasBackgroundClick,
  onParagraphClick,
  onSelectionContextMenu,
  onTextSelected,
  onSelectionDismiss,
  onHighlightClick,
  onPlaceTypewriter,
  onPlaceESign,
  onTypewriterChange,
  onRequestInteractionTool,
  onHandPanBy,
}: ReadingCanvasProps) {
  const renderedChapters = pageMode === 'scroll' ? chapters : [chapter]

  const marginLayout = chromeHidden ? MARGIN_IMMERSIVE : MARGIN
  const areaLayout =
    layout === 'triple'
      ? 'max-w-[min(1500px,98vw)] columns-1 min-[900px]:columns-2 min-[1200px]:columns-3 min-[900px]:gap-12 min-[900px]:[column-rule:1px_dashed_rgb(51_65_85_/_0.45)]'
      : layout === 'dual'
        ? 'max-w-[min(1200px,95vw)] columns-1 min-[900px]:columns-2 min-[900px]:gap-16 min-[900px]:[column-rule:1px_dashed_rgb(51_65_85_/_0.45)]'
        : marginLayout[margin]
  const pageBlockFrame =
    pageMode === 'scroll'
      ? 'rounded-sm border border-current/15 bg-lib-bg-deep/20 shadow-[0_14px_40px_rgba(0,0,0,0.22)]'
      : ''

  const mode = interactionToolOf(activeTool)
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
    applySurfaceSelect(mode !== 'hand')
  }, [mode])

  const handleContextMenu = useCallback(
    (
      event: MouseEvent,
      targetChapterIndex: number,
      paragraphIndex: number,
    ) => {
      if (
        activeTool === 'comment' ||
        activeTool === 'typewriter' ||
        activeTool === 'esign' ||
        activeTool === 'highlight'
      ) {
        return
      }
      // Suppress native menu; open floating toolbar only on the selection.
      event.preventDefault()
      event.stopPropagation()
      if (!isPointInTextSelection(document, event.clientX, event.clientY)) {
        return
      }
      const selection = buildFakeSelection(targetChapterIndex, paragraphIndex)
      if (!selection) return
      // Keep the native selection intact while the menu is open.
      onSelectionContextMenu(selection, {
        x: event.clientX,
        y: event.clientY,
      })
    },
    [activeTool, onSelectionContextMenu],
  )

  const handleMouseUp = useCallback(
    (targetChapterIndex: number, paragraphIndex: number) => {
      // Text Select: no auto-popup on mouseup (right-click opens the toolbar).
      // Highlight tool: apply on release.
      if (modeRef.current !== 'highlight') return
      const selection = buildFakeSelection(targetChapterIndex, paragraphIndex)
      if (!selection) return
      onTextSelected?.(selection)
    },
    [onTextSelected],
  )

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return
    if (activeTool === 'typewriter' || activeTool === 'esign' || activeTool === 'comment') {
      return
    }
    const hitText = isTextNodeAtPoint(document, event.clientX, event.clientY)
    if (modeRef.current === 'hand') {
      if (hitText) {
        // Smart switch: arm Text Select so this gesture can select immediately.
        modeRef.current = 'select'
        onRequestInteractionTool?.('select')
        applySurfaceSelect(true)
        gestureRef.current = null
        return
      }
      event.preventDefault()
      gestureRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        hitText: false,
        panned: false,
        scrollTop: event.currentTarget.scrollTop,
      }
      return
    }
    // Highlight stays latched until the user picks another tool.
    if (modeRef.current === 'highlight') {
      gestureRef.current = null
      return
    }
    if (!hitText) {
      gestureRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        hitText: false,
        panned: false,
        scrollTop: event.currentTarget.scrollTop,
      }
    } else {
      gestureRef.current = null
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gestureRef.current
    if (!g || (event.buttons & 1) === 0) return
    const dx = event.clientX - g.lastX
    const dy = event.clientY - g.lastY
    g.lastX = event.clientX
    g.lastY = event.clientY
    const total = Math.hypot(event.clientX - g.startX, event.clientY - g.startY)
    if (!g.panned && total >= PAN_DRAG_THRESHOLD_PX) g.panned = true
    const current = modeRef.current
    if (current === 'hand' || (current === 'select' && !g.hitText)) {
      if (onHandPanBy) {
        onHandPanBy(dx, dy)
      } else {
        event.currentTarget.scrollTop -= dy
        event.currentTarget.scrollLeft -= dx
      }
      if (g.panned) onRequestInteractionTool?.('hand')
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gestureRef.current
    gestureRef.current = null
    if (!g || event.button !== 0) return
    const current = modeRef.current
    if (current === 'highlight') return
    if (g.panned) {
      onRequestInteractionTool?.('hand')
      return
    }
    if (current === 'hand') {
      // Margin tap: chrome toggle (text clicks already switched on pointerdown).
      onRequestInteractionTool?.('hand')
      if (!isInteractiveTarget(event.target) && isCenterTap(event)) {
        onSelectionDismiss()
        onCanvasBackgroundClick()
      }
      return
    }
    if (!g.hitText) {
      onRequestInteractionTool?.('hand')
      if (!hasTextSelection()) onSelectionDismiss()
      if (!isInteractiveTarget(event.target) && isCenterTap(event)) {
        onCanvasBackgroundClick()
      }
    }
  }

  const cursorClass =
    activeTool === 'typewriter' || activeTool === 'esign'
      ? 'cursor-crosshair'
      : mode === 'highlight'
        ? 'cursor-highlight-tool'
        : mode === 'select'
          ? 'cursor-select-tool'
          : 'cursor-hand-tool active:cursor-hand-tool-active'

  function renderChapterPage(
    renderedChapter: FakeChapter,
    renderedChapterIndex: number,
  ) {
    const chapterHighlights = highlights.filter(
      (h): h is Extract<ReaderHighlight, { source: 'fake' }> =>
        h.source === 'fake' && h.chapterIndex === renderedChapterIndex,
    )
    const chapterComments = comments.filter(
      (c) => c.chapterIndex === renderedChapterIndex,
    )
    const chapterTw = typewriterMarks.filter(
      (m) => m.chapterIndex === renderedChapterIndex,
    )
    const chapterSign = eSignStamps.filter(
      (s) => s.chapterIndex === renderedChapterIndex,
    )

    return (
      <div
        key={`${renderedChapter.num}-${renderedChapterIndex}`}
        className={`relative mx-auto w-full transition-[max-width] duration-300 ${areaLayout} ${pageBlockFrame} ${
          pageMode === 'paginated' ? 'min-h-[calc(100%-48px)] snap-start' : ''
        }`}
        onClick={(e) => {
          if (activeTool === 'typewriter' || activeTool === 'esign') {
            const area = e.currentTarget.getBoundingClientRect()
            const xPct = ((e.clientX - area.left) / area.width) * 100
            const yPct = ((e.clientY - area.top) / area.height) * 100
            e.stopPropagation()
            if (activeTool === 'typewriter') {
              onPlaceTypewriter(renderedChapterIndex, xPct, yPct)
            } else {
              onPlaceESign(renderedChapterIndex, xPct, yPct)
            }
          }
        }}
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
            userSelect: mode === 'hand' ? 'none' : 'text',
          }}
        >
          {renderedChapter.paragraphs.map((text, i) => {
            const hl = chapterHighlights.find((h) => h.paragraphIndex === i)
            const commentCount = chapterComments.filter(
              (c) => c.paragraphIndex === i,
            ).length
            return (
              <div
                key={`${renderedChapter.num}-${i}`}
                className={`relative mb-[1.5em] rounded-md ${
                  activeTool === 'comment'
                    ? 'cursor-pointer outline outline-1 outline-transparent hover:bg-amber-500/5 hover:outline-amber-500/45'
                    : ''
                }`}
                onClick={(e) => {
                  if (activeTool === 'comment') {
                    e.stopPropagation()
                    onParagraphClick(renderedChapterIndex, i)
                    return
                  }
                  if (activeTool === 'typewriter' || activeTool === 'esign') {
                    return
                  }
                  if (mode === 'highlight' && hl) {
                    e.stopPropagation()
                    const el = e.currentTarget.querySelector('p')
                    const mapped = el ? elementToHighlightHandleRect(el) : null
                    if (mapped) {
                      onHighlightClick?.(hl, mapped, {
                        x: e.clientX,
                        y: e.clientY,
                      })
                    }
                    return
                  }
                  const sel = window.getSelection()
                  if (sel && !sel.isCollapsed && sel.toString().trim()) return
                }}
                onContextMenu={(e) =>
                  handleContextMenu(e, renderedChapterIndex, i)
                }
                onMouseUp={() => handleMouseUp(renderedChapterIndex, i)}
              >
                <p
                  className={`relative m-0 ${i === 0 ? 'indent-0' : 'indent-[1.5em]'} ${
                    i === 0
                      ? 'first-letter:float-left first-letter:mt-1 first-letter:pr-2.5 first-letter:font-["Playfair_Display",Georgia,serif] first-letter:text-[clamp(2.2em,8vw,3.2em)] first-letter:leading-[0.85] first-letter:font-bold first-letter:text-amber-500'
                      : ''
                  }`}
                  style={
                    hl
                      ? {
                          backgroundColor: `${hl.colorHex}40`,
                          boxShadow: `inset 0 -2px 0 ${hl.colorHex}`,
                        }
                      : undefined
                  }
                >
                  {hl ? (
                    <>
                      <span
                        className="pointer-events-none absolute -top-1 left-0 size-2.5 rounded-full border-2 border-lib-on-accent bg-lib-accent"
                        aria-hidden
                      />
                      <span
                        className="pointer-events-none absolute -right-0 -bottom-1 size-2.5 rounded-full border-2 border-lib-on-accent bg-lib-accent"
                        aria-hidden
                      />
                    </>
                  ) : null}
                  {text}
                </p>
                {commentCount > 0 ? (
                  <button
                    className="absolute top-0 -right-1 inline-flex h-5 min-w-5 cursor-pointer items-center justify-center rounded-full border-none bg-amber-500/15 px-1.5 text-[11px] font-bold text-amber-400"
                    type="button"
                    title={`${commentCount} comment(s)`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onParagraphClick(renderedChapterIndex, i)
                    }}
                  >
                    {commentCount}
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>

        {chapterTw.map((m) => (
          <div
            key={m.id}
            className="absolute z-[5] min-w-[120px] -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${m.xPct}%`, top: `${m.yPct}%` }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              value={m.text}
              placeholder="Type..."
              aria-label="Typewriter text"
              className="h-8 w-40 rounded border border-dashed border-amber-500 bg-slate-950/85 px-2 font-mono text-[13px] text-slate-100 outline-none"
              onChange={(e) => onTypewriterChange(m.id, e.target.value)}
            />
          </div>
        ))}

        {chapterSign.map((s) => (
          <div
            key={s.id}
            className="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2 rounded border-2 border-red-400 bg-red-400/10 px-3.5 py-2 font-['Segoe_Script','Comic_Sans_MS',cursive] text-base font-bold text-red-400 select-none"
            style={{ left: `${s.xPct}%`, top: `${s.yPct}%` }}
          >
            {s.label}
          </div>
        ))}
      </div>
    )
  }

  return (
    <main
      ref={surfaceRef}
      key={pageMode === 'paginated' ? chapter.num : 'continuous'}
      className={`app-scroll relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pt-8 pb-20 overscroll-y-contain ${
        pageMode === 'paginated' ? 'snap-y snap-mandatory' : 'snap-none'
      } ${cursorClass}`}
      style={{ userSelect: mode === 'hand' ? 'none' : 'text' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        gestureRef.current = null
      }}
      onClick={(e) => {
        if (e.defaultPrevented) return
        if (activeTool === 'typewriter' || activeTool === 'esign') return
        if (activeTool === 'comment') return
        if (modeRef.current === 'hand') return
        if (isInteractiveTarget(e.target)) return
        if (hasTextSelection()) return
        if (isTextNodeAtPoint(document, e.clientX, e.clientY)) return
        onRequestInteractionTool?.('hand')
        onSelectionDismiss()
        if (!isCenterTap(e)) return
        onCanvasBackgroundClick()
      }}
    >
      <div
        className={
          pageMode === 'scroll'
            ? 'flex flex-col gap-6'
            : 'contents'
        }
      >
        {renderedChapters.map((renderedChapter, renderedIndex) =>
          renderChapterPage(
            renderedChapter,
            pageMode === 'scroll' ? renderedIndex : chapterIndex,
          ),
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

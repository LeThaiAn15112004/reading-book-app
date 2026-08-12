import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { rangeToHighlightHandleRect, elementToHighlightHandleRect } from '../../../../reader/renderers/epub/selection-cfi'
import {
  isPointInTextSelection,
  isTextNodeAtPoint,
  PAN_DRAG_THRESHOLD_PX,
} from '../../../../reader/interaction-hit'
import {
  appendFreehandPoint,
  blocksSelectionContextMenu,
  clientPointToNormalized,
  isCrosshairAnnotateTool,
  isDrawingTool,
  type AnnotateTool,
  type DrawToolSettings,
  type ESignStamp,
  type FreehandDraftStroke,
  type FreehandPoint,
  type HighlightHandleRect,
  type InteractionTool,
  type PendingSelection,
  type ReaderHighlight,
  type ReaderShapeAnnotation,
  type ReaderTypewriterNote,
  type TypewriterBoxStyle,
  type TypewriterMovePayload,
} from '@reading-book/shared/models'
function freehandUnitPathD(points: FreehandPoint[]): string {
  const first = points[0]
  if (!first) return ''
  let d = `M ${first.x} ${first.y}`
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i]
    if (!p) continue
    d += ` L ${p.x} ${p.y}`
  }
  return d
}
import type { FakeChapter } from '../../logic'
import {
  beginTypewriterDrag,
  tickTypewriterDrag,
  type TypewriterDragSession,
  type TypewriterPct,
} from '../../../../reader/typewriterBoxDrag'
import { hitTestTypewriterAtClientPoint } from '../../../../reader/typewriterHitTest'
import {
  TypewriterRichEditor,
  TypewriterStaticHtml,
  clearTypewriterCommitSuppress,
  createTypewriterFocusSession,
  isTypewriterToolbarTarget,
  requestTypewriterActivation,
} from '../../../../reader/typewriter'

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
  typewriterNotes: ReaderTypewriterNote[]
  eSignStamps: ESignStamp[]
  /** Session freehand strokes (T5.11b). */
  freehandStrokes?: ReaderShapeAnnotation[]
  drawSettings?: DrawToolSettings
  onFreehandStrokeComplete?: (draft: FreehandDraftStroke) => void
  onCanvasBackgroundClick: () => void
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
  onPlaceTypewriter: (
    chapterIndex: number,
    xPct: number,
    yPct: number,
  ) => string | void
  onPlaceESign: (chapterIndex: number, xPct: number, yPct: number) => void
  onTypewriterChange: (id: string, text: string) => void
  /** Flush debounced content persist (e.g. on blur). */
  onTypewriterBlur?: (id: string) => void
  onTypewriterFocus?: (id: string) => void
  onTypewriterContentCancel?: (id: string) => void
  onTypewriterStyleChange?: (id: string, patch: TypewriterBoxStyle) => void
  /** Persist reposition after drag (T5.6c). */
  onTypewriterMove?: (id: string, payload: TypewriterMovePayload) => void
  /** Delete from canvas (empty + Delete/Backspace). */
  onTypewriterDelete?: (id: string) => void
  /** Floating toolbar → shared right reader panel. */
  onTypewriterOpenSidePanel?: () => void
  typewriterSidePanelOpen?: boolean
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
  if (activeTool === 'typewriter') return 'typewriter'
  if (isCrosshairAnnotateTool(activeTool)) return 'annotate'
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
  typewriterNotes,
  eSignStamps,
  freehandStrokes = [],
  drawSettings,
  onFreehandStrokeComplete,
  onCanvasBackgroundClick,
  onSelectionContextMenu,
  onTextSelected,
  onSelectionDismiss,
  onHighlightClick,
  onPlaceTypewriter,
  onPlaceESign,
  onTypewriterChange,
  onTypewriterBlur,
  onTypewriterFocus,
  onTypewriterContentCancel,
  onTypewriterStyleChange,
  onTypewriterMove,
  onTypewriterDelete,
  onTypewriterOpenSidePanel,
  typewriterSidePanelOpen = false,
  onHandPanBy,
}: ReadingCanvasProps) {
  const [activeEditingId, setActiveEditingId] = useState<string | null>(null)
  const activeEditingIdRef = useRef<string | null>(null)
  activeEditingIdRef.current = activeEditingId
  const typewriterFocusSessionRef = useRef(createTypewriterFocusSession())
  const typewriterNoteRefs = useRef(new Map<string, HTMLDivElement>())
  const visibleTypewriterNoteIdsRef = useRef<string[]>([])
  const dragSessionRef = useRef<TypewriterDragSession | null>(null)
  const dragPreviewRef = useRef<(TypewriterPct & { id: string }) | null>(null)
  const suppressTypewriterClickRef = useRef(false)
  const [dragPreview, setDragPreview] = useState<
    (TypewriterPct & { id: string }) | null
  >(null)
  const onTypewriterMoveRef = useRef(onTypewriterMove)
  onTypewriterMoveRef.current = onTypewriterMove
  const onTypewriterBlurRef = useRef(onTypewriterBlur)
  onTypewriterBlurRef.current = onTypewriterBlur
  const drawSettingsRef = useRef(drawSettings)
  drawSettingsRef.current = drawSettings
  const onFreehandStrokeCompleteRef = useRef(onFreehandStrokeComplete)
  onFreehandStrokeCompleteRef.current = onFreehandStrokeComplete
  const inkDraftRef = useRef<{
    pointerId: number
    chapterIndex: number
    host: HTMLElement
    points: FreehandPoint[]
    colorHex: string
    strokeWidth: number
  } | null>(null)
  const [inkDraft, setInkDraft] = useState<FreehandDraftStroke | null>(null)
  const renderedChapters = pageMode === 'scroll' ? chapters : [chapter]
  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool

  const syncInkDraft = useCallback((draft: FreehandDraftStroke | null) => {
    setInkDraft(draft)
  }, [])

  const beginPencilStroke = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      targetChapterIndex: number,
      host: HTMLElement,
    ) => {
      if (activeToolRef.current !== 'pencil' || event.button !== 0) return false
      event.preventDefault()
      event.stopPropagation()
      const settings = drawSettingsRef.current
      const colorHex = settings?.colorHex ?? '#ef4444'
      const strokeWidth = settings?.strokeWidth ?? 2
      const rect = host.getBoundingClientRect()
      const point = clientPointToNormalized(event.clientX, event.clientY, rect)
      if (!point) return false
      inkDraftRef.current = {
        pointerId: event.pointerId,
        chapterIndex: targetChapterIndex,
        host,
        points: [point],
        colorHex,
        strokeWidth,
      }
      syncInkDraft({
        chapterIndex: targetChapterIndex,
        points: [point],
        colorHex,
        strokeWidth,
      })
      try {
        host.setPointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
      return true
    },
    [syncInkDraft],
  )

  // Pencil stroke: window-level move/up so release outside the chapter still commits.
  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const session = inkDraftRef.current
      if (!session || e.pointerId !== session.pointerId) return
      const rect = session.host.getBoundingClientRect()
      const point = clientPointToNormalized(e.clientX, e.clientY, rect)
      if (!point) return
      session.points = appendFreehandPoint(session.points, point)
      syncInkDraft({
        chapterIndex: session.chapterIndex,
        points: session.points,
        colorHex: session.colorHex,
        strokeWidth: session.strokeWidth,
      })
    }

    function endStroke(e: PointerEvent, commit: boolean) {
      const session = inkDraftRef.current
      if (!session || e.pointerId !== session.pointerId) return
      inkDraftRef.current = null
      syncInkDraft(null)
      try {
        session.host.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      if (commit && session.points.length > 0) {
        onFreehandStrokeCompleteRef.current?.({
          chapterIndex: session.chapterIndex,
          points: session.points,
          colorHex: session.colorHex,
          strokeWidth: session.strokeWidth,
        })
      }
    }

    function onPointerUp(e: PointerEvent) {
      endStroke(e, true)
    }
    function onPointerCancel(e: PointerEvent) {
      endStroke(e, false)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [syncInkDraft])

  const commitActiveTypewriterSession = useCallback(() => {
    const editing = activeEditingIdRef.current
    if (!editing) return
    onTypewriterBlurRef.current?.(editing)
    setActiveEditingId(null)
  }, [])

  const setTypewriterDragPreview = useCallback(
    (next: (TypewriterPct & { id: string }) | null) => {
      dragPreviewRef.current = next
      setDragPreview(next)
    },
    [],
  )

  useEffect(() => {
    function endDrag(commit: boolean, openEditIfClick: boolean) {
      const session = dragSessionRef.current
      dragSessionRef.current = null
      const preview = dragPreviewRef.current
      setTypewriterDragPreview(null)
      if (!session) return
      if (session.moved) {
        suppressTypewriterClickRef.current = true
        if (commit && preview && preview.id === session.id) {
          onTypewriterMoveRef.current?.(session.id, {
            xPct: preview.xPct,
            yPct: preview.yPct,
          })
        }
        return
      }
      if (openEditIfClick) {
        setActiveEditingId(session.id)
      }
    }

    function onPointerMove(e: PointerEvent) {
      const session = dragSessionRef.current
      if (!session || e.pointerId !== session.pointerId) return
      const { session: next, preview } = tickTypewriterDrag(
        session,
        e.clientX,
        e.clientY,
      )
      dragSessionRef.current = next
      if (preview) {
        setTypewriterDragPreview({ id: next.id, ...preview })
      }
    }
    function onPointerUp(e: PointerEvent) {
      const session = dragSessionRef.current
      if (!session || e.pointerId !== session.pointerId) return
      endDrag(true, true)
    }
    function onPointerCancel(e: PointerEvent) {
      const session = dragSessionRef.current
      if (!session || e.pointerId !== session.pointerId) return
      endDrag(false, false)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [setTypewriterDragPreview])

  // Hand + Typewriter tools keep inline edit; other tools commit and exit.
  useEffect(() => {
    if (!activeEditingId) return
    if (activeTool === 'hand' || activeTool === 'typewriter') return
    onTypewriterBlur?.(activeEditingId)
    setActiveEditingId(null)
  }, [activeTool, activeEditingId, onTypewriterBlur])

  // Click outside an active edit → save + exit (click 1 of double-click switch).
  useEffect(() => {
    if (!activeEditingId) return

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (isTypewriterToolbarTarget(target)) return
      const editingId = activeEditingIdRef.current
      if (!editingId) return
      const noteEl = typewriterNoteRefs.current.get(editingId)
      if (noteEl?.contains(target)) return
      commitActiveTypewriterSession()
      typewriterFocusSessionRef.current.suppressActivate = true
    }

    function onPointerUp() {
      window.setTimeout(() => {
        clearTypewriterCommitSuppress(typewriterFocusSessionRef.current)
      }, 0)
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
    }
  }, [activeEditingId, commitActiveTypewriterSession])

  /** Activate edit only when idle; while editing, first click commits only. */
  const beginHandTypewriterEdit = useCallback((id: string) => {
    const mayActivate = requestTypewriterActivation({
      session: typewriterFocusSessionRef.current,
      activeEditingId: activeEditingIdRef.current,
      hasDraft: false,
      targetId: id,
      commitEditing: (editingId) => {
        onTypewriterBlurRef.current?.(editingId)
        setActiveEditingId(null)
      },
      commitDraft: () => {},
    })
    if (!mayActivate) return
    setActiveEditingId(id)
  }, [])

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

  const allowTextSelect = mode !== 'annotate' && mode !== 'typewriter'
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
    applySurfaceSelect(allowTextSelect)
  }, [allowTextSelect])

  useEffect(() => {
    if (mode !== 'hand') setHandOverText(false)
  }, [mode])

  const handleContextMenu = useCallback(
    (
      event: MouseEvent,
      targetChapterIndex: number,
      paragraphIndex: number,
    ) => {
      if (blocksSelectionContextMenu(activeTool)) {
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
    const tool = modeRef.current

    // Pencil: start stroke on the chapter under the pointer (surface-level fallback).
    if (activeToolRef.current === 'pencil') {
      event.preventDefault()
      gestureRef.current = null
      if (inkDraftRef.current) return
      const target = event.target as Element | null
      const chapterEl =
        target?.closest?.('[data-tw-chapter]') ??
        (event.currentTarget.querySelector('[data-tw-chapter]') as Element | null)
      if (chapterEl instanceof HTMLElement) {
        const chapters = event.currentTarget.querySelectorAll('[data-tw-chapter]')
        let chapterIndexForHost = chapterIndex
        chapters.forEach((el, i) => {
          if (el === chapterEl) {
            chapterIndexForHost = pageMode === 'scroll' ? i : chapterIndex
          }
        })
        beginPencilStroke(event, chapterIndexForHost, chapterEl)
      }
      return
    }

    // Crosshair annotate / typewriter: placement click wins — no text selection / pan.
    if (tool === 'annotate' || tool === 'typewriter') {
      event.preventDefault()
      gestureRef.current = null
      return
    }

    // Highlight: let native selection run; paint on mouseup.
    if (tool === 'highlight') {
      gestureRef.current = null
      return
    }

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
    const current = modeRef.current
    if (current === 'hand' || current === 'select') {
      if (onHandPanBy) {
        onHandPanBy(dx, dy)
      } else {
        event.currentTarget.scrollTop -= dy
        event.currentTarget.scrollLeft -= dx
      }
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gestureRef.current
    gestureRef.current = null
    handPanningRef.current = false
    if (!g || event.button !== 0) return
    const current = modeRef.current
    if (
      current === 'highlight' ||
      current === 'annotate' ||
      current === 'typewriter'
    ) {
      return
    }
    if (g.panned) return
    if (current === 'hand') {
      // Existing highlight — let the paragraph onClick open the edit panel.
      const hlHost = (event.target as Element | null)?.closest?.(
        '[data-rb-hl-id]',
      )
      if (hlHost) return

      const hitId = hitTestTypewriterAtClientPoint(
        visibleTypewriterNoteIdsRef.current,
        typewriterNoteRefs.current,
        event.clientX,
        event.clientY,
      )
      if (hitId) {
        beginHandTypewriterEdit(hitId)
        return
      }
    }
    // Margin tap: toggle chrome (toolbar tool unchanged).
    if (!isInteractiveTarget(event.target) && isCenterTap(event)) {
      if (!hasTextSelection()) onSelectionDismiss()
      onCanvasBackgroundClick()
    }
  }

  const cursorClass =
    mode === 'typewriter'
      ? 'cursor-typewriter-tool'
      : mode === 'annotate'
        ? 'cursor-crosshair'
        : mode === 'highlight'
          ? 'cursor-highlight-tool'
          : mode === 'select'
            ? 'cursor-select-tool'
            : handOverText
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
    const chapterTw = typewriterNotes.filter(
      (m) => m.chapterIndex === renderedChapterIndex && m.type === 'textbox',
    )
    const chapterSign = eSignStamps.filter(
      (s) => s.chapterIndex === renderedChapterIndex,
    )
    const chapterInk = freehandStrokes.filter(
      (s) => s.chapterIndex === renderedChapterIndex,
    )
    const chapterDraft =
      inkDraft?.chapterIndex === renderedChapterIndex ? inkDraft : null

    return (
      <div
        key={`${renderedChapter.num}-${renderedChapterIndex}`}
        data-tw-chapter=""
        className={`relative mx-auto w-full transition-[max-width] duration-300 ${areaLayout} ${pageBlockFrame} ${
          pageMode === 'paginated' ? 'min-h-[calc(100%-48px)] snap-start' : ''
        }`}
        onPointerDown={(e) => {
          if (activeTool !== 'pencil') return
          beginPencilStroke(e, renderedChapterIndex, e.currentTarget)
        }}
        onClick={(e) => {
          if (activeTool === 'typewriter' || activeTool === 'esign') {
            const area = e.currentTarget.getBoundingClientRect()
            const xPct = ((e.clientX - area.left) / area.width) * 100
            const yPct = ((e.clientY - area.top) / area.height) * 100
            e.stopPropagation()
            if (activeTool === 'typewriter') {
              // Click 1 while editing → commit only; Click 2 → place + edit new box.
              const mayPlace = requestTypewriterActivation({
                session: typewriterFocusSessionRef.current,
                activeEditingId: activeEditingIdRef.current,
                hasDraft: false,
                commitEditing: (id) => {
                  onTypewriterBlurRef.current?.(id)
                  setActiveEditingId(null)
                },
                commitDraft: () => {},
              })
              if (!mayPlace) return
              const newId = onPlaceTypewriter(
                renderedChapterIndex,
                xPct,
                yPct,
              )
              if (typeof newId === 'string' && newId) {
                setActiveEditingId(newId)
              }
            } else {
              onPlaceESign(renderedChapterIndex, xPct, yPct)
            }
            return
          }
          if (isDrawingTool(activeTool)) {
            e.stopPropagation()
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
            userSelect: allowTextSelect ? 'text' : 'none',
          }}
        >
          {renderedChapter.paragraphs.map((text, i) => {
            const hl = chapterHighlights.find((h) => h.paragraphIndex === i)
            return (
              <div
                key={`${renderedChapter.num}-${i}`}
                className="relative mb-[1.5em] rounded-md"
                {...(hl ? { 'data-rb-hl-id': hl.id } : {})}
                onClick={(e) => {
                  if (isCrosshairAnnotateTool(activeTool)) {
                    return
                  }
                  // Hand + Highlight: tap an existing mark to edit (color / note / delete).
                  if ((mode === 'highlight' || mode === 'hand') && hl) {
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
              </div>
            )
          })}
        </div>

        {chapterTw.map((m) => {
          let pos = { xPct: 0, yPct: 0 }
          try {
            pos = JSON.parse(m.positionData) as { xPct: number; yPct: number }
          } catch {
            // Keep the note visible at the page origin if stored data is invalid.
          }
          if (dragPreview?.id === m.id) {
            pos = { xPct: dragPreview.xPct, yPct: dragPreview.yPct }
          }
          const editing = activeEditingId === m.id
          const dragging = dragPreview?.id === m.id
          const color =
            typeof m.colorHex === 'string' && m.colorHex.trim()
              ? m.colorHex
              : undefined

          const startDrag = (
            e: ReactPointerEvent<HTMLElement>,
            origin: TypewriterPct,
          ) => {
            e.stopPropagation()
            if (e.button !== 0) return
            const chapterArea = (e.currentTarget as HTMLElement).closest(
              '[data-tw-chapter]',
            )
            if (!(chapterArea instanceof HTMLElement)) return
            const bounds = chapterArea.getBoundingClientRect()
            dragSessionRef.current = beginTypewriterDrag({
              id: m.id,
              pointerId: e.pointerId,
              clientX: e.clientX,
              clientY: e.clientY,
              originXPct: origin.xPct,
              originYPct: origin.yPct,
              bounds,
            })
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              /* ignore */
            }
          }

          return (
            <div
              key={m.id}
              ref={(el) => {
                if (el) typewriterNoteRefs.current.set(m.id, el)
                else typewriterNoteRefs.current.delete(m.id)
              }}
              data-typewriter-note={m.id}
              data-rb-tw-note={m.id}
              className={`absolute z-[5] -translate-x-1/2 -translate-y-1/2 ${
                dragging ? 'rb-typewriter-dragging' : ''
              }`}
              style={{ left: `${pos.xPct}%`, top: `${pos.yPct}%`, color }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => {
                // Block chapter place-new while interacting with an existing box.
                e.stopPropagation()
              }}
            >
              {editing ? (
                <TypewriterRichEditor
                  autoFocus
                  value={m.content}
                  colorHex={m.colorHex}
                  fontSize={m.fontSize}
                  placeholder="Type..."
                  onFocus={() => onTypewriterFocus?.(m.id)}
                  onChange={(html) => onTypewriterChange(m.id, html)}
                  onStyleChange={(patch) =>
                    onTypewriterStyleChange?.(m.id, patch)
                  }
                  onBlur={() => {
                    if (dragSessionRef.current?.id === m.id) return
                    onTypewriterBlur?.(m.id)
                    setActiveEditingId(null)
                  }}
                  onEmptyDelete={() => {
                    setActiveEditingId(null)
                    onTypewriterDelete?.(m.id)
                  }}
                  onCancel={() => {
                    onTypewriterContentCancel?.(m.id)
                    setActiveEditingId(null)
                  }}
                  onOpenSidePanel={onTypewriterOpenSidePanel}
                  sidePanelOpen={typewriterSidePanelOpen}
                  dragHandle={
                    <button
                      type="button"
                      className="rb-typewriter-drag-handle"
                      aria-label="Move typewriter note"
                      onPointerDown={(e) => {
                        e.preventDefault()
                        startDrag(e, pos)
                      }}
                    />
                  }
                />
              ) : (
                <button
                  type="button"
                  className="rb-typewriter-static border-none bg-transparent p-0 text-left cursor-grab"
                  aria-label="Typewriter note"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    // Hand + typewriter: drag to move; click (no move) opens edit.
                    if (mode === 'hand' || mode === 'typewriter') {
                      startDrag(e, pos)
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (suppressTypewriterClickRef.current) {
                      suppressTypewriterClickRef.current = false
                      return
                    }
                    if (mode === 'hand' || mode === 'typewriter') {
                      beginHandTypewriterEdit(m.id)
                    }
                  }}
                >
                  <TypewriterStaticHtml
                    html={m.content}
                    colorHex={m.colorHex}
                    fontSize={m.fontSize}
                  />
                </button>
              )}
            </div>
          )
        })}

        {chapterSign.map((s) => (
          <div
            key={s.id}
            className="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2 rounded border-2 border-red-400 bg-red-400/10 px-3.5 py-2 font-['Segoe_Script','Comic_Sans_MS',cursive] text-base font-bold text-red-400 select-none"
            style={{ left: `${s.xPct}%`, top: `${s.yPct}%` }}
          >
            {s.label}
          </div>
        ))}

        {/* Ink above text; always mount while pencil is active so the first point paints. */}
        {(activeTool === 'pencil' ||
          chapterInk.length > 0 ||
          chapterDraft) && (
          <svg
            data-rb-ink-layer=""
            className="pointer-events-none absolute inset-0 z-[8] h-full w-full overflow-visible"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden
          >
            {chapterInk.map((stroke) => {
              const d = freehandUnitPathD(stroke.points)
              if (!d) return null
              return (
                <path
                  key={stroke.id}
                  data-rb-ink-stroke={stroke.id}
                  d={d}
                  fill="none"
                  stroke={stroke.colorHex}
                  strokeWidth={Math.max(1, stroke.strokeWidth)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
            {chapterDraft
              ? (() => {
                  const d = freehandUnitPathD(chapterDraft.points)
                  if (!d) return null
                  return (
                    <path
                      data-rb-ink-draft=""
                      d={d}
                      fill="none"
                      stroke={chapterDraft.colorHex}
                      strokeWidth={Math.max(1, chapterDraft.strokeWidth)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )
                })()
              : null}
          </svg>
        )}
      </div>
    )
  }

  visibleTypewriterNoteIdsRef.current = typewriterNotes
    .filter((m) => m.type === 'textbox')
    .map((m) => m.id)

  return (
    <main
      ref={surfaceRef}
      key={pageMode === 'paginated' ? chapter.num : 'continuous'}
      className={`app-scroll relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pt-8 pb-20 overscroll-y-contain ${
        pageMode === 'paginated' ? 'snap-y snap-mandatory' : 'snap-none'
      } ${cursorClass}`}
      style={{ userSelect: allowTextSelect ? 'text' : 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        gestureRef.current = null
      }}
      onClick={(e) => {
        if (e.defaultPrevented) return
        if (modeRef.current === 'annotate' || modeRef.current === 'typewriter') {
          return
        }
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

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { CfiLocation, Highlight } from '@reading-book/domain'
import type {
  FontFamily,
  FontWeight,
  HighlightHandleRect,
  InteractionTool,
  ReaderTheme,
  ReaderTypewriterNote,
  TextAlign,
  TypewriterBoxStyle,
  TypewriterDraft,
  TypewriterMovePayload,
  TypewriterPlacePayload,
} from '@reading-book/shared/models'
import {
  parseTypewriterPosition,
  type EpubReaderHighlight,
  type PendingSelection,
} from '@reading-book/shared/models'
import type { DomCssOverlay } from '../../overlays/dom-css-overlay'
import {
  buildEpubSelectionPayloadFromDocument,
  epubFrameContextFromView,
  openEpubjs,
  type EpubFrameSelectionContext,
  type EpubjsHandle,
  type EpubNavState,
  type EpubPageLayout,
  type EpubPageMode,
  type EpubSelectionPayload,
  type EpubTocItem,
} from './openEpubjs'
import {
  captureTypewriterAnchor,
  resolveTypewriterHostPoint,
  typewriterBelongsToRenderedSection,
} from './typewriter-cfi-anchor'
import { applyInteractionToolSurface } from '../../cursors'
import {
  HAND_HOVER_CURSOR_DELAY_MS,
  isHandHoverCursorTargetAtPoint,
  isPointInTextSelection,
  isTextCursorTargetAtPoint,
  isTextNodeAtPoint,
  PAN_DRAG_THRESHOLD_PX,
} from '../../interaction-hit'
import {
  beginTypewriterDrag,
  tickTypewriterDrag,
  type TypewriterDragSession,
  type TypewriterPct,
} from '../../typewriterBoxDrag'
import { hitTestTypewriterAtClientPoint } from '../../typewriterHitTest'
import {
  TypewriterRichEditor,
  TypewriterStaticHtml,
} from '../../typewriter'
/** Imperative nav for parent footer scrub / section jump. */
export type EpubRendererApi = Pick<
  EpubjsHandle,
  | 'nextPage'
  | 'prevPage'
  | 'nextSection'
  | 'prevSection'
  | 'goToHref'
  | 'goToSpineIndex'
  | 'getSpineLength'
  | 'getNavState'
  | 'getToc'
  | 'getCurrentLocation'
  | 'goToLocation'
  | 'clearSelection'
  | 'setFontSize'
  | 'setFontFamily'
  | 'setFontWeight'
  | 'setLineHeight'
  | 'setTextAlign'
  | 'setMargins'
  | 'setChromeHidden'
  | 'resize'
  | 'captureVisiblePreview'
  | 'loadSpinePreviewHtml'
> & {
  /** Force DomCssOverlay full reload (T5.3) — usually driven by `rendered` / props. */
  repaintHighlights: () => void
  /**
   * Resolve a 1-based UI page into a JPEG thumbnail data URL (cover image,
   * live snapshot, or rasterized spine section).
   */
  getPagePreview: (page: number) => Promise<EpubPagePreview | null>
}

export type EpubPagePreview = { kind: 'image'; src: string }

type EpubRendererProps = {
  data: ArrayBuffer
  /** Extracted cover shown as page 1 when the EPUB has no cover document in its spine. */
  coverUrl?: string
  theme: ReaderTheme
  layout?: EpubPageLayout
  pageMode?: EpubPageMode
  /** Reflow zoom — px (same scale as Aa font size). */
  fontSize?: number
  fontFamily?: FontFamily
  fontWeight?: FontWeight
  lineHeight?: number
  textAlign?: TextAlign
  marginsEnabled?: boolean
  marginPreset?: string
  /** Reader chrome hidden → wider text column. */
  chromeHidden?: boolean
  /** Resume at CFI on open (T4.1). Wired by T4.4. */
  initialLocation?: CfiLocation
  className?: string
  /** Tap/click the center reading zone to reveal/hide Reader chrome. */
  onCenterTap?: () => void
  onNavState?: (state: EpubNavState) => void
  /** Stable CFI after relocated — for persist flush (T4.2). */
  onLocationChange?: (location: CfiLocation) => void
  onToc?: (items: EpubTocItem[]) => void
  /** Right-click on selected text → selection menu (FR-06). */
  onSelectionContextMenu?: (
    selection: PendingSelection,
    anchor: { x: number; y: number },
  ) => void
  /**
   * Fired when Highlight tool finishes a selection (pointerup).
   * Text Select does not auto-open the toolbar — right-click does.
   */
  onTextSelected?: (selection: PendingSelection) => void
  /** Dismiss menu when page/section changes. */
  onSelectionDismiss?: () => void
  /** Click an existing painted highlight (tool color-edit panel). */
  onHighlightMarkClick?: (mark: {
    id: string
    cfiRange: string
    colorHex: string
    rect: HighlightHandleRect
    click: { x: number; y: number }
  }) => void
  /** In-memory EPUB highlights to paint via epubjs annotations (T5.1). */
  highlights?: EpubReaderHighlight[]
  /**
   * Surface mode from toolbar (hand / select / highlight / typewriter / annotate).
   * Never mutated by gestures — toolbar state stays authoritative.
   */
  interactionTool?: InteractionTool
  /** Persisted typewriter textboxes for the current book (host overlay paint). */
  typewriterNotes?: ReaderTypewriterNote[]
  /** Spine/chapter index used to filter which notes to paint. */
  typewriterChapterIndex?: number
  /** Virtual textbox while typing (owned by ReaderScreen). */
  typewriterDraft?: TypewriterDraft | null
  /** Typewriter tool: click page → place virtual textbox. */
  onTypewriterPlace?: (payload: TypewriterPlacePayload) => void
  onTypewriterDraftChange?: (content: string) => void
  onTypewriterDraftStyleChange?: (patch: TypewriterBoxStyle) => void
  /** Commit draft by id (ignore stale blur after place-replace). */
  onTypewriterDraftCommit?: (draftId: string) => void
  onTypewriterDraftCancel?: (draftId: string) => void
  onTypewriterContentChange?: (id: string, text: string) => void
  onTypewriterContentBlur?: (id: string) => void
  onTypewriterContentFocus?: (id: string) => void
  /** Box-level defaults → `style_properties` (font size / default color). */
  onTypewriterStyleChange?: (id: string, patch: TypewriterBoxStyle) => void
  /** Persist reposition after drag (T5.6c/d). */
  onTypewriterMove?: (id: string, payload: TypewriterMovePayload) => void
  /** Delete from canvas (empty + Delete/Backspace). */
  onTypewriterDelete?: (id: string) => void
  /**
   * Hand + Ctrl/Meta wheel — focus-zoom. Coords are viewport (parent) space.
   * Return true if the event was handled.
   */
  onFocusZoomWheel?: (detail: {
    clientX: number
    clientY: number
    deltaY: number
  }) => boolean
  /** Hand pan deltas (px) — used to scroll the outer zoom viewport when zoomed. */
  onHandPanBy?: (dx: number, dy: number) => void
  apiRef?: MutableRefObject<EpubRendererApi | null>
}

function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name?: string }).name === 'AbortError'
  )
}


function hasFrameTextSelection(doc: Document): boolean {
  const sel = doc.defaultView?.getSelection()
  return !!sel && !sel.isCollapsed && (sel.toString()?.trim().length ?? 0) > 0
}

function isInteractiveElement(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return !!el.closest(
    'a, button, input, textarea, select, summary, [role="button"], [contenteditable="true"]',
  )
}

function isCenterClick(event: MouseEvent, doc: Document): boolean {
  const width =
    doc.defaultView?.innerWidth ||
    doc.documentElement.clientWidth ||
    doc.body?.clientWidth ||
    0
  if (width <= 0) return false
  return event.clientX >= width * 0.25 && event.clientX <= width * 0.75
}

type SyntheticCoverNavigation = {
  isAvailable: () => boolean
  isShown: () => boolean
  show: () => Promise<void>
  hide: () => void
  navState: () => EpubNavState
}

function toApi(
  handle: EpubjsHandle,
  cover: SyntheticCoverNavigation,
  repaintHighlights: () => void,
  getCoverUrl: () => string | undefined,
): EpubRendererApi {
  return {
    nextPage: async () => {
      if (cover.isShown()) {
        cover.hide()
        return
      }
      await handle.nextPage()
    },
    prevPage: async () => {
      if (cover.isShown()) return
      if (!cover.isAvailable()) {
        await handle.prevPage()
        return
      }
      const before = handle.getCurrentLocation()?.cfi
      await handle.prevPage()
      const after = handle.getCurrentLocation()?.cfi
      if (
        handle.getNavState().spineIndex === 0 &&
        before === after
      ) {
        await cover.show()
      }
    },
    nextSection: async () => {
      if (cover.isShown()) {
        cover.hide()
        return
      }
      await handle.nextSection()
    },
    prevSection: async () => {
      if (cover.isShown()) return
      if (cover.isAvailable() && handle.getNavState().spineIndex === 0) {
        await cover.show()
        return
      }
      await handle.prevSection()
    },
    goToHref: async (href) => {
      cover.hide()
      await handle.goToHref(href)
    },
    goToSpineIndex: async (i) => {
      if (cover.isAvailable()) {
        if (i <= 0) {
          await cover.show()
          return
        }
        cover.hide()
        await handle.goToSpineIndex(i - 1)
        return
      }
      await handle.goToSpineIndex(i)
    },
    getSpineLength: () =>
      handle.getSpineLength() + (cover.isAvailable() ? 1 : 0),
    getNavState: cover.navState,
    getToc: () => handle.getToc(),
    getCurrentLocation: () => handle.getCurrentLocation(),
    goToLocation: async (location) => {
      cover.hide()
      await handle.goToLocation(location)
    },
    setFontSize: (px) => handle.setFontSize(px),
    setFontFamily: (family) => handle.setFontFamily(family),
    setFontWeight: (weight) => handle.setFontWeight(weight),
    setLineHeight: (lineHeight) => handle.setLineHeight(lineHeight),
    setTextAlign: (textAlign) => handle.setTextAlign(textAlign),
    setMargins: (enabled, preset) => handle.setMargins(enabled, preset),
    setChromeHidden: (hidden) => handle.setChromeHidden(hidden),
    resize: () => handle.resize(),
    clearSelection: () => handle.clearSelection(),
    captureVisiblePreview: (maxWidth, maxHeight) =>
      handle.captureVisiblePreview(maxWidth, maxHeight),
    loadSpinePreviewHtml: (visibleIndex) =>
      handle.loadSpinePreviewHtml(visibleIndex),
    getPagePreview: async (page) => {
      if (!Number.isFinite(page) || page < 1) return null
      if (cover.isAvailable() && page === 1) {
        const src = getCoverUrl()
        return src ? { kind: 'image', src } : null
      }
      const spineIndex = cover.isAvailable() ? page - 2 : page - 1
      if (spineIndex < 0) return null
      const nav = cover.navState()
      if (nav.pageCurrent === page) {
        const snap = await handle.captureVisiblePreview(160, 220)
        if (snap) return { kind: 'image', src: snap }
      }
      const raster = await handle.rasterizeSpinePreview(spineIndex, 160, 220)
      return raster ? { kind: 'image', src: raster } : null
    },
    repaintHighlights,
  }
}

/** Convert in-memory EPUB highlights → domain Highlight for DomCssOverlay.paint. */
function epubHighlightsToDomain(
  highlights: EpubReaderHighlight[],
): Highlight[] {
  const now = new Date().toISOString()
  const out: Highlight[] = []
  for (const h of highlights) {
    const cfiRange = (h.cfiRange || h.locationStart || '').trim()
    if (!cfiRange) continue
    const selectedText = h.selectedText.trim() || ' '
    try {
      out.push(
        new Highlight({
          id: h.id,
          bookId: '_',
          location: Highlight.packLocation(
            new CfiLocation(cfiRange),
            new CfiLocation(
              (h.locationEnd || h.locationStart || cfiRange).trim() || cfiRange,
            ),
          ),
          selectedText,
          colorHex: h.colorHex,
          note: h.note,
          createdAt: h.createdAt || now,
          updatedAt: h.updatedAt || now,
        }),
      )
    } catch {
      /* skip invalid color / location */
    }
  }
  return out
}

function selectionPayloadToPending(
  payload: EpubSelectionPayload,
): PendingSelection {
  return {
    source: 'epub',
    cfiRange: payload.cfiRange,
    locationStart: payload.locationStart,
    locationEnd: payload.locationEnd,
    selectedText: payload.selectedText,
    rect: payload.rect,
    chapterIndex: payload.sectionIndex,
  }
}

type IframeHostBox = {
  left: number
  top: number
  width: number
  height: number
}

function iframeHostBoxesEqual(
  a: IframeHostBox | null,
  b: IframeHostBox | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  )
}

/**
 * Production EPUB surface (T3.3) — epubjs from ArrayBuffer; no FS paths.
 * Dual layout draws a center gutter; spine order includes cover as a normal page.
 * T3.5: page/section nav + relocated state for footer scrub.
 */
export function EpubRenderer({
  data,
  coverUrl,
  theme,
  layout = 'single',
  pageMode = 'paginated',
  fontSize = 18,
  fontFamily = 'serif',
  fontWeight = 400,
  lineHeight = 1.65,
  textAlign = 'justify',
  marginsEnabled = true,
  marginPreset = 'normal',
  chromeHidden = true,
  initialLocation,
  className,
  onCenterTap,
  onNavState,
  onLocationChange,
  onToc,
  onSelectionContextMenu,
  onTextSelected,
  onSelectionDismiss,
  onHighlightMarkClick,
  highlights,
  interactionTool = 'hand',
  typewriterNotes,
  typewriterChapterIndex = 0,
  typewriterDraft = null,
  onTypewriterPlace,
  onTypewriterDraftChange,
  onTypewriterDraftStyleChange,
  onTypewriterDraftCommit,
  onTypewriterDraftCancel,
  onTypewriterContentChange,
  onTypewriterContentBlur,
  onTypewriterContentFocus,
  onTypewriterStyleChange,
  onTypewriterMove,
  onTypewriterDelete,
  onFocusZoomWheel,
  onHandPanBy,
  apiRef,
}: EpubRendererProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [activeEditingId, setActiveEditingId] = useState<string | null>(null)
  const activeEditingIdRef = useRef<string | null>(null)
  activeEditingIdRef.current = activeEditingId
  const typewriterNoteRefs = useRef(new Map<string, HTMLDivElement>())
  const chapterTypewriterNoteIdsRef = useRef<string[]>([])
  const dragSessionRef = useRef<TypewriterDragSession | null>(null)
  const dragPreviewRef = useRef<(TypewriterPct & { id: string }) | null>(null)
  const suppressTypewriterClickRef = useRef(false)
  const [dragPreview, setDragPreview] = useState<
    (TypewriterPct & { id: string }) | null
  >(null)
  const onTypewriterContentBlurRef = useRef(onTypewriterContentBlur)
  onTypewriterContentBlurRef.current = onTypewriterContentBlur
  const onTypewriterMoveRef = useRef(onTypewriterMove)
  onTypewriterMoveRef.current = onTypewriterMove
  const typewriterFrameRef = useRef<{
    doc: Document
    ctx: EpubFrameSelectionContext
    cfiBase?: string
  } | null>(null)
  const remeasureTypewriterHostRef = useRef<() => void>(() => {})
  const dragEndClientRef = useRef<{ x: number; y: number } | null>(null)
  const iframeHostBoxRef = useRef<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

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
          const frame = typewriterFrameRef.current
          const host = hostRef.current
          const iframe = host?.querySelector('iframe')
          const ir = iframe?.getBoundingClientRect()
          let movePayload: TypewriterMovePayload = {
            xPct: preview.xPct,
            yPct: preview.yPct,
          }
          const endPt = dragEndClientRef.current
          if (frame && ir && endPt) {
            const cap = captureTypewriterAnchor({
              doc: frame.doc,
              ctx: frame.ctx,
              iframeClientX: endPt.x - ir.left,
              iframeClientY: endPt.y - ir.top,
              iframeRect: ir,
            })
            if (cap) {
              movePayload = {
                xPct: cap.xPct,
                yPct: cap.yPct,
                cfi: cap.cfi,
                offsetPx: cap.offsetPx,
              }
            }
          }
          onTypewriterMoveRef.current?.(session.id, movePayload)
          remeasureTypewriterHostRef.current()
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
      dragEndClientRef.current = { x: e.clientX, y: e.clientY }
      endDrag(true, true)
      dragEndClientRef.current = null
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
  const handleRef = useRef<EpubjsHandle | null>(null)
  const overlayPainterRef = useRef<DomCssOverlay | null>(null)
  const highlightsRef = useRef<EpubReaderHighlight[]>(highlights ?? [])
  highlightsRef.current = highlights ?? []
  const lastEpubSelectionRef = useRef<PendingSelection | null>(null)
  const interactionToolRef = useRef<InteractionTool>(interactionTool)
  interactionToolRef.current = interactionTool
  const onTypewriterPlaceRef = useRef(onTypewriterPlace)
  onTypewriterPlaceRef.current = onTypewriterPlace
  const typewriterChapterIndexRef = useRef(typewriterChapterIndex)
  typewriterChapterIndexRef.current = typewriterChapterIndex
  const onFocusZoomWheelRef = useRef(onFocusZoomWheel)
  onFocusZoomWheelRef.current = onFocusZoomWheel
  const onHandPanByRef = useRef(onHandPanBy)
  onHandPanByRef.current = onHandPanBy
  const grabbingRef = useRef(false)
  /** Hand mode: I-beam/pointer armed after hover dwell over text/annotations. */
  const hoverTextRef = useRef(false)
  const hoverCursorTimerRef = useRef<number | null>(null)
  const hoverOverTargetRef = useRef(false)
  type HandPanGesture = {
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    panned: boolean
    scrollEl: Element | null
    captureEl: HTMLElement | null
    doc: Document
  }
  const panGestureRef = useRef<HandPanGesture | null>(null)

  const releasePanPointerCapture = (
    captureEl: HTMLElement | null,
    pointerId: number,
  ) => {
    if (!captureEl?.hasPointerCapture?.(pointerId)) return
    try {
      captureEl.releasePointerCapture(pointerId)
    } catch {
      /* already released */
    }
  }

  const clearHoverCursorTimer = () => {
    if (hoverCursorTimerRef.current == null) return
    window.clearTimeout(hoverCursorTimerRef.current)
    hoverCursorTimerRef.current = null
  }

  const applyHandSurface = (options?: {
    grabbing?: boolean
    hoverText?: boolean
  }) => {
    const grabbing = options?.grabbing ?? grabbingRef.current
    const hoverText =
      options?.hoverText ?? (hoverTextRef.current && !grabbing)
    grabbingRef.current = grabbing
    hoverTextRef.current = hoverText && !grabbing
    applyInteractionToolSurface(
      hostRef.current,
      interactionToolRef.current,
      {
        grabbing,
        hoverText: hoverTextRef.current,
      },
    )
  }

  const disarmHoverTextCursor = () => {
    clearHoverCursorTimer()
    hoverOverTargetRef.current = false
    if (!hoverTextRef.current) return
    applyHandSurface({ hoverText: false })
  }

  const applyHandGrabbing = (grabbing: boolean) => {
    if (grabbing) {
      clearHoverCursorTimer()
      hoverOverTargetRef.current = false
      hoverTextRef.current = false
    }
    applyHandSurface({ grabbing, hoverText: grabbing ? false : hoverTextRef.current })
  }

  /** End hand pan — always clears grabbing cursor (even if pointerup fires outside iframe). */
  const clearHandPanGesture = (event?: PointerEvent): HandPanGesture | null => {
    const active = panGestureRef.current
    if (active && event) {
      if (event.pointerId !== active.pointerId) return null
      if (event.type === 'pointerup' && event.button !== 0) return null
    }
    if (!active && !grabbingRef.current) return null

    const ended = active
    if (active) {
      releasePanPointerCapture(active.captureEl, active.pointerId)
      panGestureRef.current = null
    }
    if (grabbingRef.current) {
      applyHandGrabbing(false)
    }
    return ended
  }

  const onNavStateRef = useRef(onNavState)
  onNavStateRef.current = onNavState
  const onLocationChangeRef = useRef(onLocationChange)
  onLocationChangeRef.current = onLocationChange
  const onTocRef = useRef(onToc)
  onTocRef.current = onToc
  const onCenterTapRef = useRef(onCenterTap)
  onCenterTapRef.current = onCenterTap
  const onSelectionContextMenuRef = useRef(onSelectionContextMenu)
  onSelectionContextMenuRef.current = onSelectionContextMenu
  const onTextSelectedRef = useRef(onTextSelected)
  onTextSelectedRef.current = onTextSelected
  const onSelectionDismissRef = useRef(onSelectionDismiss)
  onSelectionDismissRef.current = onSelectionDismiss
  const onHighlightMarkClickRef = useRef(onHighlightMarkClick)
  onHighlightMarkClickRef.current = onHighlightMarkClick
  const coverUrlRef = useRef(coverUrl)
  coverUrlRef.current = coverUrl
  const initialLocationRef = useRef(initialLocation)
  initialLocationRef.current = initialLocation
  const apiRefProp = useRef(apiRef)
  apiRefProp.current = apiRef

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [syntheticCoverShown, setSyntheticCoverShown] = useState(false)
  const syntheticCoverShownRef = useRef(false)

  const paintHighlightsNow = useCallback(() => {
    const painter = overlayPainterRef.current
    if (!painter) return
    const domain = epubHighlightsToDomain(highlightsRef.current)
    void painter.paint({ highlights: domain })
  }, [])

  const repaintTimerRef = useRef<number | null>(null)
  const scheduleRepaint = useCallback(() => {
    // Debounce: epubjs may fire multiple `rendered` events during a single turn.
    if (!overlayPainterRef.current) return
    if (repaintTimerRef.current != null) {
      window.clearTimeout(repaintTimerRef.current)
    }
    repaintTimerRef.current = window.setTimeout(() => {
      repaintTimerRef.current = null
      paintHighlightsNow()
    }, 50)
  }, [paintHighlightsNow])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const ac = new AbortController()
    setStatus('loading')
    setErrorMessage(null)
    syntheticCoverShownRef.current = false
    setSyntheticCoverShown(false)
    overlayPainterRef.current = null
    if (apiRefProp.current) apiRefProp.current.current = null

    openEpubjs(data, host, {
      theme,
      layout,
      pageMode,
      fontSize,
      fontFamily,
      fontWeight,
      lineHeight,
      textAlign,
      marginsEnabled,
      marginPreset,
      chromeHidden,
      initialLocation: initialLocationRef.current,
      signal: ac.signal,
      onFirstRender: () => {
        if (ac.signal.aborted) return
        setStatus('ready')
      },
      onSelected: (payload) => {
        // Cache only — floating toolbar opens on right-click, not mouseup.
        // Highlight tool applies on pointerup (see attachFrameListeners).
        lastEpubSelectionRef.current = selectionPayloadToPending(payload)
      },
    })
      .then((handle) => {
        if (ac.signal.aborted) {
          handle.destroy()
          return
        }
        handleRef.current = handle
        overlayPainterRef.current = handle.overlayPainter
        handle.overlayPainter.setOnMarkClick((mark) => {
          onHighlightMarkClickRef.current?.(mark)
        })

        const hasSyntheticCover = () =>
          Boolean(coverUrlRef.current) && !handle.hasSpineCover()
        const getAdjustedNavState = (): EpubNavState => {
          const nav = handle.getNavState()
          if (!hasSyntheticCover()) return nav
          const spineLength = nav.spineLength + 1
          const spineIndex = syntheticCoverShownRef.current
            ? 0
            : nav.spineIndex + 1
          return {
            ...nav,
            spineIndex,
            spineLength,
            pageCurrent: spineIndex + 1,
            pageTotal: spineLength,
            href: syntheticCoverShownRef.current ? '' : nav.href,
            label: syntheticCoverShownRef.current ? 'Cover' : nav.label,
            progress:
              spineLength <= 1 ? 0 : spineIndex / (spineLength - 1),
          }
        }
        const hideSyntheticCover = () => {
          if (!syntheticCoverShownRef.current) return
          syntheticCoverShownRef.current = false
          setSyntheticCoverShown(false)
          onNavStateRef.current?.(getAdjustedNavState())
        }
        const showSyntheticCover = async () => {
          if (!hasSyntheticCover()) return
          await handle.goToSpineIndex(0)
          syntheticCoverShownRef.current = true
          setSyntheticCoverShown(true)
          onNavStateRef.current?.(getAdjustedNavState())
        }
        const coverNavigation: SyntheticCoverNavigation = {
          isAvailable: hasSyntheticCover,
          isShown: () => syntheticCoverShownRef.current,
          show: showSyntheticCover,
          hide: hideSyntheticCover,
          navState: getAdjustedNavState,
        }
        if (apiRefProp.current) {
          apiRefProp.current.current = toApi(
            handle,
            coverNavigation,
            paintHighlightsNow,
            () => coverUrlRef.current,
          )
        }

        const onRelocated = () => {
          onSelectionDismissRef.current?.()
          onNavStateRef.current?.(getAdjustedNavState())
          const location = handle.getCurrentLocation()
          if (location) onLocationChangeRef.current?.(location)
        }
        const frameCleanups = new Map<Document, () => void>()
        const frameContextByDoc = new WeakMap<Document, EpubFrameSelectionContext>()
        const attachFrameListeners = (doc: Document | null | undefined) => {
          if (!doc || frameCleanups.has(doc)) return

          const scrollRoot = (): Element | null => {
            // Scrolled flow: epubjs scrolls its own `.epub-container` wrapper
            // in the host document — the iframe itself is expanded to full
            // content height and never scrolls internally.
            const outerContainer = hostRef.current?.querySelector<HTMLElement>(
              '.epub-container',
            )
            if (
              outerContainer &&
              outerContainer.scrollHeight > outerContainer.clientHeight + 1
            ) {
              return outerContainer
            }
            const scrolling = doc.scrollingElement
            if (scrolling && scrolling.scrollHeight > scrolling.clientHeight + 1) {
              return scrolling
            }
            if (doc.documentElement.scrollHeight > doc.documentElement.clientHeight + 1) {
              return doc.documentElement
            }
            if (doc.body && doc.body.scrollHeight > doc.body.clientHeight + 1) {
              return doc.body
            }
            return doc.scrollingElement ?? doc.documentElement
          }

          /**
           * Hand hover dwell: keep grab while skimming text during pan;
           * arm I-beam/pointer only after a short pause over text/annotations.
           */
          const onPointerHoverMove = (event: PointerEvent) => {
            if (interactionToolRef.current !== 'hand') return
            if (grabbingRef.current || panGestureRef.current) return
            if ((event.buttons & 1) !== 0) return

            const overTarget = isHandHoverCursorTargetAtPoint(
              doc,
              event.clientX,
              event.clientY,
            )
            if (overTarget === hoverOverTargetRef.current) return
            hoverOverTargetRef.current = overTarget
            clearHoverCursorTimer()

            if (!overTarget) {
              if (hoverTextRef.current) applyHandSurface({ hoverText: false })
              return
            }

            // Already armed — stay on I-beam/pointer while moving within text.
            if (hoverTextRef.current) return

            hoverCursorTimerRef.current = window.setTimeout(() => {
              hoverCursorTimerRef.current = null
              if (interactionToolRef.current !== 'hand') return
              if (grabbingRef.current || panGestureRef.current) return
              if (!hoverOverTargetRef.current) return
              applyHandSurface({ hoverText: true })
            }, HAND_HOVER_CURSOR_DELAY_MS)
          }

          // Keyboard page/section nav lives on ReaderScreen (window + iframe capture).
          const onContextMenu = (event: MouseEvent) => {
            // Always suppress the native menu inside the reading surface.
            event.preventDefault()
            event.stopPropagation()

            // Floating toolbar only when right-clicking the active selection.
            // Annotate / Typewriter / Highlight tools suppress the selection menu.
            if (
              interactionToolRef.current === 'highlight' ||
              interactionToolRef.current === 'annotate' ||
              interactionToolRef.current === 'typewriter' ||
              !hasFrameTextSelection(doc) ||
              !isPointInTextSelection(doc, event.clientX, event.clientY)
            ) {
              return
            }

            const frameEl = doc.defaultView?.frameElement as HTMLElement | null
            const ctx = frameContextByDoc.get(doc)
            const livePayload = ctx
              ? buildEpubSelectionPayloadFromDocument(doc, frameEl, ctx)
              : null
            const pending = livePayload
              ? selectionPayloadToPending(livePayload)
              : lastEpubSelectionRef.current
            if (!pending) return

            lastEpubSelectionRef.current = pending

            let x = event.clientX
            let y = event.clientY
            if (frameEl) {
              const fr = frameEl.getBoundingClientRect()
              x += fr.left
              y += fr.top
            }
            // Do not clear the native selection — menu stays contextual to it.
            onSelectionContextMenuRef.current?.(pending, { x, y })
          }

          const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0 || isInteractiveElement(event.target)) return
            const tool = interactionToolRef.current

            // Typewriter: place virtual textbox — block pan / text selection.
            if (tool === 'typewriter') {
              event.preventDefault()
              event.stopPropagation()

              const editing = activeEditingIdRef.current
              if (editing) {
                onTypewriterContentBlurRef.current?.(editing)
                setActiveEditingId(null)
              }

              const frameEl = doc.defaultView?.frameElement as HTMLElement | null
              const host = hostRef.current
              if (!frameEl || !host) return

              const fr = frameEl.getBoundingClientRect()
              const hostRect = host.getBoundingClientRect()
              const clientX = event.clientX + fr.left
              const clientY = event.clientY + fr.top
              const width = fr.width || 1
              const height = fr.height || 1
              const xPct = Math.min(
                100,
                Math.max(0, ((clientX - fr.left) / width) * 100),
              )
              const yPct = Math.min(
                100,
                Math.max(0, ((clientY - fr.top) / height) * 100),
              )

              // Prefer ReaderScreen spine index (includes synthetic cover adjust).
              const chapterIndex = typewriterChapterIndexRef.current

              const frameCtx = frameContextByDoc.get(doc)
              let cfi: string | undefined
              let offsetPx: { x: number; y: number } | undefined
              if (frameCtx) {
                const captured = captureTypewriterAnchor({
                  doc,
                  ctx: frameCtx,
                  iframeClientX: event.clientX,
                  iframeClientY: event.clientY,
                  iframeRect: fr,
                })
                if (captured) {
                  cfi = captured.cfi
                  offsetPx = captured.offsetPx
                }
              }

              onTypewriterPlaceRef.current?.({
                chapterIndex,
                xPct,
                yPct,
                clientX,
                clientY,
                hostX: clientX - hostRect.left,
                hostY: clientY - hostRect.top,
                ...(cfi ? { cfi, offsetPx } : {}),
              })
              return
            }

            // Crosshair annotate tools: placement wins — block text selection.
            if (tool === 'annotate') {
              event.preventDefault()
              return
            }

            // Highlight / Select: native text selection only — no margin pan.
            if (tool === 'highlight' || tool === 'select') {
              return
            }

            // Hand: only select when hover dwell has armed I-beam; else pan
            // (includes quick drags that skim across text — grab stays active).
            if (
              hoverTextRef.current &&
              isTextCursorTargetAtPoint(doc, event.clientX, event.clientY)
            ) {
              return
            }

            disarmHoverTextCursor()

            event.preventDefault()
            const captureEl = doc.documentElement
            try {
              captureEl.setPointerCapture(event.pointerId)
            } catch {
              /* ignore */
            }
            panGestureRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              lastX: event.clientX,
              lastY: event.clientY,
              panned: false,
              scrollEl: scrollRoot(),
              captureEl,
              doc,
            }
            applyHandGrabbing(true)
          }

          const panSurfaceBy = (dx: number, dy: number) => {
            if (onHandPanByRef.current) {
              onHandPanByRef.current(dx, dy)
              return
            }
            const el = panGestureRef.current?.scrollEl
            if (el) {
              el.scrollLeft -= dx
              el.scrollTop -= dy
            }
          }

          const onPointerMove = (event: PointerEvent) => {
            const gesture = panGestureRef.current
            if (!gesture || gesture.doc !== doc) return
            if ((event.buttons & 1) === 0) {
              clearHandPanGesture(event)
              return
            }
            if (event.pointerId !== gesture.pointerId) return
            const dx = event.clientX - gesture.lastX
            const dy = event.clientY - gesture.lastY
            const totalDx = event.clientX - gesture.startX
            const totalDy = event.clientY - gesture.startY
            gesture.lastX = event.clientX
            gesture.lastY = event.clientY

            if (
              !gesture.panned &&
              Math.hypot(totalDx, totalDy) >= PAN_DRAG_THRESHOLD_PX
            ) {
              gesture.panned = true
            }

            if (interactionToolRef.current === 'hand') {
              panSurfaceBy(dx, dy)
            }
          }

          const endGesture = (event: PointerEvent) => {
            const g = clearHandPanGesture(event)
            if (!g || g.doc !== doc) return

            const tool = interactionToolRef.current
            if (
              tool === 'highlight' ||
              tool === 'annotate' ||
              tool === 'typewriter'
            ) {
              return
            }

            // Hand pan finished — toolbar tool unchanged.
            if (g.panned) return

            if (tool === 'hand') {
              const frameEl = doc.defaultView?.frameElement as HTMLElement | null
              let clientX = event.clientX
              let clientY = event.clientY
              if (frameEl) {
                const fr = frameEl.getBoundingClientRect()
                clientX += fr.left
                clientY += fr.top
              }
              const hitId = hitTestTypewriterAtClientPoint(
                chapterTypewriterNoteIdsRef.current,
                typewriterNoteRefs.current,
                clientX,
                clientY,
              )
              if (hitId) {
                beginHandTypewriterEditRef.current(hitId)
                return
              }
            }

            // Margin tap (no drag): dismiss selection chrome + toggle reader chrome.
            if (!isInteractiveElement(event.target) && isCenterClick(event, doc)) {
              if (!hasFrameTextSelection(doc)) {
                onSelectionDismissRef.current?.()
              }
              onCenterTapRef.current?.()
            }
          }

          const applyHighlightSelectionOnRelease = () => {
            if (interactionToolRef.current !== 'highlight') return

            const ctx = frameContextByDoc.get(doc)
            if (!ctx) return

            const frameEl = doc.defaultView?.frameElement as HTMLElement | null
            const payload = buildEpubSelectionPayloadFromDocument(
              doc,
              frameEl,
              ctx,
            )
            if (!payload) return

            const pending = selectionPayloadToPending(payload)
            lastEpubSelectionRef.current = pending
            onTextSelectedRef.current?.(pending)
          }

          const onPointerUp = (event: PointerEvent) => {
            if (event.button !== 0) return
            endGesture(event)
            applyHighlightSelectionOnRelease()
          }

          const onPointerCancel = (event: PointerEvent) => {
            endGesture(event)
          }

          const onClick = (event: MouseEvent) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              isInteractiveElement(event.target)
            ) {
              return
            }

            const tool = interactionToolRef.current
            if (tool === 'annotate' || tool === 'typewriter') return

            // Text hit starts without a pan gesture — handle chrome toggle here
            // when the click did not produce a selection.
            if (hasFrameTextSelection(doc)) return
            onSelectionDismissRef.current?.()
            if (isTextNodeAtPoint(doc, event.clientX, event.clientY)) {
              // Empty click on text: keep tool; optional chrome toggle in center.
              if (!isCenterClick(event, doc)) return
              onCenterTapRef.current?.()
              return
            }
            // Margin clicks without a pan gesture are handled in pointerup.
          }

          const onWheel = (event: WheelEvent) => {
            if (!(event.ctrlKey || event.metaKey)) return
            if (interactionToolRef.current !== 'hand') return
            const frameEl = doc.defaultView?.frameElement as HTMLElement | null
            let clientX = event.clientX
            let clientY = event.clientY
            if (frameEl) {
              const fr = frameEl.getBoundingClientRect()
              clientX += fr.left
              clientY += fr.top
            }
            const handled = onFocusZoomWheelRef.current?.({
              clientX,
              clientY,
              deltaY: event.deltaY,
            })
            if (handled) {
              event.preventDefault()
              event.stopPropagation()
            }
          }

          doc.addEventListener('contextmenu', onContextMenu)
          doc.addEventListener('pointerdown', onPointerDown, { capture: true })
          doc.addEventListener('pointermove', onPointerHoverMove, { capture: true })
          doc.addEventListener('pointermove', onPointerMove, { capture: true })
          doc.addEventListener('pointerup', onPointerUp, { capture: true })
          doc.addEventListener('pointercancel', onPointerCancel, { capture: true })
          doc.addEventListener('click', onClick)
          doc.addEventListener('wheel', onWheel, { capture: true, passive: false })
          frameCleanups.set(doc, () => {
            doc.removeEventListener('contextmenu', onContextMenu)
            doc.removeEventListener('pointerdown', onPointerDown, true)
            doc.removeEventListener('pointermove', onPointerHoverMove, true)
            doc.removeEventListener('pointermove', onPointerMove, true)
            doc.removeEventListener('pointerup', onPointerUp, true)
            doc.removeEventListener('pointercancel', onPointerCancel, true)
            doc.removeEventListener('click', onClick)
            doc.removeEventListener('wheel', onWheel, true)
          })

          // Inject CSS cursor/user-select rules for this frame immediately.
          applyHandSurface({
            grabbing: grabbingRef.current,
            hoverText: hoverTextRef.current,
          })
        }
        const attachOnRendered = (_section: unknown, view: unknown) => {
          const frame = epubFrameContextFromView(view)
          if (frame) {
            frameContextByDoc.set(frame.doc, frame.ctx)
            const v = view as { contents?: { cfiBase?: string } }
            typewriterFrameRef.current = {
              doc: frame.doc,
              ctx: frame.ctx,
              cfiBase: v.contents?.cfiBase,
            }
            attachFrameListeners(frame.doc)
            remeasureTypewriterHostRef.current()
          }
          // T5.3 — section iframe may be fresh; reload DomCssOverlay marks.
          scheduleRepaint()
        }
        const cleanupFrameListeners = () => {
          handle.rendition.off('rendered', attachOnRendered)
          frameCleanups.forEach((cleanup) => cleanup())
          frameCleanups.clear()
        }

        handle.rendition.on('relocated', onRelocated)
        handle.rendition.on('rendered', attachOnRendered)
        host
          .querySelectorAll('iframe')
          .forEach((frame) => attachFrameListeners(frame.contentDocument))
        if (!initialLocationRef.current && hasSyntheticCover()) {
          syntheticCoverShownRef.current = true
          setSyntheticCoverShown(true)
        }
        onNavStateRef.current?.(getAdjustedNavState())
        // When resuming, wait for `relocated` — immediate CFI may still be cover.
        if (!initialLocationRef.current) {
          const initialCfi = handle.getCurrentLocation()
          if (initialCfi) onLocationChangeRef.current?.(initialCfi)
        }
        onTocRef.current?.(handle.getToc())
        // Initial paint once rendition is ready (hydrate + live highlights).
        paintHighlightsNow()
        setStatus('ready')
        // Host may still be settling after the loading shell unmounts; force a
        // layout pass so the first page is not blank until the user turns a page.
        requestAnimationFrame(() => {
          if (ac.signal.aborted) return
          requestAnimationFrame(() => {
            if (ac.signal.aborted || handleRef.current !== handle) return
            handle.resize()
          })
        })

        ac.signal.addEventListener(
          'abort',
          () => {
            handle.rendition.off('relocated', onRelocated)
            cleanupFrameListeners()
          },
          { once: true },
        )
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || isAbortError(err)) return
        handleRef.current = null
        overlayPainterRef.current = null
        if (apiRefProp.current) apiRefProp.current.current = null
        setStatus('error')
        setErrorMessage(
          err instanceof Error ? err.message : 'Could not open this EPUB.',
        )
      })

    return () => {
      if (repaintTimerRef.current != null) {
        window.clearTimeout(repaintTimerRef.current)
        repaintTimerRef.current = null
      }
      ac.abort()
      handleRef.current?.destroy()
      handleRef.current = null
      overlayPainterRef.current = null
      syntheticCoverShownRef.current = false
      if (apiRefProp.current) apiRefProp.current.current = null
    }
    // Re-open when bytes / pagination mode change; layout toggles via setLayout.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theme/layout applied below
  }, [data, pageMode, paintHighlightsNow, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setTheme(theme)
    scheduleRepaint()
  }, [theme, scheduleRepaint])

  // T5.3 — DomCssOverlay full reload when highlight list changes.
  useEffect(() => {
    if (status !== 'ready') return
    paintHighlightsNow()
  }, [highlights, status, paintHighlightsNow])

  useEffect(() => {
    handleRef.current?.setLayout(layout)
    scheduleRepaint()
  }, [layout, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setFontSize(fontSize)
    scheduleRepaint()
  }, [fontSize, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setFontFamily(fontFamily)
    scheduleRepaint()
  }, [fontFamily, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setFontWeight(fontWeight)
    scheduleRepaint()
  }, [fontWeight, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setLineHeight(lineHeight)
    scheduleRepaint()
  }, [lineHeight, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setTextAlign(textAlign)
    scheduleRepaint()
  }, [textAlign, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setMargins(marginsEnabled, marginPreset)
    scheduleRepaint()
  }, [marginPreset, marginsEnabled, scheduleRepaint])

  useEffect(() => {
    handleRef.current?.setChromeHidden(chromeHidden)
    scheduleRepaint()
  }, [chromeHidden, scheduleRepaint])

  useEffect(() => {
    if (status !== 'ready') return

    const onGlobalPointerEnd = (event: PointerEvent) => {
      clearHandPanGesture(event)
    }

    window.addEventListener('pointerup', onGlobalPointerEnd, true)
    window.addEventListener('pointercancel', onGlobalPointerEnd, true)
    return () => {
      window.removeEventListener('pointerup', onGlobalPointerEnd, true)
      window.removeEventListener('pointercancel', onGlobalPointerEnd, true)
      clearHandPanGesture()
    }
  }, [status])

  useEffect(() => {
    const host = hostRef.current
    if (!host || status !== 'ready') return

    if (interactionTool !== 'hand') {
      clearHoverCursorTimer()
      hoverOverTargetRef.current = false
      hoverTextRef.current = false
    }

    const apply = () =>
      applyInteractionToolSurface(host, interactionTool, {
        grabbing: grabbingRef.current && interactionTool === 'hand',
        hoverText:
          hoverTextRef.current &&
          interactionTool === 'hand' &&
          !grabbingRef.current,
      })
    apply()

    const mo = new MutationObserver(apply)
    mo.observe(host, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      if (panGestureRef.current) {
        releasePanPointerCapture(
          panGestureRef.current.captureEl,
          panGestureRef.current.pointerId,
        )
        panGestureRef.current = null
      }
      grabbingRef.current = false
      hoverTextRef.current = false
      clearHoverCursorTimer()
      applyInteractionToolSurface(host, 'hand', {
        grabbing: false,
        hoverText: false,
      })
    }
  }, [interactionTool, status])

  useEffect(() => {
    const handle = handleRef.current
    if (status !== 'ready' || !handle) return
    const available = Boolean(coverUrl) && !handle.hasSpineCover()
    if (!available && syntheticCoverShownRef.current) {
      syntheticCoverShownRef.current = false
      setSyntheticCoverShown(false)
      onNavStateRef.current?.(handle.getNavState())
      return
    }
    if (
      available &&
      !initialLocationRef.current &&
      handle.getNavState().spineIndex === 0
    ) {
      syntheticCoverShownRef.current = true
      setSyntheticCoverShown(true)
      const nav = handle.getNavState()
      const spineLength = nav.spineLength + 1
      onNavStateRef.current?.({
        ...nav,
        spineIndex: 0,
        spineLength,
        pageCurrent: 1,
        pageTotal: spineLength,
        href: '',
        label: 'Cover',
        progress: 0,
      })
    }
  }, [coverUrl, status])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => {
      handleRef.current?.resize()
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [status])

  // Continuous scroll is a single reflowing column — no page spread gutters.
  const showGutter = layout !== 'single' && pageMode !== 'scroll' && status === 'ready'

  // ── Custom scrollbar for scroll mode ──────────────────────────────────────
  // epubjs (scrolled / continuous flow) scrolls its own `.epub-container`
  // wrapper inside `host` — individual iframes expand to full content height
  // and never scroll internally, so the scrollbar must track that container.
  const [scrollThumb, setScrollThumb] = useState({ top: 0, height: 0 })
  const [scrollVisible, setScrollVisible] = useState(false)
  const scrollHideTimerRef = useRef<number | null>(null)
  const scrollContainerRef = useRef<HTMLElement | null>(null)

  const readScrollMetrics = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return null
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight <= clientHeight + 1) return null
    return { scrollTop, scrollHeight, clientHeight }
  }, [])

  const updateScrollThumb = useCallback(() => {
    if (pageMode !== 'scroll') return
    const m = readScrollMetrics()
    if (!m) {
      setScrollThumb({ top: 0, height: 0 })
      return
    }
    const trackH = 100
    const thumbH = Math.max((m.clientHeight / m.scrollHeight) * trackH, 8)
    const maxTop = trackH - thumbH
    const thumbTop = (m.scrollTop / (m.scrollHeight - m.clientHeight)) * maxTop
    setScrollThumb({ top: thumbTop, height: thumbH })

    setScrollVisible(true)
    if (scrollHideTimerRef.current != null) window.clearTimeout(scrollHideTimerRef.current)
    scrollHideTimerRef.current = window.setTimeout(() => {
      setScrollVisible(false)
      scrollHideTimerRef.current = null
    }, 1200)
  }, [pageMode, readScrollMetrics])

  // `.epub-container` is created once by epubjs and persists across chapter
  // appends in continuous mode — no need to re-bind on every content swap.
  useEffect(() => {
    if (pageMode !== 'scroll' || status !== 'ready') return
    const host = hostRef.current
    if (!host) return

    let scrollCleanup: (() => void) | null = null
    let mo: MutationObserver | null = null

    const bind = (el: HTMLElement) => {
      scrollContainerRef.current = el
      const onScroll = () => updateScrollThumb()
      el.addEventListener('scroll', onScroll, { passive: true })
      updateScrollThumb()
      scrollCleanup = () => el.removeEventListener('scroll', onScroll)
    }

    const existing = host.querySelector<HTMLElement>('.epub-container')
    if (existing) {
      bind(existing)
    } else {
      // Rendition may still be attaching; bind as soon as it appears.
      mo = new MutationObserver(() => {
        const container = host.querySelector<HTMLElement>('.epub-container')
        if (container) {
          mo?.disconnect()
          mo = null
          bind(container)
        }
      })
      mo.observe(host, { childList: true, subtree: true })
    }

    return () => {
      mo?.disconnect()
      scrollCleanup?.()
      scrollContainerRef.current = null
      if (scrollHideTimerRef.current != null) {
        window.clearTimeout(scrollHideTimerRef.current)
        scrollHideTimerRef.current = null
      }
    }
  }, [pageMode, status, updateScrollThumb])

  const showCustomScrollbar = pageMode === 'scroll' && status === 'ready' && scrollThumb.height > 0

  const [iframeHostBox, setIframeHostBox] = useState<IframeHostBox | null>(null)

  useEffect(() => {
    if (status !== 'ready') {
      setIframeHostBox(null)
      iframeHostBoxRef.current = null
      remeasureTypewriterHostRef.current = () => {}
      return
    }
    const measure = () => {
      const host = hostRef.current
      if (!host) return
      const iframe = host.querySelector('iframe')
      if (!iframe) {
        if (iframeHostBoxRef.current !== null) {
          iframeHostBoxRef.current = null
          setIframeHostBox(null)
        }
        return
      }
      const hr = host.getBoundingClientRect()
      const ir = iframe.getBoundingClientRect()
      const box: IframeHostBox = {
        left: ir.left - hr.left,
        top: ir.top - hr.top,
        width: ir.width,
        height: ir.height,
      }
      if (iframeHostBoxesEqual(iframeHostBoxRef.current, box)) return
      iframeHostBoxRef.current = box
      setIframeHostBox(box)
    }
    remeasureTypewriterHostRef.current = measure
    measure()
    const host = hostRef.current
    const ro = host ? new ResizeObserver(measure) : null
    if (host) ro?.observe(host)
    window.addEventListener('resize', measure)
    return () => {
      remeasureTypewriterHostRef.current = () => {}
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [status, chromeHidden])

  // Hand + Typewriter tools keep inline edit; other tools commit and exit.
  useEffect(() => {
    if (!activeEditingId) return
    if (interactionTool === 'hand' || interactionTool === 'typewriter') return
    onTypewriterContentBlur?.(activeEditingId)
    setActiveEditingId(null)
  }, [interactionTool, activeEditingId, onTypewriterContentBlur])

  const chapterTypewriterNotes = (typewriterNotes ?? []).filter((n) => {
    if (n.type !== 'textbox') return false
    if (
      !typewriterBelongsToRenderedSection(
        n.positionData,
        typewriterFrameRef.current?.cfiBase,
      )
    ) {
      return false
    }
    if (n.cfi || n.source === 'epub') return true
    return n.chapterIndex === typewriterChapterIndex
  })
  chapterTypewriterNoteIdsRef.current = chapterTypewriterNotes.map((n) => n.id)

  const beginHandTypewriterEdit = useCallback((id: string) => {
    const prev = activeEditingIdRef.current
    if (prev && prev !== id) {
      onTypewriterContentBlurRef.current?.(prev)
    }
    setActiveEditingId(id)
  }, [])
  const beginHandTypewriterEditRef = useRef(beginHandTypewriterEdit)
  beginHandTypewriterEditRef.current = beginHandTypewriterEdit

  const iframeRectForResolve = (): DOMRect | null => {
    const host = hostRef.current
    const iframe = host?.querySelector('iframe')
    return iframe?.getBoundingClientRect() ?? null
  }

  return (
    <main
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${className ?? ''}`}
      data-epub-status={status}
      data-epub-layout={layout}
      data-epub-page-mode={pageMode}
    >
      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
          <div
            className="size-9 shrink-0 animate-spin rounded-full border-[3px] border-current/20 border-t-current opacity-80"
            aria-hidden
          />
          <span className="text-sm opacity-70">Opening book…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-sm text-rose-300">
          {errorMessage ?? 'Could not open this EPUB.'}
        </div>
      )}
      {/* Multi-page spread gutters — visible gray bands between page columns. */}
      {showGutter ? (
        <>
          <div
            className={`pointer-events-none absolute inset-y-0 z-[7] flex w-3 -translate-x-1/2 flex-col items-center justify-stretch ${
              layout === 'triple' ? 'left-1/3' : 'left-1/2'
            }`}
            aria-hidden
          >
            <div className="h-full w-full bg-neutral-500/20" />
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-neutral-400/75" />
          </div>
          {layout === 'triple' ? (
            <div
              className="pointer-events-none absolute inset-y-0 left-2/3 z-[7] flex w-3 -translate-x-1/2 flex-col items-center justify-stretch"
              aria-hidden
            >
              <div className="h-full w-full bg-neutral-500/20" />
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-neutral-400/75" />
            </div>
          ) : null}
        </>
      ) : null}
      {syntheticCoverShown && coverUrl ? (
        <div
          className="absolute inset-0 z-[8] flex items-center justify-center bg-lib-bg-deep p-6"
          data-epub-synthetic-cover
        >
          <img
            src={coverUrl}
            alt="Book cover"
            className="max-h-full max-w-full object-contain shadow-2xl"
            draggable={false}
          />
        </div>
      ) : null}
      <div
        ref={hostRef}
        className={`h-full w-full min-h-0 flex-1 [&_iframe]:h-full [&_iframe]:w-full ${
          interactionTool === 'highlight'
            ? 'cursor-highlight-tool'
            : interactionTool === 'typewriter'
              ? 'cursor-typewriter-tool'
              : interactionTool === 'annotate'
                ? 'cursor-crosshair'
                : interactionTool === 'select'
                  ? 'cursor-select-tool'
                  : 'cursor-hand-tool'
        } ${
          showGutter
            ? 'bg-neutral-600/15 [&_.epub-container]:bg-transparent [&_.epub-view]:shadow-[0_0_0_1px_rgba(148,163,184,0.35)]'
            : ''
        }`}
        tabIndex={-1}
      />
      {/* Typewriter host overlays — outside iframe so focus/blur work reliably.
          overflow visible so the floating format toolbar isn't clipped. */}
      <div className="pointer-events-none absolute inset-0 z-[11] overflow-visible">
        {iframeHostBox
          ? chapterTypewriterNotes.map((note) => {
              const ir = iframeRectForResolve()
              let left =
                iframeHostBox.left +
                (parseTypewriterPosition(note.positionData)?.xPct ?? 0) /
                  100 *
                  iframeHostBox.width
              let top =
                iframeHostBox.top +
                (parseTypewriterPosition(note.positionData)?.yPct ?? 0) /
                  100 *
                  iframeHostBox.height

              if (ir && dragPreview?.id !== note.id) {
                const resolved = resolveTypewriterHostPoint({
                  locationRaw: note.positionData,
                  doc: typewriterFrameRef.current?.doc,
                  iframeRect: ir,
                  iframeHostBox,
                })
                if (resolved) {
                  left = resolved.left
                  top = resolved.top
                }
              }

              if (dragPreview?.id === note.id) {
                left =
                  iframeHostBox.left +
                  (dragPreview.xPct / 100) * iframeHostBox.width
                top =
                  iframeHostBox.top +
                  (dragPreview.yPct / 100) * iframeHostBox.height
              }
              const editing = activeEditingId === note.id
              const dragging = dragPreview?.id === note.id
              const notePos = parseTypewriterPosition(note.positionData) ?? {
                xPct: 0,
                yPct: 0,
              }
              const color =
                typeof note.colorHex === 'string' && note.colorHex.trim()
                  ? note.colorHex
                  : undefined

              const startDrag = (
                e: ReactPointerEvent<HTMLElement>,
                origin: TypewriterPct,
              ) => {
                e.stopPropagation()
                if (e.button !== 0) return
                const box = iframeHostBoxRef.current
                if (!box || box.width <= 0 || box.height <= 0) return
                dragSessionRef.current = beginTypewriterDrag({
                  id: note.id,
                  pointerId: e.pointerId,
                  clientX: e.clientX,
                  clientY: e.clientY,
                  originXPct: origin.xPct,
                  originYPct: origin.yPct,
                  bounds: new DOMRect(0, 0, box.width, box.height),
                })
                try {
                  e.currentTarget.setPointerCapture(e.pointerId)
                } catch {
                  /* ignore */
                }
              }

              return (
                <div
                  key={note.id}
                  ref={(el) => {
                    if (el) typewriterNoteRefs.current.set(note.id, el)
                    else typewriterNoteRefs.current.delete(note.id)
                  }}
                  data-typewriter-note={note.id}
                  className={`pointer-events-auto absolute z-[5] -translate-x-1/2 -translate-y-1/2 ${
                    dragging ? 'rb-typewriter-dragging' : ''
                  }`}
                  style={{ left, top, color }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {editing ? (
                    <TypewriterRichEditor
                      autoFocus
                      value={note.content}
                      colorHex={note.colorHex}
                      fontSize={note.fontSize}
                      onFocus={() => onTypewriterContentFocus?.(note.id)}
                      onChange={(html) =>
                        onTypewriterContentChange?.(note.id, html)
                      }
                      onStyleChange={(patch) =>
                        onTypewriterStyleChange?.(note.id, patch)
                      }
                      onBlur={() => {
                        if (dragSessionRef.current?.id === note.id) return
                        onTypewriterContentBlur?.(note.id)
                        setActiveEditingId(null)
                      }}
                      onEmptyDelete={() => {
                        setActiveEditingId(null)
                        onTypewriterDelete?.(note.id)
                      }}
                      dragHandle={
                        <button
                          type="button"
                          className="rb-typewriter-drag-handle"
                          aria-label="Move typewriter note"
                          onPointerDown={(e) => {
                            e.preventDefault()
                            startDrag(e, notePos)
                          }}
                        />
                      }
                    />
                  ) : (
                    <button
                      type="button"
                      className={`rb-typewriter-static border-none bg-transparent p-0 text-left ${
                        interactionTool === 'hand'
                          ? 'cursor-text'
                          : 'cursor-grab'
                      }`}
                      aria-label="Typewriter note"
                      onPointerDown={(e) => {
                        if (interactionTool === 'typewriter') startDrag(e, notePos)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (suppressTypewriterClickRef.current) {
                          suppressTypewriterClickRef.current = false
                          return
                        }
                        beginHandTypewriterEdit(note.id)
                      }}
                    >
                      <TypewriterStaticHtml
                        html={note.content}
                        colorHex={note.colorHex}
                        fontSize={note.fontSize}
                      />
                    </button>
                  )}
                </div>
              )
            })
          : null}
        {typewriterDraft ? (
          <div
            className="pointer-events-auto absolute z-[6] -translate-x-1/2 -translate-y-1/2"
            style={{
              left: typewriterDraft.hostX,
              top: typewriterDraft.hostY,
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <TypewriterRichEditor
              autoFocus
              value={typewriterDraft.content}
              colorHex={typewriterDraft.colorHex}
              fontSize={typewriterDraft.fontSize}
              placeholder="Type..."
              onChange={(html) => onTypewriterDraftChange?.(html)}
              onStyleChange={(patch) => onTypewriterDraftStyleChange?.(patch)}
              onBlur={() => onTypewriterDraftCommit?.(typewriterDraft.id)}
              onCancel={() => onTypewriterDraftCancel?.(typewriterDraft.id)}
            />
          </div>
        ) : null}
      </div>
      {/* Custom thin scrollbar overlay — only in scroll mode */}
      {showCustomScrollbar ? (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-[9] w-[7px] py-1"
          aria-hidden
        >
          {/* Track */}
          <div className="relative h-full w-full overflow-hidden rounded-full">
            <div
              className="absolute inset-0 rounded-full bg-white/5 transition-opacity duration-300"
              style={{ opacity: scrollVisible ? 1 : 0 }}
            />
            {/* Thumb */}
            <div
              className="absolute left-[1px] right-[1px] rounded-full transition-[top,height,opacity] duration-150"
              style={{
                top: `${scrollThumb.top}%`,
                height: `${scrollThumb.height}%`,
                background: 'rgb(148 163 184 / 0.55)',
                opacity: scrollVisible ? 1 : 0,
                transition: scrollVisible
                  ? 'top 0.1s ease, height 0.1s ease, opacity 0.15s ease'
                  : 'opacity 0.6s ease 0.6s',
              }}
            />
          </div>
        </div>
      ) : null}
    </main>
  )
}

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { CfiLocation } from '@reading-book/book-reader-sdk'
import type {
  FontFamily,
  FontWeight,
  InteractionTool,
  ReaderTheme,
  TextAlign,
} from '@reading-book/book-reader-sdk'
import {
  openEpubjs,
  type EpubHighlightClickInfo,
  type EpubjsHandle,
  type EpubNavState,
  type EpubPageLayout,
  type EpubSelectionInfo,
  type EpubTocItem,
  type EpubViewMode,
} from './openEpubjs'
import {
  syncEpubAppearance,
  resetEpubSettingsBaseline,
  flushEpubSettingsNow,
  disposeEpubSettingsSync,
} from './store/epubSettingsSync'
import {
  applyInteractionToolSurface,
  HAND_HOVER_CURSOR_DELAY_MS,
  isHandHoverCursorTargetAtPoint,
  isPointInTextSelection,
  isTextCursorTargetAtPoint,
  isTextNodeAtPoint,
  PAN_DRAG_THRESHOLD_PX,
} from '../../interaction'
/** Imperative nav for parent footer scrub / section jump. */
export type EpubRendererApi = Pick<
  EpubjsHandle,
  | 'nextPage'
  | 'prevPage'
  | 'isAtScrollBoundary'
  | 'nextSection'
  | 'prevSection'
  | 'goToHref'
  | 'goToSpineIndex'
  | 'goToLocationPage'
  | 'goToEnd'
  | 'getSpineLength'
  | 'getNavState'
  | 'getToc'
  | 'getSectionLabels'
  | 'getCurrentLocation'
  | 'getCurrentExcerpt'
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
  | 'debugResolveCfiRect'
  | 'applyHighlight'
  | 'removeHighlight'
  | 'flashHighlight'
  | 'getHighlightAtPoint'
  | 'setFocusedHighlight'
  | 'setSearchHighlights'
  | 'goToSearchMatch'
  | 'onTextSelected'
  | 'getCurrentSelectionInfo'
  | 'getReadAloudSegments'
  | 'setReadAloudCursor'
> & {
  /**
   * Section labels indexed by REAL spine index. Search hits come from the extracted text, which
   * knows nothing of the synthetic cover that shifts `getSectionLabels()` by one.
   */
  getSpineSectionLabels: () => string[]
}

type EpubRendererProps = {
  data: ArrayBuffer
  /** Extracted cover shown as a synthetic first *section* when the EPUB has none in its spine. */
  coverUrl?: string
  theme: ReaderTheme
  layout?: EpubPageLayout
  /** Paginated (default) vs. continuous vertical scroll within a section. */
  viewMode?: EpubViewMode
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
  /**
   * Right-click landed inside a live text selection. `x`/`y` are outer-viewport (fixed-position)
   * coordinates — same convention as `ViewportRectLike`/`anchorRect` used by the highlight
   * popovers. Does not fire for right-clicks with no selection under the cursor, or outside the
   * selection's bounds — see `onHighlightContextMenu` for that case.
   */
  onSelectionContextMenu?: (x: number, y: number) => void
  /**
   * Highlight/Underline/Strikethrough tool armed and the mouse button that was drag-selecting text
   * just came up over a non-empty selection — the exact moment (and only moment) such a drag
   * should turn into a saved mark. Fires with a fresh, synchronous read of the selection (not the
   * ~250ms-debounced `onTextSelected`), so a fast click-drag-release is captured correctly and a
   * drag that merely *pauses* mid-gesture (mouse still down) never fires this early.
   */
  onAnnotationDragEnd?: (info: EpubSelectionInfo) => void
  /**
   * Toolbar Translate mode armed (rides on the Select tool — see `ReaderScreen`). While set, a
   * drag-select on the Select tool that ends over a non-empty selection fires
   * `onTranslateDragEnd` the instant the pointer comes up, same mechanism as
   * `onAnnotationDragEnd` for the markup tools, instead of the old debounced `onTextSelected`
   * settle event (which could fire before the drag actually finished, or fire twice).
   */
  translateModeActive?: boolean
  /** Fires once, on pointerup, with a fresh synchronous read of the selection — see
   *  `translateModeActive`. */
  onTranslateDragEnd?: (info: EpubSelectionInfo) => void
  /**
   * Right-click landed on an existing highlight/underline mark with no live text selection under
   * the cursor (the `onSelectionContextMenu` case above takes priority when both are true). Fires
   * instead of the native context menu either way — `EpubRenderer` always calls
   * `preventDefault()` on `contextmenu` inside the reading surface.
   */
  onHighlightContextMenu?: (info: EpubHighlightClickInfo) => void
  /**
   * A plain left click landed on an existing highlight/underline mark — focuses it (the
   * `.rb-hl-focused` outline), does not open its menu (see `onHighlightContextMenu` for that).
   * Driven by the exact same hit-test as `onSurfaceClick` below, so the two can never disagree
   * about whether a given click did or didn't land on a mark.
   */
  onHighlightClick?: (info: EpubHighlightClickInfo) => void
  /**
   * A plain left click landed somewhere in the reading surface that is NOT an existing highlight/
   * underline mark (margin, plain text, empty space). Used to dismiss an open highlight popup/
   * focus outline — see `onHighlightClick` above for the "landed on a mark" case instead.
   */
  onSurfaceClick?: () => void
  onNavState?: (state: EpubNavState) => void
  /** Stable CFI after relocated — for persist flush (T4.2). */
  onLocationChange?: (location: CfiLocation) => void
  onToc?: (items: EpubTocItem[]) => void
  /** Spine section labels for the Page layout grid, index-aligned to sections. */
  onSections?: (labels: string[]) => void
  /**
   * Surface mode from toolbar (hand / select / highlight / underline).
   * Never mutated by gestures — toolbar state stays authoritative.
   */
  interactionTool?: InteractionTool
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

/**
 * iframe-local point → outer-viewport point, scale-corrected — same math as `openEpubjs.ts`'s
 * private `toOuterRect` (not exported/reachable from here), applied to a single point. Needed
 * because `ReaderZoomViewport` applies `transform: scale(z)` to the iframe, so naively adding
 * `iframe.getBoundingClientRect()`'s offset drifts at any zoom level other than 100%.
 */
function toOuterPoint(
  localX: number,
  localY: number,
  iframe: HTMLIFrameElement,
  win: Window,
): { x: number; y: number } {
  const iframeRect = iframe.getBoundingClientRect()
  const scaleX = win.innerWidth > 0 ? iframeRect.width / win.innerWidth : 1
  const scaleY = win.innerHeight > 0 ? iframeRect.height / win.innerHeight : 1
  return {
    x: iframeRect.left + localX * scaleX,
    y: iframeRect.top + localY * scaleY,
  }
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

/** The synthetic cover is one extra page in front of the epub.js locations. */
function withSyntheticCoverNav(
  nav: EpubNavState,
  onCover: boolean,
): EpubNavState {
  const spineLength = nav.spineLength + 1
  const pageTotal = nav.pageCountReady ? nav.pageTotal + 1 : 0
  if (onCover) {
    return {
      ...nav,
      spineIndex: 0,
      spineLength,
      sectionPage: 1,
      sectionPageTotal: 1,
      pageCurrent: 1,
      pageTotal,
      href: '',
      label: 'Cover',
      progress: 0,
      percentage: 0,
      cfi: undefined,
    }
  }
  const percentage =
    pageTotal > 1 ? (1 + nav.percentage * nav.pageTotal) / pageTotal : 0
  return {
    ...nav,
    spineIndex: nav.spineIndex + 1,
    spineLength,
    // Before locations exist, `pageCurrent` is a section-local page that the
    // cover does not shift.
    pageCurrent: nav.pageCountReady ? nav.pageCurrent + 1 : nav.pageCurrent,
    pageTotal,
    progress: percentage,
    percentage,
  }
}

function toApi(
  handle: EpubjsHandle,
  cover: SyntheticCoverNavigation,
): EpubRendererApi {
  return {
    nextPage: async () => {
      if (cover.isShown()) {
        cover.hide()
        return
      }
      await handle.nextPage()
    },
    isAtScrollBoundary: (direction) => {
      if (cover.isShown()) return false
      return handle.isAtScrollBoundary(direction)
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
    goToEnd: async () => {
      cover.hide()
      return handle.goToEnd()
    },
    goToLocationPage: async (page) => {
      if (cover.isAvailable()) {
        if (page <= 1) {
          await cover.show()
          return
        }
        cover.hide()
        await handle.goToLocationPage(page - 1)
        return
      }
      await handle.goToLocationPage(page)
    },
    getSpineLength: () =>
      handle.getSpineLength() + (cover.isAvailable() ? 1 : 0),
    getNavState: cover.navState,
    getToc: () => handle.getToc(),
    getSectionLabels: () =>
      cover.isAvailable()
        ? ['Cover', ...handle.getSectionLabels()]
        : handle.getSectionLabels(),
    getCurrentLocation: () => handle.getCurrentLocation(),
    getCurrentExcerpt: () =>
      cover.isShown() ? undefined : handle.getCurrentExcerpt(),
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
    debugResolveCfiRect: (cfi) => handle.debugResolveCfiRect(cfi),
    applyHighlight: (params) => handle.applyHighlight(params),
    removeHighlight: (cfiRange, styleKind) => handle.removeHighlight(cfiRange, styleKind),
    flashHighlight: (cfiRange, styleKind) => handle.flashHighlight(cfiRange, styleKind),
    getHighlightAtPoint: (outerX, outerY) => handle.getHighlightAtPoint(outerX, outerY),
    setFocusedHighlight: (id) => handle.setFocusedHighlight(id),
    setSearchHighlights: (matcher) => handle.setSearchHighlights(matcher),
    goToSearchMatch: async (target) => {
      cover.hide()
      return handle.goToSearchMatch(target)
    },
    getSpineSectionLabels: () => handle.getSectionLabels(),
    onTextSelected: (cb) => handle.onTextSelected(cb),
    getCurrentSelectionInfo: () => handle.getCurrentSelectionInfo(),
    getReadAloudSegments: (mode) => {
      if (cover.isShown()) {
        // The synthetic cover has no text; "from here" starts at the first real section.
        if (mode === 'viewport') return null
        cover.hide()
        return handle.getReadAloudSegments('section')
      }
      return handle.getReadAloudSegments(mode)
    },
    setReadAloudCursor: async (cursor) => {
      if (cursor) cover.hide()
      await handle.setReadAloudCursor(cursor)
    },
  }
}

/** One mouse-wheel tick (or a firm trackpad flick) turns one paginated page. */
const PAGE_TURN_WHEEL_THRESHOLD = 80
/**
 * Scroll mode only: how much *extra* wheel delta the user must keep scrolling
 * past a section's top/bottom edge before it counts as "I meant to leave this
 * chapter" rather than "I'm still reading the last few lines." Deliberately
 * several times `PAGE_TURN_WHEEL_THRESHOLD` — a single wheel tick landing
 * exactly at the edge (the common case) must never flip the chapter out from
 * under the reader mid-sentence. `isAtScrollBoundary` re-checks the edge on
 * every tick, so easing off the wheel before this is reached (even by one
 * tick that dips back off the edge) resets the buffer to zero and the user
 * simply keeps reading — see the reset alongside `isAtScrollBoundary` below.
 */
const SCROLL_BOUNDARY_OVERFLOW_THRESHOLD = PAGE_TURN_WHEEL_THRESHOLD * 5

function wheelAxisDelta(event: WheelEvent): { x: number; y: number } {
  const unit =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? 600
        : 1
  return { x: event.deltaX * unit, y: event.deltaY * unit }
}

function isEditableWheelTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const el = target.closest('input, textarea, select, [contenteditable="true"]')
  return el != null
}

/** Coalesce epub.js relocated bursts after a page-turn before publishing footer pages. */
const PAGINATED_NAV_SETTLE_MS = 80

/**
 * Production EPUB surface (T3.3) — epubjs from ArrayBuffer; no FS paths.
 * Dual layout draws a center gutter; spine order includes cover as a section.
 * Footer page counter uses stable content-size EPUB reference pages.
 * T3.5: page/section nav + relocated state for footer scrub.
 */
export function EpubRenderer({
  data,
  coverUrl,
  theme,
  layout = 'single',
  viewMode = 'paginated',
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
  onSelectionContextMenu,
  onAnnotationDragEnd,
  translateModeActive = false,
  onTranslateDragEnd,
  onHighlightContextMenu,
  onHighlightClick,
  onSurfaceClick,
  onNavState,
  onLocationChange,
  onToc,
  onSections,
  interactionTool = 'hand',
  onFocusZoomWheel,
  onHandPanBy,
  apiRef,
}: EpubRendererProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const epubRootRef = useRef<HTMLElement>(null)
  const handleRef = useRef<EpubjsHandle | null>(null)
  const interactionToolRef = useRef<InteractionTool>(interactionTool)
  interactionToolRef.current = interactionTool
  const onFocusZoomWheelRef = useRef(onFocusZoomWheel)
  onFocusZoomWheelRef.current = onFocusZoomWheel
  const onHandPanByRef = useRef(onHandPanBy)
  onHandPanByRef.current = onHandPanBy
  const pageTurnWheelAccRef = useRef(0)
  const pageTurnBusyRef = useRef(false)
  const turnPageFromWheelRef = useRef<(event: WheelEvent) => boolean>(
    () => false,
  )
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
  /** True from pointerdown to pointerup/cancel of a Highlight/Underline/Strikethrough drag-select
   *  gesture — the mark is committed only when this transitions back to false with a live
   *  selection under it (see `onAnnotationDragEnd`), never while it's still true (mouse still
   *  down, however long the drag pauses). */
  const annotationDragActiveRef = useRef(false)
  /** Set for exactly one `click` event right after a drag-to-mark commits — see `endAnnotationDrag`. */
  const justCommittedAnnotationRef = useRef(false)
  /** True from pointerdown to pointerup/cancel of a Select-tool drag made while Translate mode is
   *  armed — mirrors `annotationDragActiveRef` but for `onTranslateDragEnd` instead of a markup
   *  mark, and deliberately kept separate so it never triggers the highlight-drag click-swallow
   *  (`justCommittedAnnotationRef`) below. */
  const translateDragActiveRef = useRef(false)

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
  const onSectionsRef = useRef(onSections)
  onSectionsRef.current = onSections
  const onCenterTapRef = useRef(onCenterTap)
  onCenterTapRef.current = onCenterTap
  const onSelectionContextMenuRef = useRef(onSelectionContextMenu)
  onSelectionContextMenuRef.current = onSelectionContextMenu
  const onAnnotationDragEndRef = useRef(onAnnotationDragEnd)
  onAnnotationDragEndRef.current = onAnnotationDragEnd
  const translateModeActiveRef = useRef(translateModeActive)
  translateModeActiveRef.current = translateModeActive
  const onTranslateDragEndRef = useRef(onTranslateDragEnd)
  onTranslateDragEndRef.current = onTranslateDragEnd

  /**
   * Commits a Highlight/Underline/Strikethrough drag, or a Translate-mode Select-tool drag, the
   * instant its pointer comes up — reads the selection fresh via `getCurrentSelectionInfo` (see
   * that method's doc comment for why, not `onTextSelected`'s debounce). Deliberately NOT scoped
   * to any one iframe document: called both from that document's own `pointerup` (the common
   * case) and from `window`'s capture-phase `pointerup` further below, which is what still
   * catches the release when the drag carried the cursor out past the iframe's own rectangle
   * before the button came up.
   */
  const commitAnnotationDrag = () => {
    const isAnnotationDrag = annotationDragActiveRef.current
    const isTranslateDrag = translateDragActiveRef.current
    if (!isAnnotationDrag && !isTranslateDrag) return
    annotationDragActiveRef.current = false
    translateDragActiveRef.current = false
    const info = handleRef.current?.getCurrentSelectionInfo()
    if (!info) return
    if (isTranslateDrag) {
      onTranslateDragEndRef.current?.(info)
      return
    }
    onAnnotationDragEndRef.current?.(info)
    // The commit above clears the native selection synchronously, but the trailing `click` this
    // same gesture dispatches right after `pointerup` fires before React has re-rendered/painted
    // the new mark — `getHighlightAtPoint` in `onClick` below would find nothing yet and treat it
    // as an empty-surface click, dismissing the very outline `createHighlight` just focused.
    // Swallow exactly that one click.
    justCommittedAnnotationRef.current = true
  }

  const onHighlightContextMenuRef = useRef(onHighlightContextMenu)
  onHighlightContextMenuRef.current = onHighlightContextMenu
  const onHighlightClickRef = useRef(onHighlightClick)
  onHighlightClickRef.current = onHighlightClick
  const onSurfaceClickRef = useRef(onSurfaceClick)
  onSurfaceClickRef.current = onSurfaceClick
  const coverUrlRef = useRef(coverUrl)
  coverUrlRef.current = coverUrl
  const initialLocationRef = useRef(initialLocation)
  initialLocationRef.current = initialLocation
  const apiRefProp = useRef(apiRef)
  apiRefProp.current = apiRef
  const adjustedNavRef = useRef<(() => EpubNavState) | null>(null)
  turnPageFromWheelRef.current = (event) => {
    if (event.ctrlKey || event.metaKey) return false
    if (isEditableWheelTarget(event.target)) return false

    const { x, y } = wheelAxisDelta(event)
    if (Math.abs(y) <= Math.abs(x)) return false

    if (viewMode === 'scroll') {
      // The browser scrolls the section natively — only take over once the
      // user keeps scrolling past the section's own top/bottom edge, so that
      // continuing to scroll there changes chapter instead of doing nothing.
      const api = apiRefProp.current?.current
      const direction = y > 0 ? 'down' : 'up'
      if (!api?.isAtScrollBoundary(direction)) {
        // Not overscrolling right now — reading normally (or scrolled back
        // off the edge mid-gesture). Forget any overscroll built up so far;
        // leaving the edge even briefly means starting the buffer over.
        pageTurnWheelAccRef.current = 0
        return false
      }

      pageTurnWheelAccRef.current += y
      if (Math.abs(pageTurnWheelAccRef.current) < SCROLL_BOUNDARY_OVERFLOW_THRESHOLD) {
        // Still within the buffer zone: consume the event (no native
        // overscroll bounce) but do not change chapter yet — this is the
        // "cushion" that lets the reader finish the last lines in peace.
        return true
      }
      pageTurnWheelAccRef.current = 0
      if (pageTurnBusyRef.current) return true

      pageTurnBusyRef.current = true
      void (direction === 'down' ? api.nextPage() : api.prevPage()).finally(() => {
        pageTurnBusyRef.current = false
      })
      return true
    }

    pageTurnWheelAccRef.current += y
    if (Math.abs(pageTurnWheelAccRef.current) < PAGE_TURN_WHEEL_THRESHOLD) {
      return true
    }
    const forward = pageTurnWheelAccRef.current > 0
    pageTurnWheelAccRef.current = 0
    if (pageTurnBusyRef.current) return true

    const api = apiRefProp.current?.current
    if (!api) return true
    pageTurnBusyRef.current = true
    void (forward ? api.nextPage() : api.prevPage()).finally(() => {
      pageTurnBusyRef.current = false
    })
    return true
  }

  const [status, setStatus] = useState<
    'opening' | 'rendering' | 'ready' | 'error'
  >('opening')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [syntheticCoverShown, setSyntheticCoverShown] = useState(false)
  const syntheticCoverShownRef = useRef(false)

  /**
   * One batched apply for every appearance prop (was nine effects, each
   * paying for its own relayout + pagination remeasure).
   *
   * This is a plain function call, not a hook — `syncEpubAppearance` lives in
   * a Zustand vanilla store with no React binding, so there is nothing here
   * for `useEffect`/`useRef`/`useCallback` to manage. It runs on every render
   * (including React 18 StrictMode's double-invoked dev render); the diff
   * against the store's baseline makes a repeat call with unchanged values a
   * no-op, so calling it unconditionally here is safe.
   */
  syncEpubAppearance({
    handle: handleRef.current,
    enabled: status === 'ready',
    settings: {
      theme,
      layout,
      viewMode,
      fontSize,
      fontFamily,
      fontWeight,
      lineHeight,
      textAlign,
      marginsEnabled,
      marginPreset,
      chromeHidden,
    },
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // openEpubjs receives the current appearance values below, so they are
    // already live in the fresh rendition — nothing to re-apply. Reads the
    // same values syncEpubAppearance already pushed to the store this render.
    resetEpubSettingsBaseline({
      theme,
      layout,
      viewMode,
      fontSize,
      fontFamily,
      fontWeight,
      lineHeight,
      textAlign,
      marginsEnabled,
      marginPreset,
      chromeHidden,
    })

    const ac = new AbortController()
    setStatus('opening')
    setErrorMessage(null)
    syntheticCoverShownRef.current = false
    setSyntheticCoverShown(false)
    if (apiRefProp.current) apiRefProp.current.current = null

    openEpubjs(data, host, {
      theme,
      layout,
      viewMode,
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
      onStatusChange: (nextStatus) => {
        if (ac.signal.aborted) return
        setStatus(nextStatus)
      },
      onFirstRender: () => {
        if (ac.signal.aborted) return
        // No longer setStatus('ready') here, it's handled by onStatusChange
      },
      onLocationsReady: () => {
        if (ac.signal.aborted) return
        const readNav = adjustedNavRef.current
        if (readNav) onNavStateRef.current?.(readNav())
      },
    })
      .then((handle) => {
        if (ac.signal.aborted) {
          handle.destroy()
          return
        }
        handleRef.current = handle
        // `ready` can be published from inside openEpubjs before this ref is
        // set, so drain anything the user changed while the book was opening.
        flushEpubSettingsNow()

        const hasSyntheticCover = () =>
          Boolean(coverUrlRef.current) && !handle.hasSpineCover()
        const getAdjustedNavState = (): EpubNavState => {
          const nav = handle.getNavState()
          if (!hasSyntheticCover()) return nav
          return withSyntheticCoverNav(nav, syntheticCoverShownRef.current)
        }
        adjustedNavRef.current = getAdjustedNavState
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
          apiRefProp.current.current = toApi(handle, coverNavigation)
        }

        let relocateTimer: number | null = null
        const publishRelocatedNav = () => {
          if (handleRef.current !== handle) return
          onNavStateRef.current?.(getAdjustedNavState())
          const location = handle.getCurrentLocation()
          if (location) onLocationChangeRef.current?.(location)
        }
        const onRelocated = () => {
          if (relocateTimer != null) window.clearTimeout(relocateTimer)
          relocateTimer = window.setTimeout(() => {
            relocateTimer = null
            publishRelocatedNav()
          }, PAGINATED_NAV_SETTLE_MS)
        }
        const frameCleanups = new Map<Document, () => void>()
        const attachFrameListeners = (doc: Document | null | undefined) => {
          if (!doc || frameCleanups.has(doc)) return

          const scrollRoot = (): Element | null => {
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
          // Always suppress the native context menu inside the reading surface — a right-click
          // over a live text selection instead opens the highlights context menu (Highlight /
          // Underline / Copy / Copy with Citation); a right-click on an existing highlight/
          // underline mark (no live selection under it) opens that mark's own floating menu
          // instead (`onHighlightContextMenu`); a right-click anywhere else (empty margin, plain
          // text with neither) shows nothing, matching this file's existing "no native menu,
          // ever" convention.
          const onContextMenu = (event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()

            const win = doc.defaultView
            const frameEl = win?.frameElement as HTMLIFrameElement | null
            const point =
              frameEl && win
                ? toOuterPoint(event.clientX, event.clientY, frameEl, win)
                : { x: event.clientX, y: event.clientY }

            if (hasFrameTextSelection(doc) && isPointInTextSelection(doc, event.clientX, event.clientY)) {
              onSelectionContextMenuRef.current?.(point.x, point.y)
              return
            }

            const markInfo = handleRef.current?.getHighlightAtPoint(point.x, point.y)
            if (markInfo) onHighlightContextMenuRef.current?.(markInfo)
          }

          const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0 || isInteractiveElement(event.target)) return

            const tool = interactionToolRef.current

            // Select / Highlight / Underline / Strikethrough: native text selection only — no
            // margin pan. For the three markup tools, the drag's *end* (pointerup, below) is what
            // decides whether it becomes a saved mark — not any mid-drag pause.
            if (
              tool === 'select' ||
              tool === 'highlight' ||
              tool === 'underline' ||
              tool === 'strikethrough'
            ) {
              // Deliberately NOT `setPointerCapture` here (unlike Hand's pan gesture below) — it
              // would redirect this pointer's events to a single captured element, which in
              // Chromium can itself interrupt the browser's own native text-selection drag
              // instead of just this doc's JS listeners. `commitAnnotationDrag` below covers a
              // release outside this iframe another way — via `window`'s own capture-phase
              // pointerup in the effect further down (`onGlobalPointerEnd`), which fires no matter
              // which document the release actually lands in.
              if (tool !== 'select') annotationDragActiveRef.current = true
              else if (translateModeActiveRef.current) translateDragActiveRef.current = true
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

            // Hand pan finished — toolbar tool unchanged.
            if (g.panned) return

            // Margin tap (no drag): toggle reader chrome.
            if (!isInteractiveElement(event.target) && isCenterClick(event, doc)) {
              onCenterTapRef.current?.()
            }
          }

          const onPointerUp = (event: PointerEvent) => {
            if (event.button !== 0) return
            commitAnnotationDrag()
            endGesture(event)
          }

          const onPointerCancel = (event: PointerEvent) => {
            // Gesture aborted (e.g. window lost focus mid-drag) — never commit here.
            annotationDragActiveRef.current = false
            translateDragActiveRef.current = false
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

            // Tail end of a drag that `endAnnotationDrag` just turned into a saved mark — see the
            // comment there.
            if (justCommittedAnnotationRef.current) {
              justCommittedAnnotationRef.current = false
              return
            }

            // A click that leaves a live text selection behind is the tail end of a drag-to-
            // select, not a real click on the surface or a mark — ignore it entirely (mirrors
            // `onContextMenu`'s identical check above) so it can't dismiss the very selection the
            // user just made, via `onSurfaceClick` -> `dismissAnnotationUi()` -> `clearSelection()`,
            // which would leave nothing for a follow-up right-click to act on.
            if (hasFrameTextSelection(doc)) return

            if (isTextNodeAtPoint(doc, event.clientX, event.clientY)) {
              // Empty click on text: keep tool; optional chrome toggle in center.
              if (isCenterClick(event, doc)) onCenterTapRef.current?.()
            }
            // Margin clicks without a pan gesture are handled in pointerup.

            // A single hit-test decides both `onHighlightClick` (focus) and `onSurfaceClick`
            // (dismiss) — marks-pane's own `click` listener on a mark used to drive focusing
            // instead, as a second independent detector for "did this click land on a mark." The
            // two could disagree (e.g. a mark whose geometry this hit-test resolves slightly
            // differently), racing to set focus and then immediately clear it again within the
            // same click. Using one hit-test for both removes that race by construction.
            const win = doc.defaultView
            const frameEl = win?.frameElement as HTMLIFrameElement | null
            const point =
              frameEl && win
                ? toOuterPoint(event.clientX, event.clientY, frameEl, win)
                : { x: event.clientX, y: event.clientY }
            const markInfo = handleRef.current?.getHighlightAtPoint(point.x, point.y)
            if (markInfo) {
              onHighlightClickRef.current?.(markInfo)
            } else {
              onSurfaceClickRef.current?.()
            }
          }

          const onWheel = (event: WheelEvent) => {
            if (!(event.ctrlKey || event.metaKey)) {
              if (turnPageFromWheelRef.current(event)) {
                event.preventDefault()
                event.stopPropagation()
              }
              return
            }
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
          const doc = (view as { document?: Document } | null)?.document
          if (doc) attachFrameListeners(doc)
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
          .forEach((frame) => {
            attachFrameListeners(frame.contentDocument)
          })
        if (hasSyntheticCover() && !initialLocationRef.current) {
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
        onSectionsRef.current?.(
          apiRefProp.current?.current?.getSectionLabels() ??
            handle.getSectionLabels(),
        )
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
            if (relocateTimer != null) {
              window.clearTimeout(relocateTimer)
              relocateTimer = null
            }
            handle.rendition.off('relocated', onRelocated)
            cleanupFrameListeners()
          },
          { once: true },
        )
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || isAbortError(err)) return
        handleRef.current = null
        if (apiRefProp.current) apiRefProp.current.current = null
        setStatus('error')
        setErrorMessage(
          err instanceof Error ? err.message : 'Could not open this EPUB.',
        )
      })

    return () => {
      ac.abort()
      handleRef.current?.destroy()
      handleRef.current = null
      adjustedNavRef.current = null
      syntheticCoverShownRef.current = false
      if (apiRefProp.current) apiRefProp.current.current = null
      disposeEpubSettingsSync()
    }
    // Re-open when bytes change; appearance is synced by syncEpubAppearance
    // (a plain function, not a hook result — nothing to list here).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- appearance applied by syncEpubAppearance
  }, [data])

  useEffect(() => {
    if (status !== 'ready') return

    const onGlobalPointerEnd = (event: PointerEvent) => {
      clearHandPanGesture(event)
      // A markup-tool or Translate-mode drag started inside the iframe but ended with the button
      // coming up outside its rectangle — that `pointerup`/`pointercancel` lands here, on the
      // outer window, instead of the iframe's own document (cross-document events don't bubble
      // the other way). This is the fallback that still commits the drag in that case; the iframe
      // doc's own `pointerup` (in `attachFrameListeners` above) already handles the common
      // in-bounds release and will have reset `annotationDragActiveRef`/`translateDragActiveRef`
      // by the time this ever runs for the same gesture.
      if (event.type === 'pointerup') {
        commitAnnotationDrag()
      } else {
        annotationDragActiveRef.current = false
        translateDragActiveRef.current = false
      }
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
    const host = hostRef.current
    if (status !== 'ready' || !handle || !host) return
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
      onNavStateRef.current?.(withSyntheticCoverNav(nav, true))
    }
  }, [coverUrl, status])

  useEffect(() => {
    if (status !== 'ready') return
    const root = epubRootRef.current
    if (!root) return
    pageTurnWheelAccRef.current = 0
    const onWheel = (event: WheelEvent) => {
      if (turnPageFromWheelRef.current(event)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    root.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => root.removeEventListener('wheel', onWheel, true)
  }, [status])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let lastWidth = host.clientWidth
    let lastHeight = host.clientHeight
    let timer: number | null = null
    const ro = new ResizeObserver(() => {
      const width = host.clientWidth
      const height = host.clientHeight
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      if (timer != null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        handleRef.current?.resize()
      }, 100)
    })
    ro.observe(host)
    return () => {
      if (timer != null) window.clearTimeout(timer)
      ro.disconnect()
    }
  }, [status])

  const showGutter = layout !== 'single' && status === 'ready'

  return (
    <main
      ref={epubRootRef}
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${className ?? ''}`}
      data-epub-status={status}
      data-epub-layout={layout}
      data-epub-page-mode={viewMode === 'scroll' ? 'scroll' : 'paginated'}
    >
      {(status === 'opening' || status === 'rendering') && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-lib-surface-strong/80 backdrop-blur-sm">
          <div className="flex w-48 flex-col gap-3">
            <div className="flex items-center justify-between text-sm font-medium text-lib-text-strong">
              <span>
                {status === 'opening'
                  ? 'Opening book...'
                  : 'Preparing your book...'}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-lib-border-soft">
              <div className="h-full w-1/3 animate-import-indeterminate rounded-full bg-lib-accent" />
            </div>
          </div>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-lib-surface-strong px-6 text-center">
          <div className="text-base font-medium text-rose-500">
            {errorMessage ?? 'Unable to open this book'}
          </div>
          <button
            type="button"
            className="rounded-md bg-lib-surface-hover px-4 py-2 text-sm font-medium text-lib-text-strong hover:bg-lib-chip"
            onClick={() => window.location.reload()}
          >
            Try Again
          </button>
        </div>
      )}
      {/* Dual-page spread gutter — visible gray band between page columns. */}
      {showGutter ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-1/2 z-[7] flex w-3 -translate-x-1/2 flex-col items-center justify-stretch"
          aria-hidden
        >
          <div className="h-full w-full bg-neutral-500/20" />
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-neutral-400/75" />
        </div>
      ) : null}
      {/* Synthetic cover (EPUB has none in spine) — fixed overlay page. */}
      {syntheticCoverShown && coverUrl ? (
        <div
          className="absolute inset-0 z-[8] flex items-center justify-center bg-lib-bg-deep p-6"
          data-epub-synthetic-cover="overlay"
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
        className={`h-full w-full min-h-0 flex-1 [&_iframe]:w-full [&_iframe]:h-full ${
          interactionTool === 'select'
            ? 'cursor-select-tool'
            : interactionTool === 'highlight'
              ? 'cursor-highlight-tool'
              : interactionTool === 'underline'
                ? 'cursor-underline-tool'
                : interactionTool === 'strikethrough'
                  ? 'cursor-strikethrough-tool'
                  : 'cursor-hand-tool'
        } ${
          showGutter
            ? 'bg-neutral-600/15 [&_.epub-container]:bg-transparent [&_.epub-view]:shadow-[0_0_0_1px_rgba(148,163,184,0.35)]'
            : ''
        }`}
        tabIndex={-1}
      />
    </main>
  )
}

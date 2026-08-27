import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { CfiLocation, Highlight } from '@reading-book/domain'
import type {
  DrawToolSettings,
  FontFamily,
  FontWeight,
  FreehandDraftStroke,
  FreehandPoint,
  HighlightHandleRect,
  InteractionTool,
  ReaderShapeAnnotation,
  ReaderTheme,
  ReaderTypewriterNote,
  TextAlign,
  TypewriterBoxStyle,
  TypewriterDraft,
  TypewriterMovePayload,
  TypewriterPlacePayload,
} from '@reading-book/shared/models'
import {
  appendFreehandPoint,
  freehandBoundingBox,
  hitTestFreehandStrokes,
  parseTypewriterPosition,
  type EpubReaderHighlight,
  type PendingSelection,
} from '@reading-book/shared/models'
import type { DomCssOverlay } from '../../overlays/dom-css-overlay'
import {
  draftToInkStroke,
  ensureInkIframeLayer,
  iframeClientToNormalizedInkPoint,
  inkSvgTopLevelRect,
  paintInkStrokes,
  readerShapeToInkStroke,
} from '../../overlays/ink-iframe-layer'
import {
  ensureTypewriterIframeLayer,
  isTypewriterOverlayElement,
  TYPEWRITER_DRAFT_ATTR,
  TYPEWRITER_NOTE_ATTR,
} from '../../overlays/typewriter-iframe-layer'
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
  iframeClientToBodyPoint,
  resolveTypewriterIframePoint,
  typewriterBelongsToRenderedSection,
} from './cfi/typewriter-cfi-anchor'
import {
  applyInteractionToolSurface,
  HAND_HOVER_CURSOR_DELAY_MS,
  isHandHoverCursorTargetAtPoint,
  isPointInTextSelection,
  isTextCursorTargetAtPoint,
  isTextNodeAtPoint,
  PAN_DRAG_THRESHOLD_PX,
} from '../../interaction'
import {
  beginTypewriterDrag,
  tickTypewriterDrag,
  type TypewriterDragSession,
  type TypewriterPct,
  hitTestTypewriterAtClientPoint,
  TypewriterRichEditor,
  TypewriterStaticHtml,
  clearTypewriterCommitSuppress,
  createTypewriterFocusSession,
  isTypewriterToolbarTarget,
  requestTypewriterActivation,
} from '../../typewriter'
/** Imperative nav for parent footer scrub / section jump. */
export type EpubRendererApi = Pick<
  EpubjsHandle,
  | 'nextPage'
  | 'prevPage'
  | 'scrollByViewport'
  | 'nextSection'
  | 'prevSection'
  | 'goToHref'
  | 'goToSpineIndex'
  | 'goToLocationPage'
  | 'getSpineLength'
  | 'getNavState'
  | 'getToc'
  | 'getSectionLabels'
  | 'getCurrentLocation'
  | 'getCurrentExcerpt'
  | 'isCfiWithinCurrentView'
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
> & {
  /** Force DomCssOverlay full reload (T5.3) — usually driven by `rendered` / props. */
  repaintHighlights: () => void
}

type EpubRendererProps = {
  data: ArrayBuffer
  /** Extracted cover shown as a synthetic first *section* when the EPUB has none in its spine. */
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
  /** Spine section labels for the Page layout grid, index-aligned to sections. */
  onSections?: (labels: string[]) => void
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
  /**
   * Pencil / eraser drawing signal while `interactionTool` is `annotate`.
   */
  drawingTool?: 'pencil' | 'eraser' | null
  drawSettings?: DrawToolSettings
  /** Session freehand strokes for the open book (T5.11b). */
  freehandStrokes?: ReaderShapeAnnotation[]
  onFreehandStrokeComplete?: (draft: FreehandDraftStroke) => void
  /** Hand / select / eraser: tap a painted stroke. */
  onFreehandStrokeClick?: (payload: {
    id: string
    rect: { left: number; top: number; width: number; height: number }
    click?: { x: number; y: number }
    hostRect?: { left: number; top: number; width: number; height: number }
  }) => void
  /** Persisted typewriter textboxes for the current book (painted inside EPUB iframe). */
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
  /** ESC while editing — revert without persisting changes. */
  onTypewriterContentCancel?: (id: string) => void
  /** Box-level defaults → `style_properties` (font size / default color). */
  onTypewriterStyleChange?: (id: string, patch: TypewriterBoxStyle) => void
  /** Persist reposition after drag (T5.6c/d). */
  onTypewriterMove?: (id: string, payload: TypewriterMovePayload) => void
  /** Delete from canvas (empty + Delete/Backspace). */
  onTypewriterDelete?: (id: string) => void
  /** Floating toolbar → shared right reader panel. */
  onTypewriterOpenSidePanel?: () => void
  typewriterSidePanelOpen?: boolean
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
  if (isTypewriterOverlayElement(el)) return true
  return !!el.closest(
    'a, button, input, textarea, select, summary, [role="button"], [contenteditable="true"]',
  )
}

/** Normalize pointer client coords to top-level viewport (iframe events are local). */
function toTopLevelClientPoint(
  event: PointerEvent | MouseEvent,
): { x: number; y: number } {
  const view =
    event.view ??
    ((event.target as Node | null)?.ownerDocument?.defaultView ?? null)
  const frameEl = view?.frameElement as HTMLElement | null
  if (frameEl) {
    const fr = frameEl.getBoundingClientRect()
    return { x: event.clientX + fr.left, y: event.clientY + fr.top }
  }
  return { x: event.clientX, y: event.clientY }
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
  repaintHighlights: () => void,
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
    scrollByViewport: (direction) => handle.scrollByViewport(direction),
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
    getCurrentExcerpt: () => handle.getCurrentExcerpt(),
    isCfiWithinCurrentView: (cfi) => handle.isCfiWithinCurrentView(cfi),
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

type IframeContentSize = {
  width: number
  height: number
}

function iframeContentSizesEqual(
  a: IframeContentSize | null,
  b: IframeContentSize | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.width === b.width && a.height === b.height
}

/** One mouse-wheel tick (or a firm trackpad flick) turns one paginated page. */
const PAGE_TURN_WHEEL_THRESHOLD = 80

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

/** In-flow synthetic cover for continuous scroll (not a fixed viewport overlay). */
const SCROLL_COVER_ATTR = 'data-epub-synthetic-cover'
const SCROLL_COVER_STYLE_ATTR = 'data-epub-scroll-cover-style'
/** Coalesce epub.js relocated bursts after a page-turn before publishing footer pages. */
const PAGINATED_NAV_SETTLE_MS = 80

function ensureScrollCoverStyles(doc: Document): void {
  const host = doc.head ?? doc.documentElement
  if (!host || doc.querySelector(`style[${SCROLL_COVER_STYLE_ATTR}]`)) return
  const style = doc.createElement('style')
  style.setAttribute(SCROLL_COVER_STYLE_ATTR, '1')
  style.textContent = `
    .rb-epub-scroll-cover {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 100%;
      flex: 0 0 auto;
      padding: 1.5rem;
      background: transparent;
    }
    .rb-epub-scroll-cover img {
      display: block;
      max-width: min(100%, 28rem);
      max-height: min(100%, 85vh);
      width: auto;
      height: auto;
      object-fit: contain;
      box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.45);
      user-select: none;
      -webkit-user-drag: none;
    }
  `
  host.appendChild(style)
}

function getEpubScrollContainer(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.epub-container')
}

/**
 * Stretch one continuous-scroll iframe to its document height.
 * Do not call rendition.resize() here — that rebuilds every spine view.
 */
function expandEpubIframeToContent(doc: Document): void {
  const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null
  if (!iframe) return
  const height = Math.ceil(
    Math.max(
      doc.documentElement?.scrollHeight ?? 0,
      doc.body?.scrollHeight ?? 0,
    ),
  )
  if (height <= 0) return
  if (Math.abs(iframe.clientHeight - height) < 2) return
  iframe.style.height = `${height}px`
  const viewEl = iframe.closest('.epub-view') as HTMLElement | null
  if (viewEl) viewEl.style.height = `${height}px`
}

/** Keep cover as the first in-flow block inside the continuous scroll container. */
function syncContinuousScrollCover(
  host: HTMLElement,
  coverUrl: string | null | undefined,
): HTMLElement | null {
  const container = getEpubScrollContainer(host)
  if (!container) return null

  let cover = container.querySelector(
    `[${SCROLL_COVER_ATTR}]`,
  ) as HTMLElement | null

  if (!coverUrl?.trim()) {
    cover?.remove()
    return null
  }

  ensureScrollCoverStyles(host.ownerDocument)

  if (!cover) {
    cover = host.ownerDocument.createElement('div')
    cover.setAttribute(SCROLL_COVER_ATTR, 'scroll')
    cover.className = 'rb-epub-scroll-cover'
    const img = host.ownerDocument.createElement('img')
    img.alt = 'Book cover'
    img.draggable = false
    cover.appendChild(img)
  }

  const img = cover.querySelector('img')
  if (img && img.getAttribute('src') !== coverUrl) {
    img.src = coverUrl
  }

  const viewportH =
    container.clientHeight || host.clientHeight || window.innerHeight || 640
  cover.style.minHeight = `${Math.max(Math.floor(viewportH), 320)}px`

  if (cover.parentElement !== container || container.firstElementChild !== cover) {
    container.insertBefore(cover, container.firstChild)
  }
  return cover
}

function removeContinuousScrollCover(host: HTMLElement): void {
  host
    .querySelector(`.epub-container > [${SCROLL_COVER_ATTR}]`)
    ?.remove()
}

function isContinuousScrollCoverActive(host: HTMLElement | null): boolean {
  if (!host) return false
  const container = getEpubScrollContainer(host)
  const cover = container?.querySelector(
    `[${SCROLL_COVER_ATTR}]`,
  ) as HTMLElement | null
  if (!container || !cover || cover.offsetHeight <= 0) return false
  // Page 1 until the cover has fully left the viewport top — a partial
  // scroll must not map onto later reference pages.
  return container.scrollTop < cover.offsetHeight
}

function scrollPastContinuousCover(host: HTMLElement | null): void {
  const container = host ? getEpubScrollContainer(host) : null
  const cover = container?.querySelector(
    `[${SCROLL_COVER_ATTR}]`,
  ) as HTMLElement | null
  if (!container || !cover) return
  container.scrollTo({ top: cover.offsetHeight, behavior: 'smooth' })
}

function scrollToContinuousCover(host: HTMLElement | null): void {
  const container = host ? getEpubScrollContainer(host) : null
  if (!container) return
  container.scrollTo({ top: 0, behavior: 'smooth' })
}

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
  onSections,
  onSelectionContextMenu,
  onTextSelected,
  onSelectionDismiss,
  onHighlightMarkClick,
  highlights,
  interactionTool = 'hand',
  drawingTool = null,
  drawSettings,
  freehandStrokes = [],
  onFreehandStrokeComplete,
  onFreehandStrokeClick,
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
  onTypewriterContentCancel,
  onTypewriterStyleChange,
  onTypewriterMove,
  onTypewriterDelete,
  onTypewriterOpenSidePanel,
  typewriterSidePanelOpen = false,
  onFocusZoomWheel,
  onHandPanBy,
  apiRef,
}: EpubRendererProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const epubRootRef = useRef<HTMLElement>(null)
  const typewriterDraftRootRef = useRef<HTMLDivElement | null>(null)
  const [activeEditingId, setActiveEditingId] = useState<string | null>(null)
  const activeEditingIdRef = useRef<string | null>(null)
  activeEditingIdRef.current = activeEditingId
  const typewriterDraftLiveRef = useRef(typewriterDraft)
  typewriterDraftLiveRef.current = typewriterDraft
  const typewriterFocusSessionRef = useRef(createTypewriterFocusSession())
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
  const onTypewriterDraftCommitRef = useRef(onTypewriterDraftCommit)
  onTypewriterDraftCommitRef.current = onTypewriterDraftCommit
  const onTypewriterMoveRef = useRef(onTypewriterMove)
  onTypewriterMoveRef.current = onTypewriterMove

  const commitActiveTypewriterSession = useCallback(() => {
    const editing = activeEditingIdRef.current
    if (editing) {
      onTypewriterContentBlurRef.current?.(editing)
      setActiveEditingId(null)
    }
    const draft = typewriterDraftLiveRef.current
    if (draft) {
      onTypewriterDraftCommitRef.current?.(draft.id)
    }
  }, [])
  const commitActiveTypewriterSessionRef = useRef(commitActiveTypewriterSession)
  commitActiveTypewriterSessionRef.current = commitActiveTypewriterSession
  const typewriterFrameRef = useRef<{
    doc: Document
    ctx: EpubFrameSelectionContext
    cfiBase?: string
  } | null>(null)
  const remeasureTypewriterHostRef = useRef<() => void>(() => {})
  const dragEndClientRef = useRef<{ x: number; y: number } | null>(null)
  const iframeContentSizeRef = useRef<IframeContentSize | null>(null)
  const typewriterPortalHostRef = useRef<HTMLElement | null>(null)
  const [typewriterPortalHost, setTypewriterPortalHost] =
    useState<HTMLElement | null>(null)
  const [iframeContentSize, setIframeContentSize] =
    useState<IframeContentSize | null>(null)
  /** Bumps when CFI geometry may have moved (scroll / relocate) so notes re-resolve. */
  const [typewriterLayoutEpoch, setTypewriterLayoutEpoch] = useState(0)

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
          setTypewriterLayoutEpoch((n) => n + 1)
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
      const pt = toTopLevelClientPoint(e)
      const { session: next, preview } = tickTypewriterDrag(
        session,
        pt.x,
        pt.y,
      )
      dragSessionRef.current = next
      if (preview) {
        setTypewriterDragPreview({ id: next.id, ...preview })
      }
    }
    function onPointerUp(e: PointerEvent) {
      const session = dragSessionRef.current
      if (!session || e.pointerId !== session.pointerId) return
      dragEndClientRef.current = toTopLevelClientPoint(e)
      endDrag(true, true)
      dragEndClientRef.current = null
    }
    function onPointerCancel(e: PointerEvent) {
      const session = dragSessionRef.current
      if (!session || e.pointerId !== session.pointerId) return
      endDrag(false, false)
    }
    // Top window for host chrome; iframe window for in-doc pointer capture.
    const iframeWin =
      typewriterPortalHostRef.current?.ownerDocument?.defaultView ?? null
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    iframeWin?.addEventListener('pointermove', onPointerMove)
    iframeWin?.addEventListener('pointerup', onPointerUp)
    iframeWin?.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      iframeWin?.removeEventListener('pointermove', onPointerMove)
      iframeWin?.removeEventListener('pointerup', onPointerUp)
      iframeWin?.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [setTypewriterDragPreview, typewriterPortalHost])
  const handleRef = useRef<EpubjsHandle | null>(null)
  const overlayPainterRef = useRef<DomCssOverlay | null>(null)
  const highlightsRef = useRef<EpubReaderHighlight[]>(highlights ?? [])
  highlightsRef.current = highlights ?? []
  const lastEpubSelectionRef = useRef<PendingSelection | null>(null)
  const interactionToolRef = useRef<InteractionTool>(interactionTool)
  interactionToolRef.current = interactionTool
  const drawingToolRef = useRef(drawingTool)
  drawingToolRef.current = drawingTool
  const drawSettingsRef = useRef(drawSettings)
  drawSettingsRef.current = drawSettings
  const onFreehandStrokeCompleteRef = useRef(onFreehandStrokeComplete)
  onFreehandStrokeCompleteRef.current = onFreehandStrokeComplete
  const onFreehandStrokeClickRef = useRef(onFreehandStrokeClick)
  onFreehandStrokeClickRef.current = onFreehandStrokeClick
  const freehandStrokesRef = useRef(freehandStrokes)
  freehandStrokesRef.current = freehandStrokes
  const inkDraftRef = useRef<{
    pointerId: number
    doc: Document
    chapterIndex: number
    points: FreehandPoint[]
    colorHex: string
    strokeWidth: number
  } | null>(null)
  const [inkDraft, setInkDraft] = useState<FreehandDraftStroke | null>(null)
  const onTypewriterPlaceRef = useRef(onTypewriterPlace)
  onTypewriterPlaceRef.current = onTypewriterPlace
  const typewriterChapterIndexRef = useRef(typewriterChapterIndex)
  typewriterChapterIndexRef.current = typewriterChapterIndex
  const onFocusZoomWheelRef = useRef(onFocusZoomWheel)
  onFocusZoomWheelRef.current = onFocusZoomWheel
  const onHandPanByRef = useRef(onHandPanBy)
  onHandPanByRef.current = onHandPanBy
  const pageModeRef = useRef(pageMode)
  pageModeRef.current = pageMode
  const pageTurnWheelAccRef = useRef(0)
  const pageTurnBusyRef = useRef(false)
  const turnPageFromWheelRef = useRef<(event: WheelEvent) => boolean>(
    () => false,
  )

  const paintInkLayerNow = useCallback(
    (draftOverride?: FreehandDraftStroke | null) => {
      const doc =
        inkDraftRef.current?.doc ??
        typewriterFrameRef.current?.doc ??
        typewriterPortalHostRef.current?.ownerDocument ??
        null
      if (!doc) return
      const layer = ensureInkIframeLayer(doc)
      if (!layer) return
      const chapterIndex = typewriterChapterIndexRef.current
      const chapterStrokes = freehandStrokesRef.current.filter(
        (s) => s.chapterIndex === chapterIndex,
      )
      const draft =
        draftOverride === undefined
          ? inkDraftRef.current &&
            inkDraftRef.current.chapterIndex === chapterIndex
            ? {
                chapterIndex: inkDraftRef.current.chapterIndex,
                points: inkDraftRef.current.points,
                colorHex: inkDraftRef.current.colorHex,
                strokeWidth: inkDraftRef.current.strokeWidth,
              }
            : null
          : draftOverride && draftOverride.chapterIndex === chapterIndex
            ? draftOverride
            : null
      paintInkStrokes(
        layer,
        chapterStrokes.map(readerShapeToInkStroke),
        draft ? draftToInkStroke(draft) : null,
      )
    },
    [],
  )
  const paintInkLayerNowRef = useRef(paintInkLayerNow)
  paintInkLayerNowRef.current = paintInkLayerNow

  const appendInkDraftPoint = useCallback(
    (doc: Document, clientX: number, clientY: number, pointerId: number) => {
      const session = inkDraftRef.current
      if (!session || session.pointerId !== pointerId || session.doc !== doc) {
        return
      }
      const localPoint = iframeClientToNormalizedInkPoint(doc, clientX, clientY)
      if (!localPoint) return
      session.points = appendFreehandPoint(session.points, localPoint)
      const draft: FreehandDraftStroke = {
        chapterIndex: session.chapterIndex,
        points: session.points,
        colorHex: session.colorHex,
        strokeWidth: session.strokeWidth,
      }
      setInkDraft(draft)
      paintInkLayerNowRef.current(draft)
    },
    [],
  )
  const appendInkDraftPointRef = useRef(appendInkDraftPoint)
  appendInkDraftPointRef.current = appendInkDraftPoint

  const endInkDraftStroke = useCallback(
    (pointerId: number, commit: boolean) => {
      const session = inkDraftRef.current
      if (!session || session.pointerId !== pointerId) return
      inkDraftRef.current = null
      setInkDraft(null)
      try {
        session.doc.documentElement.releasePointerCapture(pointerId)
      } catch {
        /* ignore */
      }
      if (commit && session.points.length > 0) {
        const completed: FreehandDraftStroke = {
          chapterIndex: session.chapterIndex,
          points: session.points,
          colorHex: session.colorHex,
          strokeWidth: session.strokeWidth,
        }
        onFreehandStrokeCompleteRef.current?.(completed)
        // Keep the stroke visible until React state catches up.
        const layer = ensureInkIframeLayer(session.doc)
        if (layer) {
          const chapterIndex = typewriterChapterIndexRef.current
          const chapterStrokes = freehandStrokesRef.current.filter(
            (s) => s.chapterIndex === chapterIndex,
          )
          paintInkStrokes(layer, [
            ...chapterStrokes.map(readerShapeToInkStroke),
            draftToInkStroke(completed),
          ])
        }
      } else {
        paintInkLayerNowRef.current(null)
      }
    },
    [],
  )
  const endInkDraftStrokeRef = useRef(endInkDraftStroke)
  endInkDraftStrokeRef.current = endInkDraftStroke

  // Top window: finish / extend stroke when pointer leaves the iframe.
  useEffect(() => {
    function iframeLocalFromTop(e: PointerEvent, doc: Document) {
      const frameEl = doc.defaultView?.frameElement as HTMLElement | null
      if (!frameEl) return null
      const fr = frameEl.getBoundingClientRect()
      // Parent ReaderZoomViewport may apply CSS scale — convert visual → layout.
      const layoutW = frameEl.offsetWidth || fr.width
      const layoutH = frameEl.offsetHeight || fr.height
      if (layoutW <= 0 || layoutH <= 0) return null
      const scaleX = fr.width / layoutW
      const scaleY = fr.height / layoutH
      if (scaleX <= 0 || scaleY <= 0) return null
      const contentLeft = fr.left + frameEl.clientLeft * scaleX
      const contentTop = fr.top + frameEl.clientTop * scaleY
      return {
        x: (e.clientX - contentLeft) / scaleX,
        y: (e.clientY - contentTop) / scaleY,
      }
    }

    function onPointerMove(e: PointerEvent) {
      const session = inkDraftRef.current
      if (!session || e.pointerId !== session.pointerId) return
      // Prefer iframe-local events; convert top-window coords when needed.
      const fromIframe =
        (e.target as Node | null)?.ownerDocument === session.doc ||
        e.view === session.doc.defaultView
      if (fromIframe) {
        appendInkDraftPointRef.current(
          session.doc,
          e.clientX,
          e.clientY,
          e.pointerId,
        )
        return
      }
      const local = iframeLocalFromTop(e, session.doc)
      if (!local) return
      appendInkDraftPointRef.current(
        session.doc,
        local.x,
        local.y,
        e.pointerId,
      )
    }

    function onPointerUp(e: PointerEvent) {
      endInkDraftStrokeRef.current(e.pointerId, true)
    }
    function onPointerCancel(e: PointerEvent) {
      endInkDraftStrokeRef.current(e.pointerId, false)
    }

    const iframeWin =
      typewriterPortalHost?.ownerDocument?.defaultView ?? null
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    iframeWin?.addEventListener('pointermove', onPointerMove)
    iframeWin?.addEventListener('pointerup', onPointerUp)
    iframeWin?.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      iframeWin?.removeEventListener('pointermove', onPointerMove)
      iframeWin?.removeEventListener('pointerup', onPointerUp)
      iframeWin?.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [typewriterPortalHost])
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
        drawingTool: drawingToolRef.current,
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
  const adjustedNavRef = useRef<(() => EpubNavState) | null>(null)
  turnPageFromWheelRef.current = (event) => {
    if (pageModeRef.current !== 'paginated') return false
    if (event.ctrlKey || event.metaKey) return false
    if (inkDraftRef.current) return false
    if (isEditableWheelTarget(event.target)) return false

    const { x, y } = wheelAxisDelta(event)
    if (Math.abs(y) <= Math.abs(x)) return false

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
    setStatus('opening')
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
        const isScrollMode = pageMode === 'scroll'
        const getAdjustedNavState = (): EpubNavState => {
          const nav = handle.getNavState()
          if (!hasSyntheticCover()) return nav
          const onCover = isScrollMode
            ? isContinuousScrollCoverActive(host)
            : syntheticCoverShownRef.current
          return withSyntheticCoverNav(nav, onCover)
        }
        adjustedNavRef.current = getAdjustedNavState
        const hideSyntheticCover = () => {
          // Continuous scroll: cover is in-flow — just scroll past it.
          if (isScrollMode) {
            scrollPastContinuousCover(host)
            onNavStateRef.current?.(getAdjustedNavState())
            return
          }
          if (!syntheticCoverShownRef.current) return
          syntheticCoverShownRef.current = false
          setSyntheticCoverShown(false)
          onNavStateRef.current?.(getAdjustedNavState())
        }
        const showSyntheticCover = async () => {
          if (!hasSyntheticCover()) return
          if (isScrollMode) {
            syncContinuousScrollCover(host, coverUrlRef.current)
            scrollToContinuousCover(host)
            onNavStateRef.current?.(getAdjustedNavState())
            return
          }
          await handle.goToSpineIndex(0)
          syntheticCoverShownRef.current = true
          setSyntheticCoverShown(true)
          onNavStateRef.current?.(getAdjustedNavState())
        }
        const coverNavigation: SyntheticCoverNavigation = {
          isAvailable: hasSyntheticCover,
          isShown: () =>
            isScrollMode
              ? isContinuousScrollCoverActive(host)
              : syntheticCoverShownRef.current,
          show: showSyntheticCover,
          hide: hideSyntheticCover,
          navState: getAdjustedNavState,
        }
        if (apiRefProp.current) {
          apiRefProp.current.current = toApi(
            handle,
            coverNavigation,
            paintHighlightsNow,
          )
        }

        let relocateTimer: number | null = null
        const publishRelocatedNav = () => {
          if (handleRef.current !== handle) return
          onNavStateRef.current?.(getAdjustedNavState())
          const location = handle.getCurrentLocation()
          if (location) onLocationChangeRef.current?.(location)
        }
        const onRelocated = () => {
          onSelectionDismissRef.current?.()
          if (pageMode !== 'paginated') {
            if (relocateTimer != null) {
              window.clearTimeout(relocateTimer)
              relocateTimer = null
            }
            publishRelocatedNav()
            return
          }
          if (relocateTimer != null) window.clearTimeout(relocateTimer)
          relocateTimer = window.setTimeout(() => {
            relocateTimer = null
            publishRelocatedNav()
          }, PAGINATED_NAV_SETTLE_MS)
        }
        const frameCleanups = new Map<Document, () => void>()
        const frameContextByDoc = new WeakMap<Document, EpubFrameSelectionContext>()
        const attachFrameListeners = (doc: Document | null | undefined) => {
          if (!doc || frameCleanups.has(doc)) return
          let frameActive = true
          let lateReflowTimer: number | null = null
          const scheduleLateContentReflow = () => {
            if (!frameActive || pageMode !== 'scroll') return
            if (lateReflowTimer != null) {
              window.clearTimeout(lateReflowTimer)
            }
            lateReflowTimer = window.setTimeout(() => {
              lateReflowTimer = null
              if (!frameActive || handleRef.current !== handle) return
              expandEpubIframeToContent(doc)
            }, 80)
          }
          const onLateResourceLoad = (event: Event) => {
            const target = event.target as Element | null
            if (target?.localName === 'img') scheduleLateContentReflow()
          }
          // Images often settle after the section iframe is measured. Expand
          // only this view — a full rendition.resize() rebuilds every iframe
          // and loops in continuous scroll.
          doc.addEventListener('load', onLateResourceLoad, true)

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

            const targetEl =
              event.target instanceof Element
                ? event.target
                : event.target instanceof Node
                  ? event.target.parentElement
                  : null
            if (targetEl && isTypewriterOverlayElement(targetEl)) return

            const tool = interactionToolRef.current

            // Typewriter overlays live in this iframe — empty-page clicks while
            // editing commit first (React stopPropagation keeps the editor itself safe).
            if (
              tool !== 'typewriter' &&
              (activeEditingIdRef.current || typewriterDraftLiveRef.current)
            ) {
              commitActiveTypewriterSessionRef.current()
              typewriterFocusSessionRef.current.suppressActivate = true
            }

            // Typewriter: place virtual textbox — block pan / text selection.
            // Click 1 while editing → commit only; Click 2 → place new box.
            if (tool === 'typewriter') {
              event.preventDefault()
              event.stopPropagation()

              const mayPlace = requestTypewriterActivation({
                session: typewriterFocusSessionRef.current,
                activeEditingId: activeEditingIdRef.current,
                hasDraft: Boolean(typewriterDraftLiveRef.current),
                commitEditing: (id) => {
                  onTypewriterContentBlurRef.current?.(id)
                  setActiveEditingId(null)
                },
                commitDraft: () => {
                  const draft = typewriterDraftLiveRef.current
                  if (draft) onTypewriterDraftCommitRef.current?.(draft.id)
                },
              })
              if (!mayPlace) return

              const frameEl = doc.defaultView?.frameElement as HTMLElement | null
              if (!frameEl) return

              const fr = frameEl.getBoundingClientRect()
              const clientX = event.clientX + fr.left
              const clientY = event.clientY + fr.top
              const width = fr.width || 1
              const height = fr.height || 1
              const xPct = Math.min(
                100,
                Math.max(0, (event.clientX / width) * 100),
              )
              const yPct = Math.min(
                100,
                Math.max(0, (event.clientY / height) * 100),
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

              const bodyPoint = iframeClientToBodyPoint(
                doc,
                event.clientX,
                event.clientY,
              )

              onTypewriterPlaceRef.current?.({
                chapterIndex,
                xPct,
                yPct,
                clientX,
                clientY,
                // Body-relative px inside the EPUB iframe (in-iframe paint).
                hostX: bodyPoint?.left ?? event.clientX,
                hostY: bodyPoint?.top ?? event.clientY,
                ...(cfi ? { cfi, offsetPx } : {}),
              })
              return
            }

            // Crosshair annotate tools: placement wins — block text selection.
            // Pencil: start freehand stroke; eraser: hit-test delete/select; shape stays no-op.
            if (tool === 'annotate') {
              event.preventDefault()
              const drawTool = drawingToolRef.current
              if (drawTool === 'eraser') {
                const point = iframeClientToNormalizedInkPoint(
                  doc,
                  event.clientX,
                  event.clientY,
                )
                if (!point) return
                const chapterIndex = typewriterChapterIndexRef.current
                const chapterStrokes = freehandStrokesRef.current.filter(
                  (s) => s.chapterIndex === chapterIndex,
                )
                const inkHost = inkSvgTopLevelRect(doc)
                const hitId = hitTestFreehandStrokes(point, chapterStrokes, {
                  hostWidthPx: inkHost?.width,
                  hostHeightPx: inkHost?.height,
                })
                if (!hitId) return
                const stroke = chapterStrokes.find((s) => s.id === hitId)
                const bb = stroke ? freehandBoundingBox(stroke.points) : null
                const frameEl = doc.defaultView?.frameElement as HTMLElement | null
                const fr = frameEl?.getBoundingClientRect()
                const click = {
                  x: event.clientX + (fr?.left ?? 0),
                  y: event.clientY + (fr?.top ?? 0),
                }
                if (!stroke || !bb || !inkHost) {
                  onFreehandStrokeClickRef.current?.({
                    id: hitId,
                    rect: { left: click.x, top: click.y, width: 1, height: 1 },
                    click,
                  })
                  return
                }
                onFreehandStrokeClickRef.current?.({
                  id: hitId,
                  rect: {
                    left: inkHost.left + bb.minX * inkHost.width,
                    top: inkHost.top + bb.minY * inkHost.height,
                    width: Math.max(8, (bb.maxX - bb.minX) * inkHost.width),
                    height: Math.max(8, (bb.maxY - bb.minY) * inkHost.height),
                  },
                  click,
                  hostRect: inkHost,
                })
                return
              }
              if (drawTool !== 'pencil') return

              const point = iframeClientToNormalizedInkPoint(
                doc,
                event.clientX,
                event.clientY,
              )
              if (!point) return

              const settings = drawSettingsRef.current
              const colorHex = settings?.colorHex ?? '#ef4444'
              const strokeWidth = settings?.strokeWidth ?? 2
              const chapterIndex = typewriterChapterIndexRef.current
              const draft: FreehandDraftStroke = {
                chapterIndex,
                points: [point],
                colorHex,
                strokeWidth,
              }
              inkDraftRef.current = {
                pointerId: event.pointerId,
                doc,
                chapterIndex,
                points: [point],
                colorHex,
                strokeWidth,
              }
              setInkDraft(draft)
              paintInkLayerNowRef.current(draft)
              try {
                doc.documentElement.setPointerCapture(event.pointerId)
              } catch {
                /* ignore */
              }
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
            // Pencil stroke (iframe-local coords — reliable even when event.view is null).
            if (
              inkDraftRef.current &&
              inkDraftRef.current.doc === doc &&
              inkDraftRef.current.pointerId === event.pointerId
            ) {
              appendInkDraftPointRef.current(
                doc,
                event.clientX,
                event.clientY,
                event.pointerId,
              )
              return
            }

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
              // Highlight wash is under text (pointer-events: none) — geometry hit-test.
              const hlMark = overlayPainterRef.current?.hitTestMarkAt(
                event.clientX,
                event.clientY,
                doc,
              )
              if (hlMark) {
                onHighlightMarkClickRef.current?.(hlMark)
                return
              }

              const frameEl = doc.defaultView?.frameElement as HTMLElement | null
              let clientX = event.clientX
              let clientY = event.clientY
              if (frameEl) {
                const fr = frameEl.getBoundingClientRect()
                clientX += fr.left
                clientY += fr.top
              }

              const inkPoint = iframeClientToNormalizedInkPoint(
                doc,
                event.clientX,
                event.clientY,
              )
              if (inkPoint) {
                const chapterIndex = typewriterChapterIndexRef.current
                const chapterStrokes = freehandStrokesRef.current.filter(
                  (s) => s.chapterIndex === chapterIndex,
                )
                const inkHost = inkSvgTopLevelRect(doc)
                const hitId = hitTestFreehandStrokes(inkPoint, chapterStrokes, {
                  hostWidthPx: inkHost?.width,
                  hostHeightPx: inkHost?.height,
                })
                if (hitId) {
                  const stroke = chapterStrokes.find((s) => s.id === hitId)
                  const bb = stroke ? freehandBoundingBox(stroke.points) : null
                  if (stroke && bb && inkHost) {
                    onFreehandStrokeClickRef.current?.({
                      id: hitId,
                      rect: {
                        left: inkHost.left + bb.minX * inkHost.width,
                        top: inkHost.top + bb.minY * inkHost.height,
                        width: Math.max(8, (bb.maxX - bb.minX) * inkHost.width),
                        height: Math.max(
                          8,
                          (bb.maxY - bb.minY) * inkHost.height,
                        ),
                      },
                      click: { x: clientX, y: clientY },
                      hostRect: inkHost,
                    })
                    return
                  }
                }
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
            if (
              inkDraftRef.current &&
              inkDraftRef.current.doc === doc &&
              inkDraftRef.current.pointerId === event.pointerId
            ) {
              endInkDraftStrokeRef.current(event.pointerId, true)
              return
            }
            endGesture(event)
            applyHighlightSelectionOnRelease()
            window.setTimeout(() => {
              clearTypewriterCommitSuppress(typewriterFocusSessionRef.current)
            }, 0)
          }

          const onPointerCancel = (event: PointerEvent) => {
            if (
              inkDraftRef.current &&
              inkDraftRef.current.doc === doc &&
              inkDraftRef.current.pointerId === event.pointerId
            ) {
              endInkDraftStrokeRef.current(event.pointerId, false)
              return
            }
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
            if (!(event.ctrlKey || event.metaKey)) {
              if (pageMode === 'scroll') {
                const container = hostRef.current
                  ? getEpubScrollContainer(hostRef.current)
                  : null
                if (!container) return

                const unit =
                  event.deltaMode === WheelEvent.DOM_DELTA_LINE
                    ? 16
                    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                      ? Math.max(1, container.clientHeight)
                      : 1
                container.scrollBy({
                  left: event.deltaX * unit,
                  top: event.deltaY * unit,
                  behavior: 'auto',
                })
                event.preventDefault()
                event.stopPropagation()
                return
              }
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
            frameActive = false
            if (lateReflowTimer != null) {
              window.clearTimeout(lateReflowTimer)
              lateReflowTimer = null
            }
            doc.removeEventListener('load', onLateResourceLoad, true)
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
            const layer = ensureTypewriterIframeLayer(frame.doc)
            ensureInkIframeLayer(frame.doc)
            typewriterPortalHostRef.current = layer
            setTypewriterPortalHost(layer)
            remeasureTypewriterHostRef.current()
            setTypewriterLayoutEpoch((n) => n + 1)
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
          .forEach((frame) => {
            const doc = frame.contentDocument
            attachFrameListeners(doc)
            if (doc) {
              const layer = ensureTypewriterIframeLayer(doc)
              ensureInkIframeLayer(doc)
              typewriterPortalHostRef.current = layer
              setTypewriterPortalHost(layer)
            }
          })
        remeasureTypewriterHostRef.current()
        if (hasSyntheticCover()) {
          if (pageMode === 'scroll') {
            // Cover participates in the same continuous scroller as chapters.
            syncContinuousScrollCover(host, coverUrlRef.current)
            syntheticCoverShownRef.current = false
            setSyntheticCoverShown(false)
            if (!initialLocationRef.current) {
              scrollToContinuousCover(host)
            }
          } else if (!initialLocationRef.current) {
            syntheticCoverShownRef.current = true
            setSyntheticCoverShown(true)
          }
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
        // Initial paint once rendition is ready (hydrate + live highlights).
        paintHighlightsNow()
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
      adjustedNavRef.current = null
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
        drawingTool,
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
        drawingTool: null,
      })
    }
  }, [interactionTool, drawingTool, status])

  useEffect(() => {
    const handle = handleRef.current
    const host = hostRef.current
    if (status !== 'ready' || !handle || !host) return
    const available = Boolean(coverUrl) && !handle.hasSpineCover()

    if (pageMode === 'scroll') {
      // Never use the fixed overlay in continuous mode.
      if (syntheticCoverShownRef.current) {
        syntheticCoverShownRef.current = false
        setSyntheticCoverShown(false)
      }
      if (available) {
        syncContinuousScrollCover(host, coverUrl)
      } else {
        removeContinuousScrollCover(host)
      }
      onNavStateRef.current?.(
        apiRefProp.current?.current?.getNavState() ?? handle.getNavState(),
      )
      return
    }

    removeContinuousScrollCover(host)

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
  }, [coverUrl, status, pageMode])

  useEffect(() => {
    if (pageMode !== 'paginated' || status !== 'ready') return
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
  }, [pageMode, status])

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

  // Continuous scroll is a single reflowing column — no page spread gutters.
  const showGutter =
    layout !== 'single' && pageMode !== 'scroll' && status === 'ready'

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
    let coverMo: MutationObserver | null = null
    let navRaf: number | null = null
    let lastOnCover: boolean | null = null

    const publishScrollNav = () => {
      const api = apiRefProp.current?.current
      if (!api) return
      onNavStateRef.current?.(api.getNavState())
    }

    const publishCoverNav = () => {
      const api = apiRefProp.current?.current
      if (!api) return
      const onCover = isContinuousScrollCoverActive(host)
      if (lastOnCover === onCover) {
        publishScrollNav()
        return
      }
      lastOnCover = onCover
      onNavStateRef.current?.(api.getNavState())
    }

    const keepCoverFirst = () => {
      const handle = handleRef.current
      const url = coverUrlRef.current
      if (!handle || !url || handle.hasSpineCover()) {
        removeContinuousScrollCover(host)
        return
      }
      syncContinuousScrollCover(host, url)
    }

    const bind = (el: HTMLElement) => {
      scrollContainerRef.current = el
      keepCoverFirst()
      const onScroll = () => {
        updateScrollThumb()
        if (navRaf != null) cancelAnimationFrame(navRaf)
        navRaf = requestAnimationFrame(() => {
          navRaf = null
          publishCoverNav()
        })
      }
      el.addEventListener('scroll', onScroll, { passive: true })
      updateScrollThumb()
      publishCoverNav()
      // Continuous manager may prepend views — keep cover as first child.
      coverMo = new MutationObserver(() => {
        keepCoverFirst()
      })
      coverMo.observe(el, { childList: true })
      scrollCleanup = () => {
        el.removeEventListener('scroll', onScroll)
        coverMo?.disconnect()
        coverMo = null
      }
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
      coverMo?.disconnect()
      scrollCleanup?.()
      if (navRaf != null) cancelAnimationFrame(navRaf)
      scrollContainerRef.current = null
      if (scrollHideTimerRef.current != null) {
        window.clearTimeout(scrollHideTimerRef.current)
        scrollHideTimerRef.current = null
      }
    }
  }, [pageMode, status, updateScrollThumb, coverUrl])

  const showCustomScrollbar =
    pageMode === 'scroll' && status === 'ready' && scrollThumb.height > 0

  useEffect(() => {
    if (status !== 'ready') {
      setIframeContentSize(null)
      iframeContentSizeRef.current = null
      typewriterPortalHostRef.current = null
      setTypewriterPortalHost(null)
      remeasureTypewriterHostRef.current = () => {}
      return
    }
    const measure = () => {
      const host = hostRef.current
      if (!host) return
      const iframe = host.querySelector('iframe')
      if (!iframe) {
        if (iframeContentSizeRef.current !== null) {
          iframeContentSizeRef.current = null
          setIframeContentSize(null)
        }
        return
      }
      const ir = iframe.getBoundingClientRect()
      const size: IframeContentSize = {
        width: ir.width,
        height: ir.height,
      }
      if (!iframeContentSizesEqual(iframeContentSizeRef.current, size)) {
        iframeContentSizeRef.current = size
        setIframeContentSize(size)
      }
      const doc = iframe.contentDocument
      if (doc) {
        const layer = ensureTypewriterIframeLayer(doc)
        ensureInkIframeLayer(doc)
        if (typewriterPortalHostRef.current !== layer) {
          typewriterPortalHostRef.current = layer
          setTypewriterPortalHost(layer)
        }
      }
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

  // Click outside draft / active edit → save + exit edit frame (click 1 of switch).
  useEffect(() => {
    if (!typewriterDraft && !activeEditingId) return

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) return
      // Format toolbar is portaled to document.body — not inside the note DOM.
      if (isTypewriterToolbarTarget(target)) return

      if (typewriterDraft && typewriterDraftRootRef.current?.contains(target)) {
        return
      }
      if (activeEditingIdRef.current) {
        const noteEl = typewriterNoteRefs.current.get(activeEditingIdRef.current)
        if (noteEl?.contains(target)) return
      }
      commitActiveTypewriterSession()
      // Same gesture must not activate another box / place a new one.
      typewriterFocusSessionRef.current.suppressActivate = true
    }

    function onPointerUp() {
      // Clear after click handlers for this gesture have run.
      window.setTimeout(() => {
        clearTypewriterCommitSuppress(typewriterFocusSessionRef.current)
      }, 0)
    }

    const iframeWin =
      typewriterPortalHost?.ownerDocument?.defaultView ?? null

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    iframeWin?.addEventListener('pointerdown', onPointerDown, true)
    iframeWin?.addEventListener('pointerup', onPointerUp, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      iframeWin?.removeEventListener('pointerdown', onPointerDown, true)
      iframeWin?.removeEventListener('pointerup', onPointerUp, true)
    }
  }, [
    typewriterDraft,
    activeEditingId,
    commitActiveTypewriterSession,
    typewriterPortalHost,
  ])

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

  /** Activate edit only when idle; while editing, first click commits only. */
  const beginHandTypewriterEdit = useCallback((id: string) => {
    const mayActivate = requestTypewriterActivation({
      session: typewriterFocusSessionRef.current,
      activeEditingId: activeEditingIdRef.current,
      hasDraft: Boolean(typewriterDraftLiveRef.current),
      targetId: id,
      commitEditing: (editingId) => {
        onTypewriterContentBlurRef.current?.(editingId)
        setActiveEditingId(null)
      },
      commitDraft: () => {
        const draft = typewriterDraftLiveRef.current
        if (draft) onTypewriterDraftCommitRef.current?.(draft.id)
      },
    })
    if (!mayActivate) return
    setActiveEditingId(id)
  }, [])
  const beginHandTypewriterEditRef = useRef(beginHandTypewriterEdit)
  beginHandTypewriterEditRef.current = beginHandTypewriterEdit

  // Keep layout epoch referenced so CFI notes re-resolve after scroll/relocate.
  void typewriterLayoutEpoch

  // Drop in-progress ink when the rendered section changes.
  useEffect(() => {
    if (!inkDraftRef.current) return
    if (inkDraftRef.current.chapterIndex === typewriterChapterIndex) return
    inkDraftRef.current = null
    setInkDraft(null)
  }, [typewriterChapterIndex])

  // Paint session freehand strokes into the iframe ink layer (T5.11b).
  useEffect(() => {
    const doc =
      typewriterPortalHost?.ownerDocument ??
      typewriterFrameRef.current?.doc ??
      null
    if (!doc) return
    const layer = ensureInkIframeLayer(doc)
    if (!layer) return
    const chapterStrokes = freehandStrokes.filter(
      (s) => s.chapterIndex === typewriterChapterIndex,
    )
    const draft =
      inkDraft && inkDraft.chapterIndex === typewriterChapterIndex
        ? draftToInkStroke(inkDraft)
        : null
    paintInkStrokes(
      layer,
      chapterStrokes.map(readerShapeToInkStroke),
      draft,
    )
  }, [
    freehandStrokes,
    inkDraft,
    typewriterChapterIndex,
    typewriterPortalHost,
    typewriterLayoutEpoch,
  ])

  const typewriterOverlay =
    typewriterPortalHost && iframeContentSize
      ? createPortal(
          <>
            {chapterTypewriterNotes.map((note) => {
              let left =
                ((parseTypewriterPosition(note.positionData)?.xPct ?? 0) /
                  100) *
                iframeContentSize.width
              let top =
                ((parseTypewriterPosition(note.positionData)?.yPct ?? 0) /
                  100) *
                iframeContentSize.height

              if (dragPreview?.id !== note.id) {
                const resolved = resolveTypewriterIframePoint({
                  locationRaw: note.positionData,
                  doc: typewriterFrameRef.current?.doc,
                  iframeSize: iframeContentSize,
                })
                if (resolved) {
                  left = resolved.left
                  top = resolved.top
                }
              }

              if (dragPreview?.id === note.id) {
                left = (dragPreview.xPct / 100) * iframeContentSize.width
                top = (dragPreview.yPct / 100) * iframeContentSize.height
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
                const size = iframeContentSizeRef.current
                if (!size || size.width <= 0 || size.height <= 0) return
                const pt = toTopLevelClientPoint(e.nativeEvent)
                dragSessionRef.current = beginTypewriterDrag({
                  id: note.id,
                  pointerId: e.pointerId,
                  clientX: pt.x,
                  clientY: pt.y,
                  originXPct: origin.xPct,
                  originYPct: origin.yPct,
                  bounds: new DOMRect(0, 0, size.width, size.height),
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
                  {...{ [TYPEWRITER_NOTE_ATTR]: note.id }}
                  data-typewriter-note={note.id}
                  className={dragging ? 'rb-typewriter-dragging' : undefined}
                  style={{
                    position: 'absolute',
                    left,
                    top,
                    transform: 'translate(-50%, -50%)',
                    zIndex: 5,
                    color,
                  }}
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
                      onCancel={() => {
                        onTypewriterContentCancel?.(note.id)
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
                            startDrag(e, notePos)
                          }}
                        />
                      }
                    />
                  ) : (
                    <button
                      type="button"
                      className="rb-typewriter-static"
                      aria-label="Typewriter note"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        // Hand + typewriter: drag to move; click (no move) opens edit.
                        if (
                          interactionTool === 'hand' ||
                          interactionTool === 'typewriter'
                        ) {
                          startDrag(e, notePos)
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (suppressTypewriterClickRef.current) {
                          suppressTypewriterClickRef.current = false
                          return
                        }
                        if (
                          interactionTool === 'hand' ||
                          interactionTool === 'typewriter'
                        ) {
                          beginHandTypewriterEdit(note.id)
                        }
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
            })}
            {typewriterDraft ? (
              <div
                ref={typewriterDraftRootRef}
                {...{ [TYPEWRITER_DRAFT_ATTR]: typewriterDraft.id }}
                className="rb-tw-draft"
                style={{
                  position: 'absolute',
                  left: typewriterDraft.hostX,
                  top: typewriterDraft.hostY,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 6,
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
                  onStyleChange={(patch) =>
                    onTypewriterDraftStyleChange?.(patch)
                  }
                  onBlur={() => onTypewriterDraftCommit?.(typewriterDraft.id)}
                  onCancel={() => onTypewriterDraftCancel?.(typewriterDraft.id)}
                  onOpenSidePanel={onTypewriterOpenSidePanel}
                  sidePanelOpen={typewriterSidePanelOpen}
                />
              </div>
            ) : null}
          </>,
          typewriterPortalHost,
        )
      : null

  return (
    <main
      ref={epubRootRef}
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${className ?? ''}`}
      data-epub-status={status}
      data-epub-layout={layout}
      data-epub-page-mode={pageMode}
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
      {/* Paginated only: fixed overlay. Scroll mode injects cover into .epub-container. */}
      {syntheticCoverShown && coverUrl && pageMode !== 'scroll' ? (
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
        className={`h-full w-full min-h-0 flex-1 [&_iframe]:w-full ${
          pageMode === 'scroll' ? '' : '[&_iframe]:h-full'
        } ${
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
      {/* Typewriter notes portal into the EPUB iframe (scroll with content). */}
      {typewriterOverlay}
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

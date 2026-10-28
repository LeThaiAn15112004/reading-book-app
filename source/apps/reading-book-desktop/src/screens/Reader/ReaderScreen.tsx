import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import { useParams } from 'react-router-dom'
import {
  CfiLocation,
  PageRectLocation,
  TextOffsetLocation,
  parseMdReadingLocation,
  fontFamilyCss,
  formatHighlightCitation,
  isMarkupTool,
  isShapeStyleKind,
  shapeColorHex,
  shapeOpacityOf,
  shapeStrokeHex,
  resolveTxtReadingOffset,
  buildMdOutline,
  type InteractionTool,
  type MdHeadingInfo,
  type MdOutlineNode,
} from '@reading-book/book-reader-sdk'

const MD_HEADING_HREF = 'md-heading:'
import {
  useAppTitle,
  useGlobalReadingPrefs,
  useImmersiveReading,
  useOpenReading,
  useReaderChromeMenu,
} from '../../chrome'
import { ReaderShell, readerChromeTopInset, readerChromeBottomInset } from '../../reader'
import { usePdfViewStore } from './logic/pdfView/pdfViewStore'
import { usePdfExportStore } from './logic/pdfExport/pdfExportStore'
import { supportsAnnotationTransfer, useAnnotationTransferStore } from './logic/annotationTransferStore'
import { usePdfSignedWriteStore } from './logic/pdfExport/pdfSignedWriteStore'
import { getReaderCapabilities } from '../../reader/capabilities'
import {
  EpubRenderer,
  type EpubRendererApi,
} from '../../reader/renderers/epub'
import {
  PdfRenderer,
  PAGE_GAP_PX,
  pdfFitPageZoom,
  pdfSelectionPageLabel,
  type PdfRendererApi,
  type PdfShapeMark,
} from '../../reader/renderers/pdf'
import { TxtRenderer, type TxtRendererApi } from '../../reader/renderers/txt'
import { MdRenderer, decodeMdSource, type MdRendererApi, type MdSelectionInfo } from '../../reader/renderers/md'
import type { EpubTocItem, ViewportRectLike } from '../../reader/renderers/epub'
import type { TextSurfaceApi } from '../../reader/renderers/textSurface'
import { appApi } from '../../bridge/app'
import {
  AaSettingsPanel,
  BookInfoDialog,
  HighlightContextMenu,
  HighlightEditPopup,
  NoteFloatingMenu,
  NoteTextboxPopup,
  ReaderFooter,
  ReplacePreviewTooltip,
  ReaderOpenStatus,
  ReaderRightSidebar,
  ReaderSearchPanel,
  ReadAloudMenu,
  ReaderTopbar,
  ReaderZoomViewport,
  ImmersiveExitButton,
  ReadingCanvas,
  SidebarEdgeRail,
  resolveSidebarTab,
  sidebarTabsFor,
  SnapshotOverlay,
  WordCountPanel,
  rightSidebarContentInset,
  sidebarContentInsetLeft,
  SignInfoPanel,
  SignedPdfWriteDialog,
  SyncConflictBanner,
  TocSidebar,
  TranslationPopover,
  TrashConfirmDialog,
  TxtSaveStatus,
  useRightSidebarDocked,
  useSidebarPanelResize,
  type SidebarTab,
  type EraserMode,
  type ToolId,
  type ToolStates,
} from './components'
import {
  FAKE_CHAPTERS,
  useBookIndexing,
  useBookRelink,
  useReaderBookmarks,
  useReaderHighlights,
  useReaderBookOpen,
  useReaderChromeUi,
  useReaderNavigation,
  useReaderSearch,
  useReaderShortcuts,
  useReaderSessionBridge,
  useImmersiveChromeReveal,
  useReaderZoomControls,
  useSnapshotTool,
  useWordCount,
  useReadAloud,
  useReaderTranslation,
  usePdfSelectionMenu,
  useReaderMdHighlights,
  useReaderPdfHighlights,
  useReaderTxt,
  useRightPanelStore,
  type HighlightShortcuts,
  type ReaderChromeEscapeUi,
} from './logic'
import { INSERT_CARET_COLOR } from './logic/pdfHighlights/pdfHighlightsStore'
import { useReaderPdfInk } from './logic/hooks/useReaderPdfInk'
import { useReaderPdfGraphics } from './logic/hooks/useReaderPdfGraphics'
import { usePdfShapePrefsStore } from './logic/pdfShapes/pdfShapePrefsStore'
import { usePdfInkPrefsStore } from './logic/pdfInk/pdfInkPrefsStore'
import { pdfDeleteFocused, pdfHasFocusedMark, pdfRedo, pdfUndo } from './logic/pdfInk/pdfUndoRouter'
import { PdfInkPanel } from './components/chrome/PdfInkPanel'
import { PdfInkQuickToolbar } from './components/chrome/PdfInkQuickToolbar'
import { MD_INSERT_CARET_COLOR } from './logic/mdHighlights/mdHighlightsStore'

/** Stand-in row for the Inserted Text editor while the caret is only a draft (nothing saved yet). */
const PENDING_INSERT_DRAFT = {
  id: 'pending-insert',
  locatorRef: '',
  styleKind: 'insert' as const,
  colorHex: INSERT_CARET_COLOR,
  tags: [] as string[],
  createdAt: '',
  updatedAt: '',
}

/** SCR-03 — session wiring; layout/chrome live in ReaderShell (T3.2). */
export function ReaderScreen() {
  const { bookId } = useParams<{ bookId: string }>()
  const {
    setDocumentSubtitle,
    readerSearchQuery,
    setReaderSearchQuery,
    readerSearchRequestId,
    requestReaderSearch,
  } = useAppTitle()
  const { ensureTab, updateBookTitle } = useOpenReading()
  const { registerReaderChrome } = useReaderChromeMenu()
  const { prefs: globalPrefs } = useGlobalReadingPrefs()
  const { immersive, fullscreen, toggleFullscreen, exitFullscreen } =
    useImmersiveReading()
  const immersiveReveal = useImmersiveChromeReveal({ enabled: immersive })
  const globalPrefsRef = useRef(globalPrefs)
  globalPrefsRef.current = globalPrefs

  const epubApiRef = useRef<EpubRendererApi | null>(null)
  const pdfApiRef = useRef<PdfRendererApi | null>(null)
  const txtApiRef = useRef<TxtRendererApi | null>(null)
  const escapeUiRef = useRef<ReaderChromeEscapeUi>({
    isEpubSurface: false,
    isPdfSurface: false,
  })
  const highlightShortcutsRef = useRef<HighlightShortcuts>({
    undo: () => {},
    redo: () => {},
    deleteFocused: () => {},
    hasFocusedHighlight: () => false,
    cancelAnnotationTool: () => false,
  })

  const chrome = useReaderChromeUi({
    bookId,
    registerReaderChrome,
    epubApiRef,
    pdfApiRef,
    escapeUiRef,
    immersive,
  })
  const sidebarResize = useSidebarPanelResize('left')
  const snapshot = useSnapshotTool({ bookId, setToast: chrome.setToast })
  const wordCount = useWordCount({ bookId, open: chrome.wordCountOpen })

  /**
   * Toolbar mode — a single value drives both groups of buttons: Hand/Select (navigation) and
   * Highlight/Underline/Strikethrough (markup). Only one can be "on" at a time, which is also the
   * correct UX here — dragging on the reading surface can either pan/select or instant-mark,
   * never both.
   */
  const [activeTool, setActiveTool] = useState<InteractionTool>('hand')
  // The Eraser's mode outlives switching tools (the arrow menu sets it; the Eraser button arms it).
  const [eraserMode, setEraserMode] = useState<EraserMode>('stroke')
  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool
  const activeAnnotationTool = isMarkupTool(activeTool) ? activeTool : null

  const book = useReaderBookOpen({
    bookId,
    ensureTab,
    updateBookTitle,
    setDocumentSubtitle,
    globalPrefsRef,
  })

  const isPdfSurface =
    book.contentStatus === 'ready' && book.bookFormat === 'pdf' && !!book.bookBytes
  // Like EPUB, wait for the saved position before mounting so the PDF opens on the right page.
  const isPdfSessionLoading = isPdfSurface && book.sessionLoadStatus === 'loading'

  // TXT: the text itself comes from Main (`txt:open`, edited copy aware), not from the book bytes.
  const isTxtSurface = book.contentStatus === 'ready' && book.bookFormat === 'txt'
  const txt = useReaderTxt({
    bookId,
    active: isTxtSurface,
    txtApiRef,
    setToast: chrome.setToast,
    setChromeHidden: chrome.setChromeHidden,
  })
  // Markdown: read-only; the bytes come from `openBookContent` (Main enforces the size limit) and
  // are decoded here. Like TXT it scrolls as one continuous text and reports a percentage.
  const isMdSurface = book.contentStatus === 'ready' && book.bookFormat === 'md' && !!book.bookBytes
  const mdApiRef = useRef<MdRendererApi | null>(null)
  const mdSource = useMemo(
    () => (isMdSurface && book.bookBytes ? decodeMdSource(book.bookBytes) : null),
    [isMdSurface, book.bookBytes],
  )
  // Markdown outline: the headings the surface reports, as sidebar Contents entries (`md-heading:N`
  // = the N-th heading of the page). The active entry follows the scroll.
  /** The mark the pointer rests on (Replace shows its replacement text in a tooltip). */
  const [hoverMark, setHoverMark] = useState<{ id: string; rect: ViewportRectLike } | null>(null)
  const [mdHeadings, setMdHeadings] = useState<MdHeadingInfo[]>([])
  const [mdActiveHeading, setMdActiveHeading] = useState<number | null>(null)
  useEffect(() => {
    setMdHeadings([])
    setMdActiveHeading(null)
  }, [bookId])
  const mdToc = useMemo<EpubTocItem[]>(() => {
    const toItem = (node: MdOutlineNode): EpubTocItem => ({
      id: `md-h-${node.index}`,
      label: node.label,
      href: `${MD_HEADING_HREF}${node.index}`,
      level: node.level,
      children: node.children.map(toItem),
    })
    return buildMdOutline(mdHeadings).map(toItem)
  }, [mdHeadings])
  const isTextSurface = isTxtSurface || isMdSurface
  // Markdown has no Hand tool (it scrolls natively): never sit on it.
  useEffect(() => {
    if (isMdSurface) setActiveTool((tool) => (tool === 'hand' ? 'select' : tool))
  }, [isMdSurface])
  const textApiRef: MutableRefObject<TextSurfaceApi | null> = isMdSurface ? mdApiRef : txtApiRef
  const txtReady = isTxtSurface && txt.loadStatus === 'ready'
  const txtLoadFailed = isTxtSurface && txt.loadStatus === 'error'
  // Like EPUB / PDF, wait for the saved position before mounting so the text opens where it was left.
  const isTxtLoading = isTxtSurface && !txtLoadFailed && (!txtReady || book.sessionLoadStatus === 'loading')
  const [txtPercent, setTxtPercent] = useState(0)
  useEffect(() => {
    setTxtPercent(0)
  }, [bookId])
  const txtInitialOffset = useMemo(
    () =>
      book.resumeLocation instanceof TextOffsetLocation
        ? resolveTxtReadingOffset(book.resumeLocation, txt.getTextLength())
        : 0,
    // The renderer reads this once, when it mounts (text and saved position are both ready then).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book.resumeLocation, txtReady],
  )
  // Markdown opens where it was left, like TXT: the saved text point, read once when it mounts.
  const mdInitialPoint = useMemo(
    () => parseMdReadingLocation(book.resumeLocation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book.resumeLocation, isMdSurface],
  )
  const isMdLoading = isMdSurface && book.sessionLoadStatus === 'loading'
  const txtSidebarHighlights = useMemo(() => [...txt.highlights], [txt.highlights])
  const exportAnnotatedPdf = usePdfExportStore((st) => st.exportAnnotatedPdf)
  const pendingSignedExport = usePdfExportStore((st) => st.pendingSigned)
  const confirmSignedExport = usePdfExportStore((st) => st.confirmSigned)
  const cancelSignedExport = usePdfExportStore((st) => st.cancelSigned)
  // "Export annotations (backup)…" (specs/006-annotation-import-export): EPUB / PDF / TXT / Markdown only.
  const canTransferAnnotations = book.contentStatus === 'ready' && supportsAnnotationTransfer(book.bookFormat)
  const annotationCount = useAnnotationTransferStore((st) => (st.countBookId === bookId ? st.count : 0))
  const refreshAnnotationCount = useAnnotationTransferStore((st) => st.refreshCount)
  const exportAnnotations = useAnnotationTransferStore((st) => st.exportRestore)
  useEffect(() => {
    if (canTransferAnnotations && bookId && chrome.moreOpen) void refreshAnnotationCount(bookId)
  }, [canTransferAnnotations, bookId, chrome.moreOpen, refreshAnnotationCount])
  const pendingSignedWrite = usePdfSignedWriteStore((st) => st.pending)
  const confirmSignedWrite = usePdfSignedWriteStore((st) => st.confirm)
  const declineSignedWrite = usePdfSignedWriteStore((st) => st.decline)

  const readerCapabilities = useMemo(
    () => getReaderCapabilities(book.bookFormat),
    [book.bookFormat],
  )
  // Sidebar tabs follow the surface's capabilities (Page layout: PDF yes, EPUB no). Every entry point
  // opens tabs through `openSidebarTab`, and the shown tab is resolved, so a tab left selected by
  // another book / format can never render here.
  // Page layout thumbnails come from the open PDF document (fixed layout → real pages).
  const renderPdfThumbnail = useCallback(
    (page: number, cssWidth: number, signal: AbortSignal) =>
      pdfApiRef.current?.renderThumbnail(page, cssWidth, signal) ?? Promise.resolve(null),
    [],
  )
  const sidebarTabs = useMemo(() => sidebarTabsFor(readerCapabilities), [readerCapabilities])
  const sidebarTab = resolveSidebarTab(chrome.sidebarTab, readerCapabilities)
  const chromeOpenSidebarTab = chrome.openSidebarTab
  const openSidebarTab = useCallback(
    (tab: SidebarTab) => chromeOpenSidebarTab(resolveSidebarTab(tab, readerCapabilities)),
    [chromeOpenSidebarTab, readerCapabilities],
  )

  // "Locate file…" when the book's file was moved or deleted (verified by SHA-256 in Main).
  const relink = useBookRelink({ bookId, onRelinked: book.retryOpen })

  // Silent background chunking for search — starts only after the book is already on screen.
  const searchIndexing = useBookIndexing({
    bookId,
    ready: book.contentStatus === 'ready',
  })

  // Full-text search over the chunks above (FTS5 in Main); jumps through the EPUB handle.
  useReaderSearch({
    bookId,
    isEpubSurface: book.isEpubSurface,
    epubApiRef,
    isPdfSurface,
    pdfApiRef,
    searchOpen: chrome.searchOpen,
    readerSearchQuery,
    readerSearchRequestId,
  })

  const readAloud = useReadAloud({
    bookId,
    isEpubSurface: book.isEpubSurface,
    epubApiRef,
    setToast: chrome.setToast,
  })
  const audioButtonRef = useRef<HTMLButtonElement>(null)

  // Translate: a mode layered on Select (text must be selectable) — every finished selection
  // opens the popover. The selection context menu's "Translate" opens the same popover in any mode.
  const translation = useReaderTranslation({ bookId, setToast: chrome.setToast })
  const translateModeRef = useRef(translation.mode)
  translateModeRef.current = translation.mode
  // The Pen exists on the PDF surface only: another book (or format) leaves it.
  useEffect(() => {
    if (!isPdfSurface && (activeTool === 'pen' || activeTool === 'eraser' || activeTool === 'shape')) setActiveTool('select')
  }, [isPdfSurface, activeTool])
  const selectTool = (tool: InteractionTool | ((current: InteractionTool) => InteractionTool)) => {
    if (translateModeRef.current) translation.setMode(false)
    setActiveTool(tool)
  }

  const session = useReaderSessionBridge({
    bookId,
    epubApiRef,
    pdfApiRef,
    txtApiRef: textApiRef,
    prefsRef: book.prefsRef,
    prefsDirtyRef: book.prefsDirtyRef,
    prefs: book.prefs,
    sessionLoadStatus: book.sessionLoadStatus,
  })

  const nav = useReaderNavigation({
    bookId,
    contentStatus: book.contentStatus,
    bookBytes: book.bookBytes,
    bookFormat: book.bookFormat,
    isEpubSurface: book.isEpubSurface,
    epubApiRef,
    isPdfSurface,
    pdfApiRef,
    isTxtSurface: isTextSurface,
    txtApiRef: textApiRef,
    closeFloating: chrome.closeFloating,
    highlightShortcutsRef,
  })

  const zoom = useReaderZoomControls({
    bookId,
    activeToolRef,
  })
  const setZoomThen = zoom.setZoomThen
  const zoomViewportRef = zoom.zoomViewportRef

  /**
   * PDF Fit page: measure the page being read from the document, zoom so that page fills the reading
   * area (width and height), then scroll it to the top of the view and centre it horizontally.
   */
  const pdfView = usePdfViewStore()
  const fitPdfPageRef = useRef<() => Promise<void>>(async () => {})
  const changePdfPagesPerView = useCallback((count: 1 | 2 | 3) => {
    usePdfViewStore.getState().setPagesPerView(count)
    // The page block just got wider / narrower: refit once the new layout is in place.
    requestAnimationFrame(() => void fitPdfPageRef.current())
  }, [])
  const fitPdfPage = useCallback(async () => {
    const api = pdfApiRef.current
    const viewport = zoomViewportRef.current?.getElement()
    if (!api || !viewport) return
    const page = api.getNavState().pageCurrent
    const single = await api.measurePage(page)
    // Several pages side by side fit as one wide block (pages + the gaps between them).
    const perView = usePdfViewStore.getState().pagesPerView
    const size = single
      ? { width: single.width * perView + (perView - 1) * PAGE_GAP_PX, height: single.height }
      : null
    const next = size ? pdfFitPageZoom(size, viewport.clientWidth, viewport.clientHeight) : null
    if (next === null) return
    setZoomThen(next, () => {
      api.goToPage(page)
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2)
    })
  }, [setZoomThen, zoomViewportRef])
  fitPdfPageRef.current = fitPdfPage

  // Immersive: tools/footer stay hidden unless an edge reveal is active. Left sidebar is disabled in fullscreen.
  const toolsHidden = immersive
    ? !immersiveReveal.reveal.top
    : chrome.chromeHidden
  const footerImmersiveHidden = immersive && !immersiveReveal.reveal.bottom
  const contentInsetLeft = immersive
    ? 0
    : sidebarContentInsetLeft(chrome.sidebarOpen, sidebarResize.panelWidth)
  const rightPanel = useRightPanelStore((s) => s.panel)
  const closeRightPanel = useRightPanelStore((s) => s.close)
  const rightSidebarDocked = useRightSidebarDocked()
  const contentInsetRight = immersive
    ? 0
    : rightSidebarContentInset(rightPanel !== null, rightSidebarDocked)

  const chapter = FAKE_CHAPTERS[nav.chapterIndex] ?? FAKE_CHAPTERS[0]
  const pdfPageCurrent = nav.pdfNav?.pageCurrent ?? 0
  const pdfPageTotal = nav.pdfNav?.pageTotal ?? 0
  const chapterLabel = isPdfSurface
    ? `Page ${pdfPageCurrent}`
    : isTextSurface
      ? `${txtPercent}%`
      : chapter.title
  // PDF: real page numbers. EPUB: reference pages / spine sections. Otherwise the placeholder.
  // TXT is one continuous text: a single "section", progress is the share scrolled.
  const pageCurrent = book.isEpubSurface
    ? (nav.epubNav?.pageCurrent ?? 0)
    : isPdfSurface
      ? pdfPageCurrent
      : isTextSurface
        ? 1
        : nav.chapterIndex + 1
  const pageTotal = book.isEpubSurface
    ? (nav.epubNav?.pageTotal ?? 0)
    : isPdfSurface
      ? pdfPageTotal
      : isTextSurface
        ? 1
        : FAKE_CHAPTERS.length
  const pageCountReady = book.isEpubSurface
    ? Boolean(nav.epubNav?.pageCountReady)
    : isPdfSurface
      ? pdfPageTotal > 0
      : true
  const sectionCurrent = book.isEpubSurface
    ? (nav.epubNav?.spineLength
        ? nav.epubNav.spineIndex + 1
        : 0)
    : isPdfSurface
      ? pdfPageCurrent
      : isTextSurface
        ? 1
        : nav.chapterIndex + 1
  const sectionTotal = book.isEpubSurface
    ? (nav.epubNav?.spineLength ?? 0)
    : isPdfSurface
      ? pdfPageTotal
      : isTextSurface
        ? 1
        : FAKE_CHAPTERS.length
  const sectionLabels = useMemo(
    () =>
      book.isEpubSurface
        ? nav.epubSections
        : isPdfSurface
          ? Array.from({ length: pdfPageTotal }, (_, i) => `Page ${i + 1}`)
          : isTextSurface
            ? ['Text']
            : FAKE_CHAPTERS.map((c) => c.title),
    [book.isEpubSurface, isPdfSurface, isTextSurface, nav.epubSections, pdfPageTotal],
  )
  const progress = book.isEpubSurface
    ? (nav.epubNav?.progress ?? 0)
    : isPdfSurface && pdfPageTotal > 0
      ? pdfPageCurrent / pdfPageTotal
      : isTextSurface
        ? txtPercent / 100
        : 0
  const effectiveMargin = book.prefs.marginEnabled ? book.prefs.margin : 'off'

  const bookmarks = useReaderBookmarks({
    bookId,
    isEpubSurface: book.isEpubSurface,
    epubApiRef,
    epubNav: nav.epubNav ?? null,
    isPdfSurface,
    pdfApiRef,
    pdfPage: pdfPageCurrent,
    chapterIndex: nav.chapterIndex,
    chapterLabel,
    goChapter: nav.goChapter,
    setChromeHidden: chrome.setChromeHidden,
    setToast: chrome.setToast,
  })

  // Reader dialogs without `aria-modal` (so the bridge's DOM guard can't see them) still block the
  // reading shortcuts behind them.
  const readerDialogOpen = chrome.bookInfoOpen || chrome.signOpen || chrome.trashOpen
  const shortcutsEnabled = book.contentStatus === 'ready' && !readerDialogOpen
  useReaderShortcuts({
    enabled: shortcutsEnabled,
    immersive,
    isEpubSurface: book.isEpubSurface,
    epubApiRef,
    isPdfSurface,
    pdfApiRef,
    switchPage: nav.switchPage,
    goToStart: nav.goToStart,
    goToEnd: nav.goToEnd,
    toggleBookmark: bookmarks.toggleBookmark,
    searchOpen: chrome.searchOpen,
    sidebarOpen: chrome.sidebarOpen,
    sidebarTab,
    openSidebarTab,
    toggleSidebar: chrome.toggleSidebar,
    setToast: chrome.setToast,
  })

  const highlights = useReaderHighlights({
    bookId,
    isEpubSurface: book.isEpubSurface,
    epubApiRef,
    epubNav: nav.epubNav ?? null,
    setToast: chrome.setToast,
    setChromeHidden: chrome.setChromeHidden,
    activeAnnotationTool,
  })

  // PDF: right-click inside a text-layer selection → the same menu as EPUB (see
  // docs/implementation_plan/pdf_selection_context_menu.md); its markup actions create PDF text
  // annotations (docs/implementation_plan/pdf_text_annotations.md).
  const pdfSelectionMenu = usePdfSelectionMenu({
    bookId,
    isPdfSurface,
    getScrollRoot: () => zoom.zoomViewportRef.current?.getElement() ?? null,
    zoom: zoom.viewZoom,
  })

  // PDF text annotations — the PDF counterpart of `highlights` (page + normalized rects, no CFI).
  const pdfHighlights = useReaderPdfHighlights({
    bookId,
    isPdfSurface,
    pdfApiRef,
    zoom: zoom.viewZoom,
    setToast: chrome.setToast,
    setChromeHidden: chrome.setChromeHidden,
  })
  // PDF freehand Ink (strokes are their own `notes` type; the Pen tool lives in the toolbar's Annotation group).
  const pdfInk = useReaderPdfInk({ bookId, isPdfSurface, setToast: chrome.setToast })
  // Graphic objects inside the PDF that other readers made (shapes, lines, text boxes): edits are written into the file.
  const pdfGraphics = useReaderPdfGraphics({ bookId, isPdfSurface, setToast: chrome.setToast, refreshFile: () => void book.refreshBookBytes() })
  const selectedInkStroke = useMemo(() => pdfInk.strokes.find((m) => m.id === pdfInk.selectedId) ?? null, [pdfInk.strokes, pdfInk.selectedId])
  const inkTool = usePdfInkPrefsStore((s) => s.tool)
  const inkStyles = usePdfInkPrefsStore((s) => s.styles)
  const inkPen = useMemo(() => ({ penStyle: inkTool, ...inkStyles[inkTool] }), [inkTool, inkStyles])
  /** The open surface's annotation store: drives the shared popups, sidebar actions and shortcuts. */
  // Markdown annotations — the Markdown counterpart of `pdfHighlights` (piece + offset anchors, no CFI).
  const mdHighlights = useReaderMdHighlights({
    bookId,
    isMdSurface,
    mdApiRef,
    setToast: chrome.setToast,
    setChromeHidden: chrome.setChromeHidden,
  })
  /** Right-click inside a Markdown text selection: the same menu as the other formats. */
  const [mdSelectionMenu, setMdSelectionMenu] = useState<{ selection: MdSelectionInfo; point: { x: number; y: number } } | null>(null)
  const markup = isPdfSurface
    ? pdfHighlights
    : isMdSurface
      ? mdHighlights
      : isTxtSurface
        ? txt.markup
        : highlights
  /** PDF marks as painted: the saved annotations plus the caret still being placed (Inserted Text). */
  const pdfTextHighlights = useMemo(() => pdfHighlights.highlights.filter((h) => !isShapeStyleKind(h.styleKind)), [pdfHighlights.highlights])
  const pdfMarks = useMemo(
    () =>
      pdfHighlights.pendingInsert
        ? [
            ...pdfTextHighlights,
            {
              id: PENDING_INSERT_DRAFT.id,
              styleKind: 'insert' as const,
              colorHex: INSERT_CARET_COLOR,
              rects: [pdfHighlights.pendingInsert.rect],
              caret: true,
            },
          ]
        : pdfTextHighlights,
    [pdfTextHighlights, pdfHighlights.pendingInsert],
  )
  // Shape annotations: rows of the same list / history / table as every annotation, painted and selected by their own layer
  // (so a shape's box never swallows a click meant for the text under it). The focused row is the selected shape.
  const pdfShapes = useMemo(
    () =>
      pdfHighlights.highlights.flatMap((h): PdfShapeMark[] => {
        const rect = h.rects[0]
        if (!isShapeStyleKind(h.styleKind) || !h.shape || !rect) return []
        return [{ id: h.id, kind: h.styleKind, pageIndex: h.page - 1, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, shape: h.shape, colorHex: h.colorHex }]
      }),
    [pdfHighlights.highlights],
  )
  const selectedShapeId = pdfShapes.some((s) => s.id === pdfHighlights.focusedHighlightId) ? pdfHighlights.focusedHighlightId : null
  const shapePrefs = {
    kind: usePdfShapePrefsStore((s) => s.kind),
    colorHex: usePdfShapePrefsStore((s) => s.colorHex),
    width: usePdfShapePrefsStore((s) => s.width),
    opacity: usePdfShapePrefsStore((s) => s.opacity),
  }
  /** Inserted Text being placed: PDF or Markdown (the caret exists, the annotation does not yet). */
  const pendingInsert = isPdfSurface && pdfHighlights.pendingInsert
    ? { anchor: pdfHighlights.pendingInsert.anchor, commit: pdfHighlights.commitInsert, cancel: pdfHighlights.cancelInsert }
    : isMdSurface && mdHighlights.pendingInsert
      ? { anchor: mdHighlights.pendingInsert.anchor, commit: mdHighlights.commitInsert, cancel: mdHighlights.cancelInsert }
      : null
  const hoverReplace =
    hoverMark && !markup.activeHighlight
      ? (markup.highlights.find((h) => h.id === hoverMark.id && (h.styleKind === 'replace' || h.styleKind === 'insert') && h.note?.trim()) ?? null)
      : null
  /** Two-way sync conflict banner for a PDF annotation's popup (undefined when there is none). */
  const conflictBannerFor = (id: string) => {
    const conflict = isPdfSurface ? pdfHighlights.conflicts[id] : undefined
    return conflict ? (
      <SyncConflictBanner
        kind={conflict.kind}
        onKeepReadmate={() => void pdfHighlights.resolveConflict(id, 'keep-readmate')}
        onUsePdf={() => void pdfHighlights.resolveConflict(id, 'use-pdf')}
      />
    ) : undefined
  }

  /** TXT selection menu → mark that selection (`textbox` = a note, its popup opens at the click). */
  function markTxtSelection(styleKind: 'highlight' | 'underline' | 'strikethrough' | 'squiggly' | 'replace' | 'insert' | 'textbox') {
    const menu = txt.selectionMenu
    if (!menu) return
    txt.createFromSelection(menu.selection, styleKind, new DOMRect(menu.point.x, menu.point.y, 0, 0))
  }

  /** PDF selection menu → mark that selection (`textbox` = a note, its popup opens at the click). */
  function markPdfSelection(styleKind: 'highlight' | 'underline' | 'strikethrough' | 'squiggly' | 'replace' | 'insert' | 'textbox') {
    const menu = pdfSelectionMenu.menu
    if (!menu) return
    pdfHighlights.createFromSelection(menu.selection, styleKind, new DOMRect(menu.point.x, menu.point.y, 0, 0))
  }

  /** Markdown selection menu → mark that selection (`textbox` = a note, its popup opens at the click). */
  function markMdSelection(styleKind: 'highlight' | 'underline' | 'strikethrough' | 'squiggly' | 'replace' | 'insert' | 'textbox') {
    const menu = mdSelectionMenu
    if (!menu) return
    setMdSelectionMenu(null)
    mdHighlights.createFromSelection(menu.selection, styleKind, new DOMRect(menu.point.x, menu.point.y, 0, 0))
  }

  highlightShortcutsRef.current = {
    // A PDF has two histories (text markup and Ink strokes): the newest edit is undone first.
    undo: isPdfSurface ? pdfUndo : markup.undo,
    redo: isPdfSurface ? pdfRedo : markup.redo,
    deleteFocused: isPdfSurface ? pdfDeleteFocused : markup.deleteFocused,
    hasFocusedHighlight: isPdfSurface ? pdfHasFocusedMark : markup.hasFocusedHighlight,
    // Escape while Highlight/Underline/Strikethrough is armed: drop back to Select instead of
    // leaving the reader (matches Foxit/Adobe — Escape backs a modal tool out one level at a time).
    cancelAnnotationTool: () => {
      if (translateModeRef.current) {
        translation.setMode(false)
        return true
      }
      if (!isMarkupTool(activeToolRef.current) && activeToolRef.current !== 'pen' && activeToolRef.current !== 'eraser' && activeToolRef.current !== 'shape') return false
      setActiveTool('select')
      return true
    },
  }

  escapeUiRef.current = {
    isEpubSurface: book.isEpubSurface,
    isPdfSurface,
  }

  const readingStyle = useMemo(
    () =>
      ({
        '--reader-reading-size': `${book.prefs.fontSize}px`,
        '--reader-reading-line-height': String(book.prefs.lineHeight),
        '--reader-reading-weight': String(book.prefs.fontWeight),
        '--reader-font-reading': fontFamilyCss(book.prefs.fontFamily),
        '--reader-reading-align': book.prefs.textAlign,
      }) as CSSProperties,
    [
      book.prefs.fontSize,
      book.prefs.lineHeight,
      book.prefs.fontWeight,
      book.prefs.fontFamily,
      book.prefs.textAlign,
    ],
  )

  const themeShell = 'bg-lib-bg-deep text-lib-text [--reader-text:var(--lib-text)]'

  function copyHighlightText(text: string | undefined) {
    if (!text) return
    void navigator.clipboard.writeText(text)
    chrome.setToast('Copied.')
  }

  /** Toolbar state per tool — which tools exist for this book comes from `readerCapabilities`. */
  const toolStates: ToolStates = {
    hand: { active: activeTool === 'hand' },
    // Translate rides on Select (text must be selectable), so Select isn't shown pressed meanwhile.
    select: { active: activeTool === 'select' && !translation.mode },
    // TXT: the text box is editable whenever no markup tool is armed.
    edit: { active: !isMarkupTool(activeTool) },
    search: { active: chrome.searchOpen },
    speech: { active: readAloud.active, expanded: readAloud.menuOpen },
    translate: { active: translation.mode },
    highlight: { active: activeTool === 'highlight' },
    underline: { active: activeTool === 'underline' },
    squiggly: { active: activeTool === 'squiggly' },
    strikethrough: { active: activeTool === 'strikethrough' },
    replace: { active: activeTool === 'replace' },
    insert: { active: activeTool === 'insert' },
    pen: { active: activeTool === 'pen' },
    shape: { active: activeTool === 'shape' },
    eraser: { active: activeTool === 'eraser' },
    snapshot: { active: snapshot.active },
    settings: { active: chrome.settingsOpen, expanded: chrome.settingsOpen },
  }

  function handleTool(tool: ToolId) {
    switch (tool) {
      case 'hand':
      case 'select':
        selectTool(tool)
        return
      case 'edit':
        selectTool('select')
        return
      case 'search':
        chrome.toggleSearch()
        return
      case 'speech':
        if (readAloud.menuOpen) {
          readAloud.closeMenu()
        } else {
          chrome.closeFloating()
          readAloud.openMenu()
        }
        return
      case 'translate':
        if (translation.mode) {
          translation.setMode(false)
        } else {
          chrome.closeFloating()
          highlights.dismissAnnotationUi()
          setActiveTool('select')
          translation.setMode(true)
          chrome.setToast('Translate: select text to translate it — Esc to exit.')
        }
        return
      case 'highlight':
      case 'underline':
      case 'squiggly':
      case 'strikethrough':
      case 'replace':
      case 'insert':
      case 'pen':
      case 'shape':
      case 'eraser':
        // Click the armed tool again to disarm it (back to Select); otherwise arm it — sticky across
        // multiple highlights/underlines/strikethroughs until toggled off, Escape, or Hand/Select.
        selectTool((current) => (current === tool ? 'select' : tool))
        return
      case 'snapshot':
        chrome.closeFloating()
        snapshot.toggle()
        return
      case 'wordCount':
        chrome.closeFloating()
        chrome.setWordCountOpen(true)
        return
      case 'settings':
        if (toolsHidden) return
        chrome.setMoreOpen(false)
        chrome.setSettingsOpen((v) => !v)
        return
    }
  }

  return (
    <ReaderShell
      themeClassName={themeShell}
      style={readingStyle}
      chromeHidden={toolsHidden}
      contentInsetLeft={contentInsetLeft}
      contentInsetRight={contentInsetRight}
      // PDF is always one continuous scroll — reserve the footer like EPUB's scroll view, whatever
      // the book's (EPUB-only) view-mode pref says.
      contentInsetBottom={readerChromeBottomInset(
        isPdfSurface || isTextSurface ? 'scroll' : book.prefs.viewMode,
        footerImmersiveHidden,
      )}
      contentInsetResizing={sidebarResize.isResizing}
      dataAttrs={{
        'data-content-status': book.contentStatus,
        'data-content-format': book.bookFormat ?? '',
        'data-content-bytes': book.bookBytes
          ? String(book.bookBytes.byteLength)
          : '0',
        ...(immersive ? { 'data-immersive': '' } : {}),
      }}
      edges={
        <>
          {!immersive ? (
            <SidebarEdgeRail
              open={chrome.sidebarOpen}
              activeTab={sidebarTab}
              tabs={sidebarTabs}
              panelWidth={sidebarResize.panelWidth}
              isResizing={sidebarResize.isResizing}
              chromeHidden={toolsHidden}
              bookmarkActive={bookmarks.isCurrentPlaceBookmarked}
              onOpenTab={openSidebarTab}
              onToggle={chrome.toggleSidebar}
            />
          ) : null}
          {immersive ? (
            <ImmersiveExitButton onExit={exitFullscreen} />
          ) : null}
        </>
      }
      topbar={
        <ReaderTopbar
          chromeHidden={toolsHidden}
          moreOpen={chrome.moreOpen}
          onToggleMore={() => {
            if (toolsHidden) return
            chrome.setSettingsOpen(false)
            chrome.setMoreOpen((v) => !v)
          }}
          capabilities={readerCapabilities}
          toolStates={toolStates}
          onTool={handleTool}
          eraserMode={eraserMode}
          onEraserMode={setEraserMode}
          audioButtonRef={audioButtonRef}
          onShare={() => {
            chrome.closeFloating()
            chrome.setToast('Share — not available yet.')
          }}
          onFavorites={() => {
            chrome.closeFloating()
            chrome.setToast('Added to Favorites (local stub).')
          }}
          onBookInfo={() => {
            chrome.closeFloating()
            chrome.setBookInfoOpen(true)
          }}
          onTrash={() => {
            chrome.closeFloating()
            chrome.setTrashOpen(true)
          }}
          onExportAnnotations={
            canTransferAnnotations && bookId
              ? () => {
                  chrome.closeFloating()
                  void exportAnnotations(bookId, chrome.setToast)
                }
              : undefined
          }
          exportAnnotationsDisabled={annotationCount === 0}
          onExportPdf={
            isPdfSurface && bookId
              ? () => {
                  chrome.closeFloating()
                  void exportAnnotatedPdf(bookId, chrome.setToast)
                }
              : undefined
          }
        />
      }
      footer={
        <ReaderFooter
          pageCurrent={pageCurrent}
          pageTotal={pageTotal}
          pageCountReady={pageCountReady}
          progress={progress}
          onSeekProgress={book.isEpubSurface || isPdfSurface || isTextSurface ? nav.goToProgress : undefined}
          onPreviousPage={() => nav.switchPage(false)}
          onNextPage={() => nav.switchPage(true)}
          onGoToPage={nav.goToPage}
          goToPageShortcutEnabled={shortcutsEnabled}
          onGoToPageUnavailable={(reason) =>
            chrome.setToast(
              reason === 'scroll'
                ? 'Go to Page isn’t available in scroll view.'
                : 'Page numbers aren’t ready yet.',
            )
          }
          layout={book.prefs.layout}
          // PDF has its own 1 / 2 / 3 pages-per-view toggle (below); TXT / MD have no spread.
          pagesPerView={isPdfSurface ? pdfView.pagesPerView : undefined}
          onPagesPerViewChange={isPdfSurface ? changePdfPagesPerView : undefined}
          pageControlsInScroll={isPdfSurface}
          onLayoutChange={
            isPdfSurface || isTextSurface
              ? undefined
              : (layout) => {
                  book.prefsDirtyRef.current = true
                  book.setPrefs((p) => ({ ...p, layout }))
                }
          }
          // PDF: page-turn or scroll, both with real page numbers (kept in `pdfViewStore`).
          // TXT is one continuous scroll with a progress readout instead of page numbers.
          viewMode={
            isPdfSurface
              ? pdfView.flow === 'paged'
                ? 'paginated'
                : 'scroll'
              : isTextSurface
                ? 'scroll'
                : book.prefs.viewMode
          }
          onViewModeChange={
            isTextSurface
              ? undefined
              : isPdfSurface
                ? (viewMode) => pdfView.setFlow(viewMode === 'scroll' ? 'scroll' : 'paged')
                : (viewMode) => {
                  book.prefsDirtyRef.current = true
                  book.setPrefs((p) => ({ ...p, viewMode }))
                }
          }
          zoom={zoom.viewZoom}
          onZoomChange={zoom.handleZoomChange}
          onZoomStep={zoom.handleZoomStep}
          onZoomLayoutPreset={(preset) =>
            isPdfSurface && preset === 'fit-page' ? fitPdfPage() : zoom.handleZoomLayoutPreset(preset)
          }
          onFitPage={isPdfSurface ? fitPdfPage : undefined}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          immersiveHidden={footerImmersiveHidden}
          bookmarkActive={bookmarks.isCurrentPlaceBookmarked}
          onToggleBookmark={bookmarks.toggleBookmark}
          searchIndexing={searchIndexing}
        />
      }
      overlays={
        <>
          <SnapshotOverlay
            active={snapshot.active}
            selectionRect={snapshot.selectionRect}
            onPointerDown={snapshot.onOverlayPointerDown}
            onPointerMove={snapshot.onOverlayPointerMove}
            onPointerUp={snapshot.onOverlayPointerUp}
          />

          <ReaderSearchPanel
            open={chrome.searchOpen}
            query={readerSearchQuery}
            onQueryChange={setReaderSearchQuery}
            onSubmit={requestReaderSearch}
            onClose={() => chrome.setSearchOpen(false)}
          />

          <ReadAloudMenu
            open={readAloud.menuOpen}
            anchorRef={audioButtonRef}
            status={readAloud.status}
            rate={readAloud.rate}
            volume={readAloud.volume}
            available={readAloud.available}
            onClose={readAloud.closeMenu}
            onReadViewport={readAloud.readViewport}
            onReadFromPosition={readAloud.readFromPosition}
            onTogglePlayPause={readAloud.togglePlayPause}
            onStop={readAloud.stop}
            onRateChange={readAloud.setRate}
            onVolumeChange={readAloud.setVolume}
          />

          <TocSidebar
            bookId={bookId}
            immersive={immersive}
            open={!immersive && chrome.sidebarOpen}
            tab={sidebarTab}
            panelWidth={sidebarResize.panelWidth}
            isResizing={sidebarResize.isResizing}
            chromeHidden={toolsHidden}
            onResizePointerDown={sidebarResize.onResizePointerDown}
            chapters={isPdfSurface || isTextSurface ? [] : FAKE_CHAPTERS}
            chapterIndex={nav.chapterIndex}
            tocItems={
              book.isEpubSurface
                ? nav.epubToc
                : isPdfSurface
                  ? nav.pdfToc
                  : isMdSurface
                    ? mdToc
                    : undefined
            }
            activeTocHref={book.isEpubSurface ? nav.epubNav?.href : undefined}
            activeTocItemId={
              isPdfSurface
                ? (nav.pdfActiveTocId ?? null)
                : isMdSurface
                  ? mdActiveHeading === null
                    ? null
                    : `md-h-${mdActiveHeading}`
                  : undefined
            }
            onClose={() => chrome.setSidebarOpen(false)}
            onSelectChapter={nav.goChapter}
            onSelectTocItem={(item) => {
              if (item.href.startsWith(MD_HEADING_HREF)) {
                chrome.closeFloating()
                mdApiRef.current?.scrollToHeading(Number(item.href.slice(MD_HEADING_HREF.length)))
                return
              }
              nav.handleSelectTocItem(item)
            }}
            pageCurrent={sectionCurrent}
            pageTotal={sectionTotal}
            sectionLabels={sectionLabels}
            sectionNoun={isPdfSurface ? 'Page' : 'Chapter'}
            onGoToPage={nav.goToPageFromLayout}
            renderPageThumbnail={isPdfSurface ? renderPdfThumbnail : undefined}
            bookmarks={bookmarks.bookmarks}
            currentBookmarkId={bookmarks.currentBookmarkId}
            currentPlaceBookmarked={bookmarks.isCurrentPlaceBookmarked}
            onToggleBookmark={bookmarks.toggleBookmark}
            onJumpBookmark={(bookmark) => {
              void bookmarks.jumpToBookmark(bookmark)
            }}
            onDeleteBookmark={bookmarks.deleteBookmarkById}
            highlights={
              isPdfSurface
                ? pdfHighlights.highlights
                : isMdSurface
                  ? mdHighlights.highlights
                  : isTxtSurface
                    ? txtSidebarHighlights
                    : highlights.highlights
            }
            activeHighlightId={isPdfSurface ? selectedShapeId : null}
            onJumpHighlight={(highlight) => {
              if (isMdSurface) {
                const row = mdHighlights.highlights.find((h) => h.id === highlight.id)
                if (row) mdHighlights.jumpToHighlight(row)
                return
              }
              if (isTxtSurface) {
                const row = txt.highlights.find((h) => h.id === highlight.id)
                if (row) txt.jumpToHighlight(row)
                return
              }
              if (isPdfSurface) {
                const row = pdfHighlights.highlights.find((h) => h.id === highlight.id)
                if (row) pdfHighlights.jumpToHighlight(row)
                return
              }
              const row = highlights.highlights.find((h) => h.id === highlight.id)
              if (row) void highlights.jumpToHighlight(row)
            }}
            onDeleteHighlight={markup.deleteHighlight}
            onChangeHighlightColor={markup.updateHighlightColor}
            onChangeHighlightNote={(id, note) => markup.updateHighlightNote(id, note)}
            onCopyHighlight={(highlight) => copyHighlightText(highlight.selectionText?.highlight)}
            onAskAiHighlight={() => chrome.setToast('AI Ask — coming soon.')}
          />

          <ReaderRightSidebar
            open={!immersive && rightPanel !== null}
            title={rightPanel === 'settings' ? 'Reading settings' : ''}
            onClose={closeRightPanel}
            chromeHidden={toolsHidden}
            docked={rightSidebarDocked}
          >
            {rightPanel === 'settings' ? (
              <AaSettingsPanel
                prefs={book.prefs}
                onChange={(patch) => {
                  book.prefsDirtyRef.current = true
                  book.setPrefs((p) => ({ ...p, ...patch }))
                }}
              />
            ) : null}
          </ReaderRightSidebar>

          <SignInfoPanel
            open={chrome.signOpen}
            bookId={bookId}
            onClose={() => chrome.setSignOpen(false)}
          />

          <WordCountPanel
            open={chrome.wordCountOpen}
            status={wordCount.status}
            stats={wordCount.stats}
            errorMessage={wordCount.errorMessage}
            pageTotal={pageTotal}
            onClose={() => chrome.setWordCountOpen(false)}
          />

          <BookInfoDialog
            open={chrome.bookInfoOpen}
            bookId={bookId ?? 'unknown'}
            title={book.bookTitle}
            chapterLabel={chapterLabel}
            formatLabel={book.bookFormat?.toUpperCase() || 'EPUB'}
            coverUrl={book.coverUrl}
            onClose={() => chrome.setBookInfoOpen(false)}
          />

          <TrashConfirmDialog
            open={chrome.trashOpen}
            bookTitle={book.bookTitle}
            onCancel={() => chrome.setTrashOpen(false)}
            onConfirm={() => {
              chrome.setTrashOpen(false)
              chrome.setToast('Trash confirm — delete wiring comes later.')
              void session.leaveToLibrary()
            }}
          />

          <SignedPdfWriteDialog
            open={pendingSignedWrite !== null}
            action="write"
            signerName={pendingSignedWrite?.signerName}
            onCancel={() => declineSignedWrite(chrome.setToast)}
            onConfirm={() => void confirmSignedWrite(chrome.setToast)}
          />

          <SignedPdfWriteDialog
            open={pendingSignedExport !== null}
            action="export"
            signerName={pendingSignedExport?.signerName}
            onCancel={cancelSignedExport}
            onConfirm={() => void confirmSignedExport(chrome.setToast)}
          />

          {isPdfSurface && selectedInkStroke ? (
            <PdfInkPanel
              key={selectedInkStroke.id}
              stroke={selectedInkStroke}
              onChange={(patch) => pdfInk.updateStroke(selectedInkStroke.id, patch)}
              onDeleteSelected={pdfInk.deleteSelected}
            />
          ) : null}

          {chrome.toast ? (
            <div className="pointer-events-none fixed top-6 left-1/2 z-[999] -translate-x-1/2 rounded-full border border-lib-border bg-lib-surface-strong px-[18px] py-2.5 text-[13px] font-semibold text-lib-text-strong shadow-xl">
              {chrome.toast}
            </div>
          ) : null}

          {highlights.selectionMenu ? (
            <HighlightContextMenu
              point={highlights.selectionMenu.point}
              selectedText={highlights.selectionMenu.selection.text}
              onHighlight={() =>
                highlights.createHighlight(highlights.lastUsedColorHex, 'highlight')
              }
              onUnderline={() =>
                highlights.createHighlight(highlights.lastUsedColorHex, 'underline')
              }
              onStrikethrough={() =>
                highlights.createHighlight(highlights.lastUsedColorHex, 'strikethrough')
              }
              onAddNote={() =>
                highlights.createHighlight(highlights.lastUsedColorHex, 'textbox')
              }
              onBookmarkHere={bookmarks.toggleBookmark}
              onCopy={() => copyHighlightText(highlights.selectionMenu?.selection.text)}
              onTranslate={() => {
                const menu = highlights.selectionMenu
                if (menu) translation.openForSelection(menu.selection)
              }}
              onCopyWithCitation={() => {
                const menu = highlights.selectionMenu
                if (!menu) return
                const citation = formatHighlightCitation({
                  text: menu.selection.text,
                  bookTitle: book.bookTitle,
                  author: book.author,
                  locationLabel: nav.epubNav?.label,
                })
                copyHighlightText(citation)
              }}
              onDismiss={highlights.closeSelectionMenu}
            />
          ) : null}

          {txtReady ? (
            <TxtSaveStatus
              status={txt.saveStatus}
              error={txt.saveError}
              editable={txt.editable}
              onRetry={txt.retrySave}
            />
          ) : null}

          {txt.selectionMenu ? (
            <HighlightContextMenu
              point={txt.selectionMenu.point}
              selectedText={txt.selectionMenu.selection.text}
              onHighlight={() => markTxtSelection('highlight')}
              onUnderline={() => markTxtSelection('underline')}
              onStrikethrough={() => markTxtSelection('strikethrough')}
              onAddNote={() => markTxtSelection('textbox')}
              onBookmarkHere={bookmarks.toggleBookmark}
              onCopy={() => copyHighlightText(txt.selectionMenu?.selection.text)}
              onTranslate={() => {
                const menu = txt.selectionMenu
                if (menu) translation.openForSelection({ text: menu.selection.text, lang: '' })
              }}
              onCopyWithCitation={() => {
                const menu = txt.selectionMenu
                if (!menu) return
                copyHighlightText(
                  formatHighlightCitation({
                    text: menu.selection.text,
                    bookTitle: book.bookTitle,
                    author: book.author,
                    locationLabel: undefined,
                  }),
                )
              }}
              onDismiss={txt.closeSelectionMenu}
            />
          ) : null}

          {mdSelectionMenu ? (
            <HighlightContextMenu
              point={mdSelectionMenu.point}
              selectedText={mdSelectionMenu.selection.text}
              onHighlight={() => markMdSelection('highlight')}
              onUnderline={() => markMdSelection('underline')}
              onStrikethrough={() => markMdSelection('strikethrough')}
              onAddNote={() => markMdSelection('textbox')}
              onBookmarkHere={bookmarks.toggleBookmark}
              onCopy={() => copyHighlightText(mdSelectionMenu.selection.text)}
              onTranslate={() => translation.openForSelection({ text: mdSelectionMenu.selection.text, lang: '' })}
              onCopyWithCitation={() =>
                copyHighlightText(
                  formatHighlightCitation({
                    text: mdSelectionMenu.selection.text,
                    bookTitle: book.bookTitle,
                    author: book.author,
                    locationLabel: undefined,
                  }),
                )
              }
              onDismiss={() => setMdSelectionMenu(null)}
            />
          ) : null}

          {pdfSelectionMenu.menu ? (
            <HighlightContextMenu
              point={pdfSelectionMenu.menu.point}
              selectedText={pdfSelectionMenu.menu.selection.text}
              onHighlight={() => markPdfSelection('highlight')}
              onUnderline={() => markPdfSelection('underline')}
              onStrikethrough={() => markPdfSelection('strikethrough')}
              onAddNote={() => markPdfSelection('textbox')}
              onBookmarkHere={() => {
                const menu = pdfSelectionMenu.menu
                if (menu) bookmarks.togglePdfPageBookmark(menu.selection.pageStart)
              }}
              onCopy={() => copyHighlightText(pdfSelectionMenu.menu?.selection.text)}
              onTranslate={() => {
                const menu = pdfSelectionMenu.menu
                if (menu) translation.openForSelection(menu.selection)
              }}
              onCopyWithCitation={() => {
                const menu = pdfSelectionMenu.menu
                if (!menu) return
                copyHighlightText(
                  formatHighlightCitation({
                    text: menu.selection.text,
                    bookTitle: book.bookTitle,
                    author: book.author,
                    locationLabel: pdfSelectionPageLabel(menu.selection),
                  }),
                )
              }}
              onDismiss={pdfSelectionMenu.close}
            />
          ) : null}

          {pendingInsert ? (
            // Inserted Text, not saved yet: Save with text creates the annotation, Cancel / Esc / empty
            // text leaves nothing behind.
            <NoteTextboxPopup
              anchorRect={pendingInsert.anchor}
              highlight={PENDING_INSERT_DRAFT}
              placeholder="Text to insert…"
              ariaLabel="Insert text"
              discardLabel="Cancel"
              onSave={pendingInsert.commit}
              onDelete={pendingInsert.cancel}
              onDismiss={pendingInsert.cancel}
            />
          ) : null}

          {hoverMark && hoverReplace ? (
            <ReplacePreviewTooltip
              anchorRect={hoverMark.rect}
              original={hoverReplace.styleKind === 'replace' ? hoverReplace.selectionText?.highlight : undefined}
              replacement={hoverReplace.note!.trim()}
            />
          ) : null}

          {markup.activeHighlight?.highlight.styleKind === 'textbox' ? (
            // A textbox note's entire purpose is its text — its own dedicated popup, regardless
            // of hand/select mode (unlike highlight/underline/strikethrough below).
            <NoteTextboxPopup
              anchorRect={markup.activeHighlight.rect}
              highlight={markup.activeHighlight.highlight}
              conflict={conflictBannerFor(markup.activeHighlight.highlight.id)}
              onSave={(note) =>
                markup.updateHighlightNote(markup.activeHighlight!.highlight.id, note)
              }
              onDelete={() => markup.deleteHighlight(markup.activeHighlight!.highlight.id)}
              onDismiss={markup.closeEditPopup}
            />
          ) : null}

          {markup.activeHighlight &&
          markup.activeHighlight.highlight.styleKind !== 'textbox' &&
          activeTool === 'hand' ? (
            // Hand mode: a click on the highlight's mark in the book gets the exact same floating
            // toolbar as the "⋯" kebab on its sidebar note card (see NoteFloatingMenu) — same
            // actions, same look, regardless of where the click came from.
            <NoteFloatingMenu
              open
              anchorRect={markup.activeHighlight.rect}
              highlight={markup.activeHighlight.highlight}
              onChangeColor={(hex) =>
                markup.updateHighlightColor(markup.activeHighlight!.highlight.id, hex)
              }
              onEditNote={(note) =>
                markup.updateHighlightNote(markup.activeHighlight!.highlight.id, note)
              }
              onCopy={() =>
                copyHighlightText(markup.activeHighlight?.highlight.selectionText?.highlight)
              }
              onAskAi={() => chrome.setToast('AI Ask — coming soon.')}
              onDelete={() => markup.deleteHighlight(markup.activeHighlight!.highlight.id)}
              onDismiss={markup.closeEditPopup}
            />
          ) : null}

          {markup.activeHighlight &&
          markup.activeHighlight.highlight.styleKind !== 'textbox' &&
          activeTool !== 'hand' ? (
            <HighlightEditPopup
              anchorRect={markup.activeHighlight.rect}
              highlight={markup.activeHighlight.highlight}
              conflict={conflictBannerFor(markup.activeHighlight.highlight.id)}
              onChangeColor={(hex) =>
                markup.updateHighlightColor(markup.activeHighlight!.highlight.id, hex)
              }
              onToggleUnderline={(isUnderline) =>
                markup.updateHighlightStyleKind(
                  markup.activeHighlight!.highlight.id,
                  isUnderline ? 'underline' : 'highlight',
                )
              }
              onToggleStrikethrough={(isStrikethrough) =>
                markup.updateHighlightStyleKind(
                  markup.activeHighlight!.highlight.id,
                  isStrikethrough ? 'strikethrough' : 'highlight',
                )
              }
              onChangeNote={(note) =>
                markup.updateHighlightNote(markup.activeHighlight!.highlight.id, note)
              }
              onChangeTags={(tags) =>
                markup.updateHighlightTags(markup.activeHighlight!.highlight.id, tags)
              }
              onCopy={() =>
                copyHighlightText(markup.activeHighlight?.highlight.selectionText?.highlight)
              }
              onDelete={() => markup.deleteHighlight(markup.activeHighlight!.highlight.id)}
              onClose={markup.closeEditPopup}
            />
          ) : null}

          {translation.popoverOpen ? <TranslationPopover /> : null}

          {chrome.isChromeResizeSettling ? (
            <div
              aria-hidden
              className="pointer-events-none absolute z-[150] bg-lib-bg-deep"
              style={{
                left: contentInsetLeft,
                right: contentInsetRight,
                top: readerChromeTopInset(toolsHidden),
                bottom: 0,
              }}
            />
          ) : null}
        </>
      }
    >
      {book.contentStatus === 'loading' ||
      book.contentStatus === 'idle' ||
      book.isEpubSessionLoading ||
      isPdfSessionLoading ||
      isMdLoading ||
      isTxtLoading ? (
        <ReaderOpenStatus
          status={book.contentStatus === 'ready' ? 'loading' : book.contentStatus}
          onRetry={book.retryOpen}
          onBack={() => {
            void session.leaveToLibrary()
          }}
        />
      ) : book.contentStatus === 'error' || txtLoadFailed ? (
        <ReaderOpenStatus
          status="error"
          message={txtLoadFailed ? txt.errorMessage : book.openErrorMessage}
          onRetry={txtLoadFailed && bookId ? () => txt.retryLoad(bookId) : book.retryOpen}
          onLocate={
            (txtLoadFailed ? txt.errorCode : book.openErrorCode) === 'missing_file'
              ? () => {
                  void relink.locateFile()
                }
              : undefined
          }
          locating={relink.locating}
          locateMessage={relink.message}
          onBack={() => {
            void session.leaveToLibrary()
          }}
        />
      ) : (
        <ReaderZoomViewport
          ref={zoom.zoomViewportRef}
          zoom={zoom.viewZoom}
          onZoomChange={zoom.setViewZoom}
          focusZoomEnabled={activeTool === 'hand' || isPdfSurface}
          mode={isPdfSurface ? 'native' : 'transform'}
        >
          {book.bookFormat === 'epub' && book.bookBytes ? (
            <EpubRenderer
              key={bookId}
              data={book.bookBytes}
              coverUrl={book.coverUrl}
              theme={globalPrefs.theme}
              layout={book.prefs.layout}
              viewMode={book.prefs.viewMode}
              fontSize={book.prefs.fontSize}
              fontFamily={book.prefs.fontFamily}
              fontWeight={book.prefs.fontWeight}
              lineHeight={book.prefs.lineHeight}
              textAlign={book.prefs.textAlign}
              marginsEnabled={book.prefs.marginEnabled}
              marginPreset={book.prefs.margin}
              chromeHidden={immersive || chrome.chromeHidden}
              initialLocation={
                book.resumeLocation instanceof CfiLocation ? book.resumeLocation : undefined
              }
              onCenterTap={() => {
                chrome.handleCenterTap()
                highlights.dismissAnnotationUi()
              }}
              onSelectionContextMenu={(x, y) => highlights.openSelectionMenuAtPoint(x, y)}
              onAnnotationDragEnd={(info) => highlights.commitDraggedMark(info)}
              translateModeActive={translation.mode}
              onTranslateDragEnd={(info) => translation.openForSelection(info)}
              onHighlightContextMenu={(info) => highlights.openHighlightContextMenu(info)}
              onHighlightClick={(info) => highlights.focusHighlightFromClick(info)}
              onHighlightHover={(info) => setHoverMark(info ? { id: info.id, rect: info.rect } : null)}
              onSurfaceClick={() => {
                highlights.dismissAnnotationUi()
              }}
              interactionTool={activeTool}
              onFocusZoomWheel={zoom.handleFocusZoomWheel}
              onHandPanBy={
                zoom.viewZoom > 1.01 ? zoom.handleHandPanBy : undefined
              }
              apiRef={epubApiRef}
              onNavState={nav.setEpubNav}
              onLocationChange={session.handleEpubLocationChange}
              onToc={nav.setEpubToc}
              onSections={nav.setEpubSections}
            />
          ) : book.bookFormat === 'pdf' && book.bookBytes ? (
            <PdfRenderer
              key={bookId}
              data={book.bookBytes}
              zoom={zoom.viewZoom}
              getScrollRoot={() => zoom.zoomViewportRef.current?.getElement() ?? null}
              initialPage={
                book.resumeLocation instanceof PageRectLocation ? book.resumeLocation.page : 1
              }
              interactionTool={activeTool}
              pagesPerView={pdfView.pagesPerView}
              flow={pdfView.flow}
              onHandPanBy={zoom.handleHandPanBy}
              onCenterTap={chrome.handleCenterTap}
              onSelectionContextMenu={(selection, x, y) => {
                pdfHighlights.dismissAnnotationUi()
                pdfSelectionMenu.open(selection, x, y)
              }}
              annotations={pdfMarks}
              focusedAnnotationId={pdfHighlights.focusedHighlightId}
              onAnnotationClick={(hit) => {
                pdfSelectionMenu.close()
                pdfHighlights.openHighlight(hit.id, hit.rect)
              }}
              onAnnotationContextMenu={(hit) => {
                pdfSelectionMenu.close()
                pdfHighlights.openHighlight(hit.id, hit.rect)
              }}
              onBlankClick={pdfHighlights.dismissAnnotationUi}
              onInsertPoint={pdfHighlights.beginInsert}
              onAnnotationHover={(hit) => setHoverMark(hit ? { id: hit.id, rect: hit.rect } : null)}
              onMarkupSelection={(selection, tool) => {
                pdfSelectionMenu.close()
                pdfHighlights.commitMarkupSelection(selection, tool)
              }}
              hiddenEmbeddedAnnotationIds={pdfHighlights.hiddenEmbeddedObjectIds}
              inkStrokes={pdfInk.strokes}
              selectedInkId={pdfInk.selectedId}
              inkPen={inkPen}
              onInkStroke={pdfInk.commitStroke}
              onInkSelect={pdfInk.select}
              onInkMove={pdfInk.moveStroke}
              onInkResize={pdfInk.resizeStroke}
              shapes={pdfShapes}
              selectedShapeId={selectedShapeId}
              onShapeSelect={(id) => {
                if (id) pdfHighlights.focusHighlight(id)
                else if (selectedShapeId) pdfHighlights.focusHighlight(null)
              }}
              shapePen={shapePrefs}
              onShapeCreate={(pageIndex, kind, geometry) => {
                pdfHighlights.createShape(pageIndex, kind, geometry, { colorHex: shapePrefs.colorHex, opacity: shapePrefs.opacity })
              }}
              onShapeResize={pdfHighlights.updateShapeGeometry}
              renderShapeToolbar={(shape) => (
                <PdfInkQuickToolbar
                  colorHex={shapeStrokeHex(shape.colorHex)}
                  // The colour edit keeps the shape's opacity (they share one #RRGGBBAA string).
                  onColor={(hex) => pdfHighlights.updateHighlightColor(shape.id, shapeColorHex(hex, shapeOpacityOf(shape.colorHex)))}
                  onDelete={() => pdfHighlights.deleteHighlight(shape.id)}
                />
              )}
              graphics={pdfGraphics.objects}
              selectedGraphicId={pdfGraphics.selectedId}
              onGraphicSelect={pdfGraphics.select}
              onGraphicResize={(id, box) => void pdfGraphics.apply(id, { kind: 'resize', box })}
              renderGraphicToolbar={(object) => (
                <PdfInkQuickToolbar
                  colorHex={object.caps.color ? (object.colorHex ?? '#000000') : undefined}
                  onColor={object.caps.color ? (colorHex) => void pdfGraphics.apply(object.objectId, { kind: 'color', colorHex }) : undefined}
                  onDelete={object.caps.delete ? pdfGraphics.deleteSelected : undefined}
                />
              )}
              renderInkToolbar={(stroke) => (
                <PdfInkQuickToolbar
                  colorHex={stroke.colorHex}
                  onColor={(colorHex) => pdfInk.updateStroke(stroke.id, { colorHex })}
                  onDelete={pdfInk.deleteSelected}
                />
              )}
              onInkErase={pdfInk.eraseStrokes}
              eraserMode={eraserMode}
              onInkPartialErase={pdfInk.applyPartialErase}
              apiRef={pdfApiRef}
              onNavState={(state) => {
                nav.setPdfNav(state)
                session.handlePdfNavState(state)
              }}
              onOutline={nav.setPdfOutline}
            />
          ) : book.bookFormat === 'md' && bookId && mdSource ? (
            <MdRenderer
              key={bookId}
              bookId={bookId}
              source={mdSource.text}
              lossy={mdSource.lossy}
              margin={effectiveMargin}
              chromeHidden={immersive || chrome.chromeHidden}
              onMarginClick={chrome.handleCenterTap}
              onProgress={(fraction) => setTxtPercent(Math.round(fraction * 100))}
              initialPoint={mdInitialPoint}
              onLocation={session.handleMdLocation}
              onHeadings={setMdHeadings}
              onActiveHeading={setMdActiveHeading}
              onAnchorNotFound={() => chrome.setToast('That section was not found in this document.')}
              onOpenExternal={(url) => {
                void appApi.openExternalLink(url).then((result) => {
                  if (!result.ok) chrome.setToast('That link could not be opened.')
                })
              }}
              annotations={mdHighlights.highlights}
              draftCaret={
                mdHighlights.pendingInsert
                  ? { point: mdHighlights.pendingInsert.point, colorHex: MD_INSERT_CARET_COLOR }
                  : null
              }
              focusedAnnotationId={mdHighlights.focusedHighlightId}
              markupTool={activeAnnotationTool}
              onMarkupSelection={(selection, tool) => {
                setMdSelectionMenu(null)
                mdHighlights.commitMarkupSelection(selection, tool)
              }}
              onInsertPoint={(info) => {
                setMdSelectionMenu(null)
                mdHighlights.beginInsert(info)
              }}
              onSelectionContextMenu={(selection, x, y) => {
                mdHighlights.dismissAnnotationUi()
                setMdSelectionMenu({ selection, point: { x, y } })
              }}
              onAnnotationClick={(hit) => {
                setMdSelectionMenu(null)
                mdHighlights.openHighlight(hit.id, hit.rect)
              }}
              onAnnotationContextMenu={(hit) => {
                setMdSelectionMenu(null)
                mdHighlights.openHighlight(hit.id, hit.rect)
              }}
              onAnnotationHover={(hit) => setHoverMark(hit ? { id: hit.id, rect: hit.rect } : null)}
              onBlankClick={() => {
                setMdSelectionMenu(null)
                mdHighlights.dismissAnnotationUi()
              }}
              onScrolled={() => setMdSelectionMenu(null)}
              apiRef={mdApiRef}
            />
          ) : book.bookFormat === 'txt' ? (
            <TxtRenderer
              key={bookId}
              text={txt.text}
              highlights={txt.highlights}
              focusedHighlightId={txt.focusedHighlightId}
              editable={txt.editable}
              markupTool={activeAnnotationTool}
              margin={effectiveMargin}
              chromeHidden={immersive || chrome.chromeHidden}
              initialOffset={txtInitialOffset}
              caretRequest={txt.caretRequest}
              onEdit={txt.applyEdit}
              onUndo={txt.undo}
              onRedo={txt.redo}
              onSaveShortcut={txt.saveNow}
              onSelectionContextMenu={(selection, x, y) => {
                txt.dismissAnnotationUi()
                txt.openSelectionMenu(selection, x, y)
              }}
              onMarkupSelection={(selection, tool) => {
                txt.closeSelectionMenu()
                txt.commitMarkupSelection(selection, tool)
              }}
              onHighlightClick={(hit) => {
                txt.closeSelectionMenu()
                txt.openHighlight(hit.id, hit.box)
              }}
              onHighlightContextMenu={(hit) => {
                txt.closeSelectionMenu()
                txt.openHighlight(hit.id, hit.box)
              }}
              onReplaceHover={(hit) => setHoverMark(hit ? { id: hit.id, rect: hit.box } : null)}
              onBlankClick={() => {
                txt.closeSelectionMenu()
                txt.dismissAnnotationUi()
              }}
              onMarginClick={chrome.handleCenterTap}
              onScrolled={txt.closeSelectionMenu}
              onLocation={(offset) => {
                const length = txt.getTextLength()
                if (length === 0) return
                setTxtPercent(Math.round((txtApiRef.current?.getProgress() ?? 0) * 100))
                txt.setReadingOffset(offset)
                session.handleTxtLocation(offset, length)
              }}
              apiRef={txtApiRef}
            />
          ) : (
            <ReadingCanvas
              chapter={chapter}
              chapterIndex={nav.chapterIndex}
              margin={effectiveMargin}
              chromeHidden={immersive || chrome.chromeHidden}
              layout={book.prefs.layout}
              interactionTool={activeTool}
              onCanvasBackgroundClick={chrome.handleCenterTap}
              onSelectionDismiss={() => {}}
              onHandPanBy={
                zoom.viewZoom > 1.01 ? zoom.handleHandPanBy : undefined
              }
            />
          )}
        </ReaderZoomViewport>
      )}
    </ReaderShell>
  )
}

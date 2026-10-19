import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import { useParams } from 'react-router-dom'
import {
  CfiLocation,
  PageRectLocation,
  TextOffsetLocation,
  fontFamilyCss,
  formatHighlightCitation,
  isMarkupTool,
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
import { usePdfExportStore } from './logic/pdfExport/pdfExportStore'
import { usePdfSignedWriteStore } from './logic/pdfExport/pdfSignedWriteStore'
import { getReaderCapabilities } from '../../reader/capabilities'
import {
  EpubRenderer,
  type EpubRendererApi,
} from '../../reader/renderers/epub'
import {
  PdfRenderer,
  pdfFitPageZoom,
  pdfSelectionPageLabel,
  type PdfRendererApi,
} from '../../reader/renderers/pdf'
import { TxtRenderer, type TxtRendererApi } from '../../reader/renderers/txt'
import { MdRenderer, decodeMdSource, type MdRendererApi } from '../../reader/renderers/md'
import type { EpubTocItem } from '../../reader/renderers/epub'
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
  useReaderPdfHighlights,
  useReaderTxt,
  useRightPanelStore,
  type HighlightShortcuts,
  type ReaderChromeEscapeUi,
} from './logic'

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
  const txtSidebarHighlights = useMemo(() => [...txt.highlights], [txt.highlights])
  const exportAnnotatedPdf = usePdfExportStore((st) => st.exportAnnotatedPdf)
  const pendingSignedExport = usePdfExportStore((st) => st.pendingSigned)
  const confirmSignedExport = usePdfExportStore((st) => st.confirmSigned)
  const cancelSignedExport = usePdfExportStore((st) => st.cancelSigned)
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
  const fitPdfPage = useCallback(async () => {
    const api = pdfApiRef.current
    const viewport = zoomViewportRef.current?.getElement()
    if (!api || !viewport) return
    const page = api.getNavState().pageCurrent
    const size = await api.measurePage(page)
    const next = size ? pdfFitPageZoom(size, viewport.clientWidth, viewport.clientHeight) : null
    if (next === null) return
    setZoomThen(next, () => {
      api.goToPage(page)
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2)
    })
  }, [setZoomThen, zoomViewportRef])

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
  /** The open surface's annotation store: drives the shared popups, sidebar actions and shortcuts. */
  const markup = isPdfSurface ? pdfHighlights : isTxtSurface ? txt.markup : highlights
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

  highlightShortcutsRef.current = {
    undo: markup.undo,
    redo: markup.redo,
    deleteFocused: markup.deleteFocused,
    hasFocusedHighlight: markup.hasFocusedHighlight,
    // Escape while Highlight/Underline/Strikethrough is armed: drop back to Select instead of
    // leaving the reader (matches Foxit/Adobe — Escape backs a modal tool out one level at a time).
    cancelAnnotationTool: () => {
      if (translateModeRef.current) {
        translation.setMode(false)
        return true
      }
      if (!isMarkupTool(activeToolRef.current)) return false
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
          // PDF has no 1-page / 2-page spread (yet) — no toggle that the renderer would ignore.
          onLayoutChange={
            isPdfSurface || isTextSurface
              ? undefined
              : (layout) => {
                  book.prefsDirtyRef.current = true
                  book.setPrefs((p) => ({ ...p, layout }))
                }
          }
          // PDF is always one continuous scroll with real page numbers — no paginated/scroll toggle.
          // TXT is one continuous scroll with a progress readout instead of page numbers.
          viewMode={isPdfSurface ? 'paginated' : isTextSurface ? 'scroll' : book.prefs.viewMode}
          onViewModeChange={
            isPdfSurface || isTextSurface
              ? undefined
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
              isPdfSurface ? pdfHighlights.highlights : isTxtSurface ? txtSidebarHighlights : highlights.highlights
            }
            onJumpHighlight={(highlight) => {
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
              onHandPanBy={zoom.handleHandPanBy}
              onCenterTap={chrome.handleCenterTap}
              onSelectionContextMenu={(selection, x, y) => {
                pdfHighlights.dismissAnnotationUi()
                pdfSelectionMenu.open(selection, x, y)
              }}
              annotations={pdfHighlights.highlights}
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
              onMarkupSelection={(selection, tool) => {
                pdfSelectionMenu.close()
                pdfHighlights.commitMarkupSelection(selection, tool)
              }}
              hiddenEmbeddedAnnotationIds={pdfHighlights.hiddenEmbeddedObjectIds}
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
              onHeadings={setMdHeadings}
              onActiveHeading={setMdActiveHeading}
              onOpenExternal={(url) => {
                void appApi.openExternalLink(url).then((result) => {
                  if (!result.ok) chrome.setToast('That link could not be opened.')
                })
              }}
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

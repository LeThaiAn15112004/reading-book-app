import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { useParams } from 'react-router-dom'
import {
  CfiLocation,
  PageRectLocation,
  fontFamilyCss,
  formatHighlightCitation,
  type InteractionTool,
} from '@reading-book/book-reader-sdk'
import {
  useAppTitle,
  useGlobalReadingPrefs,
  useImmersiveReading,
  useOpenReading,
  useReaderChromeMenu,
} from '../../chrome'
import { ReaderShell, readerChromeTopInset, readerChromeBottomInset } from '../../reader'
import { getReaderCapabilities } from '../../reader/capabilities'
import {
  EpubRenderer,
  type EpubRendererApi,
} from '../../reader/renderers/epub'
import { PdfRenderer, type PdfRendererApi } from '../../reader/renderers/pdf'
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
  SnapshotOverlay,
  WordCountPanel,
  rightSidebarContentInset,
  sidebarContentInsetLeft,
  SignInfoPanel,
  TocSidebar,
  TranslationPopover,
  TrashConfirmDialog,
  useRightSidebarDocked,
  useSidebarPanelResize,
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
  const escapeUiRef = useRef<ReaderChromeEscapeUi>({
    isEpubSurface: false,
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
  const activeAnnotationTool =
    activeTool === 'highlight' || activeTool === 'underline' || activeTool === 'strikethrough'
      ? activeTool
      : null

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

  const readerCapabilities = useMemo(
    () => getReaderCapabilities(book.bookFormat),
    [book.bookFormat],
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
    closeFloating: chrome.closeFloating,
    highlightShortcutsRef,
  })

  const zoom = useReaderZoomControls({
    bookId,
    activeToolRef,
  })

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
  const chapterLabel = isPdfSurface ? `Page ${pdfPageCurrent}` : chapter.title
  // PDF: real page numbers. EPUB: reference pages / spine sections. Otherwise the placeholder.
  const pageCurrent = book.isEpubSurface
    ? (nav.epubNav?.pageCurrent ?? 0)
    : isPdfSurface
      ? pdfPageCurrent
      : nav.chapterIndex + 1
  const pageTotal = book.isEpubSurface
    ? (nav.epubNav?.pageTotal ?? 0)
    : isPdfSurface
      ? pdfPageTotal
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
      : nav.chapterIndex + 1
  const sectionTotal = book.isEpubSurface
    ? (nav.epubNav?.spineLength ?? 0)
    : isPdfSurface
      ? pdfPageTotal
      : FAKE_CHAPTERS.length
  const sectionLabels = useMemo(
    () =>
      book.isEpubSurface
        ? nav.epubSections
        : isPdfSurface
          ? Array.from({ length: pdfPageTotal }, (_, i) => `Page ${i + 1}`)
          : FAKE_CHAPTERS.map((c) => c.title),
    [book.isEpubSurface, isPdfSurface, nav.epubSections, pdfPageTotal],
  )
  const progress = book.isEpubSurface
    ? (nav.epubNav?.progress ?? 0)
    : isPdfSurface && pdfPageTotal > 0
      ? pdfPageCurrent / pdfPageTotal
      : 0
  const effectiveMargin = book.prefs.marginEnabled ? book.prefs.margin : 'off'

  const bookmarks = useReaderBookmarks({
    bookId,
    isEpubSurface: book.isEpubSurface,
    epubApiRef,
    epubNav: nav.epubNav ?? null,
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
    sidebarTab: chrome.sidebarTab,
    openSidebarTab: chrome.openSidebarTab,
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

  highlightShortcutsRef.current = {
    undo: highlights.undo,
    redo: highlights.redo,
    deleteFocused: highlights.deleteFocused,
    hasFocusedHighlight: highlights.hasFocusedHighlight,
    // Escape while Highlight/Underline/Strikethrough is armed: drop back to Select instead of
    // leaving the reader (matches Foxit/Adobe — Escape backs a modal tool out one level at a time).
    cancelAnnotationTool: () => {
      if (translateModeRef.current) {
        translation.setMode(false)
        return true
      }
      if (
        activeToolRef.current !== 'highlight' &&
        activeToolRef.current !== 'underline' &&
        activeToolRef.current !== 'strikethrough'
      ) {
        return false
      }
      setActiveTool('select')
      return true
    },
  }

  escapeUiRef.current = {
    isEpubSurface: book.isEpubSurface,
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
    search: { active: chrome.searchOpen },
    speech: { active: readAloud.active, expanded: readAloud.menuOpen },
    translate: { active: translation.mode },
    highlight: { active: activeTool === 'highlight' },
    underline: { active: activeTool === 'underline' },
    strikethrough: { active: activeTool === 'strikethrough' },
    snapshot: { active: snapshot.active },
    settings: { active: chrome.settingsOpen, expanded: chrome.settingsOpen },
  }

  function handleTool(tool: ToolId) {
    switch (tool) {
      case 'hand':
      case 'select':
        selectTool(tool)
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
      case 'strikethrough':
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
      contentInsetBottom={readerChromeBottomInset(book.prefs.viewMode, footerImmersiveHidden)}
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
              activeTab={chrome.sidebarTab}
              panelWidth={sidebarResize.panelWidth}
              isResizing={sidebarResize.isResizing}
              chromeHidden={toolsHidden}
              bookmarkActive={bookmarks.isCurrentPlaceBookmarked}
              onOpenTab={chrome.openSidebarTab}
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
        />
      }
      footer={
        <ReaderFooter
          pageCurrent={pageCurrent}
          pageTotal={pageTotal}
          pageCountReady={pageCountReady}
          progress={progress}
          onSeekProgress={book.isEpubSurface || isPdfSurface ? nav.goToProgress : undefined}
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
          onLayoutChange={(layout) => {
            book.prefsDirtyRef.current = true
            book.setPrefs((p) => ({ ...p, layout }))
          }}
          // PDF is always one continuous scroll with real page numbers — no paginated/scroll toggle.
          viewMode={isPdfSurface ? 'paginated' : book.prefs.viewMode}
          onViewModeChange={
            isPdfSurface
              ? undefined
              : (viewMode) => {
                  book.prefsDirtyRef.current = true
                  book.setPrefs((p) => ({ ...p, viewMode }))
                }
          }
          zoom={zoom.viewZoom}
          onZoomChange={zoom.handleZoomChange}
          onZoomStep={zoom.handleZoomStep}
          onZoomLayoutPreset={zoom.handleZoomLayoutPreset}
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
            tab={chrome.sidebarTab}
            panelWidth={sidebarResize.panelWidth}
            isResizing={sidebarResize.isResizing}
            chromeHidden={toolsHidden}
            onResizePointerDown={sidebarResize.onResizePointerDown}
            chapters={isPdfSurface ? [] : FAKE_CHAPTERS}
            chapterIndex={nav.chapterIndex}
            tocItems={
              book.isEpubSurface ? nav.epubToc : isPdfSurface ? nav.pdfToc : undefined
            }
            activeTocHref={book.isEpubSurface ? nav.epubNav?.href : undefined}
            onClose={() => chrome.setSidebarOpen(false)}
            onSelectChapter={nav.goChapter}
            onSelectTocItem={nav.handleSelectTocItem}
            pageCurrent={sectionCurrent}
            pageTotal={sectionTotal}
            sectionLabels={sectionLabels}
            onGoToPage={nav.goToPageFromLayout}
            bookmarks={bookmarks.bookmarks}
            currentBookmarkId={bookmarks.currentBookmarkId}
            currentPlaceBookmarked={bookmarks.isCurrentPlaceBookmarked}
            onToggleBookmark={bookmarks.toggleBookmark}
            onJumpBookmark={(bookmark) => {
              void bookmarks.jumpToBookmark(bookmark)
            }}
            onDeleteBookmark={bookmarks.deleteBookmarkById}
            highlights={highlights.highlights}
            onJumpHighlight={(highlight) => {
              void highlights.jumpToHighlight(highlight)
            }}
            onDeleteHighlight={highlights.deleteHighlight}
            onChangeHighlightColor={highlights.updateHighlightColor}
            onChangeHighlightNote={(id, note) => highlights.updateHighlightNote(id, note)}
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

          {highlights.activeHighlight?.highlight.styleKind === 'textbox' ? (
            // A textbox note's entire purpose is its text — its own dedicated popup, regardless
            // of hand/select mode (unlike highlight/underline/strikethrough below).
            <NoteTextboxPopup
              anchorRect={highlights.activeHighlight.rect}
              highlight={highlights.activeHighlight.highlight}
              onSave={(note) =>
                highlights.updateHighlightNote(highlights.activeHighlight!.highlight.id, note)
              }
              onDelete={() => highlights.deleteHighlight(highlights.activeHighlight!.highlight.id)}
              onDismiss={highlights.closeEditPopup}
            />
          ) : null}

          {highlights.activeHighlight &&
          highlights.activeHighlight.highlight.styleKind !== 'textbox' &&
          activeTool === 'hand' ? (
            // Hand mode: a click on the highlight's mark in the book gets the exact same floating
            // toolbar as the "⋯" kebab on its sidebar note card (see NoteFloatingMenu) — same
            // actions, same look, regardless of where the click came from.
            <NoteFloatingMenu
              open
              anchorRect={highlights.activeHighlight.rect}
              highlight={highlights.activeHighlight.highlight}
              onChangeColor={(hex) =>
                highlights.updateHighlightColor(highlights.activeHighlight!.highlight.id, hex)
              }
              onEditNote={(note) =>
                highlights.updateHighlightNote(highlights.activeHighlight!.highlight.id, note)
              }
              onCopy={() =>
                copyHighlightText(highlights.activeHighlight?.highlight.selectionText?.highlight)
              }
              onAskAi={() => chrome.setToast('AI Ask — coming soon.')}
              onDelete={() => highlights.deleteHighlight(highlights.activeHighlight!.highlight.id)}
              onDismiss={highlights.closeEditPopup}
            />
          ) : null}

          {highlights.activeHighlight &&
          highlights.activeHighlight.highlight.styleKind !== 'textbox' &&
          activeTool !== 'hand' ? (
            <HighlightEditPopup
              anchorRect={highlights.activeHighlight.rect}
              highlight={highlights.activeHighlight.highlight}
              onChangeColor={(hex) =>
                highlights.updateHighlightColor(highlights.activeHighlight!.highlight.id, hex)
              }
              onToggleUnderline={(isUnderline) =>
                highlights.updateHighlightStyleKind(
                  highlights.activeHighlight!.highlight.id,
                  isUnderline ? 'underline' : 'highlight',
                )
              }
              onToggleStrikethrough={(isStrikethrough) =>
                highlights.updateHighlightStyleKind(
                  highlights.activeHighlight!.highlight.id,
                  isStrikethrough ? 'strikethrough' : 'highlight',
                )
              }
              onChangeNote={(note) =>
                highlights.updateHighlightNote(highlights.activeHighlight!.highlight.id, note)
              }
              onChangeTags={(tags) =>
                highlights.updateHighlightTags(highlights.activeHighlight!.highlight.id, tags)
              }
              onCopy={() =>
                copyHighlightText(highlights.activeHighlight?.highlight.selectionText?.highlight)
              }
              onDelete={() => highlights.deleteHighlight(highlights.activeHighlight!.highlight.id)}
              onClose={highlights.closeEditPopup}
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
      isPdfSessionLoading ? (
        <ReaderOpenStatus
          status={book.contentStatus === 'ready' ? 'loading' : book.contentStatus}
          onRetry={book.retryOpen}
          onBack={() => {
            void session.leaveToLibrary()
          }}
        />
      ) : book.contentStatus === 'error' ? (
        <ReaderOpenStatus
          status="error"
          message={book.openErrorMessage}
          onRetry={book.retryOpen}
          onLocate={
            book.openErrorCode === 'missing_file'
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
              apiRef={pdfApiRef}
              onNavState={(state) => {
                nav.setPdfNav(state)
                session.handlePdfNavState(state)
              }}
              onOutline={nav.setPdfOutline}
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

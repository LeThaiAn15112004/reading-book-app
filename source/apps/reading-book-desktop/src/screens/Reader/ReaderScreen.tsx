import { useMemo, useRef, type CSSProperties } from 'react'
import { useParams } from 'react-router-dom'
import {
  fontFamilyCss,
  isCrosshairAnnotateTool,
  isReaderBookmarkAtLocation,
  resolveCurrentReaderBookmarkLocation,
  selectionHasHighlight,
  type ReaderHighlight,
} from '@reading-book/shared/models'
import {
  useAppTitle,
  useGlobalReadingPrefs,
  useOpenReading,
  useReaderChromeMenu,
} from '../../chrome'
import { ReaderShell } from '../../reader'
import {
  EpubRenderer,
  type EpubNavState,
  type EpubRendererApi,
} from '../../reader/renderers/epub'
import {
  AaSettingsPanel,
  BookInfoDialog,
  NoteModal,
  ReaderFooter,
  ReaderOpenStatus,
  ReaderTopbar,
  ReaderZoomViewport,
  ReadingCanvas,
  HighlightRangeHandles,
  SelectionTooltip,
  SidebarEdgeRail,
  sidebarContentInsetLeft,
  SignInfoPanel,
  TocSidebar,
  TrashConfirmDialog,
  useSidebarPanelResize,
} from './components'
import {
  FAKE_CHAPTERS,
  FAKE_SIGNATURES,
  usePagePreviewStore,
  useReaderAnnotations,
  useReaderBookOpen,
  useReaderChromeUi,
  useReaderNavigation,
  useReaderSessionBridge,
  useReaderZoomControls,
  type ReaderChromeAnnotationBridge,
  type ReaderChromeEscapeUi,
} from './logic'

/** SCR-03 — session wiring; layout/chrome live in ReaderShell (T3.2). */
export function ReaderScreen() {
  const { bookId } = useParams<{ bookId: string }>()
  const {
    setDocumentSubtitle,
    readerSearchQuery,
    readerSearchRequestId,
  } = useAppTitle()
  const { ensureTab, updateBookTitle } = useOpenReading()
  const { registerReaderChrome } = useReaderChromeMenu()
  const { prefs: globalPrefs, setPrefs: setGlobalPrefs } = useGlobalReadingPrefs()
  const globalPrefsRef = useRef(globalPrefs)
  globalPrefsRef.current = globalPrefs

  const epubApiRef = useRef<EpubRendererApi | null>(null)
  const clearHighlightHandlesRef = useRef<() => void>(() => {})
  const goChapterRef = useRef<(index: number) => void>(() => {})
  const goToPageRef = useRef<(page: number) => void>(() => {})
  const epubNavRef = useRef<EpubNavState | null>(null)
  const chapterTitleRef = useRef('')
  const bookmarkChapterIndexRef = useRef(0)
  const isEpubSurfaceRef = useRef(false)
  const bookFormatRef = useRef<string | null>(null)
  const annotationBridgeRef = useRef<ReaderChromeAnnotationBridge>({
    closeSelectionMenu: () => {},
    dismissHighlightEditPanel: () => {},
    leaveAnnotateToolViaEscape: () => {},
  })
  const escapeUiRef = useRef<ReaderChromeEscapeUi>({
    highlightEdit: null,
    selectionMenu: null,
    activeTool: 'hand',
    isEpubSurface: false,
    sidebarOpen: false,
  })

  const chrome = useReaderChromeUi({
    bookId,
    registerReaderChrome,
    epubApiRef,
    annotationBridgeRef,
    escapeUiRef,
    readerSearchQuery,
    readerSearchRequestId,
  })
  const sidebarResize = useSidebarPanelResize()

  const annotations = useReaderAnnotations({
    bookId,
    isEpubSurfaceRef,
    bookFormatRef,
    epubApiRef,
    epubNavRef,
    chapterTitleRef,
    bookmarkChapterIndexRef,
    closeFloating: chrome.closeFloating,
    setChromeHidden: chrome.setChromeHidden,
    setToast: chrome.setToast,
    goChapterRef,
    goToPageRef,
    clearHighlightHandlesRef,
  })

  annotationBridgeRef.current = {
    closeSelectionMenu: annotations.closeSelectionMenu,
    dismissHighlightEditPanel: annotations.dismissHighlightEditPanel,
    leaveAnnotateToolViaEscape: annotations.leaveAnnotateToolViaEscape,
  }

  const book = useReaderBookOpen({
    bookId,
    ensureTab,
    updateBookTitle,
    setDocumentSubtitle,
    globalPrefsRef,
    setHighlights: annotations.setHighlights,
    setBookmarks: annotations.setBookmarks,
    setTypewriterNotes: annotations.setTypewriterNotes,
    typewriterNotesRef: annotations.typewriterNotesRef,
    typewriterDraftRef: annotations.typewriterDraftRef,
    typewriterContentTimersRef: annotations.typewriterContentTimersRef,
  })

  const session = useReaderSessionBridge({
    bookId,
    epubApiRef,
    prefsRef: book.prefsRef,
    prefsDirtyRef: book.prefsDirtyRef,
    clearHighlightHandlesRef,
    prefs: book.prefs,
    sessionLoadStatus: book.sessionLoadStatus,
  })

  const nav = useReaderNavigation({
    bookId,
    contentStatus: book.contentStatus,
    bookBytes: book.bookBytes,
    bookFormat: book.bookFormat,
    isEpubSurface: book.isEpubSurface,
    pageMode: book.prefs.pageMode,
    epubApiRef,
    closeFloating: chrome.closeFloating,
    setSelectionMenu: annotations.setSelectionMenu,
    clearHighlightHandles: annotations.clearHighlightHandles,
    annotationShortcutsRef: annotations.annotationShortcutsRef,
    activeToolIsHighlight: () => annotations.activeToolRef.current === 'highlight',
    hasHighlightEdit: () => annotations.highlightEditRef.current != null,
  })

  goChapterRef.current = nav.goChapter
  goToPageRef.current = nav.goToPageFromLayout
  epubNavRef.current = nav.epubNav
  isEpubSurfaceRef.current = book.isEpubSurface
  bookFormatRef.current = book.bookFormat

  const zoom = useReaderZoomControls({
    bookId,
    activeToolRef: annotations.activeToolRef,
  })

  const chapter = FAKE_CHAPTERS[nav.chapterIndex] ?? FAKE_CHAPTERS[0]
  chapterTitleRef.current = chapter.title ?? ''
  const chapterLabel = chapter.title
  const pageCurrent = book.isEpubSurface
    ? (nav.epubNav?.pageCurrent ?? 0)
    : nav.chapterIndex + 1
  const pageTotal = book.isEpubSurface
    ? (nav.epubNav?.pageTotal ?? 0)
    : FAKE_CHAPTERS.length
  const pagePreviewsEnabled =
    chrome.sidebarOpen && chrome.sidebarTab === 'layout'
  const { previews: pagePreviews, requestPreview: requestPagePreview } =
    usePagePreviewStore({
      enabled: pagePreviewsEnabled,
      bookId,
      pageCurrent,
      pageTotal,
      isEpubSurface: book.isEpubSurface,
      epubApiRef,
    })
  const effectiveMargin = book.prefs.marginEnabled ? book.prefs.margin : 'off'
  /** Chapter key for bookmark ribbon — EPUB spine, else fake chapter index. */
  const bookmarkChapterIndex = book.isEpubSurface
    ? (nav.epubNav?.spineIndex ?? 0)
    : nav.chapterIndex
  bookmarkChapterIndexRef.current = bookmarkChapterIndex
  const currentBookmarkLocation = useMemo(
    () =>
      resolveCurrentReaderBookmarkLocation({
        isEpubSurface: book.isEpubSurface,
        chapterIndex: bookmarkChapterIndex,
        epubLocation: epubApiRef.current?.getCurrentLocation(),
      }),
    [
      book.isEpubSurface,
      bookmarkChapterIndex,
      nav.epubNav,
      nav.chapterIndex,
    ],
  )
  const isCurrentPlaceBookmarked = currentBookmarkLocation
    ? isReaderBookmarkAtLocation(
        annotations.bookmarks,
        currentBookmarkLocation,
      )
    : false
  const isSigned = FAKE_SIGNATURES.length > 0

  escapeUiRef.current = {
    highlightEdit: annotations.highlightEdit,
    selectionMenu: annotations.selectionMenu,
    activeTool: annotations.activeTool,
    isEpubSurface: book.isEpubSurface,
    sidebarOpen: chrome.sidebarOpen,
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

  return (
    <ReaderShell
      themeClassName={themeShell}
      style={readingStyle}
      chromeHidden={chrome.chromeHidden}
      contentInsetLeft={sidebarContentInsetLeft(
        chrome.sidebarOpen,
        sidebarResize.panelWidth,
      )}
      contentInsetResizing={sidebarResize.isResizing}
      dataAttrs={{
        'data-content-status': book.contentStatus,
        'data-content-format': book.bookFormat ?? '',
        'data-content-bytes': book.bookBytes
          ? String(book.bookBytes.byteLength)
          : '0',
      }}
      edges={
        <SidebarEdgeRail
          open={chrome.sidebarOpen}
          activeTab={chrome.sidebarTab}
          panelWidth={sidebarResize.panelWidth}
          isResizing={sidebarResize.isResizing}
          chromeHidden={chrome.chromeHidden}
          bookmarkActive={isCurrentPlaceBookmarked}
          onOpenTab={chrome.openSidebarTab}
          onToggle={chrome.toggleSidebar}
        />
      }
      topbar={
        <ReaderTopbar
          chromeHidden={chrome.chromeHidden}
          moreOpen={chrome.moreOpen}
          settingsOpen={chrome.settingsOpen}
          activeTool={annotations.activeTool}
          drawSettings={annotations.drawSettings}
          onDrawSettingsChange={(patch) =>
            annotations.setDrawSettings((prev) => ({ ...prev, ...patch }))
          }
          onToggleMore={() => {
            if (chrome.chromeHidden) return
            chrome.setSettingsOpen(false)
            chrome.setMoreOpen((v) => !v)
          }}
          onToggleSettings={() => {
            if (chrome.chromeHidden) return
            chrome.setMoreOpen(false)
            chrome.setSettingsOpen((v) => !v)
          }}
          onSelectTool={annotations.selectTool}
          onCompanionTool={annotations.onCompanionTool}
          onOpenSign={() => {
            chrome.setSignOpen(true)
          }}
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
          onPreviousPage={() => nav.switchPage(false)}
          onNextPage={() => nav.switchPage(true)}
          onGoToPage={nav.goToPage}
          layout={book.prefs.layout}
          pageMode={book.prefs.pageMode}
          onLayoutChange={(layout) => {
            book.prefsDirtyRef.current = true
            book.setPrefs((p) => ({ ...p, layout }))
          }}
          onPageModeChange={(pageMode) => {
            book.prefsDirtyRef.current = true
            book.setPrefs((p) => ({ ...p, pageMode }))
          }}
          zoom={zoom.viewZoom}
          onZoomChange={zoom.handleZoomChange}
          onZoomStep={zoom.handleZoomStep}
          onZoomLayoutPreset={zoom.handleZoomLayoutPreset}
          bookmarkActive={isCurrentPlaceBookmarked}
          onToggleBookmark={annotations.toggleBookmark}
        />
      }
      overlays={
        <>
          <TocSidebar
            open={chrome.sidebarOpen}
            tab={chrome.sidebarTab}
            panelWidth={sidebarResize.panelWidth}
            isResizing={sidebarResize.isResizing}
            chromeHidden={chrome.chromeHidden}
            onResizePointerDown={sidebarResize.onResizePointerDown}
            chapters={FAKE_CHAPTERS}
            chapterIndex={nav.chapterIndex}
            currentPlaceBookmarked={isCurrentPlaceBookmarked}
            tocItems={book.isEpubSurface ? nav.epubToc : undefined}
            activeTocHref={book.isEpubSurface ? nav.epubNav?.href : undefined}
            bookmarks={annotations.bookmarks}
            highlights={annotations.highlights}
            typewriterNotes={annotations.typewriterNotes}
            onClose={() => chrome.setSidebarOpen(false)}
            onSelectChapter={nav.goChapter}
            onSelectTocItem={nav.handleSelectTocItem}
            onJumpBookmark={annotations.jumpToBookmark}
            onDeleteBookmark={annotations.deleteBookmarkById}
            onAddBookmark={() => {
              annotations.toggleBookmark()
              chrome.setSidebarTab('bookmarks')
            }}
            onJumpHighlight={annotations.jumpToHighlight}
            onJumpTypewriterNote={annotations.jumpToTypewriterNote}
            onToggleAnnotationChecked={annotations.toggleAnnotationChecked}
            onSetAnnotationStatus={annotations.setAnnotationStatus}
            onEditHighlightNote={annotations.openHighlightNoteEditor}
            onEditTypewriterContent={annotations.setTypewriterContent}
            onDeleteHighlight={(h) => annotations.deleteHighlightById(h.id)}
            onDeleteTypewriterNote={annotations.deleteTypewriterById}
            onAnnotationTags={() => {
              chrome.setToast('Tags — coming soon.')
            }}
            pageCurrent={pageCurrent}
            pageTotal={pageTotal}
            onGoToPage={nav.goToPageFromLayout}
            pagePreviews={pagePreviews}
            onRequestPagePreview={requestPagePreview}
          />

          <AaSettingsPanel
            open={chrome.settingsOpen}
            prefs={book.prefs}
            theme={globalPrefs.theme}
            onClose={() => chrome.setSettingsOpen(false)}
            onChange={(patch) => {
              book.prefsDirtyRef.current = true
              book.setPrefs((p) => ({ ...p, ...patch }))
            }}
            onThemeChange={(theme) => setGlobalPrefs({ theme })}
          />

          <SelectionTooltip
            selection={annotations.pendingSelection}
            anchor={annotations.selectionMenu?.anchor ?? null}
            hasExistingHighlight={
              annotations.pendingSelection
                ? selectionHasHighlight(
                    annotations.pendingSelection,
                    annotations.highlights,
                  )
                : false
            }
            onHighlight={(hex) => annotations.applyHighlight(hex)}
            onNote={annotations.openNoteFromSelection}
            onCopy={annotations.copySelection}
            onSearch={() => annotations.stubSelectionAction('Search / Lookup')}
            onAskAi={() =>
              annotations.stubSelectionAction('Ask AI / Explain')
            }
            onShare={() =>
              annotations.stubSelectionAction('Share / Export Snippet')
            }
            onRemoveHighlight={annotations.removeHighlightForSelection}
            onDismiss={annotations.dismissPendingSelection}
            editTarget={annotations.highlightEdit}
            onChangeHighlightColor={annotations.changeHighlightColor}
            onEditNote={(highlightId) => {
              const existing = annotations.highlights.find(
                (h) => h.id === highlightId,
              )
              if (existing) annotations.openHighlightNoteEditor(existing)
            }}
            onRemoveEditHighlight={(highlightId) => {
              annotations.deleteHighlightById(highlightId)
            }}
            onDismissEdit={annotations.dismissHighlightEditPanel}
          />

          <HighlightRangeHandles
            rect={
              chrome.sidebarOpen || !annotations.highlightEdit
                ? null
                : annotations.handleRect
            }
            flash={annotations.handleFlash}
          />

          <NoteModal
            open={annotations.noteModalOpen}
            quote={
              annotations.noteEditTarget?.selectedText ??
              annotations.pendingSelection?.selectedText ??
              ''
            }
            initialContent={annotations.noteEditTarget?.note ?? ''}
            title={annotations.noteEditTarget ? 'Edit note' : 'Add note'}
            allowEmpty={!!annotations.noteEditTarget}
            onClose={annotations.closeNoteModal}
            onAutosave={annotations.autosaveHighlightNote}
          />

          <SignInfoPanel
            open={chrome.signOpen}
            isSigned={isSigned}
            signatures={FAKE_SIGNATURES}
            onClose={() => chrome.setSignOpen(false)}
          />

          <BookInfoDialog
            open={chrome.bookInfoOpen}
            bookId={bookId ?? 'unknown'}
            title={book.bookTitle}
            chapterLabel={chapterLabel}
            formatLabel={book.bookFormat?.toUpperCase() || 'EPUB'}
            coverUrl={book.coverUrl}
            isSigned={isSigned}
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
        </>
      }
    >
      {book.contentStatus === 'loading' ||
      book.contentStatus === 'idle' ||
      book.isEpubSessionLoading ? (
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
          onBack={() => {
            void session.leaveToLibrary()
          }}
        />
      ) : (
        <ReaderZoomViewport
          ref={zoom.zoomViewportRef}
          zoom={zoom.viewZoom}
          onZoomChange={zoom.setViewZoom}
          focusZoomEnabled={annotations.activeTool === 'hand'}
        >
          {book.bookFormat === 'epub' && book.bookBytes ? (
            <EpubRenderer
              key={bookId}
              data={book.bookBytes}
              coverUrl={book.coverUrl}
              theme={globalPrefs.theme}
              layout={book.prefs.layout}
              pageMode={book.prefs.pageMode}
              fontSize={book.prefs.fontSize}
              fontFamily={book.prefs.fontFamily}
              fontWeight={book.prefs.fontWeight}
              lineHeight={book.prefs.lineHeight}
              textAlign={book.prefs.textAlign}
              marginsEnabled={book.prefs.marginEnabled}
              marginPreset={book.prefs.margin}
              chromeHidden={chrome.chromeHidden}
              initialLocation={book.resumeLocation}
              onCenterTap={chrome.handleCenterTap}
              onSelectionContextMenu={annotations.openSelectionMenu}
              onTextSelected={annotations.handleTextSelected}
              onSelectionDismiss={annotations.handleSelectionDismiss}
              onHighlightMarkClick={annotations.handleHighlightMarkClick}
              interactionTool={
                annotations.activeTool === 'highlight'
                  ? 'highlight'
                  : annotations.activeTool === 'typewriter'
                    ? 'typewriter'
                    : annotations.activeTool === 'select'
                      ? 'select'
                      : isCrosshairAnnotateTool(annotations.activeTool)
                        ? 'annotate'
                        : 'hand'
              }
              typewriterNotes={annotations.typewriterNotes}
              typewriterChapterIndex={nav.epubNav?.spineIndex ?? 0}
              typewriterDraft={annotations.typewriterDraft}
              onTypewriterPlace={annotations.handleTypewriterPlace}
              onTypewriterDraftChange={annotations.handleTypewriterDraftChange}
              onTypewriterDraftStyleChange={
                annotations.handleTypewriterDraftStyleChange
              }
              onTypewriterDraftCommit={annotations.commitTypewriterDraft}
              onTypewriterDraftCancel={annotations.cancelTypewriterDraft}
              onTypewriterContentChange={annotations.handleTypewriterContentChange}
              onTypewriterContentBlur={annotations.flushTypewriterContent}
              onTypewriterContentFocus={annotations.handleTypewriterContentFocus}
              onTypewriterStyleChange={annotations.handleTypewriterStyleChange}
              onTypewriterMove={annotations.moveTypewriter}
              onTypewriterDelete={annotations.deleteTypewriterById}
              onFocusZoomWheel={zoom.handleFocusZoomWheel}
              onHandPanBy={
                zoom.viewZoom > 1.01 ? zoom.handleHandPanBy : undefined
              }
              highlights={annotations.highlights.filter(
                (h): h is Extract<ReaderHighlight, { source: 'epub' }> =>
                  h.source === 'epub',
              )}
              apiRef={epubApiRef}
              onNavState={nav.setEpubNav}
              onLocationChange={session.handleEpubLocationChange}
              onToc={nav.setEpubToc}
            />
          ) : (
            <ReadingCanvas
              chapters={FAKE_CHAPTERS}
              chapter={chapter}
              chapterIndex={nav.chapterIndex}
              margin={effectiveMargin}
              chromeHidden={chrome.chromeHidden}
              pageMode={book.prefs.pageMode}
              layout={book.prefs.layout}
              activeTool={annotations.activeTool}
              highlights={annotations.highlights}
              typewriterNotes={annotations.typewriterNotes}
              eSignStamps={annotations.eSignStamps}
              onCanvasBackgroundClick={chrome.handleCenterTap}
              onSelectionContextMenu={annotations.openSelectionMenu}
              onTextSelected={annotations.handleTextSelected}
              onSelectionDismiss={annotations.handleSelectionDismiss}
              onHighlightClick={(hl, rect, click) =>
                annotations.handleHighlightMarkClick({
                  id: hl.id,
                  cfiRange: '',
                  colorHex: hl.colorHex,
                  rect,
                  click,
                })
              }
              onHandPanBy={
                zoom.viewZoom > 1.01 ? zoom.handleHandPanBy : undefined
              }
              onPlaceTypewriter={annotations.placeTypewriter}
              onPlaceESign={annotations.placeESign}
              onTypewriterChange={annotations.handleTypewriterContentChange}
              onTypewriterBlur={annotations.flushTypewriterContent}
              onTypewriterFocus={annotations.handleTypewriterContentFocus}
              onTypewriterStyleChange={annotations.handleTypewriterStyleChange}
              onTypewriterMove={annotations.moveTypewriter}
              onTypewriterDelete={annotations.deleteTypewriterById}
            />
          )}
        </ReaderZoomViewport>
      )}
    </ReaderShell>
  )
}

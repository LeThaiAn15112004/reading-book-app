/**
 * The Mobile Reader (spec 008, T102 + T103, FR-012a / FR-012c; `contracts/phone-ui.md`, "Mobile Reader UI").
 *
 * Chosen by `ReaderRoute` only when `isMobileHost()` is true and loaded with `React.lazy`, so Electron never loads
 * this file. It runs the SAME core hooks as Desktop's `ReaderScreen` (`useReaderCore`, `useReaderAnnotations`,
 * `useReaderTxt`, `usePdfSelectionMenu`, `useReaderZoomControls`), the same renderers and the same stores; only the
 * chrome is its own: a full-screen page, bars that a tap in the middle shows or hides, bottom sheets for Contents,
 * Bookmarks / Notes and Appearance, an action bar for selected text and a sheet for a mark.
 *
 * Not here (first-release scope, hidden on Mobile): TXT editing and markup, ink, shapes, typewriter, attachments,
 * search, read aloud, translation, snapshot, word count, export, annotation transfer, relink, keyboard shortcuts.
 *
 * Mobile-only state: none. Which sheet is open, whether the bars show and the toast are component state.
 *
 * Page turns: the edge tap zones and the bottom bar's previous / next. Swipe is NOT built: whether a swipe can be told
 * apart from a text selection and PDF scrolling is risk R2, which T095 checks on the device first.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  CfiLocation,
  PageRectLocation,
  isShapeStyleKind,
  type InteractionTool,
  type MdHeadingInfo,
  type ReaderHighlightBase,
} from '@reading-book/book-reader-sdk'
import { useAppTitle, useGlobalReadingPrefs, useOpenReading } from '../../../chrome'
import { EpubRenderer, type EpubRendererApi, type EpubTocItem } from '../../../reader/renderers/epub'
import { PdfRenderer, type PdfRendererApi } from '../../../reader/renderers/pdf'
import { TxtRenderer, type TxtRendererApi } from '../../../reader/renderers/txt'
import { MdRenderer, type MdRendererApi, type MdSelectionInfo } from '../../../reader/renderers/md'
import { ReaderOpenStatus } from '../components/chrome/ReaderOpenStatus'
import { ReaderZoomViewport } from '../components/chrome/ReaderZoomViewport'
import { AaSettingsPanel } from '../components/settings/AaSettingsPanel'
import { FAKE_CHAPTERS } from '../logic/demo/fakeReaderContent'
import type { HighlightShortcuts } from '../logic/hooks/useReaderHighlights'
import { usePdfSelectionMenu } from '../logic/hooks/usePdfSelectionMenu'
import { useReaderTxt } from '../logic/hooks/useReaderTxt'
import { useReaderZoomControls } from '../logic/hooks/useReaderZoomControls'
import { MD_HEADING_HREF, mdInitialPointFor, mdSourceFor, mdTocFromHeadings, txtInitialOffsetFor } from '../logic/reader-core/derivations'
import { readingStyleFor } from '../logic/reader-core/reading-style'
import { useReaderAnnotations } from '../logic/reader-core/useReaderAnnotations'
import { useReaderCore } from '../logic/reader-core/useReaderCore'
import { MobileMarkSheet } from './components/MobileMarkSheet'
import { MobileMarksSheet } from './components/MobileMarksSheet'
import { MobileReaderBottomBar, MobileReaderTopBar } from './components/MobileReaderBars'
import { MobileSelectionBar, type SelectionMarkKind } from './components/MobileSelectionBar'
import { MobileSheet } from './components/MobileSheet'
import { MobileTocSheet } from './components/MobileTocSheet'
import { requestSelectionMenu, useLiveSelection } from './components/useLiveSelection'

type SheetId = 'toc' | 'bookmarks' | 'notes' | 'appearance'

const NO_SHORTCUTS: HighlightShortcuts = {
  undo: () => {},
  redo: () => {},
  deleteFocused: () => {},
  hasFocusedHighlight: () => false,
  cancelAnnotationTool: () => false,
}

/** The phone has no Hand tool: the page scrolls and selects natively. */
const TOOL: InteractionTool = 'select'
const TOAST_MS = 2400
/** Width of each edge tap zone, as a share of the screen. */
const EDGE_ZONE = '14%'

export default function MobileReaderScreen() {
  const { bookId } = useParams<{ bookId: string }>()
  const { setDocumentSubtitle } = useAppTitle()
  const { ensureTab, updateBookTitle } = useOpenReading()
  const { prefs: globalPrefs } = useGlobalReadingPrefs()
  const globalPrefsRef = useRef(globalPrefs)
  globalPrefsRef.current = globalPrefs

  const epubApiRef = useRef<EpubRendererApi | null>(null)
  const pdfApiRef = useRef<PdfRendererApi | null>(null)
  const txtApiRef = useRef<TxtRendererApi | null>(null)
  const mdApiRef = useRef<MdRendererApi | null>(null)
  const highlightShortcutsRef = useRef<HighlightShortcuts>(NO_SHORTCUTS)
  const activeToolRef = useRef<InteractionTool>(TOOL)
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  const [barsVisible, setBarsVisible] = useState(true)
  const [sheet, setSheet] = useState<SheetId | null>(null)
  const [toast, setToastState] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToastState(null), TOAST_MS)
    return () => window.clearTimeout(id)
  }, [toast])
  const setToast = useCallback((message: string | null) => setToastState(message), [])
  const setChromeHidden = useCallback((hidden: boolean) => setBarsVisible(!hidden), [])
  const closeFloating = useCallback(() => setSheet(null), [])

  // Book open + session + navigation: the same hook, with the same order, as Desktop (FR-012c step 3).
  const { book, session, nav, isPdfSurface, isTxtSurface, isMdSurface, isTextSurface } = useReaderCore({
    bookId,
    ensureTab,
    updateBookTitle,
    setDocumentSubtitle,
    globalPrefsRef,
    epubApiRef,
    pdfApiRef,
    txtApiRef,
    mdApiRef,
    closeFloating,
    highlightShortcutsRef,
  })

  // TXT text comes from `txt:open`; on Mobile it is read-only (`editable: false`, no markup).
  const txt = useReaderTxt({ bookId, active: isTxtSurface, txtApiRef, setToast, setChromeHidden })
  const zoom = useReaderZoomControls({ bookId, activeToolRef })

  const mdSource = useMemo(() => mdSourceFor(isMdSurface, book.bookBytes), [isMdSurface, book.bookBytes])
  const [mdHeadings, setMdHeadings] = useState<MdHeadingInfo[]>([])
  const [mdActiveHeading, setMdActiveHeading] = useState<number | null>(null)
  const [mdSelectionMenu, setMdSelectionMenu] = useState<{ selection: MdSelectionInfo; point: { x: number; y: number } } | null>(null)
  const [textPercent, setTextPercent] = useState(0)
  useEffect(() => {
    setMdHeadings([])
    setMdActiveHeading(null)
    setMdSelectionMenu(null)
    setTextPercent(0)
    setSheet(null)
  }, [bookId])
  const mdToc = useMemo<EpubTocItem[]>(() => mdTocFromHeadings(mdHeadings), [mdHeadings])

  const txtReady = isTxtSurface && txt.loadStatus === 'ready'
  const txtLoadFailed = isTxtSurface && txt.loadStatus === 'error'
  const isTxtLoading = isTxtSurface && !txtLoadFailed && (!txtReady || book.sessionLoadStatus === 'loading')
  const txtInitialOffset = useMemo(
    () => txtInitialOffsetFor(book.resumeLocation, txt.getTextLength()),
    // Read once when the renderer mounts, like Desktop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book.resumeLocation, txtReady],
  )
  const mdInitialPoint = useMemo(
    () => mdInitialPointFor(book.resumeLocation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book.resumeLocation, isMdSurface],
  )
  const isPdfSessionLoading = isPdfSurface && book.sessionLoadStatus === 'loading'
  const isMdLoading = isMdSurface && book.sessionLoadStatus === 'loading'

  // Progress and the place label, computed as Desktop's footer does.
  const pdfPageCurrent = nav.pdfNav?.pageCurrent ?? 0
  const pdfPageTotal = nav.pdfNav?.pageTotal ?? 0
  const chapterLabel = isPdfSurface
    ? `Page ${pdfPageCurrent}`
    : isTextSurface
      ? `${textPercent}%`
      : (FAKE_CHAPTERS[nav.chapterIndex] ?? FAKE_CHAPTERS[0])!.title
  const progress = book.isEpubSurface
    ? (nav.epubNav?.progress ?? 0)
    : isPdfSurface && pdfPageTotal > 0
      ? pdfPageCurrent / pdfPageTotal
      : isTextSurface
        ? textPercent / 100
        : 0
  const progressLabel = isPdfSurface
    ? pdfPageTotal > 0
      ? `${pdfPageCurrent}/${pdfPageTotal}`
      : ''
    : `${Math.round(progress * 100)}%`

  // Bookmarks + EPUB / PDF-text / Markdown highlights (FR-012c step 4). No markup tool is ever armed on the phone.
  const { bookmarks, highlights, pdfHighlights, mdHighlights } = useReaderAnnotations({
    bookId,
    isEpubSurface: book.isEpubSurface,
    isPdfSurface,
    isMdSurface,
    epubApiRef,
    pdfApiRef,
    mdApiRef,
    epubNav: nav.epubNav ?? null,
    pdfPage: pdfPageCurrent,
    chapterIndex: nav.chapterIndex,
    chapterLabel,
    goChapter: nav.goChapter,
    zoom: zoom.viewZoom,
    setToast,
    setChromeHidden,
    activeAnnotationTool: null,
  })
  const pdfSelectionMenu = usePdfSelectionMenu({
    bookId,
    isPdfSurface,
    getScrollRoot: () => zoom.zoomViewportRef.current?.getElement() ?? null,
    zoom: zoom.viewZoom,
  })

  /** The open surface's annotation store, as Desktop's `markup` (TXT is read-only here, so it has none). */
  const markup = isPdfSurface ? pdfHighlights : isMdSurface ? mdHighlights : book.isEpubSurface ? highlights : null
  /** PDF: only text markup is listed and painted; shapes, typewriter notes and attachments are not in this release. */
  const pdfTextHighlights = useMemo(
    () => pdfHighlights.highlights.filter((h) => !isShapeStyleKind(h.styleKind) && h.styleKind !== 'typewriter' && h.styleKind !== 'attachment'),
    [pdfHighlights.highlights],
  )
  const listedHighlights: readonly ReaderHighlightBase[] = isPdfSurface
    ? pdfTextHighlights
    : isMdSurface
      ? mdHighlights.highlights
      : isTxtSurface
        ? txt.highlights
        : highlights.highlights

  const readingStyle = useMemo(
    () =>
      readingStyleFor({
        fontSize: book.prefs.fontSize,
        lineHeight: book.prefs.lineHeight,
        fontWeight: book.prefs.fontWeight,
        fontFamily: book.prefs.fontFamily,
        textAlign: book.prefs.textAlign,
      }),
    [book.prefs.fontSize, book.prefs.lineHeight, book.prefs.fontWeight, book.prefs.fontFamily, book.prefs.textAlign],
  )
  const effectiveMargin = book.prefs.marginEnabled ? book.prefs.margin : 'off'

  const toggleBars = useCallback(() => setBarsVisible((v) => !v), [])
  const copyText = (text: string | undefined) => {
    if (!text) return
    void navigator.clipboard?.writeText(text).then(
      () => setToast('Copied.'),
      () => setToast('Could not copy.'),
    )
  }

  // ── Selected text ────────────────────────────────────────────────────────────────────────────────────────────
  const selectionMenu = isPdfSurface && pdfSelectionMenu.menu
    ? {
        text: pdfSelectionMenu.menu.selection.text,
        mark: (kind: SelectionMarkKind) => {
          const menu = pdfSelectionMenu.menu
          if (!menu) return
          pdfHighlights.createFromSelection(menu.selection, kind, new DOMRect(menu.point.x, menu.point.y, 0, 0))
          pdfSelectionMenu.close()
        },
        close: pdfSelectionMenu.close,
      }
    : isMdSurface && mdSelectionMenu
      ? {
          text: mdSelectionMenu.selection.text,
          mark: (kind: SelectionMarkKind) => {
            setMdSelectionMenu(null)
            mdHighlights.createFromSelection(mdSelectionMenu.selection, kind, new DOMRect(mdSelectionMenu.point.x, mdSelectionMenu.point.y, 0, 0))
          },
          close: () => setMdSelectionMenu(null),
        }
      : book.isEpubSurface && highlights.selectionMenu
        ? {
            text: highlights.selectionMenu.selection.text,
            mark: (kind: SelectionMarkKind) => highlights.createHighlight(highlights.lastUsedColorHex, kind),
            close: highlights.closeSelectionMenu,
          }
        : null
  const markable = book.contentStatus === 'ready' && (book.isEpubSurface || isPdfSurface || isMdSurface)
  const liveSelection = useLiveSelection(surfaceRef, markable && sheet === null && !markup?.activeHighlight)
  const clearNativeSelection = () => {
    if (liveSelection) liveSelection.doc.getSelection()?.removeAllRanges()
    else window.getSelection()?.removeAllRanges()
  }

  const leave = () => {
    void session.leaveToLibrary()
  }

  // ── Loading / error ──────────────────────────────────────────────────────────────────────────────────────────
  const loading =
    book.contentStatus === 'loading' ||
    book.contentStatus === 'idle' ||
    book.isEpubSessionLoading ||
    isPdfSessionLoading ||
    isMdLoading ||
    isTxtLoading
  const failed = book.contentStatus === 'error' || txtLoadFailed

  if (loading || failed) {
    return (
      <div className="flex h-full flex-col bg-lib-bg-deep text-lib-text" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <ReaderOpenStatus
          status={failed ? 'error' : book.contentStatus === 'ready' ? 'loading' : book.contentStatus === 'error' ? 'error' : book.contentStatus}
          message={failed ? (txtLoadFailed ? txt.errorMessage : book.openErrorMessage) : undefined}
          onRetry={txtLoadFailed && bookId ? () => txt.retryLoad(bookId) : book.retryOpen}
          // "Locate file…" is a computer's file system action; on the phone a missing book is imported again.
          onBack={leave}
        />
      </div>
    )
  }

  const active = markup?.activeHighlight ?? null

  return (
    <div
      className="relative h-full overflow-hidden bg-lib-bg-deep text-lib-text [--reader-text:var(--lib-text)]"
      style={readingStyle}
      data-mobile-reader=""
    >
      <div ref={surfaceRef} className="absolute inset-0" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <ReaderZoomViewport
          ref={zoom.zoomViewportRef}
          zoom={zoom.viewZoom}
          onZoomChange={zoom.setViewZoom}
          focusZoomEnabled={isPdfSurface}
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
              chromeHidden={!barsVisible}
              initialLocation={book.resumeLocation instanceof CfiLocation ? book.resumeLocation : undefined}
              onCenterTap={() => {
                toggleBars()
                highlights.dismissAnnotationUi()
              }}
              onSelectionContextMenu={(x, y) => highlights.openSelectionMenuAtPoint(x, y)}
              onAnnotationDragEnd={(info) => highlights.commitDraggedMark(info)}
              translateModeActive={false}
              onTranslateDragEnd={() => {}}
              // A tap or long press on a mark opens its sheet (Desktop: a click focuses, a right-click opens the menu).
              onHighlightContextMenu={(info) => highlights.openHighlightContextMenu(info)}
              onHighlightClick={(info) => highlights.openHighlightContextMenu(info)}
              onSurfaceClick={() => highlights.dismissAnnotationUi()}
              interactionTool={TOOL}
              onFocusZoomWheel={zoom.handleFocusZoomWheel}
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
              initialPage={book.resumeLocation instanceof PageRectLocation ? book.resumeLocation.page : 1}
              interactionTool={TOOL}
              pagesPerView={1}
              flow="scroll"
              onHandPanBy={zoom.handleHandPanBy}
              onCenterTap={toggleBars}
              onSelectionContextMenu={(selection, x, y) => {
                pdfHighlights.dismissAnnotationUi()
                pdfSelectionMenu.open(selection, x, y)
              }}
              annotations={pdfTextHighlights}
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
              chromeHidden={!barsVisible}
              onMarginClick={toggleBars}
              onProgress={(fraction) => setTextPercent(Math.round(fraction * 100))}
              initialPoint={mdInitialPoint}
              onLocation={session.handleMdLocation}
              onHeadings={setMdHeadings}
              onActiveHeading={setMdActiveHeading}
              onAnchorNotFound={() => setToast('That section was not found in this document.')}
              onOpenExternal={() => setToast('Links to other sites do not open in this release.')}
              annotations={mdHighlights.highlights}
              draftCaret={null}
              focusedAnnotationId={mdHighlights.focusedHighlightId}
              markupTool={null}
              onMarkupSelection={(selection, tool) => {
                setMdSelectionMenu(null)
                mdHighlights.commitMarkupSelection(selection, tool)
              }}
              onInsertPoint={() => {}}
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
              onAnnotationHover={() => {}}
              onBlankClick={() => {
                setMdSelectionMenu(null)
                mdHighlights.dismissAnnotationUi()
              }}
              onScrolled={() => {
                setMdSelectionMenu(null)
                // A text that scrolls (Markdown, TXT) has few margins to tap: reading on hides the bars.
                setBarsVisible(false)
              }}
              apiRef={mdApiRef}
            />
          ) : book.bookFormat === 'txt' ? (
            <TxtRenderer
              key={bookId}
              text={txt.text}
              highlights={txt.highlights}
              focusedHighlightId={txt.focusedHighlightId}
              editable={false}
              markupTool={null}
              margin={effectiveMargin}
              chromeHidden={!barsVisible}
              initialOffset={txtInitialOffset}
              caretRequest={txt.caretRequest}
              onEdit={txt.applyEdit}
              onUndo={txt.undo}
              onRedo={txt.redo}
              onSaveShortcut={txt.saveNow}
              onSelectionContextMenu={() => {}}
              onMarkupSelection={() => {}}
              onHighlightClick={() => {}}
              onHighlightContextMenu={() => {}}
              onReplaceHover={() => {}}
              onBlankClick={() => txt.dismissAnnotationUi()}
              onMarginClick={toggleBars}
              onScrolled={() => setBarsVisible(false)}
              onLocation={(offset) => {
                const length = txt.getTextLength()
                if (length === 0) return
                setTextPercent(Math.round((txtApiRef.current?.getProgress() ?? 0) * 100))
                txt.setReadingOffset(offset)
                session.handleTxtLocation(offset, length)
              }}
              apiRef={txtApiRef}
            />
          ) : (
            <ReaderOpenStatus status="error" message="This book's format does not open on the phone." onRetry={book.retryOpen} onBack={leave} />
          )}
        </ReaderZoomViewport>
      </div>

      {/* Edge tap zones: previous / next page. Narrow, so a long press on most of the text is never caught. */}
      {!selectionMenu && !liveSelection ? (
        <>
          <button type="button" aria-label="Previous page" className="absolute top-[18%] bottom-[18%] left-0 z-[200]" style={{ width: EDGE_ZONE }} onClick={() => nav.switchPage(false)} />
          <button type="button" aria-label="Next page" className="absolute top-[18%] right-0 bottom-[18%] z-[200]" style={{ width: EDGE_ZONE }} onClick={() => nav.switchPage(true)} />
        </>
      ) : null}

      {barsVisible ? (
        <>
          <MobileReaderTopBar
            title={book.bookTitle || 'Untitled'}
            onBack={leave}
            bookmarked={bookmarks.isCurrentPlaceBookmarked}
            onToggleBookmark={isTxtSurface ? undefined : bookmarks.toggleBookmark}
            zoom={isPdfSurface ? { percent: Math.round(zoom.viewZoom * 100), onStep: zoom.handleZoomStep } : undefined}
          />
          {!selectionMenu && !liveSelection ? (
            <MobileReaderBottomBar
              progress={progress}
              progressLabel={progressLabel}
              onGoToProgress={nav.goToProgress}
              onPrev={() => nav.switchPage(false)}
              onNext={() => nav.switchPage(true)}
              tocAvailable={(book.isEpubSurface ? nav.epubToc : isPdfSurface ? nav.pdfToc : isMdSurface ? mdToc : []).length > 0}
              onOpenToc={() => setSheet('toc')}
              onOpenMarks={() => setSheet(isTxtSurface ? 'notes' : 'bookmarks')}
              onOpenAppearance={() => setSheet('appearance')}
            />
          ) : null}
        </>
      ) : null}

      {selectionMenu || liveSelection ? (
        <MobileSelectionBar
          state={selectionMenu ? 'ready' : 'pending'}
          colorHex={markup?.lastUsedColorHex ?? '#FFEB3B'}
          onRequest={() => {
            if (liveSelection) requestSelectionMenu(liveSelection)
          }}
          onMark={(kind) => {
            selectionMenu?.mark(kind)
            clearNativeSelection()
          }}
          onCopy={() => {
            copyText(selectionMenu?.text ?? liveSelection?.doc.getSelection()?.toString())
            selectionMenu?.close()
            clearNativeSelection()
          }}
          onDismiss={() => {
            selectionMenu?.close()
            clearNativeSelection()
          }}
        />
      ) : null}

      {sheet === 'toc' ? (
        <MobileTocSheet
          items={book.isEpubSurface ? nav.epubToc : isPdfSurface ? nav.pdfToc : isMdSurface ? mdToc : []}
          activeHref={book.isEpubSurface ? nav.epubNav?.href : undefined}
          activeId={isPdfSurface ? (nav.pdfActiveTocId ?? null) : isMdSurface && mdActiveHeading !== null ? `md-h-${mdActiveHeading}` : null}
          onSelect={(item) => {
            if (item.href.startsWith(MD_HEADING_HREF)) {
              mdApiRef.current?.scrollToHeading(Number(item.href.slice(MD_HEADING_HREF.length)))
              return
            }
            nav.handleSelectTocItem(item)
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'bookmarks' || sheet === 'notes' ? (
        <MobileMarksSheet
          initialTab={sheet}
          bookmarks={bookmarks.bookmarks}
          currentPlaceBookmarked={bookmarks.isCurrentPlaceBookmarked}
          onToggleBookmark={bookmarks.toggleBookmark}
          onJumpBookmark={(bookmark) => void bookmarks.jumpToBookmark(bookmark)}
          onDeleteBookmark={bookmarks.deleteBookmarkById}
          highlights={listedHighlights}
          onJumpHighlight={(highlight) => {
            if (isMdSurface) {
              const row = mdHighlights.highlights.find((h) => h.id === highlight.id)
              if (row) mdHighlights.jumpToHighlight(row)
            } else if (isTxtSurface) {
              const row = txt.highlights.find((h) => h.id === highlight.id)
              if (row) txt.jumpToHighlight(row)
            } else if (isPdfSurface) {
              const row = pdfHighlights.highlights.find((h) => h.id === highlight.id)
              if (row) pdfHighlights.jumpToHighlight(row)
            } else {
              const row = highlights.highlights.find((h) => h.id === highlight.id)
              if (row) void highlights.jumpToHighlight(row)
            }
          }}
          onOpenHighlight={
            markup
              ? (highlight) => {
                  setSheet(null)
                  // The mark's own sheet, anchored nowhere in particular (a sheet is not placed by a rect).
                  if (isPdfSurface) pdfHighlights.openHighlight(highlight.id, new DOMRect(0, 0, 0, 0))
                  else if (isMdSurface) mdHighlights.openHighlight(highlight.id, new DOMRect(0, 0, 0, 0))
                  else {
                    const row = highlights.highlights.find((h) => h.id === highlight.id)
                    if (row) highlights.openHighlightContextMenu({ id: row.id, cfiRange: row.cfiRange, rect: new DOMRect(0, 0, 0, 0) })
                  }
                }
              : undefined
          }
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'appearance' ? (
        <MobileSheet title="Appearance" onClose={() => setSheet(null)}>
          <div className="p-4">
            <AaSettingsPanel
              prefs={book.prefs}
              onChange={(patch) => {
                book.prefsDirtyRef.current = true
                book.setPrefs((p) => ({ ...p, ...patch }))
              }}
            />
          </div>
        </MobileSheet>
      ) : null}

      {markup && active ? (
        <MobileMarkSheet
          key={active.highlight.id}
          highlight={active.highlight}
          onChangeColor={(hex) => markup.updateHighlightColor(active.highlight.id, hex)}
          onChangeStyle={(kind) => markup.updateHighlightStyleKind(active.highlight.id, kind as 'highlight' | 'underline' | 'strikethrough')}
          onChangeNote={(note) => markup.updateHighlightNote(active.highlight.id, note)}
          onCopy={() => copyText(active.highlight.selectionText?.highlight)}
          onDelete={() => markup.deleteHighlight(active.highlight.id)}
          onClose={markup.closeEditPopup}
        />
      ) : null}

      {toast ? (
        <div
          role="status"
          className="pointer-events-none fixed left-1/2 z-[999] -translate-x-1/2 rounded-full border border-lib-border bg-lib-surface-strong px-[18px] py-2.5 text-[13px] font-semibold text-lib-text-strong shadow-xl"
          style={{ top: 'calc(env(safe-area-inset-top) + 64px)' }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  )
}

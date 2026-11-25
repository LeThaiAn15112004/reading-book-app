/**
 * Builds the phone reader's ONE `ReadingSurface` for the open book (spec 019, FR-020 – FR-023, research R9) and the
 * page element that renders it. This is the only place in `screens/Reader/phone/**` that branches on the book's
 * format (SC-009): marks and their store, place / progress, jumping, opening a mark, the selection, the Contents,
 * the Appearance sections and the renderer element.
 *
 * It runs the SAME core hooks as Desktop's `ReaderScreen` (`useReaderCore`, `useReaderAnnotations`, `useReaderTxt`,
 * `usePdfSelectionMenu`, `useReaderZoomControls`) and the same renderers; nothing is copied. Renderer props the phone
 * does not use (editing, undo / redo, translation, insert point, keyboard shortcuts) are left out (FR-022).
 *
 * Live values the renderers report (Markdown headings, the pending Markdown / TXT selection, the text percentage) are
 * kept in `phoneReaderChromeStore.live`, not in React state.
 */
import { useCallback, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { useParams } from 'react-router-dom'
import {
  CfiLocation,
  PageRectLocation,
  isShapeStyleKind,
  placeFor,
  type InteractionTool,
  type ReaderHighlightBase,
  type ZoomEdge,
} from '@core'
import { useAppTitle, useGlobalReadingPrefs, useOpenReading } from '../../../../components/chrome'
import {
  EpubRenderer,
  type EpubPagePointerEvent,
  type EpubRendererApi,
  type EpubTocItem,
} from '../../../../components/reader/renderers/epub'
import { PdfRenderer, type PdfRendererApi } from '../../../../components/reader/renderers/pdf'
import { TxtRenderer, type TxtRendererApi, type TxtSelectionInfo } from '../../../../components/reader/renderers/txt'
import { MdRenderer, type MdRendererApi } from '../../../../components/reader/renderers/md'
import { leaveBookOpening } from '../../../../hooks/reader/readerOpeningStore'
import { useT } from '../../../../i18n'
import { ReaderZoomViewport } from '../../components/chrome/ReaderZoomViewport'
import { useHighlightsStore } from '../../logic/highlights/highlightsStore'
import { usePdfHighlightsStore } from '../../logic/pdfHighlights/pdfHighlightsStore'
import { useMdHighlightsStore } from '../../logic/mdHighlights/mdHighlightsStore'
import { useTxtDocumentStore } from '../../logic/txtDocument/txtDocumentStore'
import { usePdfSelectionMenu } from '../../logic/hooks/usePdfSelectionMenu'
import { useReaderTxt } from '../../logic/hooks/useReaderTxt'
import { useReaderZoomControls } from '../../logic/hooks/useReaderZoomControls'
import { MD_HEADING_HREF, mdInitialPointFor, mdSourceFor, mdTocFromHeadings, txtInitialOffsetFor } from '../../logic/reader-core/derivations'
import { readingStyleFor } from '../../logic/reader-core/reading-style'
import { useOpeningPositionNote } from '../../logic/reader-core/useOpeningPositionNote'
import { useReaderAnnotations } from '../../logic/reader-core/useReaderAnnotations'
import { useReaderCore } from '../../logic/reader-core/useReaderCore'
import { useTxtOpeningReport } from '../../logic/reader-core/useTxtOpeningReport'
import { currentChapterName, formatPlaceDetail } from '../../logic/readerPlace'
import { usePhoneReaderChromeStore } from './phoneReaderChromeStore'
import type { ActiveMark, MarkKind, ReadingSurface, SurfaceFormat, SurfaceSelection, SurfaceView } from './readingSurface'
import { SELECTION_STABLE_MS, useLiveSelection } from '../components/useLiveSelection'

/** The phone has no Hand tool: the page scrolls and selects natively. */
const TOOL: InteractionTool = 'select'
const NO_TOC: readonly EpubTocItem[] = []
const NO_MARKS: readonly ReaderHighlightBase[] = []

/** What the page tells the phone chrome (wired by the screen to the gestures and the chrome store). */
export interface SurfacePageEvents {
  /** A tap on blank page (not a mark, a link or a selection), as the renderer saw it. */
  onBlankTap: () => void
  /** A scrolling book moved. */
  onScrolled: () => void
  /** Page view EPUB: the frames' pointer stream (swipes). */
  onEpubPointer: (event: EpubPagePointerEvent) => void
  /** A store asked to hide (true) or show (false) the bars. */
  onChromeHidden: (hidden: boolean) => void
}

export interface SurfaceOpening {
  /** The renderer can mount (the book's bytes / text are ready). */
  mountable: boolean
  /** The one opening screen is shown (spec 017). */
  visible: boolean
  status: 'loading' | 'error'
  message: string | null
  title: string
  coverUrl: string | null | undefined
  opening: ReturnType<typeof useReaderCore>['book']['opening']
  retry: () => void
  fromBeginning: () => void
}

export interface UseReadingSurfaceResult {
  bookId: string | undefined
  title: string
  surface: ReadingSurface | null
  page: ReactNode
  opening: SurfaceOpening
  /** Leave the book (position flushed, opening stopped). */
  leave: () => void
  /** The reading style (font, size, spacing) the page uses. */
  readingStyle: ReturnType<typeof readingStyleFor>
  /** The renderer under the selection is markable and nothing is over it: watch for selections. */
  selectionWatch: boolean
  /** Per-book reading prefs + their setter, for the Appearance sheet. */
  prefs: ReturnType<typeof useReaderCore>['book']['prefs']
  setPrefs: (patch: Partial<ReturnType<typeof useReaderCore>['book']['prefs']>) => void
}

function formatOf(bookFormat: string | null | undefined): SurfaceFormat | null {
  return bookFormat === 'epub' || bookFormat === 'pdf' || bookFormat === 'md' || bookFormat === 'txt' ? bookFormat : null
}

/** Ids present after `create` that were not before (the one new mark). */
function newMarkId(before: readonly { id: string }[], after: readonly { id: string }[]): string | null {
  const known = new Set(before.map((h) => h.id))
  return after.find((h) => !known.has(h.id))?.id ?? null
}

export function useReadingSurface({
  events,
  surfaceRef,
  layersOpen,
}: {
  events: SurfacePageEvents
  /** The element around the page (selection watch, the EPUB frames). */
  surfaceRef: RefObject<HTMLDivElement | null>
  /** A layer is over the page (no selection watch while it is). */
  layersOpen: boolean
}): UseReadingSurfaceResult {
  const t = useT()
  const { bookId } = useParams<{ bookId: string }>()
  const { setDocumentSubtitle } = useAppTitle()
  const { ensureTab, updateBookTitle } = useOpenReading()
  const { prefs: globalPrefs } = useGlobalReadingPrefs()
  const globalPrefsRef = useRef(globalPrefs)
  globalPrefsRef.current = globalPrefs
  const eventsRef = useRef(events)
  eventsRef.current = events

  const epubApiRef = useRef<EpubRendererApi | null>(null)
  const pdfApiRef = useRef<PdfRendererApi | null>(null)
  const txtApiRef = useRef<TxtRendererApi | null>(null)
  const mdApiRef = useRef<MdRendererApi | null>(null)
  const activeToolRef = useRef<InteractionTool>(TOOL)

  const live = usePhoneReaderChromeStore((s) => s.live)
  const setLive = usePhoneReaderChromeStore((s) => s.setLive)
  const showToast = usePhoneReaderChromeStore((s) => s.showToast)
  const closeLayer = usePhoneReaderChromeStore((s) => s.closeLayer)
  const setToast = useCallback((message: string | null) => showToast(message), [showToast])
  const setChromeHidden = useCallback((hidden: boolean) => eventsRef.current.onChromeHidden(hidden), [])
  // A jump from a panel (Contents, a bookmark) closes the panels above the page.
  const closeFloating = useCallback(() => {
    closeLayer('toc')
    closeLayer('marks')
  }, [closeLayer])

  const { book, session, nav, isPdfSurface, isTxtSurface, isMdSurface } = useReaderCore({
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
  })
  const format = formatOf(book.bookFormat)

  const txt = useReaderTxt({ bookId, active: isTxtSurface, txtApiRef, setToast, setChromeHidden })
  const zoom = useReaderZoomControls({ bookId, activeToolRef })

  const mdSource = useMemo(() => mdSourceFor(isMdSurface, book.bookBytes), [isMdSurface, book.bookBytes])
  const mdToc = useMemo<EpubTocItem[]>(() => mdTocFromHeadings(live.mdHeadings), [live.mdHeadings])

  const txtReady = isTxtSurface && txt.loadStatus === 'ready'
  const txtLoadFailed = isTxtSurface && txt.loadStatus === 'error'
  const isTxtLoading = isTxtSurface && !txtLoadFailed && (!txtReady || book.sessionLoadStatus === 'loading')
  const txtInitialOffset = useMemo(
    () => txtInitialOffsetFor(book.resumeLocation, txt.getTextLength()),
    // Read once when the renderer mounts, like Desktop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book.resumeLocation, txtReady],
  )
  useTxtOpeningReport({
    isTxtSurface,
    txtReady,
    sessionReady: book.sessionLoadStatus === 'ready',
    txtLoadFailed,
    txtErrorCode: txt.errorCode,
    resumeLocation: book.resumeLocation,
    textLength: txt.getTextLength,
  })
  const mdInitialPoint = useMemo(
    () => mdInitialPointFor(book.resumeLocation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book.resumeLocation, isMdSurface],
  )

  // ── Place ────────────────────────────────────────────────────────────────────────────────────────────────────
  const pdfPageCurrent = nav.pdfNav?.pageCurrent ?? 0
  const pdfPageTotal = nav.pdfNav?.pageTotal ?? 0
  const epubSpineHrefs = useMemo(
    () => (book.isEpubSurface ? (epubApiRef.current?.getSpineHrefs() ?? []) : []),
    // Spine hrefs are fixed for the book's lifetime; read once its contents are known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book.isEpubSurface, nav.epubToc],
  )
  const chapterName = currentChapterName({
    format,
    epubToc: nav.epubToc,
    epubSpineHrefs,
    epubSpineIndex: nav.epubNav ? nav.epubNav.spineIndex : null,
    pdfToc: nav.pdfToc,
    pdfPage: pdfPageCurrent,
    mdHeadings: live.mdHeadings,
    mdActiveHeading: live.mdActiveHeading,
  })
  const view: SurfaceView = format === 'epub' || format === 'pdf' ? (book.prefs.viewMode === 'scroll' ? 'scroll' : 'page') : 'scroll'
  const progress =
    format === 'epub'
      ? (nav.epubNav?.progress ?? 0)
      : format === 'pdf'
        ? pdfPageTotal > 0
          ? pdfPageCurrent / pdfPageTotal
          : 0
        : live.textPercent / 100
  const place = placeFor(format ?? 'txt', view, {
    name: format === 'txt' ? book.bookTitle || null : chapterName,
    progress,
    sectionPage: nav.epubNav?.sectionPage,
    sectionPageTotal: nav.epubNav && nav.epubNav.pageCountReady !== false ? nav.epubNav.sectionPageTotal : 0,
    page: pdfPageCurrent,
    pageTotal: pdfPageTotal,
  })
  const placeDetail = formatPlaceDetail(place.detail, t)
  // New bookmarks: the book's own chapter name, else the place (FR-019).
  const chapterLabel = place.name ?? placeDetail

  // ── Marks ────────────────────────────────────────────────────────────────────────────────────────────────────
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
  /** PDF: only text markup is listed and painted; shapes, typewriter notes and attachments are not in this release. */
  const pdfTextHighlights = useMemo(
    () => pdfHighlights.highlights.filter((h) => !isShapeStyleKind(h.styleKind) && h.styleKind !== 'typewriter' && h.styleKind !== 'attachment'),
    [pdfHighlights.highlights],
  )

  /** The open format's mark store, as one shape. */
  const markStore = useMemo(() => {
    switch (format) {
      case 'epub':
        return {
          list: highlights.highlights as readonly ReaderHighlightBase[],
          active: highlights.activeHighlight?.highlight ?? null,
          lastColorHex: highlights.lastUsedColorHex,
          open: (id: string) => highlights.openHighlightById(id),
          jump: (id: string) => {
            const row = highlights.highlights.find((h) => h.id === id)
            if (row) void highlights.jumpToHighlight(row)
          },
          setColor: highlights.updateHighlightColor,
          setStyle: (id: string, kind: MarkKind) => highlights.updateHighlightStyleKind(id, kind),
          setNote: highlights.updateHighlightNote,
          remove: highlights.deleteHighlight,
          close: highlights.closeEditPopup,
          snapshot: () => useHighlightsStore.getState().highlights,
        }
      case 'pdf':
        return {
          list: pdfTextHighlights as readonly ReaderHighlightBase[],
          active: pdfHighlights.activeHighlight?.highlight ?? null,
          lastColorHex: pdfHighlights.lastUsedColorHex,
          open: (id: string) => pdfHighlights.openHighlight(id),
          jump: (id: string) => {
            const row = pdfHighlights.highlights.find((h) => h.id === id)
            if (row) pdfHighlights.jumpToHighlight(row)
          },
          setColor: pdfHighlights.updateHighlightColor,
          setStyle: (id: string, kind: MarkKind) => pdfHighlights.updateHighlightStyleKind(id, kind),
          setNote: pdfHighlights.updateHighlightNote,
          remove: pdfHighlights.deleteHighlight,
          close: pdfHighlights.closeEditPopup,
          snapshot: () => usePdfHighlightsStore.getState().highlights,
        }
      case 'md':
        return {
          list: mdHighlights.highlights as readonly ReaderHighlightBase[],
          active: mdHighlights.activeHighlight?.highlight ?? null,
          lastColorHex: mdHighlights.lastUsedColorHex,
          open: (id: string) => mdHighlights.openHighlight(id),
          jump: (id: string) => {
            const row = mdHighlights.highlights.find((h) => h.id === id)
            if (row) mdHighlights.jumpToHighlight(row)
          },
          setColor: mdHighlights.updateHighlightColor,
          setStyle: (id: string, kind: MarkKind) => mdHighlights.updateHighlightStyleKind(id, kind),
          setNote: mdHighlights.updateHighlightNote,
          remove: mdHighlights.deleteHighlight,
          close: mdHighlights.closeEditPopup,
          snapshot: () => useMdHighlightsStore.getState().highlights,
        }
      case 'txt':
        return {
          list: txt.highlights as readonly ReaderHighlightBase[],
          active: txt.markup.activeHighlight?.highlight ?? null,
          lastColorHex: useTxtDocumentStore.getState().lastUsedColorHex,
          open: (id: string) => txt.openHighlight(id),
          jump: (id: string) => {
            const row = txt.highlights.find((h) => h.id === id)
            if (row) txt.jumpToHighlight(row)
          },
          setColor: txt.markup.updateHighlightColor,
          setStyle: (id: string, kind: MarkKind) => txt.markup.updateHighlightStyleKind(id, kind),
          setNote: txt.markup.updateHighlightNote,
          remove: txt.markup.deleteHighlight,
          close: txt.markup.closeEditPopup,
          snapshot: () => useTxtDocumentStore.getState().doc?.highlights ?? [],
        }
      default:
        return null
    }
  }, [format, highlights, pdfHighlights, pdfTextHighlights, mdHighlights, txt])

  /** The mark opened with "Note": its panel opens on the note field. */
  const focusNoteIdRef = useRef<string | null>(null)
  const activeRow = markStore?.active ?? null
  const activeMark: ActiveMark | null = useMemo(() => {
    if (!markStore || !activeRow) return null
    const id = activeRow.id
    return {
      highlight: activeRow,
      focusNote: focusNoteIdRef.current === id,
      setColor: (hex) => markStore.setColor(id, hex),
      setStyle: (kind) => markStore.setStyle(id, kind),
      setNote: (note) => markStore.setNote(id, note),
      remove: () => markStore.remove(id),
      close: () => {
        focusNoteIdRef.current = null
        markStore.close()
      },
    }
  }, [markStore, activeRow])

  // ── Selection (one step, FR-015) ─────────────────────────────────────────────────────────────────────────────
  const markable = book.contentStatus === 'ready' && format !== null
  const selectionWatch = markable && format !== 'txt' && !layersOpen && !activeRow
  const domSelection = useLiveSelection(surfaceRef, selectionWatch)

  const clearSelection = useCallback(() => {
    if (format === 'txt') {
      txtApiRef.current?.clearSelection()
      setLive({ txtSelection: null })
      return
    }
    if (domSelection) domSelection.doc.getSelection()?.removeAllRanges()
    else window.getSelection()?.removeAllRanges()
    epubApiRef.current?.clearSelection()
    pdfApiRef.current?.clearSelection()
    pdfSelectionMenu.close()
    highlights.closeSelectionMenu()
    setLive({ mdSelection: null })
  }, [format, domSelection, setLive, pdfSelectionMenu, highlights])

  // TXT: the box reports its selection; it counts once unchanged for the stable delay.
  const txtSelectionTimer = useRef<number | null>(null)
  const onTxtSelectionChange = useCallback(
    (selection: TxtSelectionInfo | null) => {
      if (txtSelectionTimer.current !== null) window.clearTimeout(txtSelectionTimer.current)
      txtSelectionTimer.current = null
      if (!selection) {
        setLive({ txtSelection: null })
        return
      }
      txtSelectionTimer.current = window.setTimeout(() => setLive({ txtSelection: selection }), SELECTION_STABLE_MS)
    },
    [setLive],
  )
  useEffect(
    () => () => {
      if (txtSelectionTimer.current !== null) window.clearTimeout(txtSelectionTimer.current)
    },
    [],
  )

  /** Mark the pending selection with one style and colour; returns the new mark's id. */
  const markPending = useCallback(
    (kind: MarkKind, colorHex: string): string | null => {
      if (!markStore) return null
      const before = markStore.snapshot()
      switch (format) {
        case 'epub':
          highlights.createHighlight(colorHex, kind)
          break
        case 'pdf': {
          const menu = pdfSelectionMenu.menu
          if (!menu) return null
          usePdfHighlightsStore.setState({ lastUsedColorHex: colorHex })
          pdfHighlights.createFromSelection(menu.selection, kind)
          pdfSelectionMenu.close()
          break
        }
        case 'md': {
          const pending = live.mdSelection
          if (!pending) return null
          useMdHighlightsStore.setState({ lastUsedColorHex: colorHex })
          mdHighlights.createFromSelection(pending.selection, kind)
          break
        }
        case 'txt': {
          const pending = live.txtSelection
          if (!pending) return null
          useTxtDocumentStore.setState({ lastUsedColorHex: colorHex })
          txt.createFromSelection(pending, kind)
          break
        }
        default:
          return null
      }
      const id = newMarkId(before, markStore.snapshot())
      clearSelection()
      return id
    },
    [markStore, format, highlights, pdfSelectionMenu, pdfHighlights, live.mdSelection, live.txtSelection, mdHighlights, txt, clearSelection],
  )

  const pendingText =
    format === 'epub'
      ? (highlights.selectionMenu?.selection.text ?? null)
      : format === 'pdf'
        ? (pdfSelectionMenu.menu?.selection.text ?? null)
        : format === 'md'
          ? (live.mdSelection?.selection.text ?? null)
          : format === 'txt'
            ? (live.txtSelection?.text ?? null)
            : null
  const selection: SurfaceSelection | null =
    pendingText !== null && pendingText.trim()
      ? {
          text: pendingText,
          mark: (kind, colorHex) => void markPending(kind, colorHex),
          note: (colorHex) => {
            const id = markPending('highlight', colorHex)
            if (!id || !markStore) return
            focusNoteIdRef.current = id
            // The store has the new row on its next read; open it then.
            requestAnimationFrame(() => markStore.open(id))
          },
          close: clearSelection,
        }
      : null

  // ── Moving ───────────────────────────────────────────────────────────────────────────────────────────────────
  const atStart =
    format === 'epub'
      ? (nav.epubNav?.spineIndex ?? 0) <= 0 && (nav.epubNav?.sectionPage ?? 1) <= 1
      : format === 'pdf'
        ? pdfPageCurrent <= 1
        : true
  const atEnd =
    format === 'epub'
      ? !!nav.epubNav &&
        nav.epubNav.spineIndex >= nav.epubNav.spineLength - 1 &&
        nav.epubNav.sectionPage >= nav.epubNav.sectionPageTotal
      : format === 'pdf'
        ? pdfPageTotal > 0 && pdfPageCurrent >= pdfPageTotal
        : true

  /** PDF: the page shows fitted to the screen in Page view (FR-013a), fitted to the width in Scroll view. */
  const fitPdf = useCallback(() => {
    zoom.handleZoomLayoutPreset(view === 'page' ? 'fit-page' : 'fit-width')
  }, [zoom, view])

  const zoomEdge = useCallback((): ZoomEdge | null => {
    const el = zoom.zoomViewportRef.current?.getElement()
    if (!el || el.scrollWidth <= el.clientWidth + 1) return null
    return { left: el.scrollLeft <= 1, right: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 }
  }, [zoom.zoomViewportRef])

  const turn = useCallback(
    (direction: 'next' | 'prev'): boolean => {
      if (direction === 'next' ? atEnd : atStart) return false
      const zoomed = format === 'pdf' && zoomEdge() !== null
      nav.switchPage(direction === 'next')
      // FR-013b: the turned-to page opens fitted to the screen.
      if (zoomed) requestAnimationFrame(fitPdf)
      return true
    },
    [atEnd, atStart, format, zoomEdge, nav, fitPdf],
  )

  // PDF Page view: fitted to the screen once the pages are known and whenever the view changes.
  const pdfPagesKnown = format === 'pdf' && pdfPageTotal > 0
  useEffect(() => {
    if (!pdfPagesKnown || view !== 'page') return
    const id = requestAnimationFrame(fitPdf)
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfPagesKnown, view])

  const setPrefs = useCallback(
    (patch: Partial<typeof book.prefs>) => {
      book.prefsDirtyRef.current = true
      book.setPrefs((p) => ({ ...p, ...patch }))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book.prefsDirtyRef, book.setPrefs],
  )

  const toc = format === 'epub' ? nav.epubToc : format === 'pdf' ? nav.pdfToc : format === 'md' ? mdToc : NO_TOC

  const surface: ReadingSurface | null =
    format && markStore
      ? {
          format,
          view,
          setView:
            format === 'epub' || format === 'pdf'
              ? (next) => setPrefs({ viewMode: next === 'scroll' ? 'scroll' : 'paginated' })
              : undefined,
          place,
          placeText: { name: place.name, detail: placeDetail },
          progress,
          goToProgress: nav.goToProgress,
          turn: view === 'page' ? turn : undefined,
          toc,
          activeTocId:
            format === 'pdf'
              ? (nav.pdfActiveTocId ?? null)
              : format === 'md' && live.mdActiveHeading !== null
                ? `md-h-${live.mdActiveHeading}`
                : null,
          activeTocHref: format === 'epub' ? nav.epubNav?.href : undefined,
          goToToc: (item) => {
            if (item.href.startsWith(MD_HEADING_HREF)) {
              mdApiRef.current?.scrollToHeading(Number(item.href.slice(MD_HEADING_HREF.length)))
              return
            }
            nav.handleSelectTocItem(item)
          },
          bookmarks:
            format === 'txt'
              ? undefined
              : {
                  list: bookmarks.bookmarks,
                  isHere: bookmarks.isCurrentPlaceBookmarked,
                  toggle: bookmarks.toggleBookmark,
                  jump: (bookmark) => void bookmarks.jumpToBookmark(bookmark),
                  remove: bookmarks.deleteBookmarkById,
                },
          marks: markStore.list ?? NO_MARKS,
          openMark: (id) => markStore.open(id),
          jumpToMark: (id) => markStore.jump(id),
          activeMark,
          selection,
          clearSelection,
          lastColorHex: markStore.lastColorHex,
          appearance: { text: format !== 'pdf', view: format === 'epub' || format === 'pdf', zoom: format === 'pdf' },
          zoom:
            format === 'pdf'
              ? { percent: Math.round(zoom.viewZoom * 100), step: zoom.handleZoomStep, fit: fitPdf }
              : undefined,
          zoomEdge: format === 'pdf' && view === 'page' ? zoomEdge : undefined,
          isMarkAt:
            format === 'epub' ? (x, y) => Boolean(epubApiRef.current?.getHighlightAtPoint(x, y)) : undefined,
        }
      : null

  // ── Opening ──────────────────────────────────────────────────────────────────────────────────────────────────
  const leave = useCallback(() => {
    // Spec 017 (FR-001 / FR-002): an opening still running stops at once (system Back unmounts the route the same way).
    leaveBookOpening()
    void session.leaveToLibrary()
  }, [session])
  useOpeningPositionNote(book.opening, setToast)

  const loading =
    book.contentStatus === 'loading' ||
    book.contentStatus === 'idle' ||
    book.isEpubSessionLoading ||
    (isPdfSurface && book.sessionLoadStatus === 'loading') ||
    (isMdSurface && book.sessionLoadStatus === 'loading') ||
    isTxtLoading
  const openingFailed = book.opening?.outcome === 'failed'
  const failed = !openingFailed && (book.contentStatus === 'error' || txtLoadFailed)
  const mountable = !openingFailed && !failed && !loading
  // Spec 017 (US2): formats whose renderer reports its first page keep the opening screen until then.
  const marksFirstPage = format !== null
  const opening: SurfaceOpening = {
    mountable,
    visible: !mountable || (marksFirstPage && book.opening?.outcome === 'pending'),
    status: openingFailed || failed ? 'error' : 'loading',
    message: failed ? (txtLoadFailed ? txt.errorMessage : book.openErrorMessage) : null,
    title: book.bookTitle,
    coverUrl: book.coverUrl,
    opening: book.opening,
    retry: openingFailed
      ? () => {
          book.retryOpen()
          if (txtLoadFailed && bookId) txt.retryLoad(bookId)
        }
      : txtLoadFailed && bookId
        ? () => txt.retryLoad(bookId)
        : book.retryOpen,
    fromBeginning: book.openFromBeginning,
  }

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
  const blankTap = () => eventsRef.current.onBlankTap()
  const scrolled = () => eventsRef.current.onScrolled()

  // ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────
  const renderer =
    format === 'epub' && book.bookBytes ? (
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
        chromeHidden
        initialLocation={book.resumeLocation instanceof CfiLocation ? book.resumeLocation : undefined}
        onSelectionContextMenu={(x, y) => highlights.openSelectionMenuAtPoint(x, y)}
        // A tap or long press on a mark opens its sheet (Desktop: a click focuses, a right-click opens the menu).
        onHighlightContextMenu={(info) => highlights.openHighlightById(info.id)}
        onHighlightClick={(info) => highlights.openHighlightById(info.id)}
        onSurfaceClick={() => {
          highlights.dismissAnnotationUi()
          blankTap()
        }}
        onPagePointer={view === 'page' ? (event) => eventsRef.current.onEpubPointer(event) : undefined}
        interactionTool={TOOL}
        apiRef={epubApiRef}
        onNavState={nav.setEpubNav}
        onLocationChange={session.handleEpubLocationChange}
        onToc={nav.setEpubToc}
        onSections={nav.setEpubSections}
      />
    ) : format === 'pdf' && book.bookBytes ? (
      <PdfRenderer
        key={`${bookId}-${view}`}
        data={book.bookBytes}
        zoom={zoom.viewZoom}
        getScrollRoot={() => zoom.zoomViewportRef.current?.getElement() ?? null}
        initialPage={
          pdfPageCurrent > 0 ? pdfPageCurrent : book.resumeLocation instanceof PageRectLocation ? book.resumeLocation.page : 1
        }
        interactionTool={TOOL}
        pagesPerView={1}
        flow={view === 'page' ? 'paged' : 'scroll'}
        tapZones={false}
        onHandPanBy={zoom.handleHandPanBy}
        onSelectionContextMenu={(sel, x, y) => {
          pdfHighlights.dismissAnnotationUi()
          pdfSelectionMenu.open(sel, x, y)
        }}
        annotations={pdfTextHighlights}
        focusedAnnotationId={pdfHighlights.focusedHighlightId}
        onAnnotationClick={(hit) => {
          pdfSelectionMenu.close()
          pdfHighlights.openHighlight(hit.id)
        }}
        onAnnotationContextMenu={(hit) => {
          pdfSelectionMenu.close()
          pdfHighlights.openHighlight(hit.id)
        }}
        onBlankClick={() => {
          pdfHighlights.dismissAnnotationUi()
          blankTap()
        }}
        hiddenEmbeddedAnnotationIds={pdfHighlights.hiddenEmbeddedObjectIds}
        apiRef={pdfApiRef}
        onNavState={(state) => {
          nav.setPdfNav(state)
          session.handlePdfNavState(state)
        }}
        onOutline={nav.setPdfOutline}
      />
    ) : format === 'md' && bookId && mdSource ? (
      <MdRenderer
        key={bookId}
        bookId={bookId}
        source={mdSource.text}
        lossy={mdSource.lossy}
        margin={effectiveMargin}
        chromeHidden
        onMarginClick={blankTap}
        onProgress={(fraction) => setLive({ textPercent: Math.round(fraction * 100) })}
        initialPoint={mdInitialPoint}
        onLocation={session.handleMdLocation}
        onHeadings={(headings) => setLive({ mdHeadings: headings })}
        onActiveHeading={(index) => setLive({ mdActiveHeading: index })}
        onAnchorNotFound={() => setToast(t('reader.phone.screen.anchorNotFound'))}
        onOpenExternal={() => setToast(t('reader.phone.screen.externalLink'))}
        annotations={mdHighlights.highlights}
        focusedAnnotationId={mdHighlights.focusedHighlightId}
        onMarkupSelection={(sel, tool) => {
          setLive({ mdSelection: null })
          mdHighlights.commitMarkupSelection(sel, tool)
        }}
        onSelectionContextMenu={(sel, x, y) => {
          mdHighlights.dismissAnnotationUi()
          setLive({ mdSelection: { selection: sel, point: { x, y } } })
        }}
        onAnnotationClick={(hit) => {
          setLive({ mdSelection: null })
          mdHighlights.openHighlight(hit.id)
        }}
        onAnnotationContextMenu={(hit) => {
          setLive({ mdSelection: null })
          mdHighlights.openHighlight(hit.id)
        }}
        onBlankClick={() => {
          setLive({ mdSelection: null })
          mdHighlights.dismissAnnotationUi()
          blankTap()
        }}
        onScrolled={scrolled}
        apiRef={mdApiRef}
      />
    ) : format === 'txt' ? (
      <TxtRenderer
        key={bookId}
        text={txt.text}
        highlights={txt.highlights}
        focusedHighlightId={txt.focusedHighlightId}
        editable={false}
        markupTool={null}
        margin={effectiveMargin}
        chromeHidden
        initialOffset={txtInitialOffset}
        onSelectionChange={onTxtSelectionChange}
        onSelectionContextMenu={(sel) => onTxtSelectionChange(sel)}
        onMarkupSelection={(sel, tool) => txt.commitMarkupSelection(sel, tool)}
        onHighlightClick={(hit) => txt.openHighlight(hit.id)}
        onHighlightContextMenu={(hit) => txt.openHighlight(hit.id)}
        onBlankClick={() => {
          txt.dismissAnnotationUi()
          blankTap()
        }}
        onMarginClick={blankTap}
        onScrolled={scrolled}
        onLocation={(offset) => {
          const length = txt.getTextLength()
          if (length === 0) return
          setLive({ textPercent: Math.round((txtApiRef.current?.getProgress() ?? 0) * 100) })
          txt.setReadingOffset(offset)
          session.handleTxtLocation(offset, length)
        }}
        apiRef={txtApiRef}
      />
    ) : (
      <p className="m-0 px-6 py-10 text-center text-sm text-lib-muted" role="alert">
        {t('reader.phone.screen.formatUnsupported')}
      </p>
    )

  const page = mountable ? (
    <ReaderZoomViewport
      ref={zoom.zoomViewportRef}
      zoom={zoom.viewZoom}
      onZoomChange={zoom.setViewZoom}
      focusZoomEnabled={format === 'pdf'}
      mode={format === 'pdf' ? 'native' : 'transform'}
    >
      {renderer}
    </ReaderZoomViewport>
  ) : null

  return {
    bookId,
    title: book.bookTitle || t('common.untitled'),
    surface,
    page,
    opening,
    leave,
    readingStyle,
    selectionWatch,
    prefs: book.prefs,
    setPrefs,
  }
}

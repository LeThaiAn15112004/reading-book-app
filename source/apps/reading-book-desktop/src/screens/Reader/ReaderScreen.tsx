import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  CfiLocation,
  Location,
  TextOffsetLocation,
} from '@reading-book/domain'
import {
  fontFamilyCss,
  resolveReadingPrefs,
  type GlobalReadingPrefs,
  isFontFamily,
  isFontWeight,
  isTextAlign,
} from '@reading-book/shared/models'
import { libraryApi, overlayApi } from '../../bridge'
import {
  useAppTitle,
  useGlobalReadingPrefs,
  useOpenReading,
  useReaderChromeMenu,
} from '../../chrome'
import { ReaderShell } from '../../reader'
import {
  cfiRangesOverlap,
  EpubRenderer,
  type EpubNavState,
  type EpubRendererApi,
  type EpubTocItem,
} from '../../reader/renderers/epub'
import { toArrayBuffer } from '../../reader/renderers/epub/openEpubjs'
import {
  AaSettingsPanel,
  BookInfoDialog,
  BookmarkEdgeButton,
  CommentsDrawer,
  NoteModal,
  ReaderFooter,
  ReaderTopbar,
  ReaderZoomViewport,
  ReadingCanvas,
  HighlightRangeHandles,
  SelectionTooltip,
  type HighlightEditTarget,
  type ReaderZoomViewportHandle,
  type SelectionMenuAnchor,
  SignInfoPanel,
  TocEdgeButton,
  TocSidebar,
  TrashConfirmDialog,
  type ReadingPrefs,
  type SidebarTab,
} from './components'
import { FAKE_CHAPTERS } from './fakeReaderContent'
import {
  ZOOM_DEFAULT,
  clampZoom,
  stepZoom,
  zoomForLayoutPreset,
  zoomFactorFromWheelDelta,
  type ZoomLayoutPreset,
} from './readerZoom'
import {
  FAKE_SIGNATURES,
  HIGHLIGHT_COLOR_HEX,
  highlightColorFromHex,
  nextId,
  normalizeHighlightColorHex,
  type AnnotateTool,
  type InteractionTool,
  type HighlightHandleRect,
  type PendingSelection,
  type ReaderBookmark,
  type ReaderComment,
  type ReaderHighlight,
  type ESignStamp,
  type TypewriterMark,
} from './readerSession'
import {
  annotationDtoToReaderHighlight,
  epubJumpCfi,
  packReaderHighlightLocation,
} from './highlightPersistence'
import {
  bookmarkDtoToReaderBookmark,
  packReaderBookmarkLocation,
  readerBookmarkJumpLocation,
} from './bookmarkPersistence'
import {
  createAnnotationHistory,
  type AnnotationAction,
} from './annotationHistory'
import {
  useReadingSessionAutosave,
  type SessionLatestSnapshot,
} from './useReadingSessionAutosave'

const DEFAULT_PREFS: ReadingPrefs = {
  fontFamily: 'serif',
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 1.65,
  textAlign: 'justify',
  margin: 'normal',
  marginEnabled: true,
  layout: 'single',
  pageMode: 'paginated',
}

const FONT_SIZE_MIN = 12
const FONT_SIZE_MAX = 32

type SelectionMenuState = {
  selection: PendingSelection
  anchor: SelectionMenuAnchor
}

function selectionHasHighlight(
  selection: PendingSelection,
  highlights: ReaderHighlight[],
): boolean {
  if (selection.source === 'epub') {
    return highlights.some(
      (h) =>
        h.source === 'epub' && cfiRangesOverlap(h.cfiRange, selection.cfiRange),
    )
  }
  return highlights.some(
    (h) =>
      h.source === 'fake' &&
      h.chapterIndex === selection.chapterIndex &&
      h.paragraphIndex === selection.paragraphIndex,
  )
}

function findOverlappingHighlight(
  selection: PendingSelection,
  highlights: ReaderHighlight[],
): ReaderHighlight | undefined {
  if (selection.source === 'epub') {
    return highlights.find(
      (h) =>
        h.source === 'epub' && cfiRangesOverlap(h.cfiRange, selection.cfiRange),
    )
  }
  return highlights.find(
    (h) =>
      h.source === 'fake' &&
      h.chapterIndex === selection.chapterIndex &&
      h.paragraphIndex === selection.paragraphIndex,
  )
}

/** Place the floating toolbar next to the right-click cursor; fall back to selection. */
function anchorFromSelectionRect(
  selection: PendingSelection,
  cursor: SelectionMenuAnchor,
): SelectionMenuAnchor {
  if (Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
    return { x: cursor.x + 4, y: cursor.y + 4 }
  }
  const { rect } = selection
  if (!rect || rect.width <= 0) return cursor
  return {
    x: rect.left + rect.width / 2 - 120,
    y: Math.max(12, rect.top - 8),
  }
}

// #region agent log
function agentReaderDebugLog(
  location: string,
  message: string,
  hypothesisId: string,
  data: Record<string, unknown>,
) {
  fetch('http://127.0.0.1:7770/ingest/06bdb65b-2ef4-48e0-b72a-ef894477e9f4', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': 'e7d9d7',
    },
    body: JSON.stringify({
      sessionId: 'e7d9d7',
      runId: 'pre-fix',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
}
// #endregion

function clampFontSize(px: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, px))
}

function parseReadingLayoutMode(
  value: string | undefined,
): ReadingPrefs['layout'] | undefined {
  return value === 'single' || value === 'dual' || value === 'triple'
    ? value
    : undefined
}

function readingPrefsFromSession(
  session: Awaited<ReturnType<typeof overlayApi.getSessionState>>,
  fallback: ReadingPrefs,
): ReadingPrefs {
  if (!session) return fallback
  const resolved = resolveReadingPrefs(
    {
      fontFamily: isFontFamily(session.fontFamily) ? session.fontFamily : undefined,
      fontSize:
        typeof session.fontSize === 'number' && Number.isFinite(session.fontSize)
          ? clampFontSize(session.fontSize)
          : undefined,
      fontWeight: isFontWeight(Number(session.fontWeight))
        ? Number(session.fontWeight) as ReadingPrefs['fontWeight']
        : undefined,
      lineHeight:
        typeof session.lineHeight === 'number' &&
        Number.isFinite(session.lineHeight)
          ? Math.min(2.3, Math.max(1.3, session.lineHeight))
          : undefined,
      textAlign: isTextAlign(session.textAlign) ? session.textAlign : undefined,
      layout: parseReadingLayoutMode(session.layoutMode),
      pageMode: session.pageTurnMode === 'scroll' ? 'scroll' : undefined,
      marginEnabled: session.marginsEnabled,
      margin:
        session.marginPreset === 'narrow' ||
        session.marginPreset === 'wide' ||
        session.marginPreset === 'normal'
          ? session.marginPreset
          : undefined,
    },
    {
      ...fallback,
      margin: fallback.margin === 'off' ? 'normal' : fallback.margin,
      theme: 'night',
    },
  )
  return {
    ...resolved,
    margin: resolved.margin,
  }
}

function readingPrefsFromGlobal(globalPrefs: GlobalReadingPrefs): ReadingPrefs {
  const resolved = resolveReadingPrefs(null, globalPrefs)
  return {
    ...resolved,
    margin: resolved.margin,
  }
}

/** Ignore absent, legacy, malformed, or non-EPUB saved locations. */
function parseResumeLocation(raw: string | undefined): CfiLocation | undefined {
  if (!raw?.trim()) return undefined
  try {
    const location = Location.parse(raw)
    return location instanceof CfiLocation ? location : undefined
  } catch {
    return undefined
  }
}

function ReaderOpenStatus({
  status,
  message,
  onRetry,
  onBack,
}: {
  status: 'idle' | 'loading' | 'error'
  message?: string | null
  onRetry: () => void
  onBack: () => void
}) {
  const isError = status === 'error'
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        {!isError ? (
          <div
            className="size-10 shrink-0 animate-spin rounded-full border-[3px] border-current/20 border-t-current text-lib-accent"
            aria-hidden
          />
        ) : (
          <div
            className="flex size-11 items-center justify-center rounded-full border border-rose-400/35 bg-rose-500/10 text-lg font-bold text-rose-300"
            aria-hidden
          >
            !
          </div>
        )}
        <div>
          <h2 className="m-0 text-base font-semibold text-lib-text-strong">
            {isError ? 'Could not open this book' : 'Opening book...'}
          </h2>
          <p className="mt-2 mb-0 text-sm leading-relaxed text-lib-muted">
            {isError
              ? (message ??
                'The file may be missing, damaged, or not readable. Try again or re-import the book.')
              : 'Preparing the reader and loading the local file.'}
          </p>
        </div>
        {isError ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              className="h-10 cursor-pointer rounded-lg border border-lib-accent-ring bg-lib-accent-soft px-4 text-sm font-semibold text-lib-accent"
              type="button"
              onClick={onRetry}
            >
              Try again
            </button>
            <button
              className="h-10 cursor-pointer rounded-lg border border-lib-border bg-lib-surface px-4 text-sm font-semibold text-lib-text"
              type="button"
              onClick={onBack}
            >
              Back to Library
            </button>
          </div>
        ) : null}
      </div>
    </main>
  )
}

/** SCR-03 — session wiring; layout/chrome live in ReaderShell (T3.2). */
export function ReaderScreen() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
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

  const [bookTitle, setBookTitle] = useState('Untitled')
  const [coverUrl, setCoverUrl] = useState<string | undefined>()
  const [contentStatus, setContentStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [openErrorMessage, setOpenErrorMessage] = useState<string | null>(null)
  const [openAttempt, setOpenAttempt] = useState(0)
  const [bookBytes, setBookBytes] = useState<ArrayBuffer | null>(null)
  const [bookFormat, setBookFormat] = useState<string | null>(null)
  const [resumeLocation, setResumeLocation] = useState<CfiLocation | undefined>()
  const [sessionLoadStatus, setSessionLoadStatus] = useState<'loading' | 'ready'>(
    'loading',
  )
  const [chapterIndex, setChapterIndex] = useState(0)
  const [epubNav, setEpubNav] = useState<EpubNavState | null>(null)
  const [epubToc, setEpubToc] = useState<EpubTocItem[]>([])
  const epubApiRef = useRef<EpubRendererApi | null>(null)
  const zoomViewportRef = useRef<ReaderZoomViewportHandle | null>(null)
  const prefsDirtyRef = useRef(false)
  const sessionGenerationRef = useRef(0)
  const [viewZoom, setViewZoom] = useState(ZOOM_DEFAULT)
  const viewZoomRef = useRef(viewZoom)
  viewZoomRef.current = viewZoom

  useEffect(() => {
    setViewZoom(ZOOM_DEFAULT)
  }, [bookId])

  const getLatestSessionSnapshot = useCallback((): SessionLatestSnapshot | null => {
    const api = epubApiRef.current
    const readingPrefs = prefsRef.current
    const location = api?.getCurrentLocation()
    const nav = api?.getNavState()
    return {
      location,
      meta: {
        label: nav?.label,
        percent: Math.round((nav?.progress ?? 0) * 100),
      },
      theme: prefsDirtyRef.current
        ? {
            fontSize: readingPrefs.fontSize,
            fontFamily: readingPrefs.fontFamily,
            fontWeight: String(readingPrefs.fontWeight),
            lineHeight: readingPrefs.lineHeight,
            textAlign: readingPrefs.textAlign,
            layoutMode: readingPrefs.layout,
            pageTurnMode: readingPrefs.pageMode,
            marginsEnabled: readingPrefs.marginEnabled,
            marginPreset: readingPrefs.margin,
            isLandscape: readingPrefs.layout !== 'single',
          }
        : {},
    }
  }, [])

  const { noteLocation, noteSettingsChange, flush: flushSession } =
    useReadingSessionAutosave({
    bookId,
    getLatest: getLatestSessionSnapshot,
    })

  const handleEpubLocationChange = useCallback(
    (location: CfiLocation) => {
      clearHighlightHandlesRef.current()
      const latest = getLatestSessionSnapshot()
      const readingPrefs = prefsRef.current
      const nav = epubApiRef.current?.getNavState()
      noteLocation(
        location,
        {
          label: latest?.meta.label ?? nav?.label,
          percent:
            latest?.meta.percent ??
            Math.round((nav?.progress ?? 0) * 100),
        },
        latest?.theme ?? {
          fontSize: readingPrefs.fontSize,
          fontFamily: readingPrefs.fontFamily,
          fontWeight: String(readingPrefs.fontWeight),
          lineHeight: readingPrefs.lineHeight,
          textAlign: readingPrefs.textAlign,
          layoutMode: readingPrefs.layout,
          pageTurnMode: readingPrefs.pageMode,
          marginsEnabled: readingPrefs.marginEnabled,
          marginPreset: readingPrefs.margin,
          isLandscape: readingPrefs.layout !== 'single',
        },
      )
    },
    [getLatestSessionSnapshot, noteLocation],
  )

  const leaveToLibrary = useCallback(async () => {
    await flushSession()
    navigate('/library')
  }, [flushSession, navigate])

  const [chromeHidden, setChromeHidden] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chapters')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_PREFS)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const [toast, setToast] = useState<string | null>(null)

  const handleFlashTimerRef = useRef<number | null>(null)
  const activeToolRef = useRef<AnnotateTool>('hand')
  /**
   * Toolbar Text Select locks the tool — no auto-revert to Hand.
   * Smart switch from Hand → Select leaves this false so margin/cancel
   * can return to Hand.
   */
  const selectLockedRef = useRef(false)
  const highlightsRef = useRef<ReaderHighlight[]>([])
  const highlightEditRef = useRef<HighlightEditTarget | null>(null)
  const annotationHistoryRef = useRef(createAnnotationHistory())
  const annotationShortcutsRef = useRef({
    undo: () => {},
    redo: () => {},
    deleteFocused: () => {},
  })
  const noteEditBaselineRef = useRef<ReaderHighlight | null>(null)
  const clearHighlightHandlesRef = useRef<() => void>(() => {})

  const [activeTool, setActiveTool] = useState<AnnotateTool>('hand')
  activeToolRef.current = activeTool
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState | null>(
    null,
  )
  const pendingSelection = selectionMenu?.selection ?? null
  const [highlightEdit, setHighlightEdit] = useState<HighlightEditTarget | null>(
    null,
  )
  highlightEditRef.current = highlightEdit
  const [handleRect, setHandleRect] = useState<HighlightHandleRect | null>(null)
  const [handleFlash, setHandleFlash] = useState(false)
  const [noteModalOpen, setNoteModalOpen] = useState(false)
  const [noteEditTarget, setNoteEditTarget] = useState<ReaderHighlight | null>(
    null,
  )
  const [commentTarget, setCommentTarget] = useState<{
    paragraphIndex: number
  } | null>(null)
  const [signOpen, setSignOpen] = useState(false)
  const [bookInfoOpen, setBookInfoOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)

  const [highlights, setHighlights] = useState<ReaderHighlight[]>([])
  highlightsRef.current = highlights

  /** Close color-edit panel and clear focused handles. */
  function dismissHighlightEditPanel() {
    setHighlightEdit(null)
    setHandleRect(null)
    setHandleFlash(false)
  }

  function clearHighlightHandles() {
    setHighlightEdit(null)
    setHandleRect(null)
    setHandleFlash(false)
  }
  clearHighlightHandlesRef.current = clearHighlightHandles

  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([])
  const [comments, setComments] = useState<ReaderComment[]>([])
  const [typewriterMarks, setTypewriterMarks] = useState<TypewriterMark[]>([])
  const [eSignStamps, setESignStamps] = useState<ESignStamp[]>([])

  // Reset in-memory overlays when switching books.
  useEffect(() => {
    setChapterIndex(0)
    setEpubNav(null)
    setEpubToc([])
    epubApiRef.current = null
    prefsDirtyRef.current = false
    setHighlights([])
    annotationHistoryRef.current.clear()
    setBookmarks([])
    setComments([])
    setTypewriterMarks([])
    setESignStamps([])
    setActiveTool('hand')
    selectLockedRef.current = false
    setSelectionMenu(null)
    clearHighlightHandles()
    setSidebarOpen(false)
    setSidebarTab('chapters')
    setSettingsOpen(false)
    setMoreOpen(false)
    setCommentTarget(null)
    setNoteModalOpen(false)
    setNoteEditTarget(null)
    setSignOpen(false)
    setBookInfoOpen(false)
    setTrashOpen(false)
    setChromeHidden(true)
    setBookBytes(null)
    setBookFormat(null)
    setResumeLocation(undefined)
    setPrefs(readingPrefsFromGlobal(globalPrefsRef.current))
    setSessionLoadStatus('loading')
    setOpenErrorMessage(null)
    setCoverUrl(undefined)
    setContentStatus('idle')
  }, [bookId])

  useEffect(() => {
    if (!bookId) return
    ensureTab(bookId)
  }, [bookId, ensureTab])

  useEffect(() => {
    if (!bookId) {
      setBookTitle('Untitled')
      setCoverUrl(undefined)
      setBookBytes(null)
      setBookFormat(null)
      setResumeLocation(undefined)
      setSessionLoadStatus('ready')
      setOpenErrorMessage(null)
      setContentStatus('idle')
      return
    }
    const generation = ++sessionGenerationRef.current
    let cancelled = false
    setContentStatus('loading')
    setOpenErrorMessage(null)
    setBookBytes(null)
    setBookFormat(null)
    setResumeLocation(undefined)
    setSessionLoadStatus('loading')
    setCoverUrl(undefined)
    libraryApi
      .getBook(bookId)
      .then((book) => {
        if (cancelled) return
        const title = book?.title?.trim() || 'Untitled'
        setBookTitle(title)
        setCoverUrl(book?.coverUrl)
        updateBookTitle(bookId, title)
      })
      .catch(() => {
        if (!cancelled) {
          setBookTitle('Untitled')
          setCoverUrl(undefined)
        }
      })

    // T4.4: wait for saved CFI before mounting EPUB so the first display
    // resumes directly instead of briefly opening at the beginning.
    overlayApi
      .getSessionState(bookId)
      .then((session) => {
        if (cancelled || generation !== sessionGenerationRef.current) return
        setResumeLocation(parseResumeLocation(session?.lastReadLocation))
        setPrefs(readingPrefsFromSession(
          session,
          readingPrefsFromGlobal(globalPrefsRef.current),
        ))
      })
      .catch(() => {
        if (!cancelled && generation === sessionGenerationRef.current) {
          setResumeLocation(undefined)
          setPrefs(readingPrefsFromGlobal(globalPrefsRef.current))
        }
      })
      .finally(() => {
        if (!cancelled) setSessionLoadStatus('ready')
      })

    // T5.3: hydrate persisted highlights for this book.
    overlayApi
      .list(bookId)
      .then((rows) => {
        if (cancelled || generation !== sessionGenerationRef.current) return
        const mapped = rows
          .map(annotationDtoToReaderHighlight)
          .filter((h): h is ReaderHighlight => h != null)
        setHighlights(mapped)
      })
      .catch(() => {
        if (!cancelled && generation === sessionGenerationRef.current) {
          setHighlights([])
        }
      })

    // T5.5: hydrate persisted bookmarks for this book.
    overlayApi
      .listBookmarks(bookId)
      .then((rows) => {
        if (cancelled || generation !== sessionGenerationRef.current) return
        const mapped = rows
          .map(bookmarkDtoToReaderBookmark)
          .filter((b): b is ReaderBookmark => b != null)
        setBookmarks(mapped)
      })
      .catch(() => {
        if (!cancelled && generation === sessionGenerationRef.current) {
          setBookmarks([])
        }
      })

    // T3.4: open sandboxed bytes via Main allowlist (no FS path in renderer).
    libraryApi
      .openBookContent(bookId)
      .then((result) => {
        if (cancelled) return
        if (result.ok && result.data) {
          // Normalize IPC payload (ArrayBuffer or typed array) into a fresh buffer.
          setBookBytes(toArrayBuffer(result.data))
          setBookFormat(result.format ?? null)
          setContentStatus('ready')
          // Library Reading shelf — default status when user opens a book.
          void libraryApi.markAsReading(bookId).catch(() => {})
          return
        }
        setBookBytes(null)
        setBookFormat(null)
        setContentStatus('error')
        setOpenErrorMessage(
          result.errorMessage ?? 'Could not open this book file.',
        )
      })
      .catch(() => {
        if (cancelled) return
        setBookBytes(null)
        setBookFormat(null)
        setContentStatus('error')
        setOpenErrorMessage('Could not open this book file.')
      })

    return () => {
      cancelled = true
    }
  }, [bookId, openAttempt, updateBookTitle])

  useEffect(() => {
    setDocumentSubtitle(bookTitle)
  }, [bookTitle, setDocumentSubtitle])

  useEffect(() => {
    if (readerSearchRequestId === 0) return
    const q = readerSearchQuery.trim()
    if (!q) {
      setToast('Type something to search in this book.')
      return
    }
    setToast(`Search “${q}” — coming soon.`)
  }, [readerSearchRequestId, readerSearchQuery])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  const isEpubSurface =
    contentStatus === 'ready' && bookFormat === 'epub' && !!bookBytes
  const isEpubSessionLoading =
    isEpubSurface && sessionLoadStatus === 'loading'

  const chapter = FAKE_CHAPTERS[chapterIndex] ?? FAKE_CHAPTERS[0]
  const chapterLabel = chapter.title
  const pageCurrent = isEpubSurface
    ? (epubNav?.pageCurrent ?? 0)
    : chapterIndex + 1
  const pageTotal = isEpubSurface
    ? (epubNav?.pageTotal ?? 0)
    : FAKE_CHAPTERS.length
  const effectiveMargin = prefs.marginEnabled ? prefs.margin : 'off'
  /** Chapter key for bookmark ribbon — EPUB spine, else fake chapter index. */
  const bookmarkChapterIndex = isEpubSurface
    ? (epubNav?.spineIndex ?? 0)
    : chapterIndex
  const chapterBookmarked = bookmarks.some(
    (b) => b.chapterIndex === bookmarkChapterIndex,
  )
  const isSigned = FAKE_SIGNATURES.length > 0

  const readingStyle = useMemo(
    () =>
      ({
        '--reader-reading-size': `${prefs.fontSize}px`,
        '--reader-reading-line-height': String(prefs.lineHeight),
        '--reader-reading-weight': String(prefs.fontWeight),
        '--reader-font-reading': fontFamilyCss(prefs.fontFamily),
        '--reader-reading-align': prefs.textAlign,
      }) as CSSProperties,
    [
      prefs.fontSize,
      prefs.lineHeight,
      prefs.fontWeight,
      prefs.fontFamily,
      prefs.textAlign,
    ],
  )

  useEffect(() => {
    if (sessionLoadStatus !== 'ready' || !prefsDirtyRef.current) return
    noteSettingsChange()
  }, [noteSettingsChange, prefs, sessionLoadStatus])

  const closeFloating = useCallback(() => {
    setMoreOpen(false)
    setSettingsOpen(false)
    setCommentTarget(null)
  }, [])

  /**
   * Tap center clears transient reader UI without toggling the tools chrome.
   * The global menubar owns opening/closing tools via its Tools item.
   */
  function handleCenterTap() {
    closeFloating()
    closeSelectionMenu()
    dismissHighlightEditPanel()
    if (isEpubSurface) {
      epubApiRef.current?.clearSelection()
    } else {
      window.getSelection()?.removeAllRanges()
    }
    if (sidebarOpen) {
      setSidebarOpen(false)
    }
  }

  const toggleChrome = useCallback(() => {
    closeFloating()
    setChromeHidden((v) => !v)
  }, [closeFloating])

  useEffect(() => {
    registerReaderChrome({
      toolsOpen: !chromeHidden,
      openTools: () => {
        closeFloating()
        setChromeHidden(false)
      },
      closeTools: () => {
        closeFloating()
        setChromeHidden(true)
      },
      toggleTools: toggleChrome,
    })
    return () => registerReaderChrome(null)
  }, [chromeHidden, closeFloating, registerReaderChrome, toggleChrome])

  function goChapter(index: number) {
    const next = Math.min(Math.max(index, 0), FAKE_CHAPTERS.length - 1)
    setChapterIndex(next)
    setSidebarOpen(false)
    setSelectionMenu(null)
    clearHighlightHandles()
  }

  function switchPage(forward: boolean) {
    if (isEpubSurface) {
      const api = epubApiRef.current
      if (!api) return
      void (forward ? api.nextPage() : api.prevPage())
      return
    }

    setChapterIndex((index) =>
      forward
        ? Math.min(index + 1, FAKE_CHAPTERS.length - 1)
        : Math.max(index - 1, 0),
    )
    setSelectionMenu(null)
    clearHighlightHandles()
  }

  function goToPage(page: number) {
    if (isEpubSurface) {
      const api = epubApiRef.current
      if (!api) return
      void api.goToSpineIndex(page - 1)
      return
    }

    goChapter(page - 1)
  }

  function setViewZoomCentered(next: number) {
    const clamped = clampZoom(next)
    setViewZoom(clamped)
    requestAnimationFrame(() => {
      const el = zoomViewportRef.current?.getElement()
      if (!el) return
      el.scrollLeft = 0
      el.scrollTop = 0
    })
  }

  const handleZoomStep = useCallback((direction: 1 | -1) => {
    const viewport = zoomViewportRef.current
    const el = viewport?.getElement()
    if (!viewport || !el) {
      setViewZoom((z) => stepZoom(z, direction))
      return
    }
    const focal = {
      offsetX: el.clientWidth / 2,
      offsetY: el.clientHeight / 2,
    }
    viewport.applyFocalZoom(stepZoom(viewZoomRef.current, direction), focal)
  }, [])

  const handleZoomChange = useCallback((scale: number) => {
    const viewport = zoomViewportRef.current
    const el = viewport?.getElement()
    if (!viewport || !el) {
      setViewZoomCentered(scale)
      return
    }
    const focal = {
      offsetX: el.clientWidth / 2,
      offsetY: el.clientHeight / 2,
    }
    viewport.applyFocalZoom(clampZoom(scale), focal)
  }, [])

  const handleZoomLayoutPreset = useCallback((preset: ZoomLayoutPreset) => {
    const metrics = zoomViewportRef.current?.getFitMetrics()
    const next = metrics
      ? zoomForLayoutPreset(preset, metrics)
      : ZOOM_DEFAULT
    setViewZoomCentered(next)
  }, [])

  const handleHandPanBy = useCallback((dx: number, dy: number) => {
    const el = zoomViewportRef.current?.getElement()
    if (!el) return
    el.scrollLeft -= dx
    el.scrollTop -= dy
  }, [])

  const handleFocusZoomWheel = useCallback(
    (detail: {
      clientX: number
      clientY: number
      deltaY: number
    }): boolean => {
      if (activeToolRef.current !== 'hand') return false
      const viewport = zoomViewportRef.current
      if (!viewport) return false
      const focal = viewport.focalFromClient(detail.clientX, detail.clientY)
      if (!focal) return false
      const factor = zoomFactorFromWheelDelta(detail.deltaY)
      viewport.applyFocalZoom(viewZoomRef.current * factor, focal)
      return true
    },
    [],
  )

  function handleSelectTocItem(item: EpubTocItem) {
    if (!item.href) return
    closeFloating()
    setSelectionMenu(null)
    setSidebarOpen(false)
    const api = epubApiRef.current
    if (!api) return
    void api.goToHref(item.href)
  }

  function isReaderTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      el.isContentEditable
    )
  }

  // Page navigation uses only ArrowLeft/ArrowRight (window + EPUB iframes).
  useEffect(() => {
    // #region agent log
    agentReaderDebugLog(
      'source/apps/reading-book-desktop/src/screens/Reader/ReaderScreen.tsx:keynav-effect',
      'Reader keynav effect evaluated',
      'H1,H5',
      {
        contentStatus,
        isEpubSurface,
        bookFormat,
        hasBookBytes: !!bookBytes,
        hasApi: !!epubApiRef.current,
      },
    )
    // #endregion
    if (contentStatus !== 'ready') return

    function onKeyDown(e: KeyboardEvent) {
      const isDebugKey = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
      if (isDebugKey) {
        const target = e.target as HTMLElement | null
        // #region agent log
        agentReaderDebugLog(
          'source/apps/reading-book-desktop/src/screens/Reader/ReaderScreen.tsx:onKeyDown',
          'Reader keydown observed',
          'H1,H2,H3,H5',
          {
            key: e.key,
            code: e.code,
            altKey: e.altKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            defaultPrevented: e.defaultPrevented,
            targetTag: target?.tagName ?? null,
            targetEditable: target?.isContentEditable ?? false,
            contentStatus,
            isEpubSurface,
            hasApi: !!epubApiRef.current,
          },
        )
        // #endregion
      }
      if (isReaderTypingTarget(e.target)) return
      if (e.altKey) return

      // Annotation undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Y, Ctrl/Cmd+Shift+Z).
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase()
        if (key === 'z') {
          e.preventDefault()
          e.stopPropagation()
          if (e.shiftKey) annotationShortcutsRef.current.redo()
          else annotationShortcutsRef.current.undo()
          return
        }
        if (key === 'y') {
          e.preventDefault()
          e.stopPropagation()
          annotationShortcutsRef.current.redo()
          return
        }
      }

      // Quick delete focused highlight while Highlight tool is active.
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !e.ctrlKey &&
        !e.metaKey &&
        activeToolRef.current === 'highlight' &&
        highlightEditRef.current
      ) {
        e.preventDefault()
        e.stopPropagation()
        annotationShortcutsRef.current.deleteFocused()
        return
      }

      const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
      if (!isArrow) return

      const sectionNav = false
      const pageNav = isArrow && !e.ctrlKey && !e.metaKey
      if (!pageNav) return

      const forward = e.key === 'ArrowRight'

      if (isEpubSurface) {
        const api = epubApiRef.current
        // Bytes may be ready before epubjs finishes opening — don't swallow keys.
        if (!api) {
          // #region agent log
          agentReaderDebugLog(
            'source/apps/reading-book-desktop/src/screens/Reader/ReaderScreen.tsx:onKeyDown',
            'Reader keydown skipped because EPUB api is missing',
            'H3',
            { key: e.key, code: e.code, sectionNav, pageNav, forward },
          )
          // #endregion
          return
        }
        e.preventDefault()
        e.stopPropagation()
        // #region agent log
        agentReaderDebugLog(
          'source/apps/reading-book-desktop/src/screens/Reader/ReaderScreen.tsx:onKeyDown',
          'Reader dispatching EPUB navigation',
          'H3,H4',
          {
            key: e.key,
            code: e.code,
            sectionNav,
            pageNav,
            forward,
            navBefore: api.getNavState(),
          },
        )
        // #endregion
        void (forward ? api.nextPage() : api.prevPage())
        return
      }

      e.preventDefault()
      e.stopPropagation()
      // #region agent log
      agentReaderDebugLog(
        'source/apps/reading-book-desktop/src/screens/Reader/ReaderScreen.tsx:onKeyDown',
        'Reader dispatching fake chapter navigation',
        'H2,H5',
        { key: e.key, code: e.code, forward, chapterIndex },
      )
      // #endregion
      setChapterIndex((i) => {
        const next = forward
          ? Math.min(i + 1, FAKE_CHAPTERS.length - 1)
          : Math.max(i - 1, 0)
        return next
      })
      setSelectionMenu(null)
    }

    // Capture so it wins over focused footer controls; also works when body has focus.
    window.addEventListener('keydown', onKeyDown, true)

    // EPUB pages live in iframes — their key events never reach `window`.
    const boundDocs = new Set<Document>()
    function bindEpubIframes() {
      let newlyBound = 0
      document.querySelectorAll('iframe').forEach((iframe) => {
        try {
          const doc = iframe.contentDocument
          if (!doc || boundDocs.has(doc)) return
          boundDocs.add(doc)
          newlyBound += 1
          doc.addEventListener('keydown', onKeyDown, true)
        } catch {
          // Ignore cross-origin frames.
        }
      })
      if (newlyBound > 0) {
        // #region agent log
        agentReaderDebugLog(
          'source/apps/reading-book-desktop/src/screens/Reader/ReaderScreen.tsx:bindEpubIframes',
          'Reader bound keydown listener to EPUB iframe documents',
          'H1',
          { newlyBound, totalBound: boundDocs.size },
        )
        // #endregion
      }
    }

    bindEpubIframes()
    const mo = new MutationObserver(bindEpubIframes)
    mo.observe(document.body, { childList: true, subtree: true })
    // epubjs swaps iframe docs on page turn; poll briefly so new docs get bound.
    const pollId = window.setInterval(bindEpubIframes, 500)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      mo.disconnect()
      window.clearInterval(pollId)
      boundDocs.forEach((doc) => {
        doc.removeEventListener('keydown', onKeyDown, true)
      })
      boundDocs.clear()
    }
  }, [contentStatus, isEpubSurface])

  // View zoom: Ctrl/Cmd + / − / 0 (Aa font-size stays on the settings panel).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return
      }
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        handleZoomStep(1)
        return
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        handleZoomStep(-1)
        return
      }
      if (e.key === '0') {
        e.preventDefault()
        setViewZoomCentered(ZOOM_DEFAULT)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleZoomStep])

  // When chrome hides, drop Settings / More so panels cannot linger off-screen.
  useEffect(() => {
    if (!chromeHidden) return
    setMoreOpen(false)
    setSettingsOpen(false)
  }, [chromeHidden])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return
      }

      if (highlightEdit) {
        e.preventDefault()
        dismissHighlightEditPanel()
        return
      }
      if (selectionMenu) {
        e.preventDefault()
        dismissPendingSelection()
        return
      }
      if (activeTool === 'select' || activeTool === 'highlight') {
        e.preventDefault()
        selectLockedRef.current = false
        setActiveTool('hand')
        clearHighlightHandles()
        return
      }
      if (settingsOpen || moreOpen) {
        e.preventDefault()
        setMoreOpen(false)
        setSettingsOpen(false)
        return
      }
      if (sidebarOpen) {
        e.preventDefault()
        setSidebarOpen(false)
        return
      }
      if (commentTarget) {
        e.preventDefault()
        setCommentTarget(null)
        return
      }
      if (!chromeHidden) {
        e.preventDefault()
        setChromeHidden(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    activeTool,
    chromeHidden,
    commentTarget,
    highlightEdit,
    moreOpen,
    selectionMenu,
    settingsOpen,
    sidebarOpen,
  ])

  useEffect(() => {
    return () => {
      if (handleFlashTimerRef.current != null) {
        window.clearTimeout(handleFlashTimerRef.current)
      }
    }
  }, [])

  function selectTool(tool: InteractionTool) {
    closeFloating()
    // Highlight button toggles off → Hand when already active.
    if (tool === 'highlight' && activeToolRef.current === 'highlight') {
      selectLockedRef.current = false
      setActiveTool('hand')
    } else {
      // Explicit toolbar pick locks Text Select until the user picks another tool.
      selectLockedRef.current = tool === 'select'
      setActiveTool(tool)
    }
    setSelectionMenu(null)
    clearHighlightHandles()
    setCommentTarget(null)
  }

  /** Smart Hand ↔ Select switches from the reading surface (not the toolbar). */
  function requestInteractionTool(tool: InteractionTool) {
    if (tool === 'hand') {
      // Manual Text Select stays latched until the toolbar (or Escape) exits it.
      if (selectLockedRef.current && activeToolRef.current === 'select') return
      selectLockedRef.current = false
    } else if (tool === 'select') {
      // Auto-switch from Hand — eligible for auto-revert.
      selectLockedRef.current = false
    }
    if (activeToolRef.current === tool) return
    setActiveTool(tool)
  }

  function flashHandleAt(rect: HighlightHandleRect | null) {
    if (!rect) return
    setHandleRect(rect)
    setHandleFlash(true)
    if (handleFlashTimerRef.current != null) {
      window.clearTimeout(handleFlashTimerRef.current)
    }
    handleFlashTimerRef.current = window.setTimeout(() => {
      setHandleFlash(false)
      handleFlashTimerRef.current = null
    }, 500)
  }

  /** Right-click on the active selection → floating toolbar (no mouseup auto-popup). */
  function openSelectionMenu(
    selection: PendingSelection,
    anchor: SelectionMenuAnchor,
  ) {
    if (
      activeTool === 'comment' ||
      activeTool === 'typewriter' ||
      activeTool === 'esign' ||
      activeTool === 'highlight'
    ) {
      // Highlight tool auto-applies — no selection context menu.
      return
    }
    clearHighlightHandles()
    setSelectionMenu({
      selection,
      anchor: anchorFromSelectionRect(selection, anchor),
    })
    setChromeHidden(false)
  }

  function closeSelectionMenu() {
    setSelectionMenu(null)
  }

  function clearActiveSelection() {
    if (isEpubSurface) {
      epubApiRef.current?.clearSelection()
    } else {
      window.getSelection()?.removeAllRanges()
    }
  }

  function dismissPendingSelection() {
    clearActiveSelection()
    closeSelectionMenu()
  }

  function handleSelectionDismiss() {
    if (highlightEdit) {
      dismissHighlightEditPanel()
      return
    }
    if (!selectionMenu) return
    dismissPendingSelection()
  }

  function rejectOverlappingHighlight(selection: PendingSelection) {
    const existing = findOverlappingHighlight(selection, highlights)
    clearActiveSelection()
    closeSelectionMenu()
    if (existing) {
      // Focus the existing mark instead of creating a duplicate/partial overlap.
      setHighlightEdit({
        id: existing.id,
        colorHex: existing.colorHex,
        selectedText: existing.selectedText,
        hasNote: Boolean(existing.note?.trim()),
        rect: selection.rect,
      })
      setHandleRect(selection.rect)
      setHandleFlash(false)
      setChromeHidden(false)
      setToast('Đoạn này đã được highlight rồi')
      return
    }
    flashHandleAt(selection.rect)
    setToast('Đoạn này đã được highlight rồi')
  }

  function persistHighlight(h: ReaderHighlight) {
    if (!bookId) return
    void overlayApi
      .addHighlight({
        bookId,
        id: h.id,
        location: packReaderHighlightLocation(h),
        selectedText: h.selectedText,
        colorHex: h.colorHex,
        note: h.note,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
      })
      .catch(() => {
        setToast('Could not save highlight.')
      })
  }

  function persistHighlightNote(id: string, note: string) {
    if (!bookId) return
    void overlayApi
      .updateHighlightNote({ bookId, id, note })
      .then((result) => {
        if (!result.ok) setToast('Could not save note.')
      })
      .catch(() => setToast('Could not save note.'))
  }

  function persistDeleteHighlight(id: string) {
    if (!bookId) return
    void overlayApi
      .deleteHighlight({ bookId, id })
      .then((result) => {
        if (!result.ok) setToast('Could not delete highlight.')
      })
      .catch(() => setToast('Could not delete highlight.'))
  }

  /** Re-apply a highlight into memory + SQLite without touching undo history. */
  function restoreHighlightQuiet(h: ReaderHighlight) {
    setHighlights((list) => [...list.filter((x) => x.id !== h.id), h])
    persistHighlight(h)
  }

  function removeHighlightQuiet(highlightId: string) {
    setHighlights((list) => list.filter((h) => h.id !== highlightId))
    if (highlightEditRef.current?.id === highlightId) {
      clearHighlightHandles()
    }
    setNoteEditTarget((prev) => {
      if (prev?.id === highlightId) {
        setNoteModalOpen(false)
        return null
      }
      return prev
    })
    persistDeleteHighlight(highlightId)
  }

  function undoAnnotation() {
    const action = annotationHistoryRef.current.undo()
    if (!action) return
    applyInverseAnnotation(action, 'undo')
  }

  function redoAnnotation() {
    const action = annotationHistoryRef.current.redo()
    if (!action) return
    applyInverseAnnotation(action, 'redo')
  }

  function applyInverseAnnotation(
    action: AnnotationAction,
    direction: 'undo' | 'redo',
  ) {
    if (action.kind === 'add') {
      if (direction === 'undo') removeHighlightQuiet(action.highlight.id)
      else restoreHighlightQuiet(action.highlight)
      return
    }
    if (action.kind === 'remove') {
      if (direction === 'undo') restoreHighlightQuiet(action.highlight)
      else removeHighlightQuiet(action.highlight.id)
      return
    }
    const target = direction === 'undo' ? action.before : action.after
    restoreHighlightQuiet(target)
    if (highlightEditRef.current?.id === target.id) {
      setHighlightEdit((prev) =>
        prev
          ? {
              ...prev,
              colorHex: target.colorHex,
              selectedText: target.selectedText,
              hasNote: Boolean(target.note?.trim()),
            }
          : prev,
      )
    }
  }

  function applyHighlight(
    colorHex: string,
    selection: PendingSelection | null = pendingSelection,
    options?: { fromTool?: boolean; note?: string },
  ) {
    if (!selection) return

    // Never create a duplicate / partial / full overlap on the same text.
    if (selectionHasHighlight(selection, highlightsRef.current)) {
      rejectOverlappingHighlight(selection)
      return
    }

    const normalized =
      normalizeHighlightColorHex(colorHex) ?? HIGHLIGHT_COLOR_HEX.yellow
    const color = highlightColorFromHex(normalized)
    const highlightId = nextId('hl')
    const now = new Date().toISOString()
    const note = options?.note?.trim() || undefined

    let created: ReaderHighlight
    if (selection.source === 'epub') {
      created = {
        source: 'epub',
        id: highlightId,
        cfiRange: selection.cfiRange,
        locationStart: selection.locationStart,
        locationEnd: selection.locationEnd,
        selectedText: selection.selectedText,
        color,
        colorHex: normalized,
        chapterIndex: selection.chapterIndex,
        note,
        createdAt: now,
        updatedAt: now,
      }
    } else {
      created = {
        source: 'fake',
        id: highlightId,
        chapterIndex: selection.chapterIndex,
        paragraphIndex: selection.paragraphIndex,
        selectedText: selection.selectedText,
        color,
        colorHex: normalized,
        note,
        createdAt: now,
        updatedAt: now,
      }
    }

    annotationHistoryRef.current.push({ kind: 'add', highlight: created })
    setHighlights((list) => [...list, created])
    persistHighlight(created)
    clearActiveSelection()
    closeSelectionMenu()

    // Highlight tool: one shot → Hand (no accidental chain highlights).
    if (options?.fromTool) {
      selectLockedRef.current = false
      setActiveTool('hand')
      clearHighlightHandles()
      return
    }

    // Selection-menu path: keep the mark focused for color/note tweaks.
    setHandleRect(selection.rect)
    setHandleFlash(false)
    setHighlightEdit({
      id: highlightId,
      colorHex: normalized,
      selectedText: selection.selectedText,
      hasNote: Boolean(options?.note?.trim()),
      rect: selection.rect,
    })
    setChromeHidden(false)
  }

  /**
   * Mouseup after a drag selection — no floating toolbar (right-click only).
   * Highlight tool still applies immediately on release.
   */
  function handleTextSelected(selection: PendingSelection) {
    const tool = activeToolRef.current
    if (tool === 'select') return
    if (tool !== 'highlight') return
    if (selectionHasHighlight(selection, highlightsRef.current)) {
      rejectOverlappingHighlight(selection)
      return
    }
    applyHighlight(HIGHLIGHT_COLOR_HEX.yellow, selection, { fromTool: true })
  }

  function handleHighlightMarkClick(mark: {
    id: string
    cfiRange: string
    colorHex: string
    rect: HighlightHandleRect
    click?: { x: number; y: number }
  }) {
    // Focus + floating toolbar only while Highlight tool is active.
    if (activeToolRef.current !== 'highlight') return
    const existing = highlightsRef.current.find((h) => h.id === mark.id)
    setSelectionMenu(null)
    setHighlightEdit({
      id: mark.id,
      colorHex: existing?.colorHex ?? mark.colorHex,
      selectedText: existing?.selectedText ?? '',
      hasNote: Boolean(existing?.note?.trim()),
      rect: mark.rect,
      click: mark.click,
    })
    setHandleRect(mark.rect)
    setHandleFlash(false)
    setChromeHidden(false)
  }

  function changeHighlightColor(highlightId: string, colorHex: string) {
    const normalized =
      normalizeHighlightColorHex(colorHex) ?? HIGHLIGHT_COLOR_HEX.yellow
    const color = highlightColorFromHex(normalized)
    const now = new Date().toISOString()
    const before = highlightsRef.current.find((h) => h.id === highlightId)
    if (!before) return
    const after = { ...before, color, colorHex: normalized, updatedAt: now }
    annotationHistoryRef.current.push({ kind: 'replace', before, after })
    setHighlights((list) =>
      list.map((h) => (h.id === highlightId ? after : h)),
    )
    persistHighlight(after)
    setHighlightEdit((prev) =>
      prev && prev.id === highlightId
        ? { ...prev, colorHex: normalized }
        : prev,
    )
  }

  function deleteHighlightById(highlightId: string) {
    const existing = highlightsRef.current.find((h) => h.id === highlightId)
    if (!existing) return
    annotationHistoryRef.current.push({ kind: 'remove', highlight: existing })
    setHighlights((list) => list.filter((h) => h.id !== highlightId))
    if (highlightEditRef.current?.id === highlightId) {
      clearHighlightHandles()
    } else {
      setHandleRect(null)
      setHandleFlash(false)
    }
    if (noteEditTarget?.id === highlightId) {
      setNoteEditTarget(null)
      setNoteModalOpen(false)
    }
    persistDeleteHighlight(highlightId)
  }

  function jumpToHighlight(h: ReaderHighlight) {
    setSidebarOpen(false)
    setChromeHidden(true)
    if (h.source === 'epub') {
      const cfi = epubJumpCfi(h)
      if (cfi) {
        void epubApiRef.current?.goToLocation(new CfiLocation(cfi)).catch(() => {
          setToast('Could not jump to highlight.')
        })
      }
      return
    }
    goChapter(h.chapterIndex)
  }

  function copyHighlightText(h: ReaderHighlight) {
    void navigator.clipboard
      ?.writeText(h.selectedText)
      .then(() => setToast('Copied.'))
      .catch(() => setToast('Could not copy.'))
  }

  function openHighlightNoteEditor(h: ReaderHighlight) {
    noteEditBaselineRef.current = h
    setNoteEditTarget(h)
    setNoteModalOpen(true)
    setChromeHidden(false)
  }

  /** Silent autosave for note text — does not close the modal or push undo. */
  function autosaveHighlightNote(content: string) {
    if (noteEditTarget) {
      const now = new Date().toISOString()
      const note = content.trim() || undefined
      const before = highlightsRef.current.find((h) => h.id === noteEditTarget.id)
      if (!before) return
      if ((before.note ?? '') === (note ?? '')) return
      const after = { ...before, note, updatedAt: now }
      setHighlights((list) =>
        list.map((h) => (h.id === noteEditTarget.id ? after : h)),
      )
      setNoteEditTarget(after)
      setHighlightEdit((prev) =>
        prev && prev.id === after.id
          ? { ...prev, hasNote: Boolean(note) }
          : prev,
      )
      persistHighlightNote(after.id, note ?? '')
      return
    }

    // Selection → create highlight with inline note (once).
    if (!pendingSelection) return
    applyHighlight(HIGHLIGHT_COLOR_HEX.yellow, pendingSelection, {
      note: content,
    })
    setNoteModalOpen(false)
  }

  function closeNoteModal() {
    const baseline = noteEditBaselineRef.current
    const current =
      baseline &&
      highlightsRef.current.find((h) => h.id === baseline.id)
    if (
      baseline &&
      current &&
      (baseline.note ?? '') !== (current.note ?? '')
    ) {
      annotationHistoryRef.current.push({
        kind: 'replace',
        before: baseline,
        after: current,
      })
    }
    noteEditBaselineRef.current = null
    setNoteModalOpen(false)
    setNoteEditTarget(null)
  }

  function removeHighlightForSelection() {
    if (!pendingSelection) return
    const existing = findOverlappingHighlight(pendingSelection, highlights)
    if (existing) {
      deleteHighlightById(existing.id)
    }
    setHandleRect(null)
    clearActiveSelection()
    closeSelectionMenu()
  }

  function stubSelectionAction(label: string) {
    closeSelectionMenu()
    setToast(`${label} — coming soon.`)
  }

  function openNoteFromSelection() {
    if (!pendingSelection) return
    const existing = findOverlappingHighlight(pendingSelection, highlights)
    if (existing) {
      openHighlightNoteEditor(existing)
      return
    }
    noteEditBaselineRef.current = null
    setNoteEditTarget(null)
    setNoteModalOpen(true)
  }

  annotationShortcutsRef.current = {
    undo: undoAnnotation,
    redo: redoAnnotation,
    deleteFocused: () => {
      const focused = highlightEditRef.current
      if (!focused || activeToolRef.current !== 'highlight') return
      deleteHighlightById(focused.id)
    },
  }

  function copySelection() {
    if (!pendingSelection) return
    void navigator.clipboard?.writeText(pendingSelection.selectedText)
    setToast('Copied.')
    clearActiveSelection()
    closeSelectionMenu()
  }

  function openCommentOnParagraph(targetChapterIndex: number, paragraphIndex: number) {
    setChapterIndex(targetChapterIndex)
    setCommentTarget({ paragraphIndex })
    setChromeHidden(false)
  }

  function submitComment(content: string) {
    if (!commentTarget) return
    setComments((list) => [
      ...list,
      {
        id: nextId('cmt'),
        chapterIndex,
        paragraphIndex: commentTarget.paragraphIndex,
        content,
        authorName: 'You',
        createdAt: new Date().toISOString(),
      },
    ])
    setToast('Comment saved.')
  }

  function persistSaveBookmark(b: ReaderBookmark) {
    if (!bookId) return
    void overlayApi
      .saveBookmark({
        bookId,
        id: b.id,
        locationRef: b.locationRef,
        label: b.label,
        createdAt: b.createdAt,
      })
      .then((result) => {
        if (!result.ok) setToast('Could not save bookmark.')
      })
      .catch(() => setToast('Could not save bookmark.'))
  }

  function persistDeleteBookmark(id: string) {
    if (!bookId) return
    void overlayApi
      .deleteBookmark({ bookId, id })
      .then((result) => {
        if (!result.ok) setToast('Could not delete bookmark.')
      })
      .catch(() => setToast('Could not delete bookmark.'))
  }

  function deleteBookmarkById(id: string) {
    setBookmarks((list) => list.filter((b) => b.id !== id))
    persistDeleteBookmark(id)
  }

  function jumpToBookmark(bookmark: ReaderBookmark) {
    setSidebarOpen(false)
    setChromeHidden(true)
    const location = readerBookmarkJumpLocation(bookmark)
    if (location instanceof CfiLocation) {
      void epubApiRef.current?.goToLocation(location).catch(() => {
        setToast('Could not jump to bookmark.')
      })
      return
    }
    goChapter(bookmark.chapterIndex)
  }

  function toggleBookmark() {
    const placeIndex = bookmarkChapterIndex
    if (chapterBookmarked) {
      const toRemove = bookmarks.filter((b) => b.chapterIndex === placeIndex)
      setBookmarks((list) =>
        list.filter((b) => b.chapterIndex !== placeIndex),
      )
      for (const b of toRemove) {
        persistDeleteBookmark(b.id)
      }
      setToast('Bookmark removed.')
      return
    }

    const epubLocation = epubApiRef.current?.getCurrentLocation()
    const location =
      epubLocation ??
      new TextOffsetLocation(0, `fake:${placeIndex}`)
    const createdAt = new Date().toISOString()
    const label =
      epubNav?.label?.trim() ||
      chapter.title?.trim() ||
      'Bookmark'
    const bookmark: ReaderBookmark = {
      id: nextId('bm'),
      locationRef: packReaderBookmarkLocation(location, placeIndex),
      chapterIndex: placeIndex,
      label,
      createdAt,
    }
    setBookmarks((list) => [...list, bookmark])
    persistSaveBookmark(bookmark)
    setToast('Bookmark added.')
  }

  function placeTypewriter(targetChapterIndex: number, xPct: number, yPct: number) {
    setTypewriterMarks((list) => [
      ...list,
      {
        id: nextId('tw'),
        chapterIndex: targetChapterIndex,
        xPct,
        yPct,
        text: '',
      },
    ])
  }

  function placeESign(targetChapterIndex: number, xPct: number, yPct: number) {
    setESignStamps((list) => [
      ...list,
      {
        id: nextId('es'),
        chapterIndex: targetChapterIndex,
        xPct,
        yPct,
        label: 'eSign',
      },
    ])
    setToast('eSign stamp placed.')
  }

  const drawerComments = commentTarget
    ? comments.filter(
        (c) =>
          c.chapterIndex === chapterIndex &&
          c.paragraphIndex === commentTarget.paragraphIndex,
      )
    : []

  const paragraphPreview =
    commentTarget != null
      ? (chapter.paragraphs[commentTarget.paragraphIndex] ?? '')
      : ''

  const themeShell = 'bg-lib-bg-deep text-lib-text [--reader-text:var(--lib-text)]'

  return (
    <ReaderShell
      themeClassName={themeShell}
      style={readingStyle}
      dataAttrs={{
        'data-content-status': contentStatus,
        'data-content-format': bookFormat ?? '',
        'data-content-bytes': bookBytes ? String(bookBytes.byteLength) : '0',
      }}
      edges={
        <>
          <TocEdgeButton
            onOpen={() => {
              closeFloating()
              setSidebarOpen(true)
              setSidebarTab('chapters')
            }}
          />
          <BookmarkEdgeButton
            active={chapterBookmarked}
            onToggle={() => {
              closeFloating()
              toggleBookmark()
            }}
          />
        </>
      }
      topbar={
        <ReaderTopbar
          chromeHidden={chromeHidden}
          moreOpen={moreOpen}
          settingsOpen={settingsOpen}
          activeTool={activeTool}
          onToggleMore={() => {
            if (chromeHidden) return
            setSettingsOpen(false)
            setMoreOpen((v) => !v)
          }}
          onToggleSettings={() => {
            if (chromeHidden) return
            setMoreOpen(false)
            setSettingsOpen((v) => !v)
          }}
          onSelectTool={selectTool}
          onOpenSign={() => {
            setSignOpen(true)
          }}
          onShare={() => {
            closeFloating()
            setToast('Share — not available yet.')
          }}
          onFavorites={() => {
            closeFloating()
            setToast('Added to Favorites (local stub).')
          }}
          onBookInfo={() => {
            closeFloating()
            setBookInfoOpen(true)
          }}
          onTrash={() => {
            closeFloating()
            setTrashOpen(true)
          }}
        />
      }
      footer={
        <ReaderFooter
          pageCurrent={pageCurrent}
          pageTotal={pageTotal}
          onPreviousPage={() => switchPage(false)}
          onNextPage={() => switchPage(true)}
          onGoToPage={goToPage}
          layout={prefs.layout}
          pageMode={prefs.pageMode}
          onLayoutChange={(layout) => {
            prefsDirtyRef.current = true
            setPrefs((p) => ({ ...p, layout }))
          }}
          onPageModeChange={(pageMode) => {
            prefsDirtyRef.current = true
            setPrefs((p) => ({ ...p, pageMode }))
          }}
          zoom={viewZoom}
          onZoomChange={handleZoomChange}
          onZoomStep={handleZoomStep}
          onZoomLayoutPreset={handleZoomLayoutPreset}
        />
      }
      overlays={
        <>
          <TocSidebar
            open={sidebarOpen}
            tab={sidebarTab}
            chapters={FAKE_CHAPTERS}
            chapterIndex={chapterIndex}
            bookmarkPlaceIndex={bookmarkChapterIndex}
            tocItems={isEpubSurface ? epubToc : undefined}
            activeTocHref={isEpubSurface ? epubNav?.href : undefined}
            bookmarks={bookmarks}
            highlights={highlights}
            comments={comments}
            onClose={() => setSidebarOpen(false)}
            onTabChange={setSidebarTab}
            onSelectChapter={goChapter}
            onSelectTocItem={handleSelectTocItem}
            onJumpBookmark={jumpToBookmark}
            onDeleteBookmark={deleteBookmarkById}
            onAddBookmark={() => {
              toggleBookmark()
              setSidebarTab('bookmarks')
            }}
            onJumpHighlight={jumpToHighlight}
            onEditHighlightNote={openHighlightNoteEditor}
            onCopyHighlight={copyHighlightText}
            onDeleteHighlight={(h) => deleteHighlightById(h.id)}
            onJumpComment={(ch, para) => {
              goChapter(ch)
              setCommentTarget({ paragraphIndex: para })
            }}
          />

          <AaSettingsPanel
            open={settingsOpen}
            prefs={prefs}
            theme={globalPrefs.theme}
            onClose={() => setSettingsOpen(false)}
            onChange={(patch) => {
              prefsDirtyRef.current = true
              setPrefs((p) => ({ ...p, ...patch }))
            }}
            onThemeChange={(theme) => setGlobalPrefs({ theme })}
          />

          <SelectionTooltip
            selection={pendingSelection}
            anchor={selectionMenu?.anchor ?? null}
            hasExistingHighlight={
              pendingSelection
                ? selectionHasHighlight(pendingSelection, highlights)
                : false
            }
            onHighlight={(hex) => applyHighlight(hex)}
            onNote={openNoteFromSelection}
            onCopy={copySelection}
            onSearch={() => stubSelectionAction('Search / Lookup')}
            onAskAi={() => stubSelectionAction('Ask AI / Explain')}
            onShare={() => stubSelectionAction('Share / Export Snippet')}
            onRemoveHighlight={removeHighlightForSelection}
            onDismiss={dismissPendingSelection}
            editTarget={highlightEdit}
            onChangeHighlightColor={changeHighlightColor}
            onEditNote={(highlightId) => {
              const existing = highlights.find((h) => h.id === highlightId)
              if (existing) openHighlightNoteEditor(existing)
            }}
            onRemoveEditHighlight={(highlightId) => {
              deleteHighlightById(highlightId)
            }}
            onDismissEdit={dismissHighlightEditPanel}
          />

          <HighlightRangeHandles
            rect={sidebarOpen || !highlightEdit ? null : handleRect}
            flash={handleFlash}
          />

          <NoteModal
            open={noteModalOpen}
            quote={
              noteEditTarget?.selectedText ??
              pendingSelection?.selectedText ??
              ''
            }
            initialContent={noteEditTarget?.note ?? ''}
            title={noteEditTarget ? 'Edit note' : 'Add note'}
            allowEmpty={!!noteEditTarget}
            onClose={closeNoteModal}
            onAutosave={autosaveHighlightNote}
          />

          <CommentsDrawer
            open={commentTarget !== null}
            chapterLabel={chapterLabel}
            paragraphPreview={paragraphPreview}
            comments={drawerComments}
            onClose={() => setCommentTarget(null)}
            onSubmit={submitComment}
          />

          <SignInfoPanel
            open={signOpen}
            isSigned={isSigned}
            signatures={FAKE_SIGNATURES}
            onClose={() => setSignOpen(false)}
          />

          <BookInfoDialog
            open={bookInfoOpen}
            bookId={bookId ?? 'unknown'}
            title={bookTitle}
            chapterLabel={chapterLabel}
            formatLabel={bookFormat?.toUpperCase() || 'EPUB'}
            coverUrl={coverUrl}
            isSigned={isSigned}
            onClose={() => setBookInfoOpen(false)}
          />

          <TrashConfirmDialog
            open={trashOpen}
            bookTitle={bookTitle}
            onCancel={() => setTrashOpen(false)}
            onConfirm={() => {
              setTrashOpen(false)
              setToast('Trash confirm — delete wiring comes later.')
              void leaveToLibrary()
            }}
          />

          {toast ? (
            <div className="pointer-events-none fixed top-6 left-1/2 z-[999] -translate-x-1/2 rounded-full border border-lib-border bg-lib-surface-strong px-[18px] py-2.5 text-[13px] font-semibold text-lib-text-strong shadow-xl">
              {toast}
            </div>
          ) : null}
        </>
      }
    >
      {contentStatus === 'loading' || contentStatus === 'idle' || isEpubSessionLoading ? (
        <ReaderOpenStatus
          status={contentStatus === 'ready' ? 'loading' : contentStatus}
          onRetry={() => setOpenAttempt((n) => n + 1)}
          onBack={() => {
            void leaveToLibrary()
          }}
        />
      ) : contentStatus === 'error' ? (
        <ReaderOpenStatus
          status="error"
          message={openErrorMessage}
          onRetry={() => setOpenAttempt((n) => n + 1)}
          onBack={() => {
            void leaveToLibrary()
          }}
        />
      ) : (
        <ReaderZoomViewport
          ref={zoomViewportRef}
          zoom={viewZoom}
          onZoomChange={setViewZoom}
          focusZoomEnabled={activeTool === 'hand'}
        >
          {bookFormat === 'epub' && bookBytes ? (
            <EpubRenderer
              data={bookBytes}
              coverUrl={coverUrl}
              theme={globalPrefs.theme}
              layout={prefs.layout}
              pageMode={prefs.pageMode}
              fontSize={prefs.fontSize}
              fontFamily={prefs.fontFamily}
              fontWeight={prefs.fontWeight}
              lineHeight={prefs.lineHeight}
              textAlign={prefs.textAlign}
              marginsEnabled={prefs.marginEnabled}
              marginPreset={prefs.margin}
              chromeHidden={chromeHidden}
              initialLocation={resumeLocation}
              onCenterTap={handleCenterTap}
              onSelectionContextMenu={openSelectionMenu}
              onTextSelected={handleTextSelected}
              onSelectionDismiss={handleSelectionDismiss}
              onHighlightMarkClick={handleHighlightMarkClick}
              interactionTool={
                activeTool === 'highlight'
                  ? 'highlight'
                  : activeTool === 'select'
                    ? 'select'
                    : 'hand'
              }
              onRequestInteractionTool={requestInteractionTool}
              onFocusZoomWheel={handleFocusZoomWheel}
              onHandPanBy={viewZoom > 1.01 ? handleHandPanBy : undefined}
              highlights={highlights.filter(
                (h): h is Extract<ReaderHighlight, { source: 'epub' }> =>
                  h.source === 'epub',
              )}
              apiRef={epubApiRef}
              onNavState={setEpubNav}
              onLocationChange={handleEpubLocationChange}
              onToc={setEpubToc}
            />
          ) : (
            <ReadingCanvas
              chapters={FAKE_CHAPTERS}
              chapter={chapter}
              chapterIndex={chapterIndex}
              margin={effectiveMargin}
              chromeHidden={chromeHidden}
              pageMode={prefs.pageMode}
              layout={prefs.layout}
              activeTool={activeTool}
              highlights={highlights}
              comments={comments}
              typewriterMarks={typewriterMarks}
              eSignStamps={eSignStamps}
              onCanvasBackgroundClick={handleCenterTap}
              onParagraphClick={openCommentOnParagraph}
              onSelectionContextMenu={openSelectionMenu}
              onTextSelected={handleTextSelected}
              onSelectionDismiss={handleSelectionDismiss}
              onHighlightClick={(hl, rect, click) =>
                handleHighlightMarkClick({
                  id: hl.id,
                  cfiRange: '',
                  colorHex: hl.colorHex,
                  rect,
                  click,
                })
              }
              onRequestInteractionTool={requestInteractionTool}
              onHandPanBy={viewZoom > 1.01 ? handleHandPanBy : undefined}
              onPlaceTypewriter={placeTypewriter}
              onPlaceESign={placeESign}
              onTypewriterChange={(id, text) =>
                setTypewriterMarks((list) =>
                  list.map((m) => (m.id === id ? { ...m, text } : m)),
                )
              }
            />
          )}
        </ReaderZoomViewport>
      )}
    </ReaderShell>
  )
}

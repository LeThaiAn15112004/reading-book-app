import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { libraryApi } from '../../bridge'
import { useAppTitle, useGlobalReadingPrefs, useOpenReading, fontFamilyCss } from '../../chrome'
import { ReaderShell } from '../../reader'
import {
  EpubRenderer,
  type EpubNavState,
  type EpubRendererApi,
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
  ReadingCanvas,
  SelectionTooltip,
  SignInfoPanel,
  TocEdgeButton,
  TocSidebar,
  TrashConfirmDialog,
  type ReadingPrefs,
  type SidebarTab,
} from './components'
import {
  chapterLocationLabel,
  FAKE_CHAPTERS,
} from './fakeReaderContent'
import {
  FAKE_SIGNATURES,
  nextId,
  type AnnotateTool,
  type HighlightColor,
  type PendingSelection,
  type ReaderBookmark,
  type ReaderComment,
  type ReaderHighlight,
  type ReaderNote,
  type ESignStamp,
  type TypewriterMark,
} from './readerSession'

const DEFAULT_PREFS: ReadingPrefs = {
  fontSize: 18,
  lineHeight: 1.65,
  margin: 'normal',
  marginEnabled: true,
  layout: 'single',
  pageMode: 'paginated',
}

const FONT_SIZE_MIN = 12
const FONT_SIZE_MAX = 32
const FONT_SIZE_STEP = 2
const FONT_SIZE_DEFAULT = DEFAULT_PREFS.fontSize

function clampFontSize(px: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, px))
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
  const { prefs: globalPrefs } = useGlobalReadingPrefs()

  const [bookTitle, setBookTitle] = useState('Untitled')
  const [coverUrl, setCoverUrl] = useState<string | undefined>()
  const [contentStatus, setContentStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [bookBytes, setBookBytes] = useState<ArrayBuffer | null>(null)
  const [bookFormat, setBookFormat] = useState<string | null>(null)
  const [chapterIndex, setChapterIndex] = useState(0)
  const [epubNav, setEpubNav] = useState<EpubNavState | null>(null)
  const epubApiRef = useRef<EpubRendererApi | null>(null)
  const [chromeHidden, setChromeHidden] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chapters')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_PREFS)
  const [toast, setToast] = useState<string | null>(null)

  const [activeTool, setActiveTool] = useState<AnnotateTool>(null)
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null)
  const [noteModalOpen, setNoteModalOpen] = useState(false)
  const [commentTarget, setCommentTarget] = useState<{
    paragraphIndex: number
  } | null>(null)
  const [signOpen, setSignOpen] = useState(false)
  const [bookInfoOpen, setBookInfoOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)

  const [highlights, setHighlights] = useState<ReaderHighlight[]>([])
  const [notes, setNotes] = useState<ReaderNote[]>([])
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([])
  const [comments, setComments] = useState<ReaderComment[]>([])
  const [typewriterMarks, setTypewriterMarks] = useState<TypewriterMark[]>([])
  const [eSignStamps, setESignStamps] = useState<ESignStamp[]>([])

  // Reset in-memory overlays when switching books.
  useEffect(() => {
    setChapterIndex(0)
    setEpubNav(null)
    epubApiRef.current = null
    setHighlights([])
    setNotes([])
    setBookmarks([])
    setComments([])
    setTypewriterMarks([])
    setESignStamps([])
    setActiveTool(null)
    setPendingSelection(null)
    setCommentTarget(null)
    setChromeHidden(true)
    setBookBytes(null)
    setBookFormat(null)
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
      setContentStatus('idle')
      return
    }
    let cancelled = false
    setContentStatus('loading')
    setBookBytes(null)
    setBookFormat(null)
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
        setToast(result.errorMessage ?? 'Could not open this book file.')
      })
      .catch(() => {
        if (cancelled) return
        setBookBytes(null)
        setBookFormat(null)
        setContentStatus('error')
        setToast('Could not open this book file.')
      })

    return () => {
      cancelled = true
    }
  }, [bookId, updateBookTitle])

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

  const chapter = FAKE_CHAPTERS[chapterIndex] ?? FAKE_CHAPTERS[0]
  const chapterLabel = chapter.title
  const locationLabel =
    isEpubSurface && epubNav
      ? epubNav.label
      : chapterLocationLabel(chapterIndex)
  const pageCurrent = isEpubSurface
    ? (epubNav?.pageCurrent ?? 0)
    : chapterIndex + 1
  const pageTotal = isEpubSurface
    ? (epubNav?.pageTotal ?? 0)
    : FAKE_CHAPTERS.length
  const progress =
    isEpubSurface && epubNav
      ? epubNav.progress
      : FAKE_CHAPTERS.length <= 1
        ? 0
        : chapterIndex / (FAKE_CHAPTERS.length - 1)
  const zoomPercent = Math.round(
    (prefs.fontSize / FONT_SIZE_DEFAULT) * 100,
  )

  function bumpFontSize(delta: number) {
    setPrefs((p) => ({
      ...p,
      fontSize: clampFontSize(p.fontSize + delta),
    }))
  }

  function resetFontSize() {
    setPrefs((p) => ({ ...p, fontSize: FONT_SIZE_DEFAULT }))
  }

  const effectiveMargin = prefs.marginEnabled ? prefs.margin : 'off'
  const chapterBookmarked = bookmarks.some(
    (b) => b.chapterIndex === chapterIndex,
  )
  const isSigned = FAKE_SIGNATURES.length > 0

  const readingStyle = useMemo(
    () =>
      ({
        '--reader-reading-size': `${prefs.fontSize}px`,
        '--reader-reading-line-height': String(prefs.lineHeight),
        '--reader-reading-weight': String(globalPrefs.fontWeight),
        '--reader-font-reading': fontFamilyCss(globalPrefs.fontFamily),
        '--reader-reading-align': globalPrefs.textAlign,
      }) as CSSProperties,
    [
      prefs.fontSize,
      prefs.lineHeight,
      globalPrefs.fontWeight,
      globalPrefs.fontFamily,
      globalPrefs.textAlign,
    ],
  )

  function closeFloating() {
    setMoreOpen(false)
    setSettingsOpen(false)
  }

  function handleCanvasClick() {
    closeFloating()
    setPendingSelection(null)
    if (sidebarOpen) {
      setSidebarOpen(false)
      return
    }
    if (commentTarget) {
      setCommentTarget(null)
    }
    // Tools chrome is revealed via the down-arrow control, not canvas tap.
  }

  function toggleChrome() {
    closeFloating()
    setChromeHidden((v) => !v)
  }

  function goChapter(index: number) {
    const next = Math.min(Math.max(index, 0), FAKE_CHAPTERS.length - 1)
    setChapterIndex(next)
    setSidebarOpen(false)
    setPendingSelection(null)
  }

  function handleScrub(ratio: number) {
    if (isEpubSurface) {
      const api = epubApiRef.current
      const n = epubNav?.spineLength ?? api?.getSpineLength() ?? 0
      if (!api || n <= 0) return
      const idx = Math.round(ratio * Math.max(n - 1, 0))
      void api.goToSpineIndex(idx)
      return
    }
    const idx = Math.round(ratio * (FAKE_CHAPTERS.length - 1))
    goChapter(idx)
  }

  // Fake / non-EPUB: ArrowLeft/Right = chapter (EPUB binds its own keys).
  useEffect(() => {
    if (isEpubSurface) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return
      }
      e.preventDefault()
      setChapterIndex((i) => {
        const next =
          e.key === 'ArrowRight'
            ? Math.min(i + 1, FAKE_CHAPTERS.length - 1)
            : Math.max(i - 1, 0)
        return next
      })
      setPendingSelection(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isEpubSurface])

  // Zoom: Ctrl/Cmd + / − / 0 (works for EPUB + fake canvas).
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
        setPrefs((p) => ({
          ...p,
          fontSize: clampFontSize(p.fontSize + FONT_SIZE_STEP),
        }))
        return
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        setPrefs((p) => ({
          ...p,
          fontSize: clampFontSize(p.fontSize - FONT_SIZE_STEP),
        }))
        return
      }
      if (e.key === '0') {
        e.preventDefault()
        setPrefs((p) => ({ ...p, fontSize: FONT_SIZE_DEFAULT }))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function selectTool(tool: Exclude<AnnotateTool, null>) {
    closeFloating()
    setActiveTool((prev) => (prev === tool ? null : tool))
    setPendingSelection(null)
    if (tool !== 'comment') setCommentTarget(null)
  }

  function handleTextSelected(
    paragraphIndex: number,
    selectedText: string,
    rect: DOMRect,
  ) {
    if (
      activeTool !== 'highlight' &&
      activeTool !== 'note' &&
      activeTool !== null
    ) {
      return
    }
    // Allow selection menu whenever user selects text (or highlight/note mode).
    setPendingSelection({
      chapterIndex,
      paragraphIndex,
      selectedText,
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
    })
    setChromeHidden(false)
  }

  function applyHighlight(color: HighlightColor) {
    if (!pendingSelection) return
    setHighlights((list) => [
      ...list.filter(
        (h) =>
          !(
            h.chapterIndex === pendingSelection.chapterIndex &&
            h.paragraphIndex === pendingSelection.paragraphIndex
          ),
      ),
      {
        id: nextId('hl'),
        chapterIndex: pendingSelection.chapterIndex,
        paragraphIndex: pendingSelection.paragraphIndex,
        selectedText: pendingSelection.selectedText,
        color,
      },
    ])
    setPendingSelection(null)
    window.getSelection()?.removeAllRanges()
    setToast(`Highlight saved (${color}).`)
  }

  function openNoteFromSelection() {
    if (!pendingSelection) return
    setNoteModalOpen(true)
  }

  function saveNote(content: string) {
    if (!pendingSelection) return
    setNotes((list) => [
      ...list,
      {
        id: nextId('note'),
        chapterIndex: pendingSelection.chapterIndex,
        paragraphIndex: pendingSelection.paragraphIndex,
        selectedText: pendingSelection.selectedText,
        content,
      },
    ])
    setNoteModalOpen(false)
    setPendingSelection(null)
    window.getSelection()?.removeAllRanges()
    setToast('Note saved.')
  }

  function copySelection() {
    if (!pendingSelection) return
    void navigator.clipboard?.writeText(pendingSelection.selectedText)
    setToast('Copied.')
    setPendingSelection(null)
  }

  function openCommentOnParagraph(paragraphIndex: number) {
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

  function toggleBookmark() {
    if (chapterBookmarked) {
      setBookmarks((list) =>
        list.filter((b) => b.chapterIndex !== chapterIndex),
      )
      setToast('Bookmark removed.')
      return
    }
    setBookmarks((list) => [
      ...list,
      {
        id: nextId('bm'),
        chapterIndex,
        label: chapter.title,
      },
    ])
    setToast('Bookmark added.')
  }

  function placeTypewriter(xPct: number, yPct: number) {
    setTypewriterMarks((list) => [
      ...list,
      {
        id: nextId('tw'),
        chapterIndex,
        xPct,
        yPct,
        text: '',
      },
    ])
  }

  function placeESign(xPct: number, yPct: number) {
    setESignStamps((list) => [
      ...list,
      {
        id: nextId('es'),
        chapterIndex,
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
      chromeHidden={chromeHidden}
      onToggleChrome={toggleChrome}
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
            setSettingsOpen(false)
            setMoreOpen((v) => !v)
          }}
          onToggleSettings={() => {
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
          chromeHidden={chromeHidden}
          locationLabel={locationLabel}
          pageCurrent={pageCurrent}
          pageTotal={pageTotal}
          progress={progress}
          onScrub={handleScrub}
          zoomPercent={zoomPercent}
          onZoomOut={() => bumpFontSize(-FONT_SIZE_STEP)}
          onZoomIn={() => bumpFontSize(FONT_SIZE_STEP)}
          onZoomReset={resetFontSize}
        />
      }
      overlays={
        <>
          <TocSidebar
            open={sidebarOpen}
            tab={sidebarTab}
            chapters={FAKE_CHAPTERS}
            chapterIndex={chapterIndex}
            bookmarks={bookmarks}
            notes={notes}
            highlights={highlights}
            comments={comments}
            onClose={() => setSidebarOpen(false)}
            onTabChange={setSidebarTab}
            onSelectChapter={goChapter}
            onJumpBookmark={goChapter}
            onDeleteBookmark={(id) =>
              setBookmarks((list) => list.filter((b) => b.id !== id))
            }
            onAddBookmark={() => {
              toggleBookmark()
              setSidebarTab('bookmarks')
            }}
            onJumpNote={goChapter}
            onJumpComment={(ch, para) => {
              goChapter(ch)
              setCommentTarget({ paragraphIndex: para })
            }}
          />

          <AaSettingsPanel
            open={settingsOpen}
            prefs={prefs}
            onClose={() => setSettingsOpen(false)}
            onChange={(patch) => setPrefs((p) => ({ ...p, ...patch }))}
          />

          <SelectionTooltip
            selection={pendingSelection}
            onHighlight={applyHighlight}
            onNote={openNoteFromSelection}
            onCopy={copySelection}
          />

          <NoteModal
            open={noteModalOpen}
            quote={pendingSelection?.selectedText ?? ''}
            onClose={() => setNoteModalOpen(false)}
            onSave={saveNote}
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
              navigate('/library')
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
      {contentStatus === 'ready' && bookFormat === 'epub' && bookBytes ? (
        <EpubRenderer
          data={bookBytes}
          theme={globalPrefs.theme}
          layout={prefs.layout}
          pageMode={prefs.pageMode}
          fontSize={prefs.fontSize}
          pageTurnEnabled={
            activeTool !== 'typewriter' && activeTool !== 'esign'
          }
          apiRef={epubApiRef}
          onNavState={setEpubNav}
        />
      ) : (
        <ReadingCanvas
          chapter={chapter}
          chapterIndex={chapterIndex}
          margin={effectiveMargin}
          pageMode={prefs.pageMode}
          layout={prefs.layout}
          activeTool={activeTool}
          highlights={highlights}
          comments={comments}
          typewriterMarks={typewriterMarks}
          eSignStamps={eSignStamps}
          onCanvasBackgroundClick={handleCanvasClick}
          onParagraphClick={openCommentOnParagraph}
          onTextSelected={handleTextSelected}
          onPlaceTypewriter={placeTypewriter}
          onPlaceESign={placeESign}
          onTypewriterChange={(id, text) =>
            setTypewriterMarks((list) =>
              list.map((m) => (m.id === id ? { ...m, text } : m)),
            )
          }
        />
      )}
    </ReaderShell>
  )
}

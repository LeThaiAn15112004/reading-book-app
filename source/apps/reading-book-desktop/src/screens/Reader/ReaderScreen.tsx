import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { libraryApi } from '../../bridge'
import { useAppTitle } from '../../chrome'
import {
  AaSettingsPanel,
  BookInfoDialog,
  BookmarkEdgeButton,
  ChromeRevealButton,
  CommentsDrawer,
  fontFamilyCss,
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
  theme: 'dark',
  fontSize: 18,
  fontFamily: 'serif',
  fontWeight: 400,
  lineHeight: 1.65,
  margin: 'normal',
  marginEnabled: true,
  layout: 'single',
  pageMode: 'scroll',
  textAlign: 'justify',
}

/** SCR-03 — full Reader UI shell (in-memory overlays; real EPUB later). */
export function ReaderScreen() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const {
    setDocumentSubtitle,
    readerSearchQuery,
    readerSearchRequestId,
  } = useAppTitle()

  const [bookTitle, setBookTitle] = useState('Untitled')
  const [chapterIndex, setChapterIndex] = useState(0)
  const [chromeHidden, setChromeHidden] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chapters')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
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
  }, [bookId])

  useEffect(() => {
    if (!bookId) {
      setBookTitle('Untitled')
      return
    }
    let cancelled = false
    libraryApi
      .getBook(bookId)
      .then((book) => {
        if (cancelled) return
        setBookTitle(book?.title?.trim() || 'Untitled')
      })
      .catch(() => {
        if (!cancelled) setBookTitle('Untitled')
      })
    return () => {
      cancelled = true
    }
  }, [bookId])

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

  const chapter = FAKE_CHAPTERS[chapterIndex] ?? FAKE_CHAPTERS[0]
  const chapterLabel = `${chapter.num}: ${chapter.title}`
  const locationLabel = chapterLocationLabel(chapterIndex)
  const progress =
    FAKE_CHAPTERS.length <= 1
      ? 0
      : chapterIndex / (FAKE_CHAPTERS.length - 1)

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

  function closeFloating() {
    setToolsOpen(false)
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
    const idx = Math.round(ratio * (FAKE_CHAPTERS.length - 1))
    goChapter(idx)
  }

  function selectTool(tool: Exclude<AnnotateTool, null>) {
    closeFloating()
    setToolsOpen(false)
    setActiveTool((prev) => (prev === tool ? null : tool))
    setPendingSelection(null)
    if (tool !== 'comment') setCommentTarget(null)
  }

  function clearTool() {
    setActiveTool(null)
    setPendingSelection(null)
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
        label: `${chapter.num}: ${chapter.title}`,
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

  const themeShell =
    prefs.theme === 'sepia'
      ? 'bg-[#16120e] text-[#e1cfb3] [--reader-text:#e1cfb3]'
      : prefs.theme === 'paper'
        ? 'bg-slate-100 text-slate-700 [--reader-text:#334155]'
        : 'bg-[#0f172a] text-slate-300 [--reader-text:#cbd5e1]'

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden font-[system-ui,'Segoe_UI',sans-serif] antialiased select-none ${themeShell}`}
      style={readingStyle}
    >
      <ChromeRevealButton
        expanded={!chromeHidden}
        onToggle={toggleChrome}
      />

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

      <ReaderTopbar
        chapterLabel={chapterLabel}
        chromeHidden={chromeHidden}
        toolsOpen={toolsOpen}
        moreOpen={moreOpen}
        settingsOpen={settingsOpen}
        activeTool={activeTool}
        onToggleTools={() => {
          setMoreOpen(false)
          setSettingsOpen(false)
          setToolsOpen((v) => !v)
        }}
        onToggleMore={() => {
          setToolsOpen(false)
          setSettingsOpen(false)
          setMoreOpen((v) => !v)
        }}
        onToggleSettings={() => {
          setToolsOpen(false)
          setMoreOpen(false)
          setSettingsOpen((v) => !v)
        }}
        onSelectTool={selectTool}
        onClearTool={clearTool}
        onOpenSign={() => {
          setToolsOpen(false)
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

      <ReaderFooter
        chromeHidden={chromeHidden}
        locationLabel={locationLabel}
        progress={progress}
        onScrub={handleScrub}
      />

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
        title={bookTitle}
        chapterLabel={chapterLabel}
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
        <div className="pointer-events-none fixed top-6 left-1/2 z-[999] -translate-x-1/2 rounded-full border border-slate-600/45 bg-slate-900/95 px-[18px] py-2.5 text-[13px] font-semibold text-slate-100 shadow-xl">
          {toast}
        </div>
      ) : null}
    </div>
  )
}

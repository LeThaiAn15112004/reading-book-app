import { useMemo, useState } from 'react'
import type {
  ReaderAnnotationStatus,
  ReaderBookmark,
  ReaderHighlight,
  ReaderTypewriterNote,
} from '@reading-book/shared/models'
import type { EpubTocItem } from '../../../../reader/renderers/epub'
import type { FakeChapter } from '../../logic'
import type {
  PagePreviewEntry,
  PreviewRequestPriority,
} from '../../logic/pagePreview/usePagePreviewStore'
import { NotesListPanel } from './NotesListPanel'
import {
  PageLayoutPanel,
  PageLayoutZoomControls,
  usePageLayoutGrid,
} from './PageLayoutPanel'
import {
  READER_FOOTER_HEIGHT_PX,
  SIDEBAR_RAIL_WIDTH_PX,
  SIDEBAR_TAB_LABEL,
} from './sidebarTabs'
import { readerChromeTopInset } from '../../../../reader/readerChromeLayout'

export type SidebarTab =
  | 'chapters'
  | 'bookmarks'
  | 'notes'
  | 'layout'
  | 'attachments'

type TocSidebarProps = {
  open: boolean
  tab: SidebarTab
  panelWidth: number
  isResizing?: boolean
  chromeHidden?: boolean
  onResizePointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void
  chapters: FakeChapter[]
  chapterIndex: number
  currentPlaceBookmarked?: boolean
  tocItems?: EpubTocItem[]
  activeTocHref?: string
  bookmarks: ReaderBookmark[]
  highlights: ReaderHighlight[]
  typewriterNotes: ReaderTypewriterNote[]
  onClose: () => void
  onSelectChapter: (index: number) => void
  onSelectTocItem?: (item: EpubTocItem) => void
  onJumpBookmark: (bookmark: ReaderBookmark) => void
  onDeleteBookmark: (id: string) => void
  onAddBookmark: () => void
  onJumpHighlight: (highlight: ReaderHighlight) => void
  onJumpTypewriterNote: (note: ReaderTypewriterNote) => void
  onToggleAnnotationChecked: (id: string, isChecked: boolean) => void
  onSetAnnotationStatus: (id: string, status: ReaderAnnotationStatus) => void
  onEditHighlightNote: (highlight: ReaderHighlight) => void
  onEditTypewriterContent: (id: string, content: string) => void
  onDeleteHighlight: (highlight: ReaderHighlight) => void
  onDeleteTypewriterNote: (id: string) => void
  onAnnotationTags?: () => void
  pageCurrent: number
  pageTotal: number
  onGoToPage: (page: number) => void
  pagePreviews: Map<number, PagePreviewEntry>
  onRequestPagePreview: (page: number, priority?: PreviewRequestPriority) => void
}

function noteCountForChapter(
  highlights: ReaderHighlight[],
  typewriterNotes: ReaderTypewriterNote[],
  chapterIndex: number,
): number {
  const highlightNotes = highlights.filter(
    (h) => h.chapterIndex === chapterIndex && Boolean(h.note?.trim()),
  ).length
  const textboxNotes = typewriterNotes.filter(
    (n) => n.chapterIndex === chapterIndex,
  ).length
  return highlightNotes + textboxNotes
}

function normalizeHref(href: string): string {
  return href.split('#')[0] ?? href
}

function tocItemIsActive(item: EpubTocItem, activeHref?: string): boolean {
  if (!activeHref || !item.href) return false
  return normalizeHref(item.href) === normalizeHref(activeHref)
}

function tocItemHasActiveDescendant(
  item: EpubTocItem,
  activeHref?: string,
): boolean {
  return item.children.some(
    (child) =>
      tocItemIsActive(child, activeHref) ||
      tocItemHasActiveDescendant(child, activeHref),
  )
}

function TocTree({
  items,
  activeHref,
  onSelect,
}: {
  items: EpubTocItem[]
  activeHref?: string
  onSelect: (item: EpubTocItem) => void
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {items.map((item) => {
        const active = tocItemIsActive(item, activeHref)
        const parentOfActive = tocItemHasActiveDescendant(item, activeHref)
        const level = Math.min(item.level, 4)
        const font =
          level === 0
            ? 'text-sm font-bold tracking-wide text-lib-text-strong'
            : level === 1
              ? 'text-[13px] font-semibold text-lib-text'
              : 'text-xs font-medium text-lib-muted'
        const spacing =
          level === 0 ? 'mt-2 first:mt-0' : level === 1 ? 'mt-1' : ''
        const indentStyle = { paddingLeft: `${12 + level * 14}px` }

        return (
          <li key={item.id} className={spacing}>
            <button
              className={`flex min-h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border-none py-2 pr-3 text-left transition-colors ${font} ${
                active
                  ? 'rounded-l-none border-l-[3px] border-lib-accent bg-lib-accent-soft text-lib-text-strong'
                  : parentOfActive
                    ? 'bg-lib-hint/70 text-lib-text-strong'
                    : 'bg-transparent hover:bg-lib-surface-hover'
              }`}
              style={indentStyle}
              type="button"
              aria-label={item.label}
              onClick={() => onSelect(item)}
            >
              <span className="min-w-0 truncate">{item.label}</span>
            </button>
            {item.children.length > 0 ? (
              <TocTree
                items={item.children}
                activeHref={activeHref}
                onSelect={onSelect}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export function TocSidebar({
  open,
  tab,
  panelWidth,
  isResizing = false,
  chromeHidden = true,
  onResizePointerDown,
  chapters,
  chapterIndex,
  currentPlaceBookmarked = false,
  tocItems,
  activeTocHref,
  bookmarks,
  highlights,
  typewriterNotes,
  onClose,
  onSelectChapter,
  onSelectTocItem,
  onJumpBookmark,
  onDeleteBookmark,
  onAddBookmark,
  onJumpHighlight,
  onJumpTypewriterNote,
  onToggleAnnotationChecked,
  onSetAnnotationStatus,
  onEditHighlightNote,
  onEditTypewriterContent,
  onDeleteHighlight,
  onDeleteTypewriterNote,
  onAnnotationTags,
  pageCurrent,
  pageTotal,
  onGoToPage,
  pagePreviews,
  onRequestPagePreview,
}: TocSidebarProps) {
  const hasRealToc = !!tocItems && tocItems.length > 0
  const pageLayoutGrid = usePageLayoutGrid()
  const [bookmarkQuery, setBookmarkQuery] = useState('')
  const filteredBookmarks = useMemo(() => {
    const q = bookmarkQuery.trim().toLowerCase()
    if (!q) return bookmarks
    return bookmarks.filter((b) => b.label.toLowerCase().includes(q))
  }, [bookmarks, bookmarkQuery])

  const chromeTopInset = readerChromeTopInset(chromeHidden)

  return (
    <aside
      className={`@container absolute z-[160] flex flex-col border-y border-r border-lib-border bg-lib-surface-strong shadow-lg ${
        isResizing
          ? ''
          : 'transition-[transform,top] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
      } ${
        open
          ? 'pointer-events-auto translate-x-0 border-l-0'
          : 'pointer-events-none -translate-x-full border-l'
      }`}
      style={{
        left: SIDEBAR_RAIL_WIDTH_PX,
        top: chromeTopInset,
        bottom: READER_FOOTER_HEIGHT_PX,
        width: panelWidth,
      }}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between gap-2 border-b border-lib-border-soft px-3 py-2.5">
        <h2 className="m-0 min-w-0 flex-1 truncate text-[15px] font-semibold text-lib-text-strong">
          {SIDEBAR_TAB_LABEL[tab]}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {tab === 'layout' ? (
            <PageLayoutZoomControls
              zoomIn={pageLayoutGrid.zoomIn}
              zoomOut={pageLayoutGrid.zoomOut}
              canZoomIn={pageLayoutGrid.canZoomIn}
              canZoomOut={pageLayoutGrid.canZoomOut}
            />
          ) : null}
          <button
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-base text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-2.5">
          {tab === 'chapters' ? (
            hasRealToc ? (
              <TocTree
                items={tocItems}
                activeHref={activeTocHref}
                onSelect={(item) => onSelectTocItem?.(item)}
              />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {chapters.map((ch, i) => {
                  const badge = noteCountForChapter(highlights, typewriterNotes, i)
                  return (
                    <li key={ch.num}>
                      <button
                        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border-none px-3 py-3 text-left text-sm font-medium ${
                          i === chapterIndex
                            ? 'rounded-l-none border-l-[3px] border-lib-accent bg-lib-accent-soft pr-3 pl-[9px] text-lib-text-strong'
                            : 'bg-transparent text-lib-text hover:bg-lib-surface-hover'
                        }`}
                        type="button"
                        onClick={() => onSelectChapter(i)}
                      >
                        <span className="min-w-0">{ch.title}</span>
                        {badge > 0 ? (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-lib-accent-soft px-1.5 text-[11px] font-bold text-lib-accent">
                            {badge}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )
          ) : null}

          {tab === 'bookmarks' ? (
            <div className="flex flex-col gap-2.5">
              <button
                className="h-10 w-full cursor-pointer rounded-lg border border-lib-border bg-lib-accent-soft text-[13px] font-semibold text-lib-accent"
                type="button"
                onClick={onAddBookmark}
              >
                {currentPlaceBookmarked
                  ? 'Remove bookmark here'
                  : 'Bookmark this place'}
              </button>
              {bookmarks.length === 0 ? (
                <p className="m-0 px-4 py-6 text-center text-[13px] text-lib-faint">
                  No bookmarks yet
                </p>
              ) : (
                <>
                  <label className="relative block">
                    <span className="sr-only">Search bookmarks</span>
                    <input
                      className="h-9 w-full rounded-lg border border-lib-border bg-lib-input py-0 pr-3 pl-8 text-[13px] text-lib-text-strong outline-none placeholder:text-lib-faint focus:border-lib-accent"
                      type="search"
                      value={bookmarkQuery}
                      onChange={(e) => setBookmarkQuery(e.target.value)}
                      placeholder="Search bookmarks…"
                    />
                    <span
                      className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-lib-faint"
                      aria-hidden
                    >
                      🔍
                    </span>
                  </label>
                  {filteredBookmarks.length === 0 ? (
                    <p className="m-0 px-2 py-4 text-center text-[13px] text-lib-faint">
                      No matches
                    </p>
                  ) : (
                    filteredBookmarks.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-start gap-2 rounded-lg border border-lib-border-soft bg-lib-surface p-3"
                      >
                        <button
                          className="min-w-0 flex-1 cursor-pointer border-none bg-transparent p-0 text-left text-sm text-lib-text"
                          type="button"
                          onClick={() => onJumpBookmark(b)}
                        >
                          {b.label}
                        </button>
                        <button
                          className="cursor-pointer border-none bg-transparent px-1 text-xs text-lib-faint hover:text-red-400"
                          type="button"
                          aria-label="Delete bookmark"
                          onClick={() => onDeleteBookmark(b.id)}
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          ) : null}

          {tab === 'notes' ? (
            <NotesListPanel
              highlights={highlights}
              typewriterNotes={typewriterNotes}
              pageCurrent={pageCurrent}
              onGoToPage={onGoToPage}
              onJump={onJumpHighlight}
              onJumpTypewriterNote={onJumpTypewriterNote}
              onToggleChecked={onToggleAnnotationChecked}
              onSetStatus={onSetAnnotationStatus}
              onEditContent={(item) => {
                if (item.kind === 'highlight') {
                  onEditHighlightNote(item.highlight)
                  return
                }
                const next = window.prompt('Edit note content', item.content)
                if (next == null) return
                onEditTypewriterContent(item.id, next)
              }}
              onDelete={(item) => {
                if (item.kind === 'highlight') {
                  onDeleteHighlight(item.highlight)
                  return
                }
                onDeleteTypewriterNote(item.id)
              }}
              onTags={() => onAnnotationTags?.()}
            />
          ) : null}

          {tab === 'layout' ? (
            <PageLayoutPanel
              pageCurrent={pageCurrent}
              pageTotal={pageTotal}
              columns={pageLayoutGrid.columns}
              onGoToPage={onGoToPage}
              previews={pagePreviews}
              onRequestPreview={onRequestPagePreview}
            />
          ) : null}

          {tab === 'attachments' ? (
            <p className="m-0 px-2 py-6 text-center text-[13px] leading-relaxed text-lib-faint">
              No attachments for this book yet.
            </p>
          ) : null}
        </div>

      {open && onResizePointerDown ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          className="absolute top-0 -right-1 z-[165] w-2 cursor-col-resize touch-none"
          style={{ bottom: 0 }}
          onPointerDown={onResizePointerDown}
        >
          <span
            className={`absolute inset-y-0 right-1 w-px ${
              isResizing ? 'bg-lib-accent' : 'bg-lib-border-soft/80'
            }`}
            aria-hidden
          />
        </div>
      ) : null}
    </aside>
  )
}

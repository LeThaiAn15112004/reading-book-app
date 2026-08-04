import type { FakeChapter } from '../../fakeReaderContent'
import type { EpubTocItem } from '../../../../reader/renderers/epub'
import type {
  ReaderBookmark,
  ReaderComment,
  ReaderHighlight,
} from '../../readerSession'
import { NotesListPanel } from './NotesListPanel'

export type SidebarTab = 'chapters' | 'bookmarks' | 'highlights' | 'comments'

type TocSidebarProps = {
  open: boolean
  tab: SidebarTab
  chapters: FakeChapter[]
  chapterIndex: number
  /** Place key for bookmark toggle (EPUB spine or fake chapter). Defaults to chapterIndex. */
  bookmarkPlaceIndex?: number
  tocItems?: EpubTocItem[]
  activeTocHref?: string
  bookmarks: ReaderBookmark[]
  highlights: ReaderHighlight[]
  comments: ReaderComment[]
  onClose: () => void
  onTabChange: (tab: SidebarTab) => void
  onSelectChapter: (index: number) => void
  onSelectTocItem?: (item: EpubTocItem) => void
  onJumpBookmark: (bookmark: ReaderBookmark) => void
  onDeleteBookmark: (id: string) => void
  onAddBookmark: () => void
  onJumpHighlight: (highlight: ReaderHighlight) => void
  onEditHighlightNote: (highlight: ReaderHighlight) => void
  onCopyHighlight: (highlight: ReaderHighlight) => void
  onDeleteHighlight: (highlight: ReaderHighlight) => void
  onJumpComment: (chapterIndex: number, paragraphIndex: number) => void
}

const TABS: { id: SidebarTab; label: string; icon: string }[] = [
  { id: 'chapters', label: 'Contents', icon: '📑' },
  { id: 'bookmarks', label: 'Bookmarks', icon: '🔖' },
  { id: 'highlights', label: 'Highlight', icon: '🖍' },
  { id: 'comments', label: 'Comments', icon: '💬' },
]

function commentCountForChapter(
  comments: ReaderComment[],
  chapterIndex: number,
): number {
  return comments.filter((c) => c.chapterIndex === chapterIndex).length
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
              title={item.label}
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
  chapters,
  chapterIndex,
  bookmarkPlaceIndex,
  tocItems,
  activeTocHref,
  bookmarks,
  highlights,
  comments,
  onClose,
  onTabChange,
  onSelectChapter,
  onSelectTocItem,
  onJumpBookmark,
  onDeleteBookmark,
  onAddBookmark,
  onJumpHighlight,
  onEditHighlightNote,
  onCopyHighlight,
  onDeleteHighlight,
  onJumpComment,
}: TocSidebarProps) {
  const hasRealToc = !!tocItems && tocItems.length > 0
  const placeIndex = bookmarkPlaceIndex ?? chapterIndex

  return (
    <>
      <div
        className={`fixed inset-0 z-[150] bg-lib-bg-deep/45 backdrop-blur-sm transition-opacity ${
          open
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`@container fixed top-[var(--app-titlebar-h,36px)] bottom-0 left-0 z-[160] flex w-[min(100%,340px)] max-w-[86vw] flex-col border-r border-lib-border bg-lib-surface-strong shadow-xl backdrop-blur-xl transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-lib-border-soft px-4 py-3">
          <h2 className="m-0 text-lg font-semibold text-lib-text-strong">
            Contents
          </h2>
          <button
            className="inline-flex size-9 cursor-pointer items-center justify-center border-none bg-transparent text-lg text-lib-muted hover:text-lib-text-strong"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="flex gap-0.5 border-b border-lib-border-soft bg-lib-hint p-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md border-none px-0.5 text-[11px] font-semibold whitespace-nowrap ${
                tab === t.id
                  ? 'bg-lib-bg-mid text-lib-accent'
                  : 'bg-transparent text-lib-muted hover:text-lib-text-strong'
              }`}
              type="button"
              title={t.label}
              aria-label={t.label}
              onClick={() => onTabChange(t.id)}
            >
              <span aria-hidden className="text-sm leading-none">
                {t.icon}
              </span>
              {/* Narrow sidebar: icon only */}
              <span className="hidden @[300px]:inline">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-3">
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
                  const badge = commentCountForChapter(comments, i)
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
                {bookmarks.some((b) => b.chapterIndex === placeIndex)
                  ? 'Remove bookmark here'
                  : 'Bookmark this place'}
              </button>
              {bookmarks.length === 0 ? (
                <p className="m-0 px-4 py-6 text-center text-[13px] text-lib-faint">
                  No bookmarks yet
                </p>
              ) : (
                bookmarks.map((b) => (
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
            </div>
          ) : null}

          {tab === 'highlights' ? (
            <NotesListPanel
              highlights={highlights}
              chapters={chapters}
              tocItems={tocItems}
              onJump={onJumpHighlight}
              onEditNote={onEditHighlightNote}
              onCopy={onCopyHighlight}
              onDelete={onDeleteHighlight}
            />
          ) : null}

          {tab === 'comments' ? (
            comments.length === 0 ? (
              <p className="m-0 px-4 py-6 text-center text-[13px] text-lib-faint">
                No comments yet
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {comments.map((c) => (
                  <button
                    key={c.id}
                    className="flex w-full cursor-pointer flex-col gap-1 rounded-lg border border-lib-border-soft bg-lib-surface p-3 text-left"
                    type="button"
                    onClick={() =>
                      onJumpComment(c.chapterIndex, c.paragraphIndex)
                    }
                  >
                    <span className="text-[10px] font-bold tracking-wide text-lib-accent uppercase">
                      {chapters[c.chapterIndex]?.title ?? `§${c.chapterIndex + 1}`}
                      {' · '}¶{c.paragraphIndex + 1}
                    </span>
                    <span className="text-[13px] leading-snug text-lib-text">
                      {c.content}
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : null}
        </div>
      </aside>
    </>
  )
}

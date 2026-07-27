import type { FakeChapter } from '../fakeReaderContent'
import type {
  ReaderBookmark,
  ReaderComment,
  ReaderHighlight,
  ReaderNote,
} from '../readerSession'

export type SidebarTab = 'chapters' | 'bookmarks' | 'notes' | 'comments'

type TocSidebarProps = {
  open: boolean
  tab: SidebarTab
  chapters: FakeChapter[]
  chapterIndex: number
  bookmarks: ReaderBookmark[]
  notes: ReaderNote[]
  highlights: ReaderHighlight[]
  comments: ReaderComment[]
  onClose: () => void
  onTabChange: (tab: SidebarTab) => void
  onSelectChapter: (index: number) => void
  onJumpBookmark: (chapterIndex: number) => void
  onDeleteBookmark: (id: string) => void
  onAddBookmark: () => void
  onJumpNote: (chapterIndex: number) => void
  onJumpComment: (chapterIndex: number, paragraphIndex: number) => void
}

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'chapters', label: 'Contents' },
  { id: 'bookmarks', label: 'Bookmarks' },
  { id: 'notes', label: 'Notes' },
  { id: 'comments', label: 'Comments' },
]

function commentCountForChapter(
  comments: ReaderComment[],
  chapterIndex: number,
): number {
  return comments.filter((c) => c.chapterIndex === chapterIndex).length
}

export function TocSidebar({
  open,
  tab,
  chapters,
  chapterIndex,
  bookmarks,
  notes,
  highlights,
  comments,
  onClose,
  onTabChange,
  onSelectChapter,
  onJumpBookmark,
  onDeleteBookmark,
  onAddBookmark,
  onJumpNote,
  onJumpComment,
}: TocSidebarProps) {
  const noteCards = [
    ...notes.map((n) => ({
      id: n.id,
      kind: 'note' as const,
      chapterIndex: n.chapterIndex,
      excerpt: n.selectedText,
      body: n.content,
    })),
    ...highlights.map((h) => ({
      id: h.id,
      kind: 'highlight' as const,
      chapterIndex: h.chapterIndex,
      excerpt: h.selectedText,
      body: `Highlighted (${h.color})`,
    })),
  ]

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
        className={`fixed top-[var(--app-titlebar-h,36px)] bottom-0 left-0 z-[160] flex w-[min(100%,340px)] max-w-[86vw] flex-col border-r border-lib-border bg-lib-surface-strong shadow-xl backdrop-blur-xl transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
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
              className={`h-9 flex-1 cursor-pointer rounded-md border-none px-0.5 text-[11px] font-semibold whitespace-nowrap ${
                tab === t.id
                  ? 'bg-lib-bg-mid text-lib-accent'
                  : 'bg-transparent text-lib-muted hover:text-lib-text-strong'
              }`}
              type="button"
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-3">
          {tab === 'chapters' ? (
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
          ) : null}

          {tab === 'bookmarks' ? (
            <div className="flex flex-col gap-2.5">
              <button
                className="h-10 w-full cursor-pointer rounded-lg border border-lib-border bg-lib-accent-soft text-[13px] font-semibold text-lib-accent"
                type="button"
                onClick={onAddBookmark}
              >
                {bookmarks.some((b) => b.chapterIndex === chapterIndex)
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
                      onClick={() => onJumpBookmark(b.chapterIndex)}
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

          {tab === 'notes' ? (
            noteCards.length === 0 ? (
              <p className="m-0 px-4 py-6 text-center text-[13px] text-lib-faint">
                No notes yet
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {noteCards.map((card) => (
                  <button
                    key={card.id}
                    className="flex w-full cursor-pointer flex-col gap-1 rounded-lg border border-lib-border-soft bg-lib-surface p-3 text-left"
                    type="button"
                    onClick={() => onJumpNote(card.chapterIndex)}
                  >
                    <span className="text-[10px] font-bold tracking-wide text-lib-accent uppercase">
                      {card.kind}
                    </span>
                    <span className="text-xs text-lib-muted italic">
                      “{card.excerpt}”
                    </span>
                    <span className="text-[13px] leading-snug text-lib-text">
                      {card.body}
                    </span>
                  </button>
                ))}
              </div>
            )
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

import { Component, useMemo, useState, type ReactNode } from 'react'
import type { ReaderBookmark, ReaderHighlight } from '@reading-book/book-reader-sdk'
import type { EpubTocItem } from '../../../../reader/renderers/epub'
import type { FakeChapter } from '../../logic'
import { useNotesFilterStore, type NotesTypeFilter } from '../../logic/highlights/notesFilterStore'
import { NoteItemMenu } from './NoteItemMenu'
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
import { readerChromeTopInset } from '../../../../reader/chrome'

export type SidebarTab = 'chapters' | 'bookmarks' | 'highlights' | 'layout' | 'attachments'

type TocSidebarProps = {
  open: boolean
  tab: SidebarTab
  panelWidth: number
  isResizing?: boolean
  chromeHidden?: boolean
  onResizePointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void
  chapters: FakeChapter[]
  chapterIndex: number
  tocItems?: EpubTocItem[]
  activeTocHref?: string
  onClose: () => void
  onSelectChapter: (index: number) => void
  onSelectTocItem?: (item: EpubTocItem) => void
  /** 1-based visible spine section — layout grid. */
  pageCurrent: number
  pageTotal: number
  onGoToPage: (page: number) => void
  /** Section titles indexed by 0-based spine position. */
  sectionLabels?: string[]
  /** Whether the reader is in immersive/fullscreen mode. */
  immersive?: boolean
  bookmarks?: ReaderBookmark[]
  /** Bookmark the reader is currently sitting at — gets the "Here" badge. */
  currentBookmarkId?: string
  /** True when the current place already has a bookmark (flips the toggle's label). */
  currentPlaceBookmarked?: boolean
  onToggleBookmark?: () => void
  onJumpBookmark?: (bookmark: ReaderBookmark) => void
  onDeleteBookmark?: (id: string) => void
  highlights?: ReaderHighlight[]
  onJumpHighlight?: (highlight: ReaderHighlight) => void
  onDeleteHighlight?: (id: string) => void
  onChangeHighlightColor?: (id: string, colorHex: string) => void
  onChangeHighlightNote?: (id: string, note: string) => void
  onCopyHighlight?: (highlight: ReaderHighlight) => void
  onAskAiHighlight?: (highlight: ReaderHighlight) => void
}

function normalizeHref(href: string): string {
  return href.split('#')[0] ?? href
}

/**
 * Coarse whole-book position for a bookmark, from the chapter/spine-section index stored
 * alongside its locator — not the exact scroll position within that section (no per-bookmark
 * page metrics are persisted), so bookmarks placed in the same section show the same value.
 */
function bookmarkProgressLabel(
  chapterIndex: number,
  sectionCount: number,
): string | undefined {
  if (!Number.isFinite(sectionCount) || sectionCount <= 0) return undefined
  const percent = Math.min(100, Math.max(0, (chapterIndex / sectionCount) * 100))
  return `${percent.toFixed(2)}%`
}

type HighlightChapterGroup = { chapterIndex: number; label: string; items: ReaderHighlight[] }

/** Groups highlights by the chapter/section they were created in, chapter order ascending,
 *  oldest-first within a chapter. `sectionLabels` (0-based, indexed by spine position — same
 *  as `ReaderHighlight.chapterIndex`) supplies the human-readable chapter title. */
function groupHighlightsByChapter(
  highlights: ReaderHighlight[],
  sectionLabels?: string[],
): HighlightChapterGroup[] {
  const byChapter = new Map<number, ReaderHighlight[]>()
  for (const h of highlights) {
    const list = byChapter.get(h.chapterIndex)
    if (list) list.push(h)
    else byChapter.set(h.chapterIndex, [h])
  }
  return Array.from(byChapter.entries())
    .sort(([a], [b]) => a - b)
    .map(([chapterIndex, items]) => ({
      chapterIndex,
      label: sectionLabels?.[chapterIndex]?.trim() || `Chapter ${chapterIndex + 1}`,
      items: [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }))
}

/** Human label for a note's type — distinct from `styleKind` so it can carry copy that differs
 *  from the raw discriminator (e.g. "Note" for `textbox`). */
function highlightTypeLabel(styleKind: ReaderHighlight['styleKind']): string {
  switch (styleKind) {
    case 'underline':
      return 'Underline'
    case 'strikethrough':
      return 'Strikethrough'
    case 'textbox':
      return 'Note'
    default:
      return 'Highlight'
  }
}

/** Locale-formats an ISO timestamp, tolerating a missing/malformed value instead of rendering
 *  "Invalid Date" or throwing — a highlight row can come from an older schema or a corrupted
 *  overlay write. */
function safeDateLabel(iso: string | undefined): string {
  if (!iso) return ''
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString()
  } catch {
    return ''
  }
}

/** Type-filter dropdown options for the Notes panel's third row — scoped to the three annotation
 *  kinds the reader fully supports (`highlight`, `underline`, `strikethrough`); `textbox` notes
 *  still show up under "All types", they just aren't independently filterable yet. */
const NOTE_TYPE_OPTIONS: { value: NotesTypeFilter; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'highlight', label: 'Highlight' },
  { value: 'underline', label: 'Underline' },
  { value: 'strikethrough', label: 'Strikethrough' },
]

/** Case-insensitive substring match over a highlight's excerpt, note and tags. */
function highlightMatchesSearch(highlight: ReaderHighlight, needle: string): boolean {
  const haystack = [highlight.selectionText?.highlight, highlight.note, ...(highlight.tags ?? [])]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n')
    .toLowerCase()
  return haystack.includes(needle)
}

/** Narrows the highlight list to the active search term and type filter. Defensive about the
 *  input shape — a `null`/`undefined` list (e.g. a bridge call that failed upstream) or a
 *  malformed row must degrade to "no matches" rather than throw during render. */
function filterHighlights(
  highlights: ReaderHighlight[] | null | undefined,
  options: { searchTerm: string; activeType: NotesTypeFilter },
): ReaderHighlight[] {
  if (!Array.isArray(highlights)) return []
  const needle = options.searchTerm.trim().toLowerCase()
  return highlights.filter((h) => {
    if (!h || typeof h.id !== 'string') return false
    if (options.activeType !== 'all' && h.styleKind !== options.activeType) return false
    if (needle && !highlightMatchesSearch(h, needle)) return false
    return true
  })
}

/** Flat, most-recent-first ordering — the "Chronological" alternative to the default
 *  reading-order (chapter-grouped) view. */
function sortHighlightsChronological(highlights: ReaderHighlight[]): ReaderHighlight[] {
  return [...highlights].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

type NotesErrorBoundaryProps = { children: ReactNode }
type NotesErrorBoundaryState = { hasError: boolean }

/**
 * Last-resort guard around the Notes list: a single malformed annotation row (bad date, broken
 * CFI, a renderer throwing on unexpected data) must not take down the whole Reader screen. Falls
 * back to a compact message with a Retry button instead of a blank/crashed panel.
 */
class NotesErrorBoundary extends Component<NotesErrorBoundaryProps, NotesErrorBoundaryState> {
  state: NotesErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): NotesErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[NotesErrorBoundary] failed to render notes list', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-[13px] text-lib-faint">
          <span>Something went wrong showing your notes.</span>
          <button
            className="cursor-pointer rounded-md border border-lib-border bg-transparent px-3 py-1.5 text-xs font-medium text-lib-text hover:bg-lib-surface-hover"
            type="button"
            onClick={() => this.setState({ hasError: false })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
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

type HighlightListItemProps = {
  highlight: ReaderHighlight
  pageTotal: number
  onJump?: (highlight: ReaderHighlight) => void
  onDelete?: (id: string) => void
  onChangeColor?: (id: string, colorHex: string) => void
  onChangeNote?: (id: string, note: string) => void
  onCopy?: (highlight: ReaderHighlight) => void
  onAskAi?: (highlight: ReaderHighlight) => void
}

/** One note/highlight card — shared by the reading-order (grouped) and chronological (flat)
 *  layouts so the two sort modes stay visually identical. */
function HighlightListItem({
  highlight: h,
  pageTotal,
  onJump,
  onDelete,
  onChangeColor,
  onChangeNote,
  onCopy,
  onAskAi,
}: HighlightListItemProps) {
  const progressLabel = bookmarkProgressLabel(h.chapterIndex, pageTotal)
  const dateLabel = safeDateLabel(h.createdAt)
  return (
    <div className="flex items-start gap-2 rounded-lg border border-lib-border-soft bg-lib-surface p-3">
      <button
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 border-none bg-transparent p-0 text-left outline-none focus:outline-none focus-visible:outline-none"
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          try {
            onJump?.(h)
          } catch (error) {
            console.error('[HighlightListItem] failed to jump to highlight', error)
          }
          e.currentTarget.blur()
        }}
      >
        {h.styleKind === 'textbox' ? (
          <span className="mt-0.5 shrink-0 text-[13px] leading-none" aria-hidden>
            📝
          </span>
        ) : (
          <span
            className="mt-1 h-3 w-3 shrink-0 rounded-full"
            style={
              h.styleKind === 'underline' || h.styleKind === 'strikethrough'
                ? { border: `2px solid ${h.colorHex}` }
                : { backgroundColor: h.colorHex }
            }
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-full bg-lib-hint/70 px-1.5 py-0.5 text-[10px] font-semibold text-lib-muted">
              {highlightTypeLabel(h.styleKind)}
            </span>
            {progressLabel ? (
              <span className="text-[10px] font-semibold text-lib-faint">{progressLabel}</span>
            ) : null}
            {dateLabel ? <span className="text-[10px] text-lib-faint">{dateLabel}</span> : null}
          </span>
          {h.selectionText?.highlight ? (
            <span className="line-clamp-2 mt-1 text-[13px] leading-snug text-lib-text">
              “{h.selectionText.highlight}”
            </span>
          ) : (
            <span className="mt-1 block text-[13px] text-lib-faint italic">(no excerpt)</span>
          )}
          {h.note ? (
            <span className="line-clamp-2 mt-1 text-xs leading-snug text-lib-muted">{h.note}</span>
          ) : null}
          {h.tags.length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {h.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full bg-lib-hint/70 px-1.5 py-0.5 text-[10px] font-semibold text-lib-muted"
                >
                  {tag}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>
      <NoteItemMenu
        highlight={h}
        onChangeColor={(colorHex) => onChangeColor?.(h.id, colorHex)}
        onEditNote={(note) => onChangeNote?.(h.id, note)}
        onCopy={() => onCopy?.(h)}
        onAskAi={() => onAskAi?.(h)}
        onDelete={() => onDelete?.(h.id)}
      />
    </div>
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
  tocItems,
  activeTocHref,
  onClose,
  onSelectChapter,
  onSelectTocItem,
  pageCurrent,
  pageTotal,
  onGoToPage,
  sectionLabels,
  immersive = false,
  bookmarks = [],
  currentBookmarkId,
  currentPlaceBookmarked = false,
  onToggleBookmark,
  onJumpBookmark,
  onDeleteBookmark,
  highlights = [],
  onJumpHighlight,
  onDeleteHighlight,
  onChangeHighlightColor,
  onChangeHighlightNote,
  onCopyHighlight,
  onAskAiHighlight,
}: TocSidebarProps) {
  const hasRealToc = !!tocItems && tocItems.length > 0
  const pageLayoutGrid = usePageLayoutGrid()
  const [bookmarkQuery, setBookmarkQuery] = useState('')
  const filteredBookmarks = useMemo(() => {
    const q = bookmarkQuery.trim().toLowerCase()
    if (!q) return bookmarks
    return bookmarks.filter((b) => b.label.toLowerCase().includes(q))
  }, [bookmarks, bookmarkQuery])
  const notesSearchTerm = useNotesFilterStore((s) => s.searchTerm)
  const notesActiveType = useNotesFilterStore((s) => s.activeType)
  const notesSortBy = useNotesFilterStore((s) => s.sortBy)
  const notesFiltersOpen = useNotesFilterStore((s) => s.filtersOpen)
  const notesFilterError = useNotesFilterStore((s) => s.error)
  const setNotesSearchTerm = useNotesFilterStore((s) => s.setSearchTerm)
  const setNotesActiveType = useNotesFilterStore((s) => s.setActiveType)
  const setNotesSortBy = useNotesFilterStore((s) => s.setSortBy)
  const toggleNotesFiltersOpen = useNotesFilterStore((s) => s.toggleFiltersOpen)

  const filteredHighlights = useMemo(() => {
    try {
      return filterHighlights(highlights, { searchTerm: notesSearchTerm, activeType: notesActiveType })
    } catch (error) {
      console.error('[TocSidebar] failed to filter notes', error)
      return []
    }
  }, [highlights, notesSearchTerm, notesActiveType])

  const highlightGroups = useMemo(() => {
    try {
      return groupHighlightsByChapter(filteredHighlights, sectionLabels)
    } catch (error) {
      console.error('[TocSidebar] failed to group notes by chapter', error)
      return []
    }
  }, [filteredHighlights, sectionLabels])

  const chronologicalHighlights = useMemo(() => {
    try {
      return sortHighlightsChronological(filteredHighlights)
    } catch (error) {
      console.error('[TocSidebar] failed to sort notes chronologically', error)
      return filteredHighlights
    }
  }, [filteredHighlights])

  // Collapsed by default — a book can accumulate a lot of notes, so start compact and let the
  // reader open the chapters they care about.
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(() => new Set())
  function toggleChapterExpanded(chapterIndex: number) {
    setExpandedChapters((prev) => {
      const next = new Set(prev)
      if (next.has(chapterIndex)) next.delete(chapterIndex)
      else next.add(chapterIndex)
      return next
    })
  }

  const chromeTopInset = readerChromeTopInset(chromeHidden)

  return (
    <aside
      data-reader-sidebar-panel
      className={`@container absolute z-[160] flex flex-col border-y border-r border-lib-border bg-lib-surface-strong shadow-lg ${
        isResizing
          ? ''
          : 'transition-[transform,top] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
      } ${
        open
          ? 'pointer-events-auto border-l-0'
          : 'pointer-events-none border-l'
      }`}
      style={{
        left: SIDEBAR_RAIL_WIDTH_PX,
        top: chromeTopInset,
        bottom: READER_FOOTER_HEIGHT_PX,
        width: panelWidth,
        transform: open ? 'translateX(0)' : immersive ? `translateX(calc(-100% - ${SIDEBAR_RAIL_WIDTH_PX}px))` : 'translateX(-100%)',
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
            ) : chapters.length === 0 ? (
              <p className="m-0 px-3 py-3 text-sm text-lib-muted">
                This book has no table of contents.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {chapters.map((ch, i) => (
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
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {tab === 'bookmarks' ? (
            <div className="flex flex-col gap-2.5">
              {onToggleBookmark ? (
                <button
                  className="h-10 w-full cursor-pointer rounded-lg border border-lib-border bg-lib-accent-soft text-[13px] font-semibold text-lib-accent"
                  type="button"
                  onClick={onToggleBookmark}
                >
                  {currentPlaceBookmarked
                    ? 'Remove bookmark here'
                    : 'Bookmark this place'}
                </button>
              ) : null}
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
                    filteredBookmarks.map((b) => {
                      const isHere = b.id === currentBookmarkId
                      const progressLabel = bookmarkProgressLabel(
                        b.chapterIndex,
                        pageTotal,
                      )
                      return (
                        <div
                          key={b.id}
                          className={`flex items-start gap-2 rounded-lg border p-3 transition-colors ${
                            isHere
                              ? 'border-lib-accent bg-lib-accent-soft'
                              : 'border-lib-border-soft bg-lib-surface'
                          }`}
                        >
                          <button
                            className="min-w-0 flex-1 cursor-pointer border-none bg-transparent p-0 text-left outline-none focus:outline-none focus-visible:outline-none"
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              onJumpBookmark?.(b)
                              // Drop focus so the reader keeps keyboard paging after a jump.
                              e.currentTarget.blur()
                            }}
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span
                                className={`truncate text-sm ${isHere ? 'font-semibold text-lib-accent' : 'text-lib-text'}`}
                              >
                                {b.label}
                              </span>
                              {progressLabel ? (
                                <span className="inline-flex shrink-0 items-center rounded-full bg-lib-hint/70 px-1.5 py-0.5 text-[10px] font-semibold text-lib-muted">
                                  {progressLabel}
                                </span>
                              ) : null}
                              {isHere ? (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-lib-accent/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-lib-accent uppercase">
                                  Here
                                </span>
                              ) : null}
                            </span>
                            {b.excerpt ? (
                              <span className="mt-1 line-clamp-2 text-xs leading-snug text-lib-muted">
                                {b.excerpt}
                              </span>
                            ) : null}
                            {b.createdAt ? (
                              <span className="mt-0.5 block text-[11px] text-lib-faint">
                                {new Date(b.createdAt).toLocaleString()}
                              </span>
                            ) : null}
                          </button>
                          <button
                            className="cursor-pointer border-none bg-transparent px-1 text-xs text-lib-faint hover:text-red-400"
                            type="button"
                            aria-label="Delete bookmark"
                            onClick={() => onDeleteBookmark?.(b.id)}
                          >
                            ✕
                          </button>
                        </div>
                      )
                    })
                  )}
                </>
              )}
            </div>
          ) : null}

          {tab === 'highlights' ? (
            highlights.length === 0 ? (
              <p className="m-0 px-4 py-6 text-center text-[13px] text-lib-faint">
                No notes yet
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {/* Row 2 — search + filter toggle */}
                <div className="flex items-center gap-1.5">
                  <label className="relative block flex-1">
                    <span className="sr-only">Search notes</span>
                    <input
                      className="h-9 w-full rounded-lg border border-lib-border bg-lib-input py-0 pr-3 pl-8 text-[13px] text-lib-text-strong outline-none placeholder:text-lib-faint focus:border-lib-accent"
                      type="search"
                      value={notesSearchTerm}
                      onChange={(e) => setNotesSearchTerm(e.target.value)}
                      placeholder="Search notes…"
                    />
                    <span
                      className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-lib-faint"
                      aria-hidden
                    >
                      🔍
                    </span>
                  </label>
                  <button
                    className={`inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border text-sm ${
                      notesFiltersOpen
                        ? 'border-lib-accent bg-lib-accent-soft text-lib-accent'
                        : 'border-lib-border bg-transparent text-lib-muted hover:bg-lib-surface-hover'
                    }`}
                    type="button"
                    aria-pressed={notesFiltersOpen}
                    aria-label="Toggle filters"
                    title="Filter & sort"
                    onClick={toggleNotesFiltersOpen}
                  >
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                      <path
                        d="M1.5 2.5h12L9 8v4.5L6 11V8L1.5 2.5Z"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>

                {/* Row 3 — annotation type filter + reading order / chronological sort, both dropdowns */}
                {notesFiltersOpen ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="relative block flex-1">
                      <span className="sr-only">Filter by type</span>
                      <select
                        className="h-8 w-full cursor-pointer rounded-lg border border-lib-border bg-lib-input px-2 text-xs font-medium text-lib-text-strong outline-none focus:border-lib-accent"
                        value={notesActiveType}
                        onChange={(e) => setNotesActiveType(e.target.value as NotesTypeFilter)}
                      >
                        {NOTE_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="relative block flex-1">
                      <span className="sr-only">Sort notes</span>
                      <select
                        className="h-8 w-full cursor-pointer rounded-lg border border-lib-border bg-lib-input px-2 text-xs font-medium text-lib-text-strong outline-none focus:border-lib-accent"
                        value={notesSortBy}
                        onChange={(e) => setNotesSortBy(e.target.value === 'chronological' ? 'chronological' : 'readingOrder')}
                      >
                        <option value="readingOrder">Reading Order</option>
                        <option value="chronological">Chronological</option>
                      </select>
                    </label>
                  </div>
                ) : null}

                {notesFilterError ? (
                  <p className="m-0 rounded-md bg-lib-hint/70 px-2.5 py-1.5 text-[11px] text-lib-muted" role="alert">
                    {notesFilterError}
                  </p>
                ) : null}

                <NotesErrorBoundary>
                  {filteredHighlights.length === 0 ? (
                    <p className="m-0 px-2 py-4 text-center text-[13px] text-lib-faint">No matches</p>
                  ) : notesSortBy === 'chronological' ? (
                    <div className="flex flex-col gap-2">
                      {chronologicalHighlights.map((h) => (
                        <HighlightListItem
                          key={h.id}
                          highlight={h}
                          pageTotal={pageTotal}
                          onJump={onJumpHighlight}
                          onDelete={onDeleteHighlight}
                          onChangeColor={onChangeHighlightColor}
                          onChangeNote={onChangeHighlightNote}
                          onCopy={onCopyHighlight}
                          onAskAi={onAskAiHighlight}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {highlightGroups.map((group) => {
                        const expanded = expandedChapters.has(group.chapterIndex)
                        const notesCount = group.items.filter((h) => h.note?.trim()).length
                        const highlightsOnlyCount = group.items.length - notesCount
                        return (
                          <div key={group.chapterIndex} className="flex flex-col gap-1.5">
                            <button
                              type="button"
                              className={`flex w-full cursor-pointer flex-col gap-1 rounded-lg border-l-4 bg-lib-accent-soft/40 py-2.5 pr-3 pl-3 text-left transition-colors hover:bg-lib-accent-soft/60 ${
                                expanded ? 'border-l-lib-accent' : 'border-l-lib-accent/60'
                              }`}
                              aria-expanded={expanded}
                              onClick={() => toggleChapterExpanded(group.chapterIndex)}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate text-[15px] font-bold text-lib-text-strong">
                                  {group.label}
                                </span>
                                <span className="flex shrink-0 items-center gap-1.5">
                                  <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-lib-accent px-2 py-0.5 text-[11px] font-bold text-lib-bg-deep shadow-[0_0_10px_-2px_var(--lib-accent)]">
                                    {group.items.length}
                                  </span>
                                  <span
                                    className={`text-[10px] text-lib-faint transition-transform ${expanded ? 'rotate-90' : ''}`}
                                    aria-hidden
                                  >
                                    ▶
                                  </span>
                                </span>
                              </span>
                              <span className="flex items-center gap-1.5 text-xs text-lib-muted">
                                <span aria-hidden>📖</span>
                                Chapter {group.chapterIndex + 1} of {pageTotal}
                              </span>
                              <span className="text-xs text-lib-muted">
                                {highlightsOnlyCount} Highlights / {notesCount} Notes
                              </span>
                            </button>

                            {expanded ? (
                              <div className="flex flex-col gap-2">
                                {group.items.map((h) => (
                                  <HighlightListItem
                                    key={h.id}
                                    highlight={h}
                                    pageTotal={pageTotal}
                                    onJump={onJumpHighlight}
                                    onDelete={onDeleteHighlight}
                                    onChangeColor={onChangeHighlightColor}
                                    onChangeNote={onChangeHighlightNote}
                                    onCopy={onCopyHighlight}
                                    onAskAi={onAskAiHighlight}
                                  />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </NotesErrorBoundary>
              </div>
            )
          ) : null}

          {tab === 'layout' ? (
            <PageLayoutPanel
              pageCurrent={pageCurrent}
              pageTotal={pageTotal}
              sectionLabels={sectionLabels}
              columns={pageLayoutGrid.columns}
              onGoToPage={onGoToPage}
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

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FakeChapter } from '../../fakeReaderContent'
import type { EpubTocItem } from '../../../../reader/renderers/epub'
import {
  HIGHLIGHT_COLOR_HEX,
  highlightColorFromHex,
  type HighlightColor,
  type ReaderHighlight,
} from '../../readerSession'

type NotesListPanelProps = {
  highlights: ReaderHighlight[]
  chapters: FakeChapter[]
  tocItems?: EpubTocItem[]
  onJump: (highlight: ReaderHighlight) => void
  onEditNote: (highlight: ReaderHighlight) => void
  onCopy: (highlight: ReaderHighlight) => void
  onDelete: (highlight: ReaderHighlight) => void
}

type ColorFilter = HighlightColor | 'all'

type HighlightAction = {
  id: string
  label: string
  icon: string
  onSelect: () => void
  destructive?: boolean
}

const menuBtn =
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-base leading-none text-lib-muted transition-colors hover:bg-lib-accent-soft hover:text-lib-accent'

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 45) return 'Just now'
  if (diffSec < 3600) return `${Math.max(1, Math.round(diffSec / 60))}m ago`
  if (diffSec < 86400) return `${Math.max(1, Math.round(diffSec / 3600))}h ago`
  if (diffSec < 86400 * 7) return `${Math.max(1, Math.round(diffSec / 86400))}d ago`
  return new Date(iso).toLocaleDateString()
}

function flattenTocLabels(items: EpubTocItem[], out: string[] = []): string[] {
  for (const item of items) {
    out.push(item.label)
    if (item.children.length) flattenTocLabels(item.children, out)
  }
  return out
}

function locationLabel(
  h: ReaderHighlight,
  chapters: FakeChapter[],
  tocItems?: EpubTocItem[],
): string {
  if (h.source === 'fake') {
    const chapter =
      chapters[h.chapterIndex]?.title ?? `Chapter ${h.chapterIndex + 1}`
    return `${chapter} · ¶${h.paragraphIndex + 1}`
  }
  const labels = tocItems?.length ? flattenTocLabels(tocItems) : []
  const chapter =
    labels[h.chapterIndex] ??
    chapters[h.chapterIndex]?.title ??
    `Section ${h.chapterIndex + 1}`
  return chapter
}

function HighlightCard({
  highlight,
  location,
  onJump,
  onEditNote,
  onCopy,
  onDelete,
}: {
  highlight: ReaderHighlight
  location: string
  onJump: () => void
  onEditNote: () => void
  onCopy: () => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const long = highlight.selectedText.trim().length > 160
  const note = highlight.note?.trim()

  const actions: HighlightAction[] = [
    { id: 'jump', label: 'Jump to highlight', icon: '📌', onSelect: onJump },
    {
      id: 'note',
      label: note ? 'Edit note' : 'Add note',
      icon: '📝',
      onSelect: onEditNote,
    },
    { id: 'copy', label: 'Copy text', icon: '📋', onSelect: onCopy },
    {
      id: 'delete',
      label: 'Delete',
      icon: '🗑️',
      onSelect: onDelete,
      destructive: true,
    },
  ]

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  return (
    <article
      className="flex flex-col gap-1.5 rounded-lg border border-lib-border-soft bg-lib-surface p-3"
      style={{ borderLeftWidth: 3, borderLeftColor: highlight.colorHex }}
    >
      <header className="flex items-start gap-1.5">
        <span
          className="mt-1.5 size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: highlight.colorHex }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-lib-text-strong">
            {location}
          </div>
          <div className="text-[11px] text-lib-faint">
            {formatRelativeTime(highlight.updatedAt || highlight.createdAt)}
          </div>
        </div>
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            className={menuBtn}
            title="More actions"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⋮
          </button>
          {menuOpen ? (
            <div
              className="absolute top-8 right-0 z-20 min-w-[168px] rounded-lg border border-lib-border bg-lib-surface-strong py-1 shadow-xl"
              role="menu"
              aria-label="Highlight actions"
            >
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  className={`flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-2.5 py-2 text-left text-[12px] font-medium ${
                    action.destructive
                      ? 'text-red-400 hover:bg-red-500/10'
                      : 'text-lib-text-strong hover:bg-lib-bg-deep/40'
                  }`}
                  onClick={() => {
                    setMenuOpen(false)
                    action.onSelect()
                  }}
                >
                  <span aria-hidden className="w-5 text-center text-sm">
                    {action.icon}
                  </span>
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <p
        className={`m-0 font-serif text-[13px] leading-snug text-lib-muted italic ${
          expanded ? '' : 'line-clamp-3'
        }`}
      >
        “{highlight.selectedText.trim()}”
      </p>
      {long ? (
        <button
          type="button"
          className="self-start cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold text-lib-accent hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}

      {note ? (
        <div className="rounded-md bg-lib-hint/80 px-2.5 py-2 text-[12px] leading-snug text-lib-text">
          <span className="mr-1 font-semibold text-lib-accent">💬 Note:</span>
          {note}
        </div>
      ) : null}
    </article>
  )
}

export function NotesListPanel({
  highlights,
  chapters,
  tocItems,
  onJump,
  onEditNote,
  onCopy,
  onDelete,
}: NotesListPanelProps) {
  const [query, setQuery] = useState('')
  const [colorFilter, setColorFilter] = useState<ColorFilter>('all')

  const availableColors = useMemo(() => {
    const set = new Set<HighlightColor>()
    for (const h of highlights) {
      set.add(highlightColorFromHex(h.colorHex))
    }
    return (Object.keys(HIGHLIGHT_COLOR_HEX) as HighlightColor[]).filter((c) =>
      set.has(c),
    )
  }, [highlights])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...highlights]
      .filter((h) => {
        if (colorFilter !== 'all') {
          if (highlightColorFromHex(h.colorHex) !== colorFilter) return false
        }
        if (!q) return true
        const location = locationLabel(h, chapters, tocItems).toLowerCase()
        return (
          h.selectedText.toLowerCase().includes(q) ||
          (h.note?.toLowerCase().includes(q) ?? false) ||
          location.includes(q)
        )
      })
      .sort((a, b) => {
        const ta = new Date(a.updatedAt || a.createdAt).getTime()
        const tb = new Date(b.updatedAt || b.createdAt).getTime()
        return tb - ta
      })
  }, [highlights, colorFilter, query, chapters, tocItems])

  if (highlights.length === 0) {
    return (
      <p className="m-0 px-4 py-6 text-center text-[13px] text-lib-faint">
        No highlights yet
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <label className="relative block">
        <span className="sr-only">Search highlights</span>
        <input
          className="h-9 w-full rounded-lg border border-lib-border bg-lib-input py-0 pr-3 pl-8 text-[13px] text-lib-text-strong outline-none placeholder:text-lib-faint focus:border-lib-accent"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search highlights…"
        />
        <span
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-lib-faint"
          aria-hidden
        >
          🔍
        </span>
      </label>

      {availableColors.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={`h-7 cursor-pointer rounded-full border px-2.5 text-[11px] font-semibold ${
              colorFilter === 'all'
                ? 'border-lib-accent bg-lib-accent-soft text-lib-accent'
                : 'border-lib-border-soft bg-transparent text-lib-muted hover:text-lib-text'
            }`}
            onClick={() => setColorFilter('all')}
          >
            All
          </button>
          {availableColors.map((color) => (
            <button
              key={color}
              type="button"
              title={`Filter ${color}`}
              aria-label={`Filter ${color}`}
              className={`inline-flex size-7 cursor-pointer items-center justify-center rounded-full border-2 ${
                colorFilter === color
                  ? 'border-lib-on-accent ring-2 ring-lib-accent-ring'
                  : 'border-lib-border-soft'
              }`}
              style={{ backgroundColor: HIGHLIGHT_COLOR_HEX[color] }}
              onClick={() =>
                setColorFilter((prev) => (prev === color ? 'all' : color))
              }
            />
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="m-0 px-2 py-4 text-center text-[13px] text-lib-faint">
          No matches
        </p>
      ) : (
        filtered.map((h) => (
          <HighlightCard
            key={h.id}
            highlight={h}
            location={locationLabel(h, chapters, tocItems)}
            onJump={() => onJump(h)}
            onEditNote={() => onEditNote(h)}
            onCopy={() => onCopy(h)}
            onDelete={() => onDelete(h)}
          />
        ))
      )}
    </div>
  )
}

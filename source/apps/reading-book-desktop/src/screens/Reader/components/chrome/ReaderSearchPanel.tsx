import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BookSearchMatch, BookSearchOrder } from '../../../../bridge'
import { useBookSearchStore, useDraggableSearchPanel, useResizableSearchPanel } from '../../logic'

type ReaderSearchPanelProps = {
  open: boolean
  query: string
  onQueryChange: (query: string) => void
  onSubmit: () => void
  onClose: () => void
}

const iconButton =
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-lib-muted'

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 animate-spin rounded-full border-2 border-current/20 border-t-current"
    />
  )
}

/** Drag-grip glyph on the header — visual affordance that the title bar is grabbable. */
function GripIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-3.5 shrink-0 text-lib-muted"
      aria-hidden
    >
      <circle cx="8" cy="6" r="1.4" />
      <circle cx="8" cy="12" r="1.4" />
      <circle cx="8" cy="18" r="1.4" />
      <circle cx="16" cy="6" r="1.4" />
      <circle cx="16" cy="12" r="1.4" />
      <circle cx="16" cy="18" r="1.4" />
    </svg>
  )
}

/** Diagonal resize-grip glyph on the bottom-right corner handle. */
function ResizeHandleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-3 shrink-0 text-lib-muted"
      aria-hidden
    >
      <circle cx="19" cy="19" r="1.4" />
      <circle cx="19" cy="13" r="1.4" />
      <circle cx="13" cy="19" r="1.4" />
    </svg>
  )
}

function Chevron({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="size-4"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d={direction === 'up' ? 'm4.5 15.75 7.5-7.5 7.5 7.5' : 'm19.5 8.25-7.5 7.5-7.5-7.5'}
      />
    </svg>
  )
}

function OptionToggle({
  pressed,
  title,
  onToggle,
  children,
}: {
  pressed: boolean
  title: string
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      onClick={onToggle}
      className={`inline-flex h-6 min-w-7 cursor-pointer items-center justify-center rounded-md border px-1.5 text-[12px] font-semibold transition-colors ${
        pressed
          ? 'border-lib-accent bg-lib-accent-soft text-lib-text-strong'
          : 'border-transparent text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong'
      }`}
    >
      {children}
    </button>
  )
}

const SORT_OPTIONS: ReadonlyArray<{ value: BookSearchOrder; label: string }> = [
  { value: 'position', label: 'In book order' },
  { value: 'relevance', label: 'By relevance' },
]

/**
 * Themed replacement for a native `<select>` — the sort-order popup is drawn by the OS on
 * Windows and can't be recolored to match the app theme, unlike a plain button + absolute list
 * (same pattern as `ZoomControl`'s preset menu / `MoreMenu`).
 */
function SortDropdown({
  order,
  onChange,
}: {
  order: BookSearchOrder
  onChange: (order: BookSearchOrder) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const current = SORT_OPTIONS.find((option) => option.value === order) ?? SORT_OPTIONS[0]

  return (
    <div ref={rootRef} className="relative ml-auto shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Sort results"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-6 cursor-pointer items-center gap-1 rounded-md border px-1.5 text-[12px] font-medium transition-colors ${
          open
            ? 'border-lib-accent bg-lib-accent-soft text-lib-text-strong'
            : 'border-lib-border-soft bg-transparent text-lib-muted hover:text-lib-text-strong'
        }`}
      >
        {current.label}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="size-3 shrink-0"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Sort results"
          className="absolute top-[calc(100%+4px)] right-0 z-[130] w-36 overflow-hidden rounded-lg border border-lib-border bg-lib-surface-strong py-1 shadow-xl"
        >
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === order}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={`block w-full cursor-pointer border-none px-3 py-1.5 text-left text-[12px] font-medium ${
                option.value === order
                  ? 'bg-lib-accent-soft text-lib-accent'
                  : 'bg-transparent text-lib-text-strong hover:bg-lib-chip'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function formatCount(value: number): string {
  return value.toLocaleString()
}

/** One-line summary under the options: loading / count / "occurrence k of n" (Foxit-style). */
function StatusLine() {
  const status = useBookSearchStore((s) => s.status)
  const busy = useBookSearchStore((s) => s.busy)
  const query = useBookSearchStore((s) => s.query)
  const totalMatches = useBookSearchStore((s) => s.totalMatches)
  const totalWords = useBookSearchStore((s) => s.totalWords)
  const errorMessage = useBookSearchStore((s) => s.errorMessage)
  const active = useBookSearchStore((s) => s.matches[s.activeIndex])

  let content: ReactNode = null
  if (status === 'searching' && busy) {
    content = (
      <>
        <Spinner />
        Searching entire book…
      </>
    )
  } else if (status === 'indexing') {
    content = (
      <>
        <Spinner />
        Preparing this book for search…
      </>
    )
  } else if (status === 'unsupported') {
    content = 'Search isn’t available for this format yet.'
  } else if (status === 'error') {
    content = errorMessage ?? 'Search failed.'
  } else if (status === 'ready' && totalMatches === 0) {
    content = `No matches for “${query}”.`
  } else if (status === 'ready' && active) {
    content = (
      <span className="min-w-0 truncate">
        <strong className="font-semibold text-lib-text-strong">
          Occurrence {formatCount(active.occurrence)} of {formatCount(totalMatches)}
        </strong>
        <span className="text-lib-muted">
          {' '}
          · word {formatCount(active.wordIndex)} of {formatCount(totalWords)}
        </span>
      </span>
    )
  } else if (status === 'ready') {
    content = `${formatCount(totalMatches)} ${totalMatches === 1 ? 'match' : 'matches'}`
  }

  if (content === null) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-8 items-center gap-2 border-t border-lib-border-soft px-3 py-1.5 text-[12px] text-lib-text"
    >
      {content}
    </div>
  )
}

function ResultItem({
  match,
  label,
  active,
  onSelect,
}: {
  match: BookSearchMatch
  label: string | undefined
  active: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        data-active={active || undefined}
        aria-current={active || undefined}
        onClick={onSelect}
        className={`block w-full cursor-pointer px-3 py-2 text-left transition-colors ${
          active ? 'bg-lib-accent-soft' : 'hover:bg-lib-surface-hover'
        }`}
      >
        <span className="flex items-baseline justify-between gap-2 text-[11px] text-lib-muted">
          <span className="min-w-0 truncate">{label}</span>
          <span className="shrink-0 tabular-nums">
            #{formatCount(match.occurrence)} · word {formatCount(match.wordIndex)}
          </span>
        </span>
        <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-lib-text">
          {match.snippet.before}
          <mark className="rounded-sm bg-[rgba(255,196,0,0.45)] px-0.5 text-lib-text-strong">
            {match.snippet.match}
          </mark>
          {match.snippet.after}
        </span>
      </button>
    </li>
  )
}

/**
 * In-book search (Search tool or Ctrl+F): FTS5 over the whole book, results + next/previous.
 * Floats over the reader, draggable by its header (see `useDraggableSearchPanel`) and always
 * kept fully inside the app window.
 */
export function ReaderSearchPanel({
  open,
  query,
  onQueryChange,
  onSubmit,
  onClose,
}: ReaderSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useDraggableSearchPanel(panelRef, open)
  const resize = useResizableSearchPanel(panelRef)

  const status = useBookSearchStore((s) => s.status)
  const busy = useBookSearchStore((s) => s.busy)
  const options = useBookSearchStore((s) => s.options)
  const order = useBookSearchStore((s) => s.order)
  const matches = useBookSearchStore((s) => s.matches)
  const totalMatches = useBookSearchStore((s) => s.totalMatches)
  const activeIndex = useBookSearchStore((s) => s.activeIndex)
  const hasMore = useBookSearchStore((s) => s.hasMore)
  const loadingMore = useBookSearchStore((s) => s.loadingMore)
  const chapterLabels = useBookSearchStore((s) => s.chapterLabels)
  const setOptions = useBookSearchStore((s) => s.setOptions)
  const setOrder = useBookSearchStore((s) => s.setOrder)
  const goTo = useBookSearchStore((s) => s.goTo)
  const next = useBookSearchStore((s) => s.next)
  const previous = useBookSearchStore((s) => s.previous)
  const loadMore = useBookSearchStore((s) => s.loadMore)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Keep the current occurrence visible in the list as next/previous walk through it.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!open) return null

  const canStep = status === 'ready' && totalMatches > 0

  return (
    <div
      ref={panelRef}
      // Floating panel anchored to the reader's top-right corner by default (Foxit/Thorium-
      // style) — independent of the search tool button's position in the toolbar, unlike a
      // dropdown. `absolute`, not `fixed`: rendered via ReaderShell's `overlays` slot, whose
      // root box is already mounted below the app's titlebar/menubar/tabs (see ReaderShell's
      // own doc comment) — `fixed` would measure from the OS window's real top edge, above all
      // of that, and land the panel too high, overlapping the toolbar instead of sitting under
      // it. Sits just under the topbar (h-[4.25rem]/h-[4.5rem], see ReaderTopbar) until the user
      // drags it (`drag.style` then overrides `top`/`right` with the dragged position). No
      // `overflow-hidden` here — that would clip the resize handles below, which sit slightly
      // outside the panel's box so they're easy to grab; the rounded-corner clipping instead
      // happens on the inner wrapper.
      className="absolute top-[calc(4.25rem+10px)] right-3 z-[120] flex w-[min(360px,calc(100vw-24px))] flex-col rounded-xl border border-lib-border bg-lib-surface-strong shadow-xl backdrop-blur-md sm:top-[calc(4.5rem+10px)] sm:right-5"
      style={{ ...drag.style, ...resize.style }}
      role="search"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[11px]">
      <div
        onPointerDown={drag.onHeaderPointerDown}
        className={`flex select-none items-center gap-1.5 border-b border-lib-border-soft px-2.5 py-1.5 ${
          drag.dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <GripIcon />
        <span className="flex-1 truncate text-[12px] font-semibold text-lib-text-strong">
          Search in book
        </span>
        <button
          type="button"
          className={iconButton}
          title="Close search"
          aria-label="Close search"
          data-no-drag
          onClick={onClose}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
            className="size-4"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-1 p-2">
        <form
          className="flex min-w-0 flex-1 items-center gap-2 pl-1"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
            className="size-4 shrink-0 text-lib-muted"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"
            />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault()
                previous()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
            placeholder="Search in book…"
            aria-label="Search in book"
            title="Enter: search / next · Shift+Enter: previous"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 border-none bg-transparent text-sm text-lib-text outline-none placeholder:text-lib-muted"
          />
          {busy ? (
            <span className="text-lib-muted">
              <Spinner />
            </span>
          ) : null}
        </form>
        <button
          type="button"
          className={iconButton}
          title="Previous match (Shift+Enter)"
          aria-label="Previous match"
          disabled={!canStep}
          onClick={previous}
        >
          <Chevron direction="up" />
        </button>
        <button
          type="button"
          className={iconButton}
          title="Next match (Enter)"
          aria-label="Next match"
          disabled={!canStep}
          onClick={() => void next()}
        >
          <Chevron direction="down" />
        </button>
      </div>

      <div className="flex items-center gap-1 px-2 pb-2">
        <OptionToggle
          title="Match case"
          pressed={options.matchCase}
          onToggle={() => setOptions({ matchCase: !options.matchCase })}
        >
          Aa
        </OptionToggle>
        <OptionToggle
          title="Whole words only"
          pressed={options.wholeWords}
          onToggle={() => setOptions({ wholeWords: !options.wholeWords })}
        >
          <span className="underline decoration-1 underline-offset-2">ab</span>
        </OptionToggle>
        <OptionToggle
          title="Match diacritics (ă ≠ a)"
          pressed={options.matchDiacritics}
          onToggle={() => setOptions({ matchDiacritics: !options.matchDiacritics })}
        >
          ă
        </OptionToggle>
        <SortDropdown order={order} onChange={setOrder} />
      </div>

      <StatusLine />

      {matches.length > 0 ? (
        <ul
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto border-t border-lib-border-soft py-1"
          style={resize.style ? undefined : { maxHeight: 'min(50vh, 420px)' }}
          aria-label="Search results"
        >
          {matches.map((match, index) => (
            <ResultItem
              key={match.occurrence}
              match={match}
              label={chapterLabels[match.chapterIndex]}
              active={index === activeIndex}
              onSelect={() => goTo(index)}
            />
          ))}
          {hasMore ? (
            <li className="px-3 py-2">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-md py-1.5 text-[12px] font-semibold text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong disabled:cursor-default"
              >
                {loadingMore ? <Spinner /> : null}
                Show more ({formatCount(totalMatches - matches.length)} left)
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      </div>

      {/* Window-style resize hit-zones — invisible, straddling the panel's border on all four
          edges and corners so the pointer only needs to be near the edge, not exactly on it.
          Corners render after (so they win on overlap) and are given a larger zone. */}
      <div
        onPointerDown={(e) => resize.onResizePointerDown('n', e)}
        className="absolute inset-x-3 -top-1 h-2 cursor-ns-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('s', e)}
        className="absolute inset-x-3 -bottom-1 h-2 cursor-ns-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('w', e)}
        className="absolute inset-y-3 -left-1 w-2 cursor-ew-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('e', e)}
        className="absolute inset-y-3 -right-1 w-2 cursor-ew-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('nw', e)}
        className="absolute -top-1 -left-1 size-3 cursor-nwse-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('ne', e)}
        className="absolute -top-1 -right-1 size-3 cursor-nesw-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('sw', e)}
        className="absolute -bottom-1 -left-1 size-3 cursor-nesw-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('se', e)}
        title="Drag to resize"
        className="absolute -right-1 -bottom-1 flex size-4 touch-none items-end justify-end p-0.5 cursor-nwse-resize"
      >
        <ResizeHandleIcon />
      </div>
    </div>
  )
}

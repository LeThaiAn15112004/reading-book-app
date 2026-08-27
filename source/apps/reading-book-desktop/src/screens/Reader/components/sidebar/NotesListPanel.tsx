import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import {
  typewriterPlainText,
  type ReaderAnnotationStatus,
  type ReaderAnnotationType,
  type ReaderHighlight,
  type ReaderShapeAnnotation,
  type ReaderTypewriterNote,
} from '@reading-book/shared/models'

type SortMode = 'chapter' | 'az' | 'za'
type ExpandOverride = 'expand' | 'collapse' | null

const toolbarBtnClass =
  'inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-lib-muted transition-colors hover:bg-lib-surface-hover hover:text-lib-text-strong'

const rowMenuBtnClass =
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-base leading-none text-lib-muted transition-colors hover:bg-lib-accent-soft hover:text-lib-accent'

const jumpBtnClass =
  'cursor-pointer border-none bg-transparent p-0 text-left outline-none focus:outline-none focus-visible:outline-none'

function ExpandAllIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
      <path
        d="M4 7h10M4 12h10M4 17h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M17 9.5 19.5 12 17 14.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CollapseAllIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
      <path
        d="M4 7h10M4 12h10M4 17h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M19.5 9.5 17 12l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AzSortIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
      <text
        x="3"
        y="10"
        fill="currentColor"
        fontSize="8"
        fontWeight="700"
        fontFamily="system-ui,sans-serif"
      >
        A
      </text>
      <text
        x="3"
        y="19"
        fill="currentColor"
        fontSize="8"
        fontWeight="700"
        fontFamily="system-ui,sans-serif"
      >
        Z
      </text>
      <path
        d="M14 5v12.5M14 17.5 11.5 15M14 17.5 16.5 15"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
      <path
        d="M4 6h16l-6.5 7.2V18l-3 1.5v-6.3L4 6Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * One row in the list. EPUB is reflowable, so items are keyed by `sectionIndex`
 * (0-based spine position resolved from the annotation's CFI) — never a page number.
 * `content` is the original text the user marked; `notes` is what they typed on top.
 */
type NoteListItemBase = {
  id: string
  sectionIndex: number
  content: string
  notes?: string
  status: ReaderAnnotationStatus
  isChecked: boolean
  colorHex?: string
  createdAt: string
  updatedAt: string
}

type NoteListItem =
  | (NoteListItemBase & {
      kind: 'highlight'
      type: ReaderAnnotationType
      highlight: ReaderHighlight
    })
  | (NoteListItemBase & {
      kind: 'typewriter'
      type: 'textbox'
      note: ReaderTypewriterNote
    })
  | (NoteListItemBase & {
      kind: 'pencil'
      type: 'freehand'
      stroke: ReaderShapeAnnotation
    })

type NotesListPanelProps = {
  highlights: ReaderHighlight[]
  typewriterNotes: ReaderTypewriterNote[]
  freehandStrokes?: ReaderShapeAnnotation[]
  /** 1-based spine section currently on screen — seeds which group starts expanded. */
  sectionCurrent?: number
  /** TOC-resolved chapter titles indexed by 0-based spine position. */
  sectionLabels?: string[]
  /** Opens a 1-based spine section (`goToSpineIndex(n - 1)`), not a physical page. */
  onGoToSection: (section: number) => void
  onJump: (highlight: ReaderHighlight) => void
  onJumpTypewriterNote: (note: ReaderTypewriterNote) => void
  onJumpPencilStroke?: (stroke: ReaderShapeAnnotation) => void
  onToggleChecked: (id: string, isChecked: boolean) => void
  onSetStatus: (id: string, status: ReaderAnnotationStatus) => void
  onEditContent: (item: NoteListItem) => void
  onDelete: (item: NoteListItem) => void
  onTags?: (item: NoteListItem) => void
}

type AnnotationMenuActions = {
  onJump: () => void
  onSetStatus: (status: ReaderAnnotationStatus) => void
  onEditContent: () => void
  onDelete: () => void
  onTags: () => void
}

type TypeFilter = ReaderAnnotationType | 'all'
type StatusQuickFilter = 'all' | 'Review' | 'checked'

const TYPE_META: Record<
  ReaderAnnotationType,
  { icon: string; label: string }
> = {
  highlight: { icon: '🖍', label: 'Highlight' },
  underline: { icon: '‿', label: 'Underline' },
  strikethrough: { icon: '̶', label: 'Strikethrough' },
  freehand: { icon: '✏️', label: 'Pencil' },
  textbox: { icon: '⌨️', label: 'Textbox' },
  stamp: { icon: '🏷', label: 'Stamp' },
}

const STATUS_STYLES: Record<
  ReaderAnnotationStatus,
  { label: string; className: string }
> = {
  None: {
    label: 'None',
    className: 'border-lib-border-soft bg-transparent text-lib-faint',
  },
  Review: {
    label: 'Review',
    className: 'border-amber-400/50 bg-amber-400/15 text-amber-300',
  },
  Done: {
    label: 'Done',
    className: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300',
  },
}

/**
 * Structural home of an annotation: the 0-based spine section. For EPUB highlights
 * `chapterIndex` is resolved from the CFI itself, so this never depends on pagination.
 */
function sectionIndexOf(a: { chapterIndex: number }): number {
  return Math.max(0, Math.floor(a.chapterIndex))
}

/** TOC title for a spine section, falling back to a stable structural label. */
function sectionLabelFor(sectionIndex: number, labels?: string[]): string {
  return labels?.[sectionIndex]?.trim() || `Section ${sectionIndex + 1}`
}

const RELATIVE_TIME_UNITS: Array<{ limit: number; div: number; unit: string }> = [
  { limit: 60_000, div: 1_000, unit: 'sec' },
  { limit: 3_600_000, div: 60_000, unit: 'min' },
  { limit: 86_400_000, div: 3_600_000, unit: 'hour' },
  { limit: 2_592_000_000, div: 86_400_000, unit: 'day' },
]

/** "5 min ago" — the reading-time context that replaces a page number in the meta line. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const elapsed = Date.now() - then
  if (elapsed < 45_000) return 'just now'
  for (const { limit, div, unit } of RELATIVE_TIME_UNITS) {
    if (elapsed < limit) {
      const value = Math.floor(elapsed / div)
      return `${value} ${unit}${value === 1 ? '' : 's'} ago`
    }
  }
  return new Date(then).toLocaleDateString()
}

function toItems(
  highlights: ReaderHighlight[],
  typewriterNotes: ReaderTypewriterNote[],
  freehandStrokes: ReaderShapeAnnotation[] = [],
): NoteListItem[] {
  return [
    ...highlights.map((h) => ({
      kind: 'highlight' as const,
      id: h.id,
      type: (h.type ?? 'highlight') as ReaderAnnotationType,
      sectionIndex: sectionIndexOf(h),
      // Part 1 is the marked source text; part 2 is the user's own note.
      content: h.selectedText,
      notes: h.note?.trim() || undefined,
      status: h.status ?? 'None',
      isChecked: h.isChecked ?? false,
      colorHex: h.colorHex,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt || h.createdAt,
      highlight: h,
    })),
    ...typewriterNotes.map((n) => ({
      kind: 'typewriter' as const,
      id: n.id,
      type: 'textbox' as const,
      sectionIndex: sectionIndexOf(n),
      content: typewriterPlainText(n.content) || n.content,
      status: n.status ?? 'None',
      isChecked: n.isChecked ?? false,
      colorHex: n.colorHex,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt || n.createdAt,
      note: n,
    })),
    ...freehandStrokes.map((s) => ({
      kind: 'pencil' as const,
      id: s.id,
      type: 'freehand' as const,
      sectionIndex: sectionIndexOf(s),
      content: 'Pencil stroke',
      notes: s.note?.trim() || undefined,
      status: s.status ?? 'None',
      isChecked: s.isChecked ?? false,
      colorHex: s.colorHex,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt || s.createdAt,
      stroke: s,
    })),
  ]
}

const STATUS_OPTIONS: ReaderAnnotationStatus[] = ['None', 'Review', 'Done']

const menuItemClass =
  'flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-2.5 py-2 text-left text-[12px] font-medium text-lib-text-strong hover:bg-lib-bg-deep/40'

type MenuCoords = { top: number; left: number }

function AnnotationContextMenu({
  open,
  anchorRect,
  status,
  actions,
  menuRef,
  onClose,
}: {
  open: boolean
  anchorRect: DOMRect | null
  status: ReaderAnnotationStatus
  actions: AnnotationMenuActions
  menuRef: Ref<HTMLDivElement>
  onClose: () => void
}) {
  const [statusOpen, setStatusOpen] = useState(false)
  const [coords, setCoords] = useState<MenuCoords | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchorRect) {
      setCoords(null)
      setStatusOpen(false)
      return
    }
    const menuWidth = 196
    const gap = 4
    const left = Math.min(
      Math.max(8, anchorRect.right - menuWidth),
      window.innerWidth - menuWidth - 8,
    )
    const top = Math.min(
      anchorRect.bottom + gap,
      window.innerHeight - 8,
    )
    setCoords({ top, left })
  }, [open, anchorRect])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onScroll() {
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onClose)
    // Close when sidebar list scrolls (capture on any scrollable ancestor).
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, onClose])

  if (!open || !coords) return null

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[400] min-w-[196px] rounded-lg border border-lib-border bg-lib-surface-strong py-1 shadow-xl"
      style={{ top: coords.top, left: coords.left }}
      role="menu"
      aria-label="Annotation actions"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className={menuItemClass}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          actions.onJump()
        }}
      >
        <span>Jump to location</span>
      </button>

      <button
        type="button"
        role="menuitem"
        className={menuItemClass}
        onClick={() => {
          onClose()
          actions.onEditContent()
        }}
      >
        <span>Edit content</span>
      </button>

      <div
        className="relative"
        onMouseEnter={() => setStatusOpen(true)}
        onMouseLeave={() => setStatusOpen(false)}
      >
        <button
          type="button"
          role="menuitem"
          className={menuItemClass}
          aria-haspopup="menu"
          aria-expanded={statusOpen}
          onClick={() => setStatusOpen((v) => !v)}
        >
          <span>Set status</span>
          <span className="text-lib-faint" aria-hidden>
            ▸
          </span>
        </button>
        {statusOpen ? (
          <div
            className="absolute top-0 left-full z-[410] ml-1 min-w-[132px] rounded-lg border border-lib-border bg-lib-surface-strong py-1 shadow-xl"
            role="menu"
            aria-label="Status options"
          >
            {STATUS_OPTIONS.map((option) => {
              const style = STATUS_STYLES[option]
              const active = status === option
              return (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={`${menuItemClass} ${
                    active ? 'bg-lib-accent-soft text-lib-accent' : ''
                  }`}
                  onClick={() => {
                    onClose()
                    actions.onSetStatus(option)
                  }}
                >
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${style.className}`}
                  >
                    {style.label}
                  </span>
                  {active ? <span aria-hidden>✓</span> : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        role="menuitem"
        className={menuItemClass}
        onClick={() => {
          onClose()
          actions.onTags()
        }}
      >
        <span>Tags</span>
      </button>

      <div className="my-1 border-t border-lib-border-soft" />

      <button
        type="button"
        role="menuitem"
        className={`${menuItemClass} text-red-400 hover:bg-red-500/10`}
        onClick={() => {
          onClose()
          actions.onDelete()
        }}
      >
        <span>Delete</span>
      </button>
    </div>,
    document.body,
  )
}

function ContentFullDialog({
  open,
  title,
  content,
  notes,
  onClose,
}: {
  open: boolean
  title: string
  content: string
  notes?: string
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[min(70vh,520px)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-lib-border bg-lib-surface-strong shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-lib-border-soft px-4 py-3">
          <h3 className="m-0 truncate text-[14px] font-semibold text-lib-text-strong">
            {title}
          </h3>
          <button
            type="button"
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="m-0 whitespace-pre-wrap text-[13px] leading-relaxed text-lib-text">
            {content.trim() || 'Empty'}
          </p>
          {notes?.trim() ? (
            <>
              <p className="m-0 mt-4 mb-1 text-[11px] font-semibold tracking-wide text-lib-faint uppercase">
                Note
              </p>
              <p className="m-0 border-l-2 border-lib-accent/50 pl-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-lib-muted">
                {notes.trim()}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function AnnotationRow({
  item,
  sectionLabel,
  onJump,
  onToggleChecked,
  actions,
}: {
  item: NoteListItem
  sectionLabel: string
  onJump: () => void
  onToggleChecked: (isChecked: boolean) => void
  actions: AnnotationMenuActions
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const [fullOpen, setFullOpen] = useState(false)
  const [clamped, setClamped] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLParagraphElement | null>(null)
  const meta = TYPE_META[item.type] ?? TYPE_META.highlight
  const statusStyle = STATUS_STYLES[item.status] ?? STATUS_STYLES.None
  const contentText = item.content.trim() || 'Empty'
  const notesText = item.notes?.trim() ?? ''
  const timeText = relativeTime(item.updatedAt)
  const metaLine = [sectionLabel, timeText].filter(Boolean).join(' • ')

  const closeMenu = () => {
    setMenuOpen(false)
    setAnchorRect(null)
  }

  const openMenuFrom = (el: HTMLElement | null) => {
    if (!el) return
    setAnchorRect(el.getBoundingClientRect())
    setMenuOpen(true)
  }

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) {
      setClamped(false)
      return
    }
    function measure() {
      if (!el) return
      setClamped(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(measure)
        : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [contentText])

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      closeMenu()
    }
    // Capture so we win against other stopPropagation handlers.
    window.addEventListener('mousedown', onPointerDown, true)
    return () => window.removeEventListener('mousedown', onPointerDown, true)
  }, [menuOpen])

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-lib-border-soft bg-lib-surface px-2.5 py-2"
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openMenuFrom(triggerRef.current)
      }}
    >
      <div className="flex items-center gap-2">
        <label
          className="inline-flex shrink-0 cursor-pointer items-center"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <span className="sr-only">Mark complete</span>
          <input
            type="checkbox"
            className="size-3.5 cursor-pointer accent-[var(--lib-accent)]"
            checked={item.isChecked}
            onChange={(e) => onToggleChecked(e.target.checked)}
          />
        </label>

        <button
          type="button"
          className={`inline-flex min-w-0 flex-1 items-center gap-1.5 ${jumpBtnClass}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onJump()
            e.currentTarget.blur()
          }}
          title={`Jump · ${meta.label}`}
        >
          <span
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-lib-hint text-[11px]"
            title={meta.label}
            aria-label={meta.label}
            style={
              item.colorHex
                ? { boxShadow: `inset 0 0 0 1.5px ${item.colorHex}` }
                : undefined
            }
          >
            {meta.icon}
          </span>
          <span className="truncate text-[12px] font-medium text-lib-muted">
            {meta.label}
          </span>
        </button>

        <button
          type="button"
          className={`shrink-0 cursor-pointer rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${statusStyle.className}`}
          title="Set status"
          aria-label={`Status ${item.status}`}
          onClick={(e) => {
            e.stopPropagation()
            openMenuFrom(triggerRef.current)
          }}
        >
          {statusStyle.label}
        </button>

        <div className="relative shrink-0">
          <button
            ref={triggerRef}
            type="button"
            className={rowMenuBtnClass}
            title="More actions"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation()
              if (menuOpen) {
                closeMenu()
                return
              }
              openMenuFrom(e.currentTarget)
            }}
          >
            ⋮
          </button>
          <AnnotationContextMenu
            open={menuOpen}
            anchorRect={anchorRect}
            status={item.status}
            actions={actions}
            menuRef={menuRef}
            onClose={closeMenu}
          />
        </div>
      </div>

      <div className="flex min-w-0 gap-2 pl-6">
        {/* Colour bar echoes the mark's own colour so the type reads at a glance. */}
        <span
          aria-hidden
          className="mt-0.5 w-[3px] shrink-0 rounded-full"
          style={{ backgroundColor: item.colorHex || 'var(--lib-border)' }}
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className={`w-full ${jumpBtnClass}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onJump()
              e.currentTarget.blur()
            }}
          >
            <p
              ref={contentRef}
              className="m-0 line-clamp-3 text-[13px] leading-snug text-lib-text"
            >
              {contentText}
            </p>
            {notesText ? (
              <p className="m-0 mt-1 line-clamp-2 border-l-2 border-lib-accent/50 pl-2 text-[12px] leading-snug text-lib-muted italic">
                {notesText}
              </p>
            ) : null}
            <p className="m-0 mt-1.5 truncate text-[11px] text-lib-faint">
              {metaLine}
            </p>
          </button>
          {clamped || notesText ? (
            <button
              type="button"
              className="mt-1 cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold text-lib-accent hover:underline"
              onClick={(e) => {
                e.stopPropagation()
                setFullOpen(true)
              }}
            >
              Show full
            </button>
          ) : null}
        </div>
      </div>

      <ContentFullDialog
        open={fullOpen}
        title={`${meta.label} · ${sectionLabel}`}
        content={contentText}
        notes={notesText}
        onClose={() => setFullOpen(false)}
      />
    </div>
  )
}

/** One collapsible group per EPUB chapter/section — the reflowable stand-in for a page. */
function ChapterAccordion({
  sectionIndex,
  sectionLabel,
  items,
  expanded,
  onToggleExpand,
  onGoToSection,
  onJumpItem,
  onToggleChecked,
  getActions,
}: {
  sectionIndex: number
  sectionLabel: string
  items: NoteListItem[]
  expanded: boolean
  onToggleExpand: () => void
  onGoToSection: (section: number) => void
  onJumpItem: (item: NoteListItem) => void
  onToggleChecked: (id: string, isChecked: boolean) => void
  getActions: (item: NoteListItem) => AnnotationMenuActions
}) {
  const countLabel = `${items.length} item${items.length === 1 ? '' : 's'}`

  return (
    <section className="rounded-lg border border-lib-border-soft bg-lib-surface-strong/40">
      <div className="flex items-stretch">
        <button
          type="button"
          className="inline-flex w-8 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong"
          aria-label={expanded ? 'Collapse chapter' : 'Expand chapter'}
          aria-expanded={expanded}
          onClick={onToggleExpand}
        >
          <span
            className={`inline-block text-[11px] transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
            aria-hidden
          >
            ▸
          </span>
        </button>
        <button
          type="button"
          className={`flex min-w-0 flex-1 items-center justify-between gap-2 px-1 py-2.5 ${jumpBtnClass} hover:bg-lib-surface-hover`}
          onClick={(e) => {
            // 1-based spine section — resolves to goToSpineIndex(n - 1).
            onGoToSection(sectionIndex + 1)
            e.currentTarget.blur()
          }}
          title={`Go to ${sectionLabel}`}
        >
          <span className="truncate text-[13px] font-semibold text-lib-text-strong">
            {sectionLabel}
          </span>
          <span className="shrink-0 rounded-full bg-lib-hint px-2 py-0.5 text-[11px] font-semibold text-lib-muted">
            {countLabel}
          </span>
        </button>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-1.5 border-t border-lib-border-soft px-2 py-2">
          {items.map((item) => (
            <AnnotationRow
              key={item.id}
              item={item}
              sectionLabel={sectionLabel}
              onJump={() => onJumpItem(item)}
              onToggleChecked={(isChecked) =>
                onToggleChecked(item.id, isChecked)
              }
              actions={getActions(item)}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

export function NotesListPanel({
  highlights,
  typewriterNotes,
  freehandStrokes = [],
  sectionCurrent,
  sectionLabels,
  onGoToSection,
  onJump,
  onJumpTypewriterNote,
  onJumpPencilStroke,
  onToggleChecked,
  onSetStatus,
  onEditContent,
  onDelete,
  onTags,
}: NotesListPanelProps) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusQuickFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('chapter')
  const [filterOpen, setFilterOpen] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<number>>(
    () => new Set(),
  )
  const expandOverrideRef = useRef<ExpandOverride>(null)
  const filterPanelRef = useRef<HTMLDivElement | null>(null)

  const allItems = useMemo(
    () => toItems(highlights, typewriterNotes, freehandStrokes),
    [highlights, typewriterNotes, freehandStrokes],
  )

  const availableTypes = useMemo(() => {
    const set = new Set<ReaderAnnotationType>()
    for (const item of allItems) set.add(item.type)
    return (Object.keys(TYPE_META) as ReaderAnnotationType[]).filter((t) =>
      set.has(t),
    )
  }, [allItems])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allItems.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false
      if (statusFilter === 'Review' && item.status !== 'Review') return false
      if (statusFilter === 'checked' && !item.isChecked) return false
      if (!q) return true
      return item.content.toLowerCase().includes(q)
    })
  }, [allItems, query, typeFilter, statusFilter])

  const chapterGroups = useMemo(() => {
    const map = new Map<number, NoteListItem[]>()
    for (const item of filtered) {
      const list = map.get(item.sectionIndex)
      if (list) list.push(item)
      else map.set(item.sectionIndex, [item])
    }

    const sortItems = (items: NoteListItem[]) => {
      const copy = [...items]
      if (sortMode === 'az') {
        copy.sort((a, b) =>
          a.content.localeCompare(b.content, undefined, { sensitivity: 'base' }),
        )
      } else if (sortMode === 'za') {
        copy.sort((a, b) =>
          b.content.localeCompare(a.content, undefined, { sensitivity: 'base' }),
        )
      } else {
        copy.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
      }
      return copy
    }

    return [...map.entries()]
      .sort(([a], [b]) => a - b)
      .map(([sectionIndex, items]) => ({
        sectionIndex,
        sectionLabel: sectionLabelFor(sectionIndex, sectionLabels),
        items: sortItems(items),
      }))
  }, [filtered, sortMode, sectionLabels])

  // Auto-expand matching chapters when searching / filtering; seed the current chapter.
  useEffect(() => {
    if (chapterGroups.length === 0) {
      setExpandedSections(new Set())
      return
    }
    const hasActiveFilter =
      query.trim().length > 0 ||
      typeFilter !== 'all' ||
      statusFilter !== 'all'

    if (hasActiveFilter) {
      expandOverrideRef.current = null
      setExpandedSections(new Set(chapterGroups.map((g) => g.sectionIndex)))
      return
    }

    if (expandOverrideRef.current === 'collapse') {
      setExpandedSections(new Set())
      return
    }
    if (expandOverrideRef.current === 'expand') {
      setExpandedSections(new Set(chapterGroups.map((g) => g.sectionIndex)))
      return
    }

    setExpandedSections((prev) => {
      if (prev.size > 0) {
        const next = new Set(
          [...prev].filter((s) =>
            chapterGroups.some((g) => g.sectionIndex === s),
          ),
        )
        if (next.size > 0) return next
      }
      // `sectionCurrent` is 1-based on screen; groups are keyed 0-based.
      const current = sectionCurrent != null ? sectionCurrent - 1 : undefined
      const seed =
        current != null &&
        chapterGroups.some((g) => g.sectionIndex === current)
          ? current
          : chapterGroups[0]!.sectionIndex
      return new Set([seed])
    })
  }, [chapterGroups, query, typeFilter, statusFilter, sectionCurrent])

  useEffect(() => {
    if (!filterOpen) return
    function onPointerDown(e: MouseEvent) {
      if (!filterPanelRef.current?.contains(e.target as Node)) {
        setFilterOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setFilterOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [filterOpen])

  function expandAll() {
    expandOverrideRef.current = 'expand'
    setExpandedSections(new Set(chapterGroups.map((g) => g.sectionIndex)))
  }

  function collapseAll() {
    expandOverrideRef.current = 'collapse'
    setExpandedSections(new Set())
  }

  function cycleSortMode() {
    setSortMode((prev) =>
      prev === 'chapter' ? 'az' : prev === 'az' ? 'za' : 'chapter',
    )
  }

  function toggleSection(sectionIndex: number) {
    expandOverrideRef.current = null
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionIndex)) next.delete(sectionIndex)
      else next.add(sectionIndex)
      return next
    })
  }

  const filterActive = typeFilter !== 'all' || statusFilter !== 'all'
  const sortLabel =
    sortMode === 'az'
      ? 'Sorted A–Z'
      : sortMode === 'za'
        ? 'Sorted Z–A'
        : 'Sort A–Z'

  function jumpItem(item: NoteListItem) {
    if (item.kind === 'highlight') {
      onJump(item.highlight)
      return
    }
    if (item.kind === 'pencil') {
      onJumpPencilStroke?.(item.stroke)
      return
    }
    onJumpTypewriterNote(item.note)
  }

  function getActions(item: NoteListItem): AnnotationMenuActions {
    return {
      onJump: () => jumpItem(item),
      onSetStatus: (status) => onSetStatus(item.id, status),
      onEditContent: () => onEditContent(item),
      onDelete: () => onDelete(item),
      onTags: () => onTags?.(item),
    }
  }

  const hasAnyNotes = allItems.length > 0

  if (!hasAnyNotes) {
    return (
      <p className="m-0 px-4 py-6 text-center text-[13px] text-lib-faint">
        No notes yet
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-0.5 px-0.5">
        <button
          type="button"
          className={toolbarBtnClass}
          title="Expand all"
          aria-label="Expand all"
          onClick={expandAll}
        >
          <ExpandAllIcon />
        </button>
        <button
          type="button"
          className={toolbarBtnClass}
          title="Collapse all"
          aria-label="Collapse all"
          onClick={collapseAll}
        >
          <CollapseAllIcon />
        </button>
        <button
          type="button"
          className={`${toolbarBtnClass} ${
            sortMode !== 'chapter'
              ? 'bg-lib-accent-soft text-lib-accent hover:bg-lib-accent-soft hover:text-lib-accent'
              : ''
          }`}
          title={sortLabel}
          aria-label={sortLabel}
          aria-pressed={sortMode !== 'chapter'}
          onClick={cycleSortMode}
        >
          <AzSortIcon />
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search notes</span>
          <input
            className="h-9 w-full rounded-lg border border-lib-border bg-lib-input py-0 pr-3 pl-8 text-[13px] text-lib-text-strong outline-none placeholder:text-lib-faint focus:border-lib-accent"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
          />
          <span
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-lib-faint"
            aria-hidden
          >
            🔍
          </span>
        </label>

        <div className="relative shrink-0" ref={filterPanelRef}>
          <button
            type="button"
            className={`${toolbarBtnClass} ${
              filterOpen || filterActive
                ? 'bg-lib-accent-soft text-lib-accent hover:bg-lib-accent-soft hover:text-lib-accent'
                : ''
            }`}
            title="Filter"
            aria-label="Filter"
            aria-expanded={filterOpen}
            aria-haspopup="dialog"
            onClick={() => setFilterOpen((open) => !open)}
          >
            <FilterIcon />
          </button>

          {filterOpen ? (
            <div
              className="absolute top-9 right-0 z-20 w-[220px] rounded-lg border border-lib-border bg-lib-surface-strong p-2.5 shadow-xl"
              role="dialog"
              aria-label="Note filters"
            >
              <p className="m-0 mb-2 text-[11px] font-semibold tracking-wide text-lib-faint uppercase">
                Type
              </p>
              <div className="mb-2.5 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  className={`h-7 cursor-pointer rounded-full border px-2.5 text-[11px] font-semibold ${
                    typeFilter === 'all'
                      ? 'border-lib-accent bg-lib-accent-soft text-lib-accent'
                      : 'border-lib-border-soft bg-transparent text-lib-muted hover:text-lib-text'
                  }`}
                  onClick={() => setTypeFilter('all')}
                >
                  All
                </button>
                {availableTypes.map((type) => {
                  const meta = TYPE_META[type]
                  const active = typeFilter === type
                  return (
                    <button
                      key={type}
                      type="button"
                      title={meta.label}
                      aria-label={meta.label}
                      aria-pressed={active}
                      className={`inline-flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-full border px-1.5 text-[12px] ${
                        active
                          ? 'border-lib-accent bg-lib-accent-soft text-lib-accent'
                          : 'border-lib-border-soft bg-transparent text-lib-muted hover:text-lib-text'
                      }`}
                      onClick={() =>
                        setTypeFilter((prev) => (prev === type ? 'all' : type))
                      }
                    >
                      {meta.icon}
                    </button>
                  )
                })}
              </div>

              <p className="m-0 mb-2 text-[11px] font-semibold tracking-wide text-lib-faint uppercase">
                Status
              </p>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  className={`h-7 cursor-pointer rounded-full border px-2.5 text-[11px] font-semibold ${
                    statusFilter === 'Review'
                      ? 'border-amber-400/60 bg-amber-400/15 text-amber-300'
                      : 'border-lib-border-soft bg-transparent text-lib-muted hover:text-lib-text'
                  }`}
                  aria-pressed={statusFilter === 'Review'}
                  onClick={() =>
                    setStatusFilter((prev) =>
                      prev === 'Review' ? 'all' : 'Review',
                    )
                  }
                >
                  Review
                </button>
                <button
                  type="button"
                  className={`h-7 cursor-pointer rounded-full border px-2.5 text-[11px] font-semibold ${
                    statusFilter === 'checked'
                      ? 'border-lib-accent bg-lib-accent-soft text-lib-accent'
                      : 'border-lib-border-soft bg-transparent text-lib-muted hover:text-lib-text'
                  }`}
                  aria-pressed={statusFilter === 'checked'}
                  onClick={() =>
                    setStatusFilter((prev) =>
                      prev === 'checked' ? 'all' : 'checked',
                    )
                  }
                >
                  ✓ Checked
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {chapterGroups.length === 0 ? (
        <p className="m-0 px-2 py-4 text-center text-[13px] text-lib-faint">
          No matches
        </p>
      ) : (
        chapterGroups.map((group) => (
          <ChapterAccordion
            key={group.sectionIndex}
            sectionIndex={group.sectionIndex}
            sectionLabel={group.sectionLabel}
            items={group.items}
            expanded={expandedSections.has(group.sectionIndex)}
            onToggleExpand={() => toggleSection(group.sectionIndex)}
            onGoToSection={onGoToSection}
            onJumpItem={jumpItem}
            onToggleChecked={onToggleChecked}
            getActions={getActions}
          />
        ))
      )}
    </div>
  )
}

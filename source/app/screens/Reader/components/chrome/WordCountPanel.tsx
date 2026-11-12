import { useRef } from 'react'
import { useDraggableWordCountPanel, useResizableWordCountPanel } from '../../logic'
import type { WordCountStats, WordCountStatus } from '../../logic'
import { useT } from '../../../../i18n'

type WordCountPanelProps = {
  open: boolean
  status: WordCountStatus
  stats: WordCountStats
  errorMessage: string | null
  /** Current live page total from the reader's own pagination (reflow-dependent, so it comes
   *  from `ReaderScreen`'s nav state, not the static `book_chunks` index the other rows use). */
  pageTotal: number
  onClose: () => void
}

const iconButton =
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong'

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

function formatCount(value: number): string {
  return value.toLocaleString()
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 animate-spin rounded-full border-2 border-current/20 border-t-current"
    />
  )
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-lib-border-soft py-2 text-[13px] last:border-b-0">
      <span className="text-lib-text">{label}</span>
      <span className="tabular-nums font-semibold text-lib-text-strong">{formatCount(value)}</span>
    </div>
  )
}

/**
 * Foxit-style "Word Count" panel: a Statistics table (Pages, Words, Characters, Lines,
 * Non-Asian words, Asian characters/Korean), read straight from the `book_chunks` index already
 * built for in-book search (see `word-count-service.ts` in Main) — nothing here re-scans the
 * book's text.
 *
 * Floats over the reader exactly like `ReaderSearchPanel` — draggable by its header, resizable
 * from any edge/corner (see `useDraggableWordCountPanel`/`useResizableWordCountPanel`), no
 * dimming backdrop. It's a reference panel meant to sit alongside the page while reading, not a
 * blocking dialog.
 */
export function WordCountPanel({
  open,
  status,
  stats,
  errorMessage,
  pageTotal,
  onClose,
}: WordCountPanelProps) {
  const t = useT()
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useDraggableWordCountPanel(panelRef, open)
  const resize = useResizableWordCountPanel(panelRef)

  if (!open) return null

  return (
    <div
      ref={panelRef}
      // Same anchoring convention as `ReaderSearchPanel`: `absolute` against ReaderShell's own
      // box (already below the app's titlebar/menubar/tabs), not `fixed` — see that panel's doc
      // comment. Left side by default so it doesn't stack on top of the search panel's corner.
      // No `overflow-hidden` here — see `ReaderSearchPanel` for why (it would clip the resize
      // handles, which sit slightly outside the panel's box).
      className="absolute top-[calc(4.25rem+10px)] left-3 z-[120] flex w-[min(320px,calc(100vw-24px))] flex-col rounded-xl border border-lib-border bg-lib-surface-strong shadow-xl backdrop-blur-md sm:top-[calc(4.5rem+10px)] sm:left-5"
      style={{ ...drag.style, ...resize.style }}
      role="dialog"
      aria-labelledby="word-count-panel-title"
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
          <span
            className="flex-1 truncate text-[12px] font-semibold text-lib-text-strong"
            id="word-count-panel-title"
          >
            {t('reader.chrome.wordCount.title')}
          </span>
          <button
            type="button"
            className={iconButton}
            title={t('common.actions.close')}
            aria-label={t('common.actions.close')}
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

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {status === 'loading' || status === 'indexing' ? (
            <div className="flex items-center gap-2 py-4 text-[13px] text-lib-muted">
              <Spinner />
              {status === 'indexing' ? t('reader.chrome.wordCount.preparing') : t('reader.chrome.wordCount.counting')}
            </div>
          ) : status === 'unsupported' ? (
            <p className="m-0 py-2 text-[13px] leading-snug text-lib-muted">
              {t('reader.chrome.wordCount.unsupported')}
            </p>
          ) : status === 'error' ? (
            <p className="m-0 py-2 text-[13px] leading-snug text-lib-muted">
              {errorMessage ?? t('reader.chrome.wordCount.failed')}
            </p>
          ) : (
            <div className="flex flex-col">
              <div className="mb-1 text-[12px] font-semibold text-lib-muted">{t('reader.chrome.wordCount.statistics')}</div>
              <StatRow label={t('reader.chrome.wordCount.pages')} value={pageTotal} />
              <StatRow label={t('reader.chrome.wordCount.words')} value={stats.words} />
              <StatRow label={t('reader.chrome.wordCount.charactersNoSpaces')} value={stats.charactersNoSpaces} />
              <StatRow label={t('reader.chrome.wordCount.charactersWithSpaces')} value={stats.charactersWithSpaces} />
              <StatRow label={t('reader.chrome.wordCount.lines')} value={stats.lines} />
              <StatRow label={t('reader.chrome.wordCount.nonAsianWords')} value={stats.nonAsianWords} />
              <StatRow label={t('reader.chrome.wordCount.asianCharacters')} value={stats.asianCharacters} />
            </div>
          )}
        </div>
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
        title={t('reader.chrome.wordCount.dragToResize')}
        className="absolute -right-1 -bottom-1 flex size-4 touch-none cursor-nwse-resize items-end justify-end p-0.5"
      >
        <ResizeHandleIcon />
      </div>
    </div>
  )
}

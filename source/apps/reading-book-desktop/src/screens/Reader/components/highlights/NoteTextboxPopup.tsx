import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReaderHighlight } from '@reading-book/book-reader-sdk'
import type { ViewportRectLike } from '../../../../reader/renderers/epub'
import { highlightPopoverPosition, useDismissOnOutsideOrEscape } from '../../logic'

type NoteTextboxPopupProps = {
  anchorRect: ViewportRectLike
  highlight: ReaderHighlight
  onSave: (note: string) => void
  onDelete: () => void
  onDismiss: () => void
}

const FALLBACK_SIZE = { width: 240, height: 140 }

/**
 * Sticky-note popup for a `textbox` note (see `HighlightContextMenu`'s "Add note" and the 📝
 * mark's click-to-reopen in `useReaderHighlights.focusHighlightFromClick`) — just the textarea
 * pattern from `NoteFloatingMenu`, without the color picker/copy/ask-AI rows that don't apply to
 * a plain note with no highlighted color. Always open in edit mode: a textbox note's entire
 * purpose is its text, unlike a highlight where the note is a secondary, optional field.
 */
export function NoteTextboxPopup({
  anchorRect,
  highlight,
  onSave,
  onDelete,
  onDismiss,
}: NoteTextboxPopupProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState(highlight.note ?? '')
  const [size, setSize] = useState(FALLBACK_SIZE)

  useDismissOnOutsideOrEscape(containerRef, onDismiss)

  useEffect(() => {
    setDraft(highlight.note ?? '')
  }, [highlight.id, highlight.note])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSize({ width: rect.width, height: rect.height })
  }, [anchorRect.top, anchorRect.left, highlight.id])

  const { top, left } = highlightPopoverPosition(anchorRect, size, {
    width: window.innerWidth,
    height: window.innerHeight,
  })

  function save() {
    onSave(draft)
    onDismiss()
  }

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Note"
      className="fixed z-[400] flex w-[240px] flex-col gap-2 rounded-xl border border-lib-border bg-lib-surface-strong p-2 shadow-xl"
      style={{ top, left }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            save()
          }
        }}
        placeholder="Note…"
        rows={4}
        className="w-full resize-none rounded-md border border-lib-border bg-lib-bg-mid/50 p-1.5 text-[12px] text-lib-text"
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          className="h-7 flex-1 cursor-pointer rounded-md border border-lib-border bg-transparent text-[12px] font-semibold text-lib-text hover:bg-lib-surface-hover"
          onClick={save}
        >
          Save
        </button>
        <button
          type="button"
          className="h-7 flex-1 cursor-pointer rounded-md border border-red-400/45 bg-red-400/15 text-[12px] font-semibold text-red-400"
          onClick={() => {
            onDismiss()
            onDelete()
          }}
        >
          Delete
        </button>
      </div>
    </div>,
    document.body,
  )
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReaderHighlight } from '@reading-book/book-reader-sdk'
import type { ViewportRectLike } from '../../../../reader/renderers/epub'
import { highlightPopoverPosition, useDismissOnOutsideOrEscape } from '../../logic'
import { HighlightColorPicker } from '../highlights/HighlightColorPicker'

type NoteFloatingMenuProps = {
  open: boolean
  /** Screen rect to anchor the popover next to — the "⋯" button, or the highlight mark that was
   *  clicked directly in the book. */
  anchorRect: ViewportRectLike | null
  highlight: ReaderHighlight
  onChangeColor: (colorHex: string) => void
  onEditNote: (note: string) => void
  onCopy: () => void
  onAskAi: () => void
  onDelete: () => void
  onDismiss: () => void
}

const FALLBACK_SIZE = { width: 220, height: 120 }

/**
 * Floating toolbar for one highlight/underline: quick color picker, edit-note, copy, an AI-ask
 * hook, and delete. Shared by the "⋯" kebab on a sidebar note card (`NoteItemMenu`) and a direct
 * click on the highlight's mark in the book while in hand mode (`ReaderScreen`) — same actions
 * and look at both call sites. Rendered through a portal into `document.body` since both call
 * sites live inside elements that animate with a CSS `transform` (the sidebar panel, the
 * zoomed/panned reading surface), which would otherwise re-anchor this `position: fixed` menu to
 * that box instead of the viewport.
 */
export function NoteFloatingMenu({
  open,
  anchorRect,
  highlight,
  onChangeColor,
  onEditNote,
  onCopy,
  onAskAi,
  onDelete,
  onDismiss,
}: NoteFloatingMenuProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [editingNote, setEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState(highlight.note ?? '')
  const [size, setSize] = useState(FALLBACK_SIZE)

  useDismissOnOutsideOrEscape(containerRef, onDismiss)

  // Reset the note editor whenever a fresh anchor opens — a stale draft from the previously
  // opened highlight must never leak into this one.
  useEffect(() => {
    if (!open) return
    setNoteDraft(highlight.note ?? '')
    setEditingNote(false)
  }, [open, highlight.id, highlight.note])

  // Re-measures on every content resize, not just on open — the color picker inside can expand
  // its own hue/alpha panel independently, which `highlightPopoverPosition` (below) needs to know
  // about to keep the menu from overflowing off-screen.
  useLayoutEffect(() => {
    if (!open) return
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [open])

  const position =
    open && anchorRect
      ? highlightPopoverPosition(anchorRect, size, {
          width: window.innerWidth,
          height: window.innerHeight,
        })
      : null

  if (!position) return null

  return createPortal(
    <div
      ref={containerRef}
      role="menu"
      aria-label="Note options"
      className="fixed z-[400] flex w-[220px] flex-col gap-2 rounded-xl border border-lib-border bg-lib-surface-strong p-2 shadow-xl"
      style={{ top: position.top, left: position.left }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="px-0.5">
        <HighlightColorPicker
          value={highlight.colorHex}
          styleKind={highlight.styleKind}
          onChange={onChangeColor}
        />
      </div>

      {editingNote ? (
        <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
          <textarea
            autoFocus
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Add a note…"
            rows={3}
            className="w-full resize-none rounded-md border border-lib-border bg-lib-bg-mid/50 p-1.5 text-[12px] text-lib-text"
          />
          <button
            type="button"
            role="menuitem"
            className="h-7 w-full cursor-pointer rounded-md border border-lib-border bg-transparent text-[12px] font-semibold text-lib-text hover:bg-lib-surface-hover"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onEditNote(noteDraft)
              setEditingNote(false)
            }}
          >
            Save note
          </button>
        </div>
      ) : (
        <button
          type="button"
          role="menuitem"
          className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-2 text-left text-[12px] font-semibold text-lib-text hover:bg-lib-surface-hover"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setEditingNote(true)
          }}
        >
          <span aria-hidden>📝</span>
          {highlight.note ? 'Edit note' : 'Add note'}
        </button>
      )}

      <button
        type="button"
        role="menuitem"
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-2 text-left text-[12px] font-semibold text-lib-text hover:bg-lib-surface-hover"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onCopy()
          onDismiss()
        }}
      >
        <span aria-hidden>📋</span>
        Copy text
      </button>

      <button
        type="button"
        role="menuitem"
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-2 text-left text-[12px] font-semibold text-lib-text hover:bg-lib-surface-hover"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onAskAi()
          onDismiss()
        }}
      >
        <span aria-hidden>✨</span>
        Ask AI
      </button>

      <div className="border-t border-lib-border-soft pt-1.5">
        <button
          type="button"
          role="menuitem"
          className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-2 text-left text-[12px] font-semibold text-red-400 hover:bg-red-400/10"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDismiss()
            onDelete()
          }}
        >
          <span aria-hidden>🗑</span>
          Delete
        </button>
      </div>
    </div>,
    document.body,
  )
}

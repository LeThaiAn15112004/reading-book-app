import { useRef, useState } from 'react'
import type { ReaderHighlight } from '@reading-book/book-reader-sdk'
import type { ViewportRectLike } from '../../../../reader/renderers/epub'
import { NoteFloatingMenu } from './NoteFloatingMenu'

type NoteItemMenuProps = {
  highlight: ReaderHighlight
  onChangeColor: (colorHex: string) => void
  onEditNote: (note: string) => void
  onCopy: () => void
  onAskAi: () => void
  onDelete: () => void
}

/**
 * "⋯" kebab button on a note card, opening `NoteFloatingMenu` anchored to itself — the same
 * floating toolbar a direct click on the highlight's mark in the book opens (see `ReaderScreen`),
 * just triggered from the sidebar instead.
 */
export function NoteItemMenu({
  highlight,
  onChangeColor,
  onEditNote,
  onCopy,
  onAskAi,
  onDelete,
}: NoteItemMenuProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState<ViewportRectLike | null>(null)

  function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      setAnchorRect({
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      })
    }
    setOpen(true)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="shrink-0 cursor-pointer rounded-md border-none bg-transparent px-1.5 py-0.5 text-sm leading-none text-lib-faint hover:bg-lib-surface-hover hover:text-lib-text-strong"
        aria-label="Note options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          toggle()
        }}
      >
        ⋯
      </button>
      <NoteFloatingMenu
        open={open}
        anchorRect={anchorRect}
        highlight={highlight}
        onChangeColor={onChangeColor}
        onEditNote={onEditNote}
        onCopy={onCopy}
        onAskAi={onAskAi}
        onDelete={onDelete}
        onDismiss={() => setOpen(false)}
      />
    </>
  )
}

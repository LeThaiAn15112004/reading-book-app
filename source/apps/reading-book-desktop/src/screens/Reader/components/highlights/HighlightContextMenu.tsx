import { useLayoutEffect, useRef, useState } from 'react'
import type { ViewportRectLike } from '../../../../reader/renderers/epub'
import { highlightPopoverPosition, useDismissOnOutsideOrEscape } from '../../logic'

export type HighlightContextMenuPoint = { x: number; y: number }

type HighlightContextMenuProps = {
  point: HighlightContextMenuPoint
  selectedText: string
  onHighlight: () => void
  onUnderline: () => void
  onStrikethrough: () => void
  onAddNote: () => void
  onBookmarkHere: () => void
  onCopy: () => void
  onCopyWithCitation: () => void
  onDismiss: () => void
}

const FALLBACK_SIZE = { width: 190, height: 260 }

const itemClass =
  'flex h-8 w-full cursor-pointer items-center rounded-md border-none bg-transparent px-2.5 text-left text-[12px] font-semibold text-lib-text hover:bg-lib-bg-mid/50 focus-visible:bg-lib-bg-mid/50 focus-visible:outline-none disabled:cursor-default disabled:opacity-40'

/** Right-click-only context menu for a fresh (not-yet-highlighted) text selection. */
export function HighlightContextMenu({
  point,
  selectedText,
  onHighlight,
  onUnderline,
  onStrikethrough,
  onAddNote,
  onBookmarkHere,
  onCopy,
  onCopyWithCitation,
  onDismiss,
}: HighlightContextMenuProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState(FALLBACK_SIZE)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSize({ width: rect.width, height: rect.height })
  }, [point.x, point.y])

  useDismissOnOutsideOrEscape(containerRef, onDismiss)

  const anchorRect: ViewportRectLike = {
    top: point.y,
    left: point.x,
    right: point.x,
    bottom: point.y,
    width: 0,
    height: 0,
  }
  const { top, left } = highlightPopoverPosition(anchorRect, size, {
    width: window.innerWidth,
    height: window.innerHeight,
  })

  function run(action: () => void) {
    onDismiss()
    action()
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-[400] flex w-[190px] flex-col gap-0.5 rounded-xl border border-lib-border bg-lib-surface-strong p-1.5 shadow-xl"
      style={{ top, left }}
      role="menu"
      aria-label="Selection options"
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <button type="button" role="menuitem" className={itemClass} onClick={() => run(onHighlight)}>
        Highlight
      </button>
      <button
        type="button"
        role="menuitem"
        className={`${itemClass} underline`}
        onClick={() => run(onUnderline)}
      >
        Underline
      </button>
      <button
        type="button"
        role="menuitem"
        className={`${itemClass} line-through`}
        onClick={() => run(onStrikethrough)}
      >
        Strikethrough
      </button>

      <div className="my-0.5 border-t border-lib-border-soft" />

      <button type="button" role="menuitem" className={itemClass} onClick={() => run(onAddNote)}>
        <span aria-hidden className="mr-1.5">📝</span>
        Add note
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => run(onBookmarkHere)}
      >
        <span aria-hidden className="mr-1.5">🔖</span>
        Bookmark here
      </button>

      <div className="my-0.5 border-t border-lib-border-soft" />

      <button
        type="button"
        role="menuitem"
        className={itemClass}
        disabled={!selectedText}
        onClick={() => run(onCopy)}
      >
        Copy
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        disabled={!selectedText}
        onClick={() => run(onCopyWithCitation)}
      >
        Copy with Citation
      </button>
    </div>
  )
}

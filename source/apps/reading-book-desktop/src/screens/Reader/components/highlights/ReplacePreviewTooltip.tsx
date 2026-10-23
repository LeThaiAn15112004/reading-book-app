import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ViewportRectLike } from '../../../../reader/renderers/epub'
import { highlightPopoverPosition } from '../../logic'

type ReplacePreviewTooltipProps = {
  anchorRect: ViewportRectLike
  /** The struck-out original text. */
  original?: string
  /** What the Replace note says should stand there instead. */
  replacement: string
}

const FALLBACK_SIZE = { width: 240, height: 60 }

/**
 * Hover preview of a Replace Text mark: shows the replacement next to the struck-out original,
 * without touching the book text itself. Never takes pointer events, so the hover that opened it
 * is not interrupted.
 */
export function ReplacePreviewTooltip({ anchorRect, original, replacement }: ReplacePreviewTooltipProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState(FALLBACK_SIZE)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSize({ width: rect.width, height: rect.height })
  }, [anchorRect.top, anchorRect.left, replacement, original])

  const { top, left } = highlightPopoverPosition(anchorRect, size, {
    width: window.innerWidth,
    height: window.innerHeight,
  })

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-[390] flex max-w-[280px] flex-col gap-1 rounded-lg border border-lib-border bg-lib-surface-strong px-2.5 py-1.5 text-[12px] text-lib-text shadow-xl"
      style={{ top, left }}
    >
      {original ? <span className="line-clamp-2 text-lib-muted line-through">{original}</span> : null}
      <span className="whitespace-pre-wrap break-words font-medium">{replacement}</span>
    </div>,
    document.body,
  )
}

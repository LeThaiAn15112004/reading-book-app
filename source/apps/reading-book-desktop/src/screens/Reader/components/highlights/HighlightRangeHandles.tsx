/**
 * Start/end handles for a focused highlight range (T5.1).
 * Word-like one-line carets with accent dots at each anchor.
 */

import type { HighlightHandleRect } from '@reading-book/shared/models'

export type { HighlightHandleRect }

type HighlightRangeHandlesProps = {
  rect: HighlightHandleRect | null
  /** Brief flash when overlap is rejected. */
  flash?: boolean
}

export function HighlightRangeHandles({
  rect,
  flash = false,
}: HighlightRangeHandlesProps) {
  if (
    !rect ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.start.lineHeight <= 0 ||
    rect.end.lineHeight <= 0
  ) {
    return null
  }

  const flashClass = flash ? 'animate-hl-flash' : ''
  // Below sidebar (z-150/160) so carets never cover Contents panel.
  const caretClass = `pointer-events-none fixed z-[140] w-0.5 bg-lib-accent ${flashClass}`
  const dotClass = `pointer-events-none fixed z-[140] size-3 rounded-full border-2 border-lib-on-accent bg-lib-accent shadow-[0_0_0_1px_var(--lib-accent-ring)] ${flashClass}`

  // Cap caret to one reading line even if geometry is coarse.
  const startH = Math.min(rect.start.lineHeight, 40)
  const endH = Math.min(rect.end.lineHeight, 40)

  return (
    <>
      {/* Start — vertical caret on the first line only */}
      <span
        className={caretClass}
        style={{
          top: rect.start.top,
          left: rect.start.left,
          height: startH,
          transform: 'translateX(-50%)',
        }}
        aria-hidden
      />
      <span
        className={dotClass}
        style={{
          top: rect.start.top,
          left: rect.start.left,
          transform: 'translate(-50%, -50%)',
        }}
        aria-hidden
      />
      {/* End — vertical caret on the last line only */}
      <span
        className={caretClass}
        style={{
          top: rect.end.top,
          left: rect.end.left,
          height: endH,
          transform: 'translateX(-50%)',
        }}
        aria-hidden
      />
      <span
        className={dotClass}
        style={{
          top: rect.end.top + endH,
          left: rect.end.left,
          transform: 'translate(-50%, -50%)',
        }}
        aria-hidden
      />
    </>
  )
}

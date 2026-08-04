/** Reading-surface cursor helpers for Hand / Text Select / Highlight modes. */

import type { InteractionTool } from '@reading-book/shared/models'

/** Hotspot at the chisel tip (bottom-left of the 32×32 SVG). */
const HIGHLIGHT_CURSOR_HOTSPOT = { x: 6, y: 28 } as const
const HIGHLIGHT_CURSOR_PATH = '/cursors/highlighter.svg'

export function highlightToolCursorCss(): string {
  const href =
    typeof window !== 'undefined'
      ? new URL(HIGHLIGHT_CURSOR_PATH, window.location.origin).href
      : HIGHLIGHT_CURSOR_PATH
  return `url("${href}") ${HIGHLIGHT_CURSOR_HOTSPOT.x} ${HIGHLIGHT_CURSOR_HOTSPOT.y}, text`
}

export function interactionToolCursorCss(
  tool: InteractionTool,
  grabbing = false,
): string {
  if (tool === 'hand') return grabbing ? 'grabbing' : 'grab'
  if (tool === 'highlight') return highlightToolCursorCss()
  return 'text'
}

/** Apply cursor + user-select onto the EPUB host and every content iframe. */
export function applyInteractionToolSurface(
  root: ParentNode | null,
  tool: InteractionTool,
  options?: { grabbing?: boolean },
) {
  if (!root) return
  const cursor = interactionToolCursorCss(tool, options?.grabbing === true)
  const userSelect = tool === 'hand' ? 'none' : 'text'

  const applyToEl = (el: HTMLElement | null | undefined) => {
    if (!el) return
    el.style.cursor = cursor
    el.style.userSelect = userSelect
    el.style.setProperty('-webkit-user-select', userSelect)
  }

  if (root instanceof HTMLElement) applyToEl(root)

  root.querySelectorAll('iframe').forEach((iframe) => {
    applyToEl(iframe)
    const doc = iframe.contentDocument
    if (!doc) return
    applyToEl(doc.documentElement)
    applyToEl(doc.body)
  })
}

/** @deprecated Prefer `applyInteractionToolSurface`. */
export function applyHighlightToolCursor(
  root: ParentNode | null,
  active: boolean,
) {
  applyInteractionToolSurface(root, active ? 'highlight' : 'hand')
}

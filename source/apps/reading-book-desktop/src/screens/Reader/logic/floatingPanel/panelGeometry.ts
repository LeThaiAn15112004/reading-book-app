/**
 * Shared geometry for every floating chrome panel that can be dragged/resized like an OS window
 * (Search, Word Count, …) — see `useDraggablePanel` / `useResizablePanel`. Kept store-agnostic:
 * each panel's own zustand store holds ITS OWN `position`/`size` fields (independent persistence
 * keys), these hooks just carry the pointer-event mechanics.
 */

/** Dragged/resized panel position in px, relative to its positioning container (its `offsetParent`). */
export type PanelPosition = { top: number; left: number }

/** User-resized panel size in px. Null = the panel's default CSS size. */
export type PanelSize = { width: number; height: number }

export const PANEL_MIN_WIDTH = 300
export const PANEL_MAX_WIDTH = 720
export const PANEL_MIN_HEIGHT = 220
export const PANEL_MAX_HEIGHT = 900

export function clampPanelSize(size: PanelSize): PanelSize {
  return {
    width: Math.min(Math.max(size.width, PANEL_MIN_WIDTH), PANEL_MAX_WIDTH),
    height: Math.min(Math.max(size.height, PANEL_MIN_HEIGHT), PANEL_MAX_HEIGHT),
  }
}

type Size = { width: number; height: number }

/** Keep the whole panel inside `container` — never let it drag/resize partly or fully off-screen. */
export function clampPanelPosition(
  position: PanelPosition,
  panel: Size,
  container: Size,
): PanelPosition {
  const maxLeft = Math.max(container.width - panel.width, 0)
  const maxTop = Math.max(container.height - panel.height, 0)
  return {
    left: Math.min(Math.max(position.left, 0), maxLeft),
    top: Math.min(Math.max(position.top, 0), maxTop),
  }
}

/** Which edge(s) of the panel a resize handle drags — same 8 zones as an OS window border. */
export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const CURSOR_BY_DIRECTION: Record<ResizeDirection, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
}

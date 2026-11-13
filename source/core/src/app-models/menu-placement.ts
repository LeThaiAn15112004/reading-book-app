/**
 * Where a pop-up menu opened at a point goes, so it stays fully inside the window (never under the OS taskbar /
 * dock, which sits just past the window's edge when it is maximized). Uses the menu's MEASURED size, not a guess:
 * below / right of the point when it fits, else flipped above / left of it, else pinned to the far edge; a menu
 * taller than the window gets `maxHeight` and scrolls.
 */
export interface MenuPlacementInput {
  /** The point the menu opens at (pointer, or the corner of the button that opened it). */
  x: number
  y: number
  /**
   * Where the menu's bottom goes when it is flipped above the point — the top of the button that opened it, so the
   * flipped menu does not cover that button. Default `y` (a pointer: the menu ends at the pointer).
   */
  flipY?: number
  /** Measured menu size (its full content height, before any max-height). */
  width: number
  height: number
  /** Window (viewport) size. */
  viewportWidth: number
  viewportHeight: number
  /** Gap kept from every window edge. Default 8. */
  margin?: number
}

export interface MenuPlacement {
  left: number
  top: number
  /** Set only when the menu is taller than the window minus both margins. */
  maxHeight?: number
}

function placeAxis(rawPoint: number, rawFlip: number, size: number, viewport: number, margin: number): number {
  const clamp = (v: number) => Math.min(Math.max(v, margin), viewport - margin)
  const point = clamp(rawPoint)
  const flip = clamp(rawFlip)
  const max = viewport - margin - size
  if (point <= max) return Math.max(margin, point) // fits after the point
  if (flip - size >= margin) return flip - size // flipped before the point
  return Math.max(margin, max) // neither: against the far edge (or the near one when too big)
}

export function placeMenu(input: MenuPlacementInput): MenuPlacement {
  const margin = input.margin ?? 8
  const room = Math.max(0, input.viewportHeight - 2 * margin)
  const height = Math.min(input.height, room)
  const placement: MenuPlacement = {
    left: placeAxis(input.x, input.x, input.width, input.viewportWidth, margin),
    top: placeAxis(input.y, input.flipY ?? input.y, height, input.viewportHeight, margin),
  }
  if (input.height > room) placement.maxHeight = room
  return placement
}

/**
 * Vertical offset (relative to its anchor row) for a submenu opened beside a menu row whose top is at `anchorTop`
 * (window coordinates): 0 when it fits below the row's top, else moved up just enough to end `margin` above the
 * window's bottom (never above the window's top margin).
 */
export function submenuOffsetY(anchorTop: number, height: number, viewportHeight: number, margin = 8): number {
  const overflow = anchorTop + height - (viewportHeight - margin)
  if (overflow <= 0) return 0
  return -Math.min(overflow, Math.max(0, anchorTop - margin))
}

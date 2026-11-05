/**
 * Typewriter box geometry (specs/005-typewriter-note, US2): move and resize of a box normalized over the page,
 * and the hit test. Pure. `minHeight(width)` is the height the laid-out text needs at that width.
 */
import { TYPEWRITER_MIN_BOX_WIDTH } from './typewriter-doc.js'

export type TypewriterBoxRect = { x: number; y: number; width: number; height: number }
export type TypewriterHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const TYPEWRITER_HANDLES: readonly TypewriterHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The box moved by (dx, dy) page fractions, kept inside the page. */
export function moveTypewriterBox(origin: TypewriterBoxRect, dx: number, dy: number): TypewriterBoxRect {
  return { ...origin, x: clamp(origin.x + dx, 0, 1 - origin.width), y: clamp(origin.y + dy, 0, 1 - origin.height) }
}

/**
 * The box after dragging `handle` by (dx, dy): width is free down to the minimum, height never goes below what the
 * text needs at the resulting width, and the box stays inside the page. A north / west drag keeps the opposite edge.
 */
export function resizeTypewriterBox(origin: TypewriterBoxRect, handle: TypewriterHandle, dx: number, dy: number, minHeight: (width: number) => number): TypewriterBoxRect {
  let { x, y, width, height } = origin
  const right = origin.x + origin.width
  const bottom = origin.y + origin.height
  if (handle.includes('e')) width = clamp(origin.width + dx, TYPEWRITER_MIN_BOX_WIDTH, 1 - origin.x)
  if (handle.includes('w')) {
    x = clamp(origin.x + dx, 0, right - TYPEWRITER_MIN_BOX_WIDTH)
    width = right - x
  }
  const floor = minHeight(width)
  if (handle.includes('s')) height = clamp(origin.height + dy, floor, Math.max(floor, 1 - origin.y))
  if (handle.includes('n')) {
    const top = clamp(origin.y + dy, 0, bottom)
    height = Math.max(floor, bottom - top)
    y = Math.max(0, bottom - height)
    height = Math.max(floor, bottom - y)
  }
  return { x, y, width, height: Math.max(height, floor) }
}

/** The topmost (last) box containing the page point, with `slopX` / `slopY` of extra reach. */
export function typewriterBoxAt<T extends { box: TypewriterBoxRect }>(marks: readonly T[], x: number, y: number, slopX = 0, slopY = 0): T | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const { box } = marks[i]!
    if (x >= box.x - slopX && x <= box.x + box.width + slopX && y >= box.y - slopY && y <= box.y + box.height + slopY) return marks[i]!
  }
  return null
}

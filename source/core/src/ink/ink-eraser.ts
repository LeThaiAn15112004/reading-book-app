/**
 * Stroke Eraser geometry (docs/implementation_plan/pdf_freehand_ink_eraser_plan.md §4.1): which WHOLE strokes
 * a sweeping eraser touches. Pure — the caller decides which strokes are candidates; only Readmate Ink rows
 * (`type: 'ink'`, parsed by `parsePdfInk`) are ever passed in, so text markup, notes and foreign annotations
 * cannot be hit by construction.
 *
 * Units are the Ink geometry's: x as stored, y multiplied by `heightRatio` for any distance; the eraser
 * radius and a stroke's `width` are both in page-width units.
 */

import type { InkPoint } from './pdf-ink.js'

/** Eraser radius in screen pixels (converted to page-width units with the page's on-screen width). */
export const INK_ERASER_RADIUS_PX = { default: 10, min: 6, max: 30 } as const

export function clampEraserRadiusPx(px: number): number {
  if (!Number.isFinite(px)) return INK_ERASER_RADIUS_PX.default
  return Math.min(INK_ERASER_RADIUS_PX.max, Math.max(INK_ERASER_RADIUS_PX.min, px))
}

type Vec = readonly [number, number]

function pointToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function cross(o: Vec, a: Vec, b: Vec): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function segmentsCross(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Shortest distance between two segments (0 when they cross). */
function segmentToSegment(a: Vec, b: Vec, c: Vec, d: Vec): number {
  if (segmentsCross(a, b, c, d)) return 0
  return Math.min(pointToSegment(a, c, d), pointToSegment(b, c, d), pointToSegment(c, a, b), pointToSegment(d, a, b))
}

/**
 * True when the eraser, swept from `from` to `to` (page points, a tap has `from === to`), passes within
 * `radius` of the stroke's centre line or its pen edge (`radius + width / 2`).
 */
export function inkSweepTouchesPaths(
  paths: readonly (readonly InkPoint[])[],
  width: number,
  from: InkPoint,
  to: InkPoint,
  radius: number,
  heightRatio: number,
): boolean {
  const reach = radius + width / 2
  const a: Vec = [from[0], from[1] * heightRatio]
  const b: Vec = [to[0], to[1] * heightRatio]
  for (const path of paths) {
    if (path.length === 1) {
      if (pointToSegment([path[0]![0], path[0]![1] * heightRatio], a, b) <= reach) return true
      continue
    }
    for (let i = 1; i < path.length; i++) {
      const c: Vec = [path[i - 1]![0], path[i - 1]![1] * heightRatio]
      const d: Vec = [path[i]![0], path[i]![1] * heightRatio]
      if (segmentToSegment(a, b, c, d) <= reach) return true
    }
  }
  return false
}

/**
 * Ids of the strokes on `pageIndex` (0-based) that one eraser step from `from` to `to` touches. Strokes
 * of other pages are never returned. Order follows `strokes`.
 */
export function inkStrokesTouchedBySweep<
  T extends { id: string; pageIndex: number; paths: readonly (readonly InkPoint[])[]; width: number },
>(strokes: readonly T[], pageIndex: number, from: InkPoint, to: InkPoint, radius: number, heightRatio: number): string[] {
  const hit: string[] = []
  for (const stroke of strokes) {
    if (stroke.pageIndex !== pageIndex) continue
    if (inkSweepTouchesPaths(stroke.paths, stroke.width, from, to, radius, heightRatio)) hit.push(stroke.id)
  }
  return hit
}

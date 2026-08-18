/**
 * Freehand stroke hit-test + bbox helpers (normalized 0..1 space).
 */

import type { FreehandPoint } from './reader-session.js'

export type FreehandBBox = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function freehandBoundingBox(
  points: readonly FreehandPoint[],
): FreehandBBox | null {
  if (points.length === 0) return null
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  // Single-point strokes still get a tiny box for handles.
  if (maxX - minX < 0.004) {
    minX = clamp01(minX - 0.002)
    maxX = clamp01(maxX + 0.002)
  }
  if (maxY - minY < 0.004) {
    minY = clamp01(minY - 0.002)
    maxY = clamp01(maxY + 0.002)
  }
  return { minX, minY, maxX, maxY }
}

function distPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-12) {
    const ex = px - ax
    const ey = py - ay
    return Math.hypot(ex, ey)
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Distance from point to polyline in normalized units. */
export function freehandPathDistance(
  point: FreehandPoint,
  points: readonly FreehandPoint[],
): number {
  const first = points[0]
  if (points.length === 1 && first) {
    return Math.hypot(point.x - first.x, point.y - first.y)
  }
  let best = Number.POSITIVE_INFINITY
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    if (a && b) {
      best = Math.min(
        best,
        distPointToSegment(point.x, point.y, a.x, a.y, b.x, b.y),
      )
    }
  }
  return best

}

/**
 * Hit-test strokes (newest first). Threshold is in normalized units,
 * expanded slightly by strokeWidth when host size is known.
 */
export function hitTestFreehandStrokes(
  point: FreehandPoint,
  strokes: readonly { id: string; points: FreehandPoint[]; strokeWidth: number }[],
  options?: { hostWidthPx?: number; hostHeightPx?: number; padPx?: number },
): string | null {
  const padPx = options?.padPx ?? 10
  const hostW = options?.hostWidthPx ?? 800
  const hostH = options?.hostHeightPx ?? 1000
  const unitPad = Math.max(padPx / Math.max(hostW, hostH), 0.008)

  for (let i = strokes.length - 1; i >= 0; i -= 1) {
    const stroke = strokes[i]
    if (!stroke || stroke.points.length === 0) continue
    const widthPad =
      (Math.max(1, stroke.strokeWidth) * 0.5) / Math.max(hostW, hostH)
    const threshold = unitPad + widthPad
    if (freehandPathDistance(point, stroke.points) <= threshold) {
      return stroke.id
    }
  }
  return null
}

export type FreehandResizeHandle =
  | 'nw'
  | 'ne'
  | 'sw'
  | 'se'
  | 'n'
  | 's'
  | 'e'
  | 'w'

/** Scale points so their bbox maps from `from` → `to` (clamped 0..1). */
export function scaleFreehandPointsToBox(
  points: readonly FreehandPoint[],
  from: FreehandBBox,
  to: FreehandBBox,
): FreehandPoint[] {
  const fromW = Math.max(from.maxX - from.minX, 1e-6)
  const fromH = Math.max(from.maxY - from.minY, 1e-6)
  const toW = to.maxX - to.minX
  const toH = to.maxY - to.minY
  return points.map((p) => ({
    x: clamp01(to.minX + ((p.x - from.minX) / fromW) * toW),
    y: clamp01(to.minY + ((p.y - from.minY) / fromH) * toH),
  }))
}

/**
 * Translate points by `(dx, dy)` in normalized space.
 * Clamps the delta so the stroke bbox stays inside 0..1 (shape preserved).
 */
export function translateFreehandPoints(
  points: readonly FreehandPoint[],
  dx: number,
  dy: number,
): FreehandPoint[] {
  if (points.length === 0) return []
  const box = freehandBoundingBox(points)
  if (!box) {
    return points.map((p) => ({
      x: clamp01(p.x + dx),
      y: clamp01(p.y + dy),
    }))
  }
  const clampedDx = Math.min(
    Math.max(dx, -box.minX),
    1 - box.maxX,
  )
  const clampedDy = Math.min(
    Math.max(dy, -box.minY),
    1 - box.maxY,
  )
  if (Math.abs(clampedDx) < 1e-12 && Math.abs(clampedDy) < 1e-12) {
    return points.map((p) => ({ x: p.x, y: p.y }))
  }
  return points.map((p) => ({
    x: clamp01(p.x + clampedDx),
    y: clamp01(p.y + clampedDy),
  }))
}

/** Apply a resize handle drag in normalized space. */
export function resizeFreehandBBox(
  box: FreehandBBox,
  handle: FreehandResizeHandle,
  pointer: FreehandPoint,
): FreehandBBox {
  let { minX, minY, maxX, maxY } = box
  const x = clamp01(pointer.x)
  const y = clamp01(pointer.y)
  if (handle.includes('w')) minX = Math.min(x, maxX - 0.004)
  if (handle.includes('e')) maxX = Math.max(x, minX + 0.004)
  if (handle.includes('n')) minY = Math.min(y, maxY - 0.004)
  if (handle.includes('s')) maxY = Math.max(y, minY + 0.004)
  return { minX, minY, maxX, maxY }
}

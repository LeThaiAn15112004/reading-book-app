/**
 * Pure geometry of freehand Ink on a PDF page: client → page coordinates, capture-time decimation,
 * SVG path data and hit testing.
 *
 * Storage space: x and y are both 0–1 over the displayed page box, so the two axes have different
 * physical lengths on a non-square page. Everything that measures a DISTANCE or draws a round pen
 * therefore works in "page-width units": x as is, y multiplied by `heightRatio` (= page height /
 * page width). A stroke `width` is in those units too.
 */

import type { InkPoint } from './pdf-ink.js'

export type InkClientRect = { left: number; top: number; width: number; height: number }

/** Normalized page position of a client point, clamped to the page box. Null for an empty rect. */
export function clientToPageUnit(clientX: number, clientY: number, rect: InkClientRect): InkPoint | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null
  const x = (clientX - rect.left) / rect.width
  const y = (clientY - rect.top) / rect.height
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]
}

/** Page height / page width of a page slot. */
export function pageHeightRatio(pageWidth: number, pageHeight: number): number {
  return pageWidth > 0 && pageHeight > 0 ? pageHeight / pageWidth : 1
}

function distance(a: InkPoint, b: InkPoint, heightRatio: number): number {
  return Math.hypot(a[0] - b[0], (a[1] - b[1]) * heightRatio)
}

/** Drop points closer than `minDistance` (page-width units) to the previous kept one; the last point always stays. */
export function filterMinDistance(points: readonly InkPoint[], minDistance: number, heightRatio: number): InkPoint[] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]])
  const out: InkPoint[] = [points[0]!]
  for (let i = 1; i < points.length - 1; i++) {
    if (distance(out[out.length - 1]!, points[i]!, heightRatio) >= minDistance) out.push(points[i]!)
  }
  out.push(points[points.length - 1]!)
  return out
}

function distanceToSegment(p: InkPoint, a: InkPoint, b: InkPoint, heightRatio: number): number {
  const ax = a[0]
  const ay = a[1] * heightRatio
  const bx = b[0]
  const by = b[1] * heightRatio
  const px = p[0]
  const py = p[1] * heightRatio
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Ramer–Douglas–Peucker; endpoints always stay. `tolerance` in page-width units. */
export function simplifyInkPoints(points: readonly InkPoint[], tolerance: number, heightRatio: number): InkPoint[] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]])
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let worst = -1
    let worstDistance = tolerance
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(points[i]!, points[first]!, points[last]!, heightRatio)
      if (d > worstDistance) {
        worstDistance = d
        worst = i
      }
    }
    if (worst !== -1) {
      keep[worst] = true
      stack.push([first, worst], [worst, last])
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => [p[0], p[1]])
}

function fmt(value: number): string {
  return String(Math.round(value * 1e5) / 1e5)
}

/**
 * SVG path data of one polyline in the page-width coordinate system (`viewBox="0 0 1 heightRatio"`):
 * straight for 2 points, otherwise quadratic curves through the segment midpoints. A single-point
 * path (a tap) is drawn as a zero-length line, which a round cap turns into a dot.
 */
export function inkPathData(points: readonly InkPoint[], heightRatio: number): string {
  if (points.length === 0) return ''
  const pt = (p: InkPoint) => `${fmt(p[0])} ${fmt(p[1] * heightRatio)}`
  if (points.length === 1) return `M ${pt(points[0]!)} l 0 0`
  if (points.length === 2) return `M ${pt(points[0]!)} L ${pt(points[1]!)}`
  let d = `M ${pt(points[0]!)}`
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!
    const next = points[i + 1]!
    const mid: InkPoint = [(p[0] + next[0]) / 2, (p[1] + next[1]) / 2]
    d += ` Q ${pt(p)} ${pt(mid)}`
  }
  d += ` L ${pt(points[points.length - 1]!)}`
  return d
}

/**
 * Move every point of `paths` by (`dx`, `dy`) — normalized page units — keeping the whole stroke inside
 * the page box: the shift is clamped so the bounding box never crosses an edge. Returns the paths (rounded
 * like stored points) and the shift actually applied. Empty paths move nowhere.
 */
export function translateInkPaths(
  paths: readonly (readonly InkPoint[])[],
  dx: number,
  dy: number,
): { paths: InkPoint[][]; dx: number; dy: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const path of paths) {
    for (const [x, y] of path) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const finite = Number.isFinite(dx) && Number.isFinite(dy) && Number.isFinite(minX)
  const shiftX = finite ? Math.min(1 - maxX, Math.max(-minX, dx)) : 0
  const shiftY = finite ? Math.min(1 - maxY, Math.max(-minY, dy)) : 0
  const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1e5) / 1e5
  return {
    paths: paths.map((path) => path.map(([x, y]): InkPoint => [round(x + shiftX), round(y + shiftY)])),
    dx: shiftX,
    dy: shiftY,
  }
}

/** Distance (page-width units) from a page point to the nearest segment of the paths. Infinity when empty. */
export function distanceToInkPaths(paths: readonly (readonly InkPoint[])[], x: number, y: number, heightRatio: number): number {
  const p: InkPoint = [x, y]
  let best = Infinity
  for (const path of paths) {
    if (path.length === 1) best = Math.min(best, distance(p, path[0]!, heightRatio))
    for (let i = 1; i < path.length; i++) {
      best = Math.min(best, distanceToSegment(p, path[i - 1]!, path[i]!, heightRatio))
    }
  }
  return best
}

/**
 * The topmost (last drawn) stroke of `page` (0-based) under the page point (`x`, `y`): within half the
 * pen width plus `slop` (both page-width units). Null when none.
 */
export function inkStrokeAt<T extends { pageIndex: number; paths: readonly (readonly InkPoint[])[]; width: number }>(
  strokes: readonly T[],
  pageIndex: number,
  x: number,
  y: number,
  heightRatio: number,
  slop: number,
): T | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i]!
    if (stroke.pageIndex !== pageIndex) continue
    if (distanceToInkPaths(stroke.paths, x, y, heightRatio) <= stroke.width / 2 + slop) return stroke
  }
  return null
}

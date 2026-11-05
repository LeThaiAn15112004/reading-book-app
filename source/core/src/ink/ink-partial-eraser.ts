/**
 * Partial Eraser geometry: cut the parts of a freehand Ink stroke that a swept eraser disc covers.
 *
 * Every freehand style (Pen, Pencil, Marker, Brush) is the same data — a constant-width centre-line
 * (`paths`, normalized points) plus colour / width / opacity / style — so one routine serves them all; the
 * style only changes how the renderer paints the surviving pieces.
 *
 * Method (exact, no sampling): the eraser's path is a list of sweeps (segments of disc centres). A sweep
 * covers the capsule of radius `reach = radius + width / 2` around it (the stroke's round cap then ends
 * exactly on the eraser disc). For each centre-line segment the covered part is ONE parameter interval per
 * sweep (a capsule is convex), found analytically from two end discs and the rectangle between them. The
 * intervals of all sweeps are merged and the segment keeps the complement, so the cut points lie exactly on
 * the capsule boundary: no spikes, no reconnecting lines, no gap beyond the erased area. Consecutive kept
 * stretches that meet at a vertex stay one polyline. The result is always computed from the ORIGINAL stroke
 * and the whole gesture's sweeps, so repeated events and repeated crossings never erase more than the path.
 *
 * Distances use page-width units (x as is, y × `heightRatio`), like the rest of the Ink geometry.
 */

import type { InkPoint } from './pdf-ink.js'

/** One step of the eraser: the disc centre moved from `from` to `to` (page points). A tap has `from === to`. */
export type InkEraseSweep = { from: InkPoint; to: InkPoint }

export type InkPartialErase = {
  /** Remaining polylines (each ≥ 2 points), in stroke order. Empty: nothing of the stroke is left. */
  pieces: InkPoint[][]
  /** False when the eraser did not remove anything (`pieces` then equals the input paths). */
  changed: boolean
}

const EPS = 1e-9

type Interval = [number, number]

function disc(ax: number, ay: number, dx: number, dy: number, cx: number, cy: number, r: number): Interval | null {
  const a = dx * dx + dy * dy
  const ex = ax - cx
  const ey = ay - cy
  const b = 2 * (dx * ex + dy * ey)
  const c = ex * ex + ey * ey - r * r
  const det = b * b - 4 * a * c
  if (det < 0) return null
  const root = Math.sqrt(det)
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)]
}

/** Clip `p0 + t * p1 ∈ [lo, hi]` into `range`; false when nothing is left. */
function clip(range: Interval, p0: number, p1: number, lo: number, hi: number): boolean {
  if (Math.abs(p1) < EPS) return p0 >= lo && p0 <= hi
  let t0 = (lo - p0) / p1
  let t1 = (hi - p0) / p1
  if (t0 > t1) [t0, t1] = [t1, t0]
  range[0] = Math.max(range[0], t0)
  range[1] = Math.min(range[1], t1)
  return range[0] <= range[1]
}

/** Part of the segment A→B (t in [0, 1]) inside the capsule of radius `r` around S0→S1 (scaled coordinates). */
function capsuleInterval(
  a: readonly [number, number],
  b: readonly [number, number],
  s0: readonly [number, number],
  s1: readonly [number, number],
  r: number,
): Interval | null {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const parts: Interval[] = []
  const d0 = disc(a[0], a[1], dx, dy, s0[0], s0[1], r)
  if (d0) parts.push(d0)
  const sx = s1[0] - s0[0]
  const sy = s1[1] - s0[1]
  const length = Math.hypot(sx, sy)
  if (length > EPS) {
    const d1 = disc(a[0], a[1], dx, dy, s1[0], s1[1], r)
    if (d1) parts.push(d1)
    const ux = sx / length
    const uy = sy / length
    const range: Interval = [-Infinity, Infinity]
    const ax = a[0] - s0[0]
    const ay = a[1] - s0[1]
    if (clip(range, ux * ax + uy * ay, ux * dx + uy * dy, 0, length) && clip(range, -uy * ax + ux * ay, -uy * dx + ux * dy, -r, r)) {
      parts.push(range)
    }
  }
  if (parts.length === 0) return null
  const lo = Math.max(0, Math.min(...parts.map((p) => p[0])))
  const hi = Math.min(1, Math.max(...parts.map((p) => p[1])))
  return hi - lo > EPS ? [lo, hi] : null
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((p, q) => p[0] - q[0])
  const out: Interval[] = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (last && iv[0] <= last[1] + EPS) last[1] = Math.max(last[1], iv[1])
    else out.push([iv[0], iv[1]])
  }
  return out
}

function lerp(a: InkPoint, b: InkPoint, t: number): InkPoint {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function polylineLength(points: readonly InkPoint[], heightRatio: number): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) {
    sum += Math.hypot(points[i]![0] - points[i - 1]![0], (points[i]![1] - points[i - 1]![1]) * heightRatio)
  }
  return sum
}

/**
 * Cut `paths` (one stroke, `width` wide) with the eraser `sweeps` of radius `radius` (page-width units).
 * Pieces shorter than half the stroke width are dropped: they would only be a speck of the round cap.
 */
export function erasePathsWithSweeps(
  paths: readonly (readonly InkPoint[])[],
  width: number,
  sweeps: readonly InkEraseSweep[],
  radius: number,
  heightRatio: number,
): InkPartialErase {
  const reach = radius + width / 2
  const scaled = (p: InkPoint): [number, number] => [p[0], p[1] * heightRatio]
  const pieces: InkPoint[][] = []
  let changed = false

  // Sweeps are pre-scaled once; each path only looks at the sweeps near its own bounding box.
  const sw = sweeps.map((s) => ({ s0: scaled(s.from), s1: scaled(s.to) }))

  for (const path of paths) {
    if (path.length === 0) continue
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of path) {
      const [x, y] = scaled(p)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const near = sw.filter(
      ({ s0, s1 }) =>
        Math.max(s0[0], s1[0]) >= minX - reach &&
        Math.min(s0[0], s1[0]) <= maxX + reach &&
        Math.max(s0[1], s1[1]) >= minY - reach &&
        Math.min(s0[1], s1[1]) <= maxY + reach,
    )

    // A single point (or a stroke whose points coincide) is a dot: all or nothing.
    if (path.length === 1 || polylineLength(path, heightRatio) < EPS) {
      const a = scaled(path[0]!)
      const covered = near.some(({ s0, s1 }) => capsuleInterval(a, [a[0] + 1e-7, a[1]], s0, s1, reach) !== null)
      if (covered) changed = true
      else pieces.push(path.length >= 2 ? path.map((p): InkPoint => [p[0], p[1]]) : [path[0]!, path[0]!])
      continue
    }

    let current: InkPoint[] = []
    let open = false
    let cut = false
    const flush = () => {
      // A speck left by a cut is dropped; an untouched short path is kept as it is.
      if (current.length >= 2 && (!cut || polylineLength(current, heightRatio) >= width / 2)) pieces.push(current)
      current = []
      open = false
    }

    for (let i = 1; i < path.length; i++) {
      const p = path[i - 1]!
      const q = path[i]!
      const a = scaled(p)
      const b = scaled(q)
      const hits: Interval[] = []
      for (const { s0, s1 } of near) {
        const iv = capsuleInterval(a, b, s0, s1, reach)
        if (iv) hits.push(iv)
      }
      const erased = mergeIntervals(hits)
      if (erased.length > 0) {
        changed = true
        cut = true
      }
      // Kept stretches = the complement of the erased intervals in [0, 1].
      const kept: Interval[] = []
      let cursor = 0
      for (const [lo, hi] of erased) {
        if (lo - cursor > EPS) kept.push([cursor, lo])
        cursor = Math.max(cursor, hi)
      }
      if (1 - cursor > EPS) kept.push([cursor, 1])

      for (const [lo, hi] of kept) {
        if (open && lo <= EPS) {
          current.push(lerp(p, q, hi))
        } else {
          flush()
          current = [lerp(p, q, lo), lerp(p, q, hi)]
        }
        open = hi >= 1 - EPS
        if (!open) flush()
      }
      if (kept.length === 0) flush()
    }
    flush()
  }

  return { pieces: changed ? pieces : paths.map((path) => path.map((pt): InkPoint => [pt[0], pt[1]])), changed }
}

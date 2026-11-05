/**
 * PDF shape annotations (rectangle / ellipse / line / arrow): the pure model behind the Shape tools.
 * docs/implementation_plan/pdf_shape_tools.md.
 *
 * A shape is an ordinary annotation row (`HighlightStyleKind` rectangle | ellipse | line | arrow):
 * `pdfAnnotation.rects[0]` = its bounding box, `pdfAnnotation.shape` = pen width (+ endpoints for a
 * line / arrow), `style.colorHex` = `#RRGGBB` with an optional `AA` opacity byte — the same convention
 * every other annotation uses. Everything is normalized 0–1 over the displayed page box; distances and
 * the pen width are in page-width units (y × `heightRatio`), like freehand Ink.
 */

import { distanceToInkPaths } from '../ink/ink-geometry.js'
import type { InkPoint } from '../ink/pdf-ink.js'
import type { PdfAnnotation, PdfShapeGeometry } from '../domain/index.js'
import type { HighlightStyleKind } from './highlight-location.js'

export const PDF_SHAPE_KINDS = ['rectangle', 'ellipse', 'line', 'arrow'] as const
export type PdfShapeKind = (typeof PDF_SHAPE_KINDS)[number]

export function isPdfShapeKind(value: unknown): value is PdfShapeKind {
  return typeof value === 'string' && (PDF_SHAPE_KINDS as readonly string[]).includes(value)
}

/** True for the annotation kinds that are shapes (type guard over the shared style-kind union). */
export function isShapeStyleKind(kind: HighlightStyleKind): kind is PdfShapeKind {
  return isPdfShapeKind(kind)
}

export const PDF_SHAPE_LABELS: Record<PdfShapeKind, string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
}

/** Pen width bounds, fraction of the page width (≈0.5–12 pt on a 612 pt page). */
export const PDF_SHAPE_MIN_STROKE = 0.0008
export const PDF_SHAPE_MAX_STROKE = 0.02
export const PDF_SHAPE_DEFAULT_STROKE = 0.003
/** Smallest rectangle / ellipse side and line length a drag may produce, page-width units. */
export const PDF_SHAPE_MIN_EXTENT = 0.008

export function clampShapeStroke(width: number): number {
  if (!Number.isFinite(width)) return PDF_SHAPE_DEFAULT_STROKE
  return Math.min(PDF_SHAPE_MAX_STROKE, Math.max(PDF_SHAPE_MIN_STROKE, width))
}

const DECIMALS = 5
const round = (v: number) => Math.round(v * 10 ** DECIMALS) / 10 ** DECIMALS
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export type PdfShapeRect = { x: number; y: number; width: number; height: number }
export type PdfShapeLine = [number, number, number, number]

/** The arrow head's side length, page-width units (grows with the pen, never tiny). */
export function shapeArrowHeadLength(strokeWidth: number): number {
  return Math.max(0.014, strokeWidth * 5)
}

const ARROW_HALF_ANGLE = (28 * Math.PI) / 180

/**
 * The two barbs of an arrow head at the END of `line`, as normalized points (the head's tip is the end
 * point itself). The head is open (two strokes), drawn with the shape's own pen.
 */
export function shapeArrowBarbs(line: PdfShapeLine, strokeWidth: number, heightRatio: number): [InkPoint, InkPoint] {
  const [x1, y1, x2, y2] = line
  const dx = x2 - x1
  const dy = (y2 - y1) * heightRatio
  const length = Math.hypot(dx, dy) || 1
  // Unit vector from the end back towards the start, in page-width units.
  const bx = -dx / length
  const by = -dy / length
  const head = Math.min(shapeArrowHeadLength(strokeWidth), length)
  const barb = (angle: number): InkPoint => {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const rx = bx * cos - by * sin
    const ry = bx * sin + by * cos
    return [x2 + rx * head, y2 + (ry * head) / heightRatio]
  }
  return [barb(ARROW_HALF_ANGLE), barb(-ARROW_HALF_ANGLE)]
}

/**
 * Bounding box of a line / arrow: its endpoints grown by half the pen (and the arrow head), clamped to
 * the page. Never empty, even for a perfectly horizontal or vertical line.
 */
export function shapeLineRect(kind: 'line' | 'arrow', line: PdfShapeLine, strokeWidth: number, heightRatio: number): PdfShapeRect {
  const [x1, y1, x2, y2] = line
  const pad = strokeWidth / 2 + (kind === 'arrow' ? shapeArrowHeadLength(strokeWidth) : 0.002)
  const padY = pad / heightRatio
  const left = clamp01(Math.min(x1, x2) - pad)
  const right = clamp01(Math.max(x1, x2) + pad)
  const top = clamp01(Math.min(y1, y2) - padY)
  const bottom = clamp01(Math.max(y1, y2) + padY)
  return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) }
}

export type PdfShapeGeometryResult = { rect: PdfShapeRect; shape: PdfShapeGeometry }

/**
 * A press-drag-release gesture → the shape it creates. `start` and `end` are normalized page points in ANY
 * order or direction; null when the drag is too small to be a shape (a click, or a degenerate side).
 * Rectangle / ellipse: the box spanned by the two points. Line / arrow: from `start` to `end`.
 */
export function shapeFromDrag(kind: PdfShapeKind, start: InkPoint, end: InkPoint, strokeWidth: number, heightRatio: number): PdfShapeGeometryResult | null {
  if (![...start, ...end].every((n) => Number.isFinite(n)) || !(heightRatio > 0)) return null
  const width = clampShapeStroke(strokeWidth)
  const sx = clamp01(start[0])
  const sy = clamp01(start[1])
  const ex = clamp01(end[0])
  const ey = clamp01(end[1])
  if (kind === 'line' || kind === 'arrow') {
    if (Math.hypot(ex - sx, (ey - sy) * heightRatio) < PDF_SHAPE_MIN_EXTENT) return null
    const line: PdfShapeLine = [round(sx), round(sy), round(ex), round(ey)]
    return { rect: shapeLineRect(kind, line, width, heightRatio), shape: { strokeWidth: width, line } }
  }
  const left = Math.min(sx, ex)
  const right = Math.max(sx, ex)
  const top = Math.min(sy, ey)
  const bottom = Math.max(sy, ey)
  if (right - left < PDF_SHAPE_MIN_EXTENT || (bottom - top) * heightRatio < PDF_SHAPE_MIN_EXTENT) return null
  return { rect: { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) }, shape: { strokeWidth: width } }
}

/**
 * Resize a rectangle / ellipse by dragging one handle of its box to `pointer`: the opposite edges stay,
 * the box keeps the minimum size and stays on the page.
 */
export function resizeShapeBox(rect: PdfShapeRect, handle: string, pointer: InkPoint, heightRatio: number): PdfShapeRect {
  const minW = PDF_SHAPE_MIN_EXTENT
  const minH = PDF_SHAPE_MIN_EXTENT / heightRatio
  let left = rect.x
  let right = rect.x + rect.width
  let top = rect.y
  let bottom = rect.y + rect.height
  if (handle.includes('w')) left = Math.min(clamp01(pointer[0]), right - minW)
  if (handle.includes('e')) right = Math.max(clamp01(pointer[0]), left + minW)
  if (handle.includes('n')) top = Math.min(clamp01(pointer[1]), bottom - minH)
  if (handle.includes('s')) bottom = Math.max(clamp01(pointer[1]), top + minH)
  return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) }
}

/**
 * Move one END of a line / arrow (`'start'` | `'end'`) to `pointer`. Null when the result would be shorter
 * than the minimum length (the caller keeps the previous geometry).
 */
export function moveShapeEndpoint(
  kind: 'line' | 'arrow',
  shape: PdfShapeGeometry,
  which: 'start' | 'end',
  pointer: InkPoint,
  heightRatio: number,
): PdfShapeGeometryResult | null {
  if (!shape.line) return null
  const [x1, y1, x2, y2] = shape.line
  const px = clamp01(pointer[0])
  const py = clamp01(pointer[1])
  const line: PdfShapeLine = which === 'start' ? [round(px), round(py), x2, y2] : [x1, y1, round(px), round(py)]
  if (Math.hypot(line[2] - line[0], (line[3] - line[1]) * heightRatio) < PDF_SHAPE_MIN_EXTENT) return null
  return { rect: shapeLineRect(kind, line, shape.strokeWidth, heightRatio), shape: { ...shape, line } }
}

/** A shape row's geometry change that keeps the rest (used by resize / pen-width edits). */
export function restrokeShape(kind: PdfShapeKind, rect: PdfShapeRect, shape: PdfShapeGeometry, strokeWidth: number, heightRatio: number): PdfShapeGeometryResult {
  const width = clampShapeStroke(strokeWidth)
  if ((kind === 'line' || kind === 'arrow') && shape.line) {
    return { rect: shapeLineRect(kind, shape.line, width, heightRatio), shape: { ...shape, strokeWidth: width } }
  }
  return { rect, shape: { ...shape, strokeWidth: width } }
}

/**
 * Does the page point (`x`, `y`) hit the shape? Lines by distance to the segment, a rectangle by its
 * border band, an ellipse by its outline band — never the empty inside, so text under a hollow shape
 * stays selectable. `slop` (page-width units) widens the reach.
 */
export function pdfShapeHit(
  kind: PdfShapeKind,
  rect: PdfShapeRect,
  shape: PdfShapeGeometry,
  x: number,
  y: number,
  heightRatio: number,
  slop: number,
): boolean {
  const reach = shape.strokeWidth / 2 + slop
  if ((kind === 'line' || kind === 'arrow') && shape.line) {
    const [x1, y1, x2, y2] = shape.line
    if (distanceToInkPaths([[[x1, y1], [x2, y2]]], x, y, heightRatio) <= reach) return true
    if (kind === 'arrow') {
      const [a, b] = shapeArrowBarbs(shape.line, shape.strokeWidth, heightRatio)
      return distanceToInkPaths([[a, [x2, y2], b]], x, y, heightRatio) <= reach
    }
    return false
  }
  const px = x
  const py = y * heightRatio
  const left = rect.x
  const right = rect.x + rect.width
  const top = rect.y * heightRatio
  const bottom = (rect.y + rect.height) * heightRatio
  if (kind === 'ellipse') {
    const rx = rect.width / 2
    const ry = (rect.height * heightRatio) / 2
    if (!(rx > 0) || !(ry > 0)) return false
    const q = Math.hypot((px - (left + rx)) / rx, (py - (top + ry)) / ry)
    return Math.abs(q - 1) * Math.min(rx, ry) <= reach
  }
  // rectangle: inside the outer box grown by `reach`, but not inside the inner box shrunk by it
  const inOuter = px >= left - reach && px <= right + reach && py >= top - reach && py <= bottom + reach
  if (!inOuter) return false
  const inInner = px > left + reach && px < right - reach && py > top + reach && py < bottom - reach
  return !inInner
}

/** The `PdfAnnotation` of a shape row: one rect (its bounding box) + the shape geometry. */
export function pdfShapeAnnotation(pageIndex: number, rect: PdfShapeRect, shape: PdfShapeGeometry): PdfAnnotation {
  return { pageIndex, rects: [{ pageIndex, x: rect.x, y: rect.y, width: rect.width, height: rect.height }], shape }
}

/** `#RRGGBB` + opacity 0–1 → the stored colour string (`#RRGGBB`, or `#RRGGBBAA` below full opacity). */
export function shapeColorHex(colorHex: string, opacity: number): string {
  const m = /^#([0-9a-f]{6})/i.exec(colorHex.trim())
  const rgb = (m ? m[1]! : '1E88E5').toUpperCase()
  if (!(opacity < 1)) return `#${rgb}`
  const alpha = Math.round(Math.min(1, Math.max(0.05, opacity)) * 255)
  return `#${rgb}${alpha.toString(16).padStart(2, '0').toUpperCase()}`
}

/** Opacity (0–1) encoded in a stored shape colour; 1 when it has no alpha byte. */
export function shapeOpacityOf(colorHex: string): number {
  const m = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(colorHex.trim())
  return m ? Math.round((parseInt(m[1]!, 16) / 255) * 1000) / 1000 : 1
}

/** The `#RRGGBB` part of a stored shape colour. */
export function shapeStrokeHex(colorHex: string): string {
  const m = /^#[0-9a-f]{6}/i.exec(colorHex.trim())
  return (m ? m[0] : '#1E88E5').toUpperCase()
}

/**
 * PDF freehand Ink ↔ the `notes` overlay row (`type: 'ink'`). Phase 0/1 of
 * docs/implementation_plan/pdf_freehand_ink_eraser_plan.md.
 *
 * Data contract:
 *  - `note_json.pdfInk` = `{ pageIndex, paths, penStyle, width }`; points are normalized 0–1 against the
 *    displayed page box (the space `PdfAnnotationRect` uses), `width` is a fraction of the page WIDTH.
 *  - `locatorExtended.locator` = a `page-rect` location on `pageIndex + 1` whose rect is the stroke's
 *    bounding box — the shape PDF text annotations and bookmarks already use.
 *  - colour / opacity live in `style` (`NoteStyle.colorHex` / `opacity`).
 *
 * Ink rows have their own type, so they never appear in highlight queries (see
 * `sqlite-overlay-store.ts`). Validation is strict: any bad point rejects the whole stroke.
 */

import { PageRectLocation, Rect, type InkPenStyle, type NoteLocator, type PdfInkStroke } from '../domain/index.js'
import { packBookmarkLocator } from '../app-models/bookmark-location.js'
import { PDF_INK_MAX_WIDTH, PDF_INK_MIN_WIDTH } from './ink-limits.js'

/** Upper bound on points of one stroke (all paths together). */
export const PDF_INK_MAX_POINTS = 5000
/** Upper bound on polylines of one stroke. */
export const PDF_INK_MAX_PATHS = 64
/** Upper bound on the serialized stroke crossing IPC. */
export const PDF_INK_MAX_REF_LENGTH = 256 * 1024
/** Highest accepted 0-based page index (same as PDF text annotations). */
export const PDF_INK_MAX_PAGE_INDEX = 99_999
export { PDF_INK_MAX_WIDTH, PDF_INK_MIN_WIDTH }

const PEN_STYLES: readonly InkPenStyle[] = ['pen', 'marker', 'pencil', 'brush']
/** Slack for float noise at the page edges. */
const EDGE_EPSILON = 1e-6
/** Points are stored rounded to this many decimals (same as PDF text annotations). */
const DECIMALS = 5

export type InkPoint = [number, number]

/** A stroke row as the store and IPC carry it. */
export type PdfInkRecord = {
  id: string
  bookId: string
  locator: NoteLocator
  colorHex: string
  /** 0–1. */
  opacity: number
  ink: PdfInkStroke
  createdAt: string
  updatedAt: string
}

function round(value: number): number {
  const factor = 10 ** DECIMALS
  return Math.round(value * factor) / factor
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Round to storage precision and clamp to the page box; non-finite points are dropped. */
export function normalizeInkPoints(points: readonly (readonly [number, number])[]): InkPoint[] {
  const out: InkPoint[] = []
  for (const [x, y] of points) {
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue
    out.push([round(clamp01(x)), round(clamp01(y))])
  }
  return out
}

/** Strict validation of an untrusted `pdfInk` (IPC input, or a row read back from SQLite). */
export function parsePdfInk(value: unknown): PdfInkStroke | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if (!isFiniteNumber(v.pageIndex) || !Number.isInteger(v.pageIndex)) return undefined
  if (v.pageIndex < 0 || v.pageIndex > PDF_INK_MAX_PAGE_INDEX) return undefined
  if (!PEN_STYLES.includes(v.penStyle as InkPenStyle)) return undefined
  if (!isFiniteNumber(v.width) || v.width < PDF_INK_MIN_WIDTH || v.width > PDF_INK_MAX_WIDTH) return undefined
  if (!Array.isArray(v.paths) || v.paths.length === 0 || v.paths.length > PDF_INK_MAX_PATHS) return undefined

  let total = 0
  const paths: InkPoint[][] = []
  for (const rawPath of v.paths) {
    if (!Array.isArray(rawPath) || rawPath.length < 2) return undefined
    const path: InkPoint[] = []
    for (const rawPoint of rawPath) {
      if (!Array.isArray(rawPoint) || rawPoint.length !== 2) return undefined
      const [x, y] = rawPoint as unknown[]
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined
      if (x < -EDGE_EPSILON || x > 1 + EDGE_EPSILON || y < -EDGE_EPSILON || y > 1 + EDGE_EPSILON) return undefined
      path.push([x, y])
    }
    total += path.length
    if (total > PDF_INK_MAX_POINTS) return undefined
    paths.push(path)
  }
  return { pageIndex: v.pageIndex, paths, penStyle: v.penStyle as InkPenStyle, width: v.width }
}

/** `parsePdfInk` over the JSON string that crosses IPC (size-capped before parsing). */
export function parsePdfInkRef(raw: unknown): PdfInkStroke | undefined {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > PDF_INK_MAX_REF_LENGTH) return undefined
  try {
    return parsePdfInk(JSON.parse(raw))
  } catch {
    return undefined
  }
}

export function packPdfInkRef(ink: PdfInkStroke): string {
  return JSON.stringify(ink)
}

/** Bounding box of every point of the stroke (normalized, not padded by the pen width). */
export function pdfInkBounds(ink: PdfInkStroke): { x: number; y: number; width: number; height: number } {
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0
  for (const path of ink.paths) {
    for (const [x, y] of path) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) }
}

/** The stroke's jump target: its page, `rect` = its bounding box. */
export function pdfInkLocation(ink: PdfInkStroke): PageRectLocation {
  const b = pdfInkBounds(ink)
  return new PageRectLocation(ink.pageIndex + 1, new Rect(round(b.x), round(b.y), round(b.width), round(b.height)))
}

/** Locator JSON for a stroke — `chapterIndex` = 0-based page, like PDF bookmarks and text annotations. */
export function packPdfInkLocator(ink: PdfInkStroke): string {
  return packBookmarkLocator(pdfInkLocation(ink), ink.pageIndex)
}

/** IPC cross-check: the locator must be a `page-rect` on the stroke's page. */
export function isConsistentPdfInk(locator: NoteLocator, ink: PdfInkStroke): boolean {
  return locator.kind === 'page-rect' && locator.page === ink.pageIndex + 1
}

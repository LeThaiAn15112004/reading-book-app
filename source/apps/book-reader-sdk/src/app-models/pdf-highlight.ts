/**
 * PDF text markup (highlight / underline / strikethrough / note) ↔ the `notes` overlay row.
 *
 * Data contract (see docs/implementation_plan/pdf_text_annotations.md):
 *  - `locatorExtended.locator` = a `page-rect` location: the 1-based page the annotation starts on,
 *    `rect` = bounding box of its rects on that page (normalized 0–1), plus `chapterIndex` = the
 *    0-based page — the exact shape PDF bookmarks already use, so jump + sidebar code is shared.
 *  - `pdfAnnotation` = `{ pageIndex, rects }`: every selected glyph run, normalized 0–1 against the
 *    displayed page box, each rect tagged with its own 0-based `pageIndex`.
 *
 * Page numbering: the renderer, locators and UI are 1-based (`page`); only `PdfAnnotation` is
 * 0-based (`pageIndex`). This module is the single place that converts between the two
 * (`pdfAnnotationFromRects` / `pdfRectsFromAnnotation`).
 */

import { PageRectLocation, Rect, type NoteLocator, type PdfAnnotation, type PdfAnnotationRect } from '../domain/index.js'
import { packBookmarkLocator, parseBookmarkLocation } from './bookmark-location.js'
import { DEFAULT_HIGHLIGHT_COLOR } from './highlight-colors.js'
import {
  parseSelectionTextRef,
  type HighlightStyleKind,
  type ReaderHighlightBase,
} from './highlight-location.js'

/** Upper bound on rects per annotation (a whole dense page is a few hundred glyph runs). */
export const PDF_ANNOTATION_MAX_RECTS = 2000
/** Highest accepted 0-based page index. */
export const PDF_ANNOTATION_MAX_PAGE_INDEX = 99_999
/** Upper bound on the serialized `pdfAnnotation` crossing IPC. */
export const PDF_ANNOTATION_MAX_REF_LENGTH = 512 * 1024
/** Upper bound on `PdfAnnotation.contents`. */
const MAX_CONTENTS_LENGTH = 10_000
/** Slack for float noise at the page edges when validating normalized coordinates. */
const EDGE_EPSILON = 1e-6
/** Normalized coordinates are stored rounded to this many decimals (~0.01 px on a 1000 px page). */
const DECIMALS = 5

/** One rect of a PDF annotation as the renderer sees it: 1-based `page`, normalized 0–1 box. */
export type PdfHighlightRect = {
  page: number
  x: number
  y: number
  width: number
  height: number
}

/** Renderer-side view of one PDF annotation row. */
export type PdfReaderHighlight = ReaderHighlightBase & {
  /** 1-based page the annotation starts on (its jump target). */
  page: number
  /** 0-based page — the sidebar's grouping key, same convention as PDF bookmarks. */
  chapterIndex: number
  /** Every rect, possibly across several pages, in reading order. */
  rects: PdfHighlightRect[]
}

export function isPdfReaderHighlight(h: ReaderHighlightBase): h is PdfReaderHighlight {
  return Array.isArray((h as Partial<PdfReaderHighlight>).rects) && typeof (h as Partial<PdfReaderHighlight>).page === 'number'
}

function round(value: number): number {
  const factor = 10 ** DECIMALS
  return Math.round(value * factor) / factor
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function isWholePage(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Clamp a selection's rects to the page box and drop empty / non-finite ones — glyph boxes can
 * poke a hair past the page edge. Rounded so the stored JSON stays small.
 */
export function normalizePdfHighlightRects(rects: readonly PdfHighlightRect[]): PdfHighlightRect[] {
  const out: PdfHighlightRect[] = []
  for (const rect of rects) {
    if (!isWholePage(rect.page, 1, PDF_ANNOTATION_MAX_PAGE_INDEX + 1)) continue
    if (![rect.x, rect.y, rect.width, rect.height].every(isFiniteNumber)) continue
    const left = round(clamp01(rect.x))
    const top = round(clamp01(rect.y))
    const right = round(clamp01(rect.x + rect.width))
    const bottom = round(clamp01(rect.y + rect.height))
    if (right - left <= 0 || bottom - top <= 0) continue
    out.push({ page: rect.page, x: left, y: top, width: round(right - left), height: round(bottom - top) })
    if (out.length >= PDF_ANNOTATION_MAX_RECTS) break
  }
  return out
}

/** 1-based renderer rects → stored `PdfAnnotation` (0-based). Undefined when nothing is left. */
export function pdfAnnotationFromRects(rects: readonly PdfHighlightRect[]): PdfAnnotation | undefined {
  const clean = normalizePdfHighlightRects(rects)
  if (clean.length === 0) return undefined
  const firstPage = Math.min(...clean.map((r) => r.page))
  return {
    pageIndex: firstPage - 1,
    rects: clean.map((r) => ({ pageIndex: r.page - 1, x: r.x, y: r.y, width: r.width, height: r.height })),
  }
}

/** Stored `PdfAnnotation` (0-based) → 1-based renderer rects. */
export function pdfRectsFromAnnotation(annotation: PdfAnnotation): PdfHighlightRect[] {
  return annotation.rects.map((r) => ({
    page: (r.pageIndex ?? annotation.pageIndex) + 1,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
  }))
}

function parseRect(value: unknown, pageIndex: number): PdfAnnotationRect | undefined {
  if (!value || typeof value !== 'object') return undefined
  const r = value as Record<string, unknown>
  if (![r.x, r.y, r.width, r.height].every(isFiniteNumber)) return undefined
  const x = r.x as number
  const y = r.y as number
  const width = r.width as number
  const height = r.height as number
  if (width <= 0 || height <= 0) return undefined
  if (x < -EDGE_EPSILON || y < -EDGE_EPSILON) return undefined
  if (x + width > 1 + EDGE_EPSILON || y + height > 1 + EDGE_EPSILON) return undefined
  const rect: PdfAnnotationRect = { x, y, width, height }
  if (r.pageIndex !== undefined) {
    // A rect never sits before the annotation's first page.
    if (!isWholePage(r.pageIndex, pageIndex, PDF_ANNOTATION_MAX_PAGE_INDEX)) return undefined
    rect.pageIndex = r.pageIndex
  }
  return rect
}

/**
 * Strict validation of an untrusted `pdfAnnotation` (IPC input, or a row read back from SQLite):
 * whole page indices in range, 1…`PDF_ANNOTATION_MAX_RECTS` rects, every rect finite with a
 * positive size and inside the 0–1 page box. Any bad rect rejects the whole payload.
 */
export function parsePdfAnnotation(value: unknown): PdfAnnotation | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if (!isWholePage(v.pageIndex, 0, PDF_ANNOTATION_MAX_PAGE_INDEX)) return undefined
  if (!Array.isArray(v.rects) || v.rects.length === 0 || v.rects.length > PDF_ANNOTATION_MAX_RECTS) {
    return undefined
  }
  const rects: PdfAnnotationRect[] = []
  for (const raw of v.rects) {
    const rect = parseRect(raw, v.pageIndex)
    if (!rect) return undefined
    rects.push(rect)
  }
  const annotation: PdfAnnotation = { pageIndex: v.pageIndex, rects }
  if (v.contents !== undefined) {
    if (typeof v.contents !== 'string' || v.contents.length > MAX_CONTENTS_LENGTH) return undefined
    annotation.contents = v.contents
  }
  return annotation
}

/** `parsePdfAnnotation` over the JSON string that crosses IPC (size-capped before parsing). */
export function parsePdfAnnotationRef(raw: unknown): PdfAnnotation | undefined {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > PDF_ANNOTATION_MAX_REF_LENGTH) return undefined
  try {
    return parsePdfAnnotation(JSON.parse(raw))
  } catch {
    return undefined
  }
}

export function packPdfAnnotationRef(annotation: PdfAnnotation): string {
  return JSON.stringify(annotation)
}

/** The annotation's jump target: its first page, `rect` = bounding box of the rects there. */
export function pdfAnnotationLocation(annotation: PdfAnnotation): PageRectLocation {
  const onFirst = annotation.rects.filter((r) => (r.pageIndex ?? annotation.pageIndex) === annotation.pageIndex)
  const page = annotation.pageIndex + 1
  if (onFirst.length === 0) return new PageRectLocation(page)
  const left = Math.min(...onFirst.map((r) => r.x))
  const top = Math.min(...onFirst.map((r) => r.y))
  const right = Math.max(...onFirst.map((r) => r.x + r.width))
  const bottom = Math.max(...onFirst.map((r) => r.y + r.height))
  return new PageRectLocation(page, new Rect(round(left), round(top), round(right - left), round(bottom - top)))
}

/** Locator JSON for a PDF annotation — `chapterIndex` = 0-based page, like PDF bookmarks. */
export function packPdfHighlightLocator(annotation: PdfAnnotation): string {
  return packBookmarkLocator(pdfAnnotationLocation(annotation), annotation.pageIndex)
}

/**
 * Cross-check a PDF annotation against its locator (IPC boundary): the locator must be a
 * `page-rect` on the annotation's first page, so the jump target and the painted marks agree.
 */
export function isConsistentPdfHighlight(locator: NoteLocator, annotation: PdfAnnotation): boolean {
  return locator.kind === 'page-rect' && locator.page === annotation.pageIndex + 1
}

/**
 * IPC row → renderer row. Null unless the row is a PDF annotation: a `page-rect` locator plus a
 * valid `pdfAnnotation` on the same page (EPUB rows go through `highlightDtoToReaderHighlight`).
 */
export function pdfHighlightDtoToReaderHighlight(dto: {
  id: string
  locatorRef: string
  styleKind: HighlightStyleKind
  colorHex: string
  note?: string
  tags: string[]
  selectionTextRef?: string
  pdfAnnotationRef?: string
  createdAt: string
  updatedAt: string
}): PdfReaderHighlight | null {
  const locatorRef = dto.locatorRef?.trim()
  if (!locatorRef) return null
  const location = parseBookmarkLocation(locatorRef)
  if (!(location instanceof PageRectLocation)) return null
  const annotation = parsePdfAnnotationRef(dto.pdfAnnotationRef)
  if (!annotation || annotation.pageIndex + 1 !== location.page) return null

  return {
    id: dto.id,
    locatorRef,
    page: location.page,
    chapterIndex: annotation.pageIndex,
    rects: pdfRectsFromAnnotation(annotation),
    styleKind: dto.styleKind,
    colorHex: dto.colorHex?.trim() || DEFAULT_HIGHLIGHT_COLOR,
    note: dto.note?.trim() || undefined,
    tags: dto.tags ?? [],
    selectionText: parseSelectionTextRef(dto.selectionTextRef),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

/** Renderer rects → the `pdfAnnotation` a save sends over IPC. */
export function pdfAnnotationRefForRects(rects: readonly PdfHighlightRect[]): string | undefined {
  const annotation = pdfAnnotationFromRects(rects)
  return annotation ? packPdfAnnotationRef(annotation) : undefined
}

/**
 * The topmost (last drawn) mark under the normalized point (`x`, `y`) on 1-based `page`, with
 * `slopX` / `slopY` of extra reach (fractions of the page) around each rect. Null when none.
 */
export function pdfMarkAt<T extends { rects: readonly PdfHighlightRect[] }>(
  marks: readonly T[],
  page: number,
  x: number,
  y: number,
  slopX = 0,
  slopY = 0,
): T | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i]!
    for (const r of mark.rects) {
      if (r.page !== page) continue
      if (x >= r.x - slopX && x <= r.x + r.width + slopX && y >= r.y - slopY && y <= r.y + r.height + slopY) {
        return mark
      }
    }
  }
  return null
}

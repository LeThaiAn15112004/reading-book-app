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

import { PageRectLocation, Rect, type NoteLocator, type PdfAnnotation, type PdfAnnotationRect, type PdfShapeGeometry } from '../domain/index.js'
import { parseTypewriterDoc, type PdfTypewriterDoc } from '../typewriter/typewriter-doc.js'
import { parsePdfAttachmentInfo } from '../attachments/pdf-attachment-annotation.js'
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
  /** Inserted Text: `rects` is a single caret box at an insertion point (see `pdfCaretRect`). */
  caret?: true
  /** Shape annotations (rectangle / ellipse / line / arrow): pen width and, for a line / arrow, its endpoints. */
  shape?: PdfShapeGeometry
  typewriter?: PdfTypewriterDoc
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
export function pdfAnnotationFromRects(
  rects: readonly PdfHighlightRect[],
  options?: { caret?: boolean },
): PdfAnnotation | undefined {
  const clean = normalizePdfHighlightRects(rects)
  if (clean.length === 0) return undefined
  const firstPage = Math.min(...clean.map((r) => r.page))
  const annotation: PdfAnnotation = {
    pageIndex: firstPage - 1,
    rects: clean.map((r) => ({ pageIndex: r.page - 1, x: r.x, y: r.y, width: r.width, height: r.height })),
  }
  // A caret is ONE box: more would be a selection, which the flag must never describe.
  if (options?.caret && clean.length === 1) annotation.caret = true
  return annotation
}

/** Caret box size, as fractions of the line height / of the page width (see `pdfCaretRect`). */
const CARET_HEIGHT_OF_LINE = 0.55
const CARET_WIDTH_OF_HEIGHT = 1.1
/** How far above the line's bottom edge the caret starts (fraction of the line height). */
const CARET_RISE_OF_LINE = 0.2

/**
 * The Inserted Text caret box for an insertion point: centered on `x` and starting just above the
 * bottom of the text line (`lineBottom`), so the `^` hangs under the baseline without covering glyphs.
 * Every input is normalized to the page box (0–1) on 1-based `page`; `lineHeight` is the line's height
 * as a fraction of the page height and `pageAspect` the page's width / height, which keeps the box
 * square-ish on screen. Undefined for non-finite input or a point off the page.
 */
export function pdfCaretRect(
  page: number,
  x: number,
  lineBottom: number,
  lineHeight: number,
  pageAspect: number,
): PdfHighlightRect | undefined {
  if (![x, lineBottom, lineHeight, pageAspect].every(isFiniteNumber)) return undefined
  if (lineHeight <= 0 || pageAspect <= 0) return undefined
  if (x < 0 || x > 1 || lineBottom < 0 || lineBottom > 1) return undefined
  const height = lineHeight * CARET_HEIGHT_OF_LINE
  // Width as a share of the page width: height (of the page) × aspect = the same length on screen.
  const width = height * CARET_WIDTH_OF_HEIGHT / pageAspect
  const top = lineBottom - lineHeight * CARET_RISE_OF_LINE
  const [left, bottom] = [x - width / 2, top + height]
  const [cl, cr, ct, cb] = [clamp01(left), clamp01(left + width), clamp01(top), clamp01(bottom)]
  if (cr - cl <= 0 || cb - ct <= 0) return undefined
  return { page, x: round(cl), y: round(ct), width: round(cr - cl), height: round(cb - ct) }
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
export function parsePdfAnnotation(value: unknown, rowText?: string): PdfAnnotation | undefined {
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
  if (v.caret !== undefined) {
    // Only ever `true`, and only on exactly one rect.
    if (v.caret !== true || rects.length !== 1) return undefined
    annotation.caret = true
  }
  if (v.contents !== undefined) {
    if (typeof v.contents !== 'string' || v.contents.length > MAX_CONTENTS_LENGTH) return undefined
    annotation.contents = v.contents
  }
  if (v.shape !== undefined) {
    // A shape is ONE box (rects[0]) plus its pen; a line / arrow adds its endpoints, all on the page.
    const shape = parseShapeGeometry(v.shape)
    if (!shape || rects.length !== 1) return undefined
    annotation.shape = shape
  }
  if (v.typewriter !== undefined) {
    // A Typewriter note is ONE box (rects[0]); its rich text is checked against the row's plain `note`.
    if (rects.length !== 1 || rowText === undefined) return undefined
    const typewriter = parseTypewriterDoc(v.typewriter, rowText)
    if (!typewriter) return undefined
    annotation.typewriter = typewriter
  }
  if (v.attachment !== undefined) {
    // A file attachment is ONE icon box (rects[0]) with real size and nothing else (specs/007 data-model §1).
    const attachment = parsePdfAttachmentInfo(v.attachment)
    const box = rects[0]!
    if (!attachment || rects.length !== 1 || box.width <= 0 || box.height <= 0) return undefined
    if (annotation.shape || annotation.typewriter || annotation.caret) return undefined
    annotation.attachment = attachment
  }
  return annotation
}

/** Style kind `attachment` ⇔ an `attachment` payload (Main checks this on every write of such a row). */
export function isConsistentPdfAttachment(styleKind: HighlightStyleKind, annotation: PdfAnnotation | undefined): boolean {
  return (styleKind === 'attachment') === (annotation?.attachment !== undefined)
}

const MAX_SHAPE_STROKE = 0.1

function parseShapeGeometry(value: unknown): PdfShapeGeometry | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if (!isFiniteNumber(v.strokeWidth) || v.strokeWidth <= 0 || v.strokeWidth > MAX_SHAPE_STROKE) return undefined
  const shape: PdfShapeGeometry = { strokeWidth: v.strokeWidth }
  if (v.line !== undefined) {
    if (!Array.isArray(v.line) || v.line.length !== 4) return undefined
    const line = v.line as unknown[]
    if (!line.every((n) => isFiniteNumber(n) && n >= -EDGE_EPSILON && n <= 1 + EDGE_EPSILON)) return undefined
    shape.line = line as [number, number, number, number]
  }
  return shape
}

/** `parsePdfAnnotation` over the JSON string that crosses IPC (size-capped before parsing). */
export function parsePdfAnnotationRef(raw: unknown, rowText?: string): PdfAnnotation | undefined {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > PDF_ANNOTATION_MAX_REF_LENGTH) return undefined
  try {
    return parsePdfAnnotation(JSON.parse(raw), rowText)
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
  const annotation = parsePdfAnnotationRef(dto.pdfAnnotationRef, dto.note)
  if (!annotation || annotation.pageIndex + 1 !== location.page) return null

  return {
    id: dto.id,
    locatorRef,
    page: location.page,
    chapterIndex: annotation.pageIndex,
    rects: pdfRectsFromAnnotation(annotation),
    ...(annotation.caret ? { caret: true as const } : {}),
    ...(annotation.shape ? { shape: annotation.shape } : {}),
    ...(annotation.typewriter ? { typewriter: annotation.typewriter } : {}),
    styleKind: dto.styleKind,
    colorHex: dto.colorHex?.trim() || DEFAULT_HIGHLIGHT_COLOR,
    // A Typewriter note's text is the document its style runs index into: never trimmed.
    note: annotation.typewriter ? dto.note : dto.note?.trim() || undefined,
    tags: dto.tags ?? [],
    selectionText: parseSelectionTextRef(dto.selectionTextRef),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

/** Renderer rects → the `pdfAnnotation` a save sends over IPC. */
export function pdfAnnotationRefForRects(
  rects: readonly PdfHighlightRect[],
  options?: { caret?: boolean; shape?: PdfShapeGeometry; typewriter?: PdfTypewriterDoc },
): string | undefined {
  const annotation = pdfAnnotationFromRects(rects, options)
  if (!annotation) return undefined
  if (options?.shape) annotation.shape = options.shape
  if (options?.typewriter) annotation.typewriter = options.typewriter
  return packPdfAnnotationRef(annotation)
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

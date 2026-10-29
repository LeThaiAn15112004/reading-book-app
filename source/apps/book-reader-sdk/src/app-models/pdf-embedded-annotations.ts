/**
 * Annotations embedded in a PDF file (written by Foxit, Acrobat, …) → the app's `notes` rows.
 * Read-only import, re-run on every open: see docs/implementation_plan/pdf_embedded_annotation_import.md.
 *
 * Live sync while the book is open (file watcher in Main): docs/implementation_plan/pdf_embedded_annotation_live_sync.md.
 *
 * Pipeline (everything here is pure; Main's scan worker feeds it PDF.js data, Main persists the plan):
 *  1. `readPdfJsAnnotation` — one item of `PDFPageProxy.getAnnotations({ intent: 'display' })` plus
 *     the page's scale-1 viewport → a `ScannedPdfAnnotation` in the same normalized 0–1 display
 *     space as app-made PDF annotations, or null for a type the app can't represent. The worker adds
 *     the annotation's `/NM` (read from the raw PDF object — PDF.js doesn't expose it).
 *  2. `parseScannedPdfAnnotation` — re-validation of every item leaving the worker.
 *  3. `embeddedAnnotationIdentities` — identity of each item inside its file (see below).
 *  4. `planEmbeddedAnnotationSync` — compare with the import ledger → insert / update / delete /
 *     leave alone.
 *
 * Identity: with an `/NM` (unique per page, PDF 32000 §12.5.2) the key is `nm1:<page>:<hash of NM>`,
 * so a move, resize, recolor or comment edit in another viewer updates the same row. Without one,
 * PDF.js offers nothing stable across a full rewrite of the file — its `id` is the object reference
 * ("12R"), which a non-incremental save may renumber and even hand to a different annotation — so
 * the key is the annotation's *anchor*: `pdf1:<subtype>:<page>:<geometry hash>` (normalized,
 * rounded to 0.001 of the page). Both get an occurrence counter so identical keys stay separate
 * rows. A move or resize without `/NM` is a delete plus an insert.
 */

import type { NoteLocator, NoteSelectionText, PdfAnnotation, PdfAnnotationRect, PdfShapeGeometry } from '../domain/index.js'
import { DEFAULT_HIGHLIGHT_COLOR } from './highlight-colors.js'
import { parsePdfAttachmentInfo, type PdfAttachmentInfo } from '../attachments/pdf-attachment-annotation.js'
import { emptyTypewriterDoc, normalizeTypewriterText } from '../typewriter/typewriter-doc.js'
import type { HighlightStyleKind } from './highlight-location.js'
import {
  PDF_ANNOTATION_MAX_PAGE_INDEX,
  normalizePdfHighlightRects,
  packPdfHighlightLocator,
  parsePdfAnnotation,
  pdfAnnotationFromRects,
  type PdfHighlightRect,
} from './pdf-highlight.js'
import { clampShapeStroke, shapeColorHex } from './pdf-shape.js'

/** PDF annotation subtypes the import understands — the ones the `notes` model can represent. */
export const EMBEDDED_PDF_ANNOTATION_SUBTYPES = ['Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Text', 'Square', 'Circle', 'Line', 'FreeText', 'FileAttachment'] as const
export type EmbeddedPdfAnnotationSubtype = (typeof EMBEDDED_PDF_ANNOTATION_SUBTYPES)[number]

/**
 * How each subtype is stored. a Text annotation (sticky note) becomes a note (`textbox`) anchored on its icon.
 */
export const EMBEDDED_PDF_ANNOTATION_STYLE: Record<EmbeddedPdfAnnotationSubtype, HighlightStyleKind> = {
  Highlight: 'highlight',
  Underline: 'underline',
  Squiggly: 'squiggly',
  StrikeOut: 'strikethrough',
  Text: 'textbox',
  // Shapes: only the ones Readmate wrote itself (`/NM` readmate:*) are ever scanned — see `electron/pdf-sync/pdf-annotation-scan.ts`.
  Square: 'rectangle',
  Circle: 'ellipse',
  Line: 'line',
  // Typewriter notes: only the ones Readmate wrote itself (`/NM` readmate:*) are ever scanned (a foreign FreeText is a graphic object).
  FreeText: 'typewriter',
  // File attachments: only the ones Readmate wrote itself (`/NM` readmate:*) are annotations; others' are listed
  // as page attachments (specs/007-pdf-file-attachment research R7, R8).
  FileAttachment: 'attachment',
}

/** Subtypes that are shapes: one box + a `shape` geometry, no text. */
export const EMBEDDED_PDF_SHAPE_SUBTYPES: readonly EmbeddedPdfAnnotationSubtype[] = ['Square', 'Circle', 'Line']

export function isEmbeddedShapeSubtype(subtype: EmbeddedPdfAnnotationSubtype): boolean {
  return EMBEDDED_PDF_SHAPE_SUBTYPES.includes(subtype)
}

/** The row style of a scanned item: a `Line` with an arrow end is an `arrow`. */
export function embeddedStyleOf(item: Pick<ScannedPdfAnnotation, 'subtype' | 'arrow'>): HighlightStyleKind {
  return item.subtype === 'Line' && item.arrow ? 'arrow' : EMBEDDED_PDF_ANNOTATION_STYLE[item.subtype]
}

/** Upper bound on items one sync accepts (a scan stops collecting there too). */
export const EMBEDDED_PDF_SCAN_MAX_ANNOTATIONS = 5000
const MAX_CONTENTS_LENGTH = 10_000
const MAX_TEXT_LENGTH = 10_000
const MAX_AUTHOR_LENGTH = 500
const MAX_OBJECT_ID_LENGTH = 64
const MAX_NAME_LENGTH = 1000
/** Geometry precision of the identity key, as a fraction of the page (≈0.6 pt on a Letter page). */
const KEY_DECIMALS = 3
/**
 * Annotation flags (PDF 32000 §12.5.3) that keep an annotation off screen: Invisible (1), Hidden (2),
 * NoView (32). PDF.js `intent: 'display'` drops only Invisible / NoView — a Hidden one still comes
 * back (it is just not drawn), so the import checks the flags itself.
 */
const NOT_SHOWN_FLAGS = 1 | 2 | 32

/** A page's scale-1 PDF.js viewport: `transform` maps PDF user space to the displayed page box. */
export type PdfPageViewportInfo = {
  /** 0-based page. */
  pageIndex: number
  /** `PageViewport.transform` at scale 1: `[a, b, c, d, e, f]`. */
  transform: readonly number[]
  width: number
  height: number
}

/** One embedded annotation, normalized like app-made PDF annotations. Plain data (crosses IPC). */
export type ScannedPdfAnnotation = {
  /**
   * PDF.js id of the annotation in *this* load of the file — only used to hide its own appearance
   * on the canvas once the app paints it; never an identity across opens.
   */
  objectId: string
  subtype: EmbeddedPdfAnnotationSubtype
  /** 0-based page. */
  pageIndex: number
  /** Normalized 0–1 boxes on `pageIndex` (QuadPoints for text markup, the icon rect for Text). */
  rects: PdfAnnotationRect[]
  /** `#RRGGBB` from the annotation's `/C`; absent when it has none. */
  colorHex?: string
  /** `/Contents` — the comment of a markup annotation, the text of a sticky note. */
  contents?: string
  /** `/T` — usually the author. Kept for the change hash only (the model has no author field). */
  author?: string
  /** The page text under a markup annotation, as PDF.js extracts it (`overlaidText`). */
  text?: string
  /** `/NM`, the annotation's name (unique per page) — the stable identity when present. */
  nm?: string
  /** Shapes: pen width and, for a `Line`, its endpoints (normalized like `rects`). */
  shape?: PdfShapeGeometry
  /** A `Line` whose end carries an arrow head (`/LE [/None /OpenArrow]`-style). */
  arrow?: true
  /** Shapes: `/CA`, 0–1 (absent = 1). */
  opacity?: number
  /** `FileAttachment` only: the embedded file as read (name sanitised, real size and SHA-256 of the decoded content) — set by Main's scan. */
  attachment?: PdfAttachmentInfo
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isSubtype(value: unknown): value is EmbeddedPdfAnnotationSubtype {
  return typeof value === 'string' && (EMBEDDED_PDF_ANNOTATION_SUBTYPES as readonly string[]).includes(value)
}

/** Array or typed array of finite numbers → number[]; undefined otherwise. */
function numbers(value: unknown): number[] | undefined {
  if (!value || typeof value !== 'object' || typeof (value as { length?: unknown }).length !== 'number') return undefined
  const out = Array.from(value as ArrayLike<unknown>)
  return out.every(isFiniteNumber) ? (out as number[]) : undefined
}

/** `{ str }` text object PDF.js uses for `/Contents` and `/T`. */
function pdfString(value: unknown): string | undefined {
  const str = value && typeof value === 'object' ? (value as { str?: unknown }).str : undefined
  if (typeof str !== 'string') return undefined
  const clean = str.replace(/\r\n?/g, '\n').trim()
  return clean || undefined
}

function toHexByte(n: number): string {
  return Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0').toUpperCase()
}

/** PDF.js `color` (RGB bytes) → `#RRGGBB`. */
function colorHexOf(value: unknown): string | undefined {
  const rgb = numbers(value)
  if (!rgb || rgb.length !== 3) return undefined
  return `#${rgb.map(toHexByte).join('')}`
}

/** User-space box `[x1, y1, x2, y2]` → 1-based renderer rect in the displayed page box. */
function displayRect(box: readonly number[], page: PdfPageViewportInfo): PdfHighlightRect | undefined {
  const [a, b, c, d, e, f] = page.transform as [number, number, number, number, number, number]
  const [x1, y1, x2, y2] = box as [number, number, number, number]
  const p1 = [a * x1 + c * y1 + e, b * x1 + d * y1 + f] as const
  const p2 = [a * x2 + c * y2 + e, b * x2 + d * y2 + f] as const
  const left = Math.min(p1[0], p2[0])
  const top = Math.min(p1[1], p2[1])
  const right = Math.max(p1[0], p2[0])
  const bottom = Math.max(p1[1], p2[1])
  return {
    page: page.pageIndex + 1,
    x: left / page.width,
    y: top / page.height,
    width: (right - left) / page.width,
    height: (bottom - top) / page.height,
  }
}

/** QuadPoints (8 numbers per quad, any corner order) → one user-space box per quad. */
function quadBoxes(quadPoints: readonly number[]): number[][] {
  const boxes: number[][] = []
  for (let i = 0; i + 8 <= quadPoints.length; i += 8) {
    const xs = [quadPoints[i]!, quadPoints[i + 2]!, quadPoints[i + 4]!, quadPoints[i + 6]!]
    const ys = [quadPoints[i + 1]!, quadPoints[i + 3]!, quadPoints[i + 5]!, quadPoints[i + 7]!]
    boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
  }
  return boxes
}

function capped(value: string | undefined, max: number): string | undefined {
  return value === undefined ? undefined : value.slice(0, max)
}

/**
 * One PDF.js annotation data object (from `getAnnotations({ intent: 'display' })`) → a scanned
 * annotation, or null when it is not one of `EMBEDDED_PDF_ANNOTATION_SUBTYPES`, is not shown on
 * screen (Invisible / Hidden / NoView flag), is a reply to another annotation (`/IRT`), or has no
 * usable geometry on the page.
 */
export function readPdfJsAnnotation(raw: unknown, page: PdfPageViewportInfo): ScannedPdfAnnotation | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  if (!isSubtype(data.subtype)) return null
  if (typeof data.annotationFlags === 'number' && (data.annotationFlags & NOT_SHOWN_FLAGS) !== 0) return null
  // A reply / group member is a comment on another annotation, not a mark of its own.
  if (data.inReplyTo) return null
  if (typeof data.id !== 'string' || !data.id || data.id.length > MAX_OBJECT_ID_LENGTH) return null
  if (!Number.isInteger(page.pageIndex) || page.pageIndex < 0 || page.pageIndex > PDF_ANNOTATION_MAX_PAGE_INDEX) return null
  if (page.transform.length !== 6 || !page.transform.every(isFiniteNumber)) return null
  if (!(page.width > 0) || !(page.height > 0)) return null

  let boxes: number[][]
  if (data.subtype === 'Text' || data.subtype === 'FreeText' || data.subtype === 'FileAttachment' || isEmbeddedShapeSubtype(data.subtype)) {
    const rect = numbers(data.rect)
    boxes = rect?.length === 4 ? [rect] : []
  } else {
    const quads = numbers(data.quadPoints)
    boxes = quads && quads.length > 0 && quads.length % 8 === 0 ? quadBoxes(quads) : []
  }
  const rects = normalizePdfHighlightRects(
    boxes.map((box) => displayRect(box, page)).filter((r): r is PdfHighlightRect => r !== undefined),
  )
  const annotation = pdfAnnotationFromRects(rects)
  if (!annotation) return null

  const item: ScannedPdfAnnotation = {
    objectId: data.id,
    subtype: data.subtype,
    pageIndex: annotation.pageIndex,
    rects: annotation.rects,
  }
  const colorHex = colorHexOf(data.color)
  if (colorHex) item.colorHex = colorHex
  const contents = capped(pdfString(data.contentsObj), MAX_CONTENTS_LENGTH)
  if (contents) item.contents = contents
  const author = capped(pdfString(data.titleObj), MAX_AUTHOR_LENGTH)
  if (author) item.author = author
  if (typeof data.overlaidText === 'string') {
    const text = capped(data.overlaidText.replace(/\s+/g, ' ').trim(), MAX_TEXT_LENGTH)
    if (text) item.text = text
  }
  if (isEmbeddedShapeSubtype(data.subtype)) {
    if (rects.length !== 1) return null
    const borderWidth = (data.borderStyle as { width?: unknown } | undefined)?.width
    const widthUser = isFiniteNumber(borderWidth) && borderWidth > 0 ? borderWidth : 1
    const [a, b, c, d, e, f] = page.transform as [number, number, number, number, number, number]
    const shape: PdfShapeGeometry = { strokeWidth: clampShapeStroke((widthUser * Math.hypot(a, b)) / page.width) }
    if (data.subtype === 'Line') {
      const L = numbers(data.lineCoordinates)
      if (!L || L.length !== 4) return null
      const toDisplay = (x: number, y: number): [number, number] => [
        Math.min(1, Math.max(0, (a * x + c * y + e) / page.width)),
        Math.min(1, Math.max(0, (b * x + d * y + f) / page.height)),
      ]
      const p1 = toDisplay(L[0]!, L[1]!)
      const p2 = toDisplay(L[2]!, L[3]!)
      shape.line = [p1[0], p1[1], p2[0], p2[1]]
    }
    item.shape = shape
  }
  return item
}

function optionalString(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > max) return null
  return value
}

/**
 * Strict validation of one item that crossed IPC (Main side). Null rejects the item: unknown
 * subtype, geometry that `parsePdfAnnotation` refuses or that leaves its page, a malformed color,
 * or an oversized string.
 */
export function parseScannedPdfAnnotation(value: unknown): ScannedPdfAnnotation | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.objectId !== 'string' || !v.objectId || v.objectId.length > MAX_OBJECT_ID_LENGTH) return null
  if (!isSubtype(v.subtype)) return null
  const annotation = parsePdfAnnotation({ pageIndex: v.pageIndex, rects: v.rects, shape: v.shape })
  if (!annotation) return null
  if (isEmbeddedShapeSubtype(v.subtype) !== (annotation.shape !== undefined)) return null
  if (v.subtype === 'Line' && !annotation.shape?.line) return null
  if (v.arrow !== undefined && (v.arrow !== true || v.subtype !== 'Line')) return null
  if (v.opacity !== undefined && (typeof v.opacity !== 'number' || !(v.opacity >= 0 && v.opacity <= 1))) return null
  if (annotation.rects.some((r) => (r.pageIndex ?? annotation.pageIndex) !== annotation.pageIndex)) return null
  const colorHex = optionalString(v.colorHex, 7)
  if (colorHex === null || (colorHex !== undefined && !/^#[0-9A-F]{6}$/.test(colorHex))) return null
  const contents = optionalString(v.contents, MAX_CONTENTS_LENGTH)
  const author = optionalString(v.author, MAX_AUTHOR_LENGTH)
  const text = optionalString(v.text, MAX_TEXT_LENGTH)
  const nm = optionalString(v.nm, MAX_NAME_LENGTH)
  if (contents === null || author === null || text === null || nm === null) return null
  // A file attachment is ONE icon box with what the file holds; nothing else carries one.
  const attachment = v.attachment === undefined ? undefined : parsePdfAttachmentInfo(v.attachment)
  if (attachment === null || (v.subtype === 'FileAttachment') !== (attachment !== undefined)) return null
  if (attachment && annotation.rects.length !== 1) return null

  const item: ScannedPdfAnnotation = {
    objectId: v.objectId,
    subtype: v.subtype,
    pageIndex: annotation.pageIndex,
    rects: annotation.rects.map((r) => ({ pageIndex: annotation.pageIndex, x: r.x, y: r.y, width: r.width, height: r.height })),
  }
  if (colorHex) item.colorHex = colorHex
  if (contents) item.contents = contents
  if (author) item.author = author
  if (text) item.text = text
  if (nm) item.nm = nm
  if (annotation.shape) item.shape = annotation.shape
  if (v.arrow === true) item.arrow = true
  if (typeof v.opacity === 'number' && v.opacity < 1) item.opacity = v.opacity
  if (attachment) item.attachment = attachment
  return item
}

/** cyrb53 — a small, stable, non-cryptographic 53-bit string hash (identity / change detection only). */
function hash53(input: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/** The prefix of a name Readmate gives its own annotations (kept equal to `READMATE_NM_PREFIX` in pdf-annotation-export.ts, which imports this module). */
const READMATE_NAME_PREFIX = 'readmate:'

/**
 * Whether a ledger `sourceKey` is the key of an annotation Readmate wrote itself (its `/NM` is `readmate:<noteId>`
 * for the first page, `readmate:<noteId>:p<page>` for the others) rather than one read from the file. The ledger
 * keeps only the hashed name (`nm1:<pageIndex>:<hash>#n`), so the hash is recomputed for both name forms.
 */
export function isReadmateAuthoredKey(noteId: string, sourceKey: string): boolean {
  const m = /^nm1:(\d+):([0-9a-f]+)#\d+$/.exec(sourceKey)
  if (!m) return false
  const pageIndex = Number(m[1])
  const names = [`${READMATE_NAME_PREFIX}${noteId}`, `${READMATE_NAME_PREFIX}${noteId}:p${pageIndex + 1}`]
  return names.some((name) => hash53(name) === m[2])
}

function geometrySignature(rects: readonly PdfAnnotationRect[]): string {
  return rects.map((r) => [r.x, r.y, r.width, r.height].map((n) => n.toFixed(KEY_DECIMALS)).join(',')).join(';')
}

/**
 * Identity key of each item within its file, in scan order: `pdf1:<subtype>:<pageIndex>:<geometry
 * hash>#<occurrence>`. Identical anchors get #0, #1, … in document order, so duplicates or stacked
 * annotations are never merged into one row.
 */
export function embeddedAnnotationKeys(items: readonly ScannedPdfAnnotation[]): string[] {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const base = `pdf1:${item.subtype}:${item.pageIndex}:${hash53(geometrySignature(item.rects))}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return `${base}#${n}`
  })
}

/** Identity of one scanned item: `key` is what the ledger uses; `legacyKey` the anchor key. */
export type EmbeddedAnnotationIdentity = {
  key: string
  /** The `pdf1` anchor key — what an import before `/NM` support stored for this item. */
  legacyKey: string
}

/**
 * Identity of each item within its file, in scan order (see the module comment). `key` is the
 * `/NM` key when the item has a name, the anchor key otherwise; `legacyKey` is always the anchor
 * key, so ledger rows written before `/NM` support can be re-keyed instead of duplicated.
 */
export function embeddedAnnotationIdentities(items: readonly ScannedPdfAnnotation[]): EmbeddedAnnotationIdentity[] {
  const legacy = embeddedAnnotationKeys(items)
  const seen = new Map<string, number>()
  return items.map((item, index) => {
    const legacyKey = legacy[index]!
    if (!item.nm) return { key: legacyKey, legacyKey }
    const base = `nm1:${item.pageIndex}:${hash53(item.nm)}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { key: `${base}#${n}`, legacyKey }
  })
}

/** Change hash of everything the import reads from the file for one item. */
export function embeddedAnnotationSourceHash(item: ScannedPdfAnnotation): string {
  return hash53(
    JSON.stringify([
      item.subtype,
      item.pageIndex,
      item.rects.map((r) => [r.x, r.y, r.width, r.height]),
      item.colorHex ?? '',
      item.contents ?? '',
      item.author ?? '',
      item.text ?? '',
      item.shape ?? null,
      item.arrow ?? false,
      item.opacity ?? 1,
      item.attachment?.sha256 ?? '',
    ]),
  )
}

/** The user-visible content of a `notes` annotation row, as `rowToHighlightRecord` reads it back. */
export type HighlightContent = {
  styleKind: HighlightStyleKind
  colorHex: string
  note?: string
  tags?: readonly string[]
  selectionText?: NoteSelectionText
  pdfAnnotation?: PdfAnnotation
}

/**
 * Hash of a row's content. The ledger keeps the hash of what the import last wrote; a different
 * hash on the row now means the user edited it in the app, and the import leaves it alone.
 */
export function highlightContentHash(content: HighlightContent): string {
  const geometry = content.pdfAnnotation
    ? [
        content.pdfAnnotation.pageIndex,
        content.pdfAnnotation.rects.map((r) => [r.pageIndex ?? null, r.x, r.y, r.width, r.height]),
        ...(content.pdfAnnotation.shape ? [content.pdfAnnotation.shape] : []),
        ...(content.pdfAnnotation.typewriter ? [content.pdfAnnotation.typewriter] : []),
        ...(content.pdfAnnotation.attachment ? [content.pdfAnnotation.attachment.sha256] : []),
      ]
    : null
  return hash53(
    JSON.stringify([
      content.styleKind,
      content.colorHex.trim().toUpperCase(),
      content.note?.trim() ?? '',
      [...(content.tags ?? [])],
      content.selectionText?.highlight ?? '',
      geometry,
    ]),
  )
}

/** The `notes` row an embedded annotation becomes. */
export type EmbeddedAnnotationHighlight = HighlightContent & {
  locator: NoteLocator
  tags: string[]
  pdfAnnotation: PdfAnnotation
}

export function highlightFromEmbeddedAnnotation(item: ScannedPdfAnnotation): EmbeddedAnnotationHighlight {
  const pdfAnnotation: PdfAnnotation = {
    pageIndex: item.pageIndex,
    rects: item.rects.map((r) => ({ pageIndex: item.pageIndex, x: r.x, y: r.y, width: r.width, height: r.height })),
    ...(item.shape ? { shape: item.shape } : {}),
  }
  // A Readmate FreeText without a row (e.g. the database was lost): its text, plain — the rich-text document is the app's.
  if (item.subtype === 'FreeText') pdfAnnotation.typewriter = emptyTypewriterDoc()
  // A Readmate file attachment without a row: the file's own description of what it holds.
  if (item.subtype === 'FileAttachment' && item.attachment) pdfAnnotation.attachment = item.attachment
  const highlight: EmbeddedAnnotationHighlight = {
    locator: JSON.parse(packPdfHighlightLocator(pdfAnnotation)) as NoteLocator,
    styleKind: embeddedStyleOf(item),
    colorHex: item.shape ? shapeColorHex(item.colorHex ?? DEFAULT_HIGHLIGHT_COLOR, item.opacity ?? 1) : (item.colorHex ?? DEFAULT_HIGHLIGHT_COLOR),
    tags: [],
    pdfAnnotation,
  }
  if (item.contents && item.subtype !== 'FileAttachment') highlight.note = item.subtype === 'FreeText' ? normalizeTypewriterText(item.contents) : item.contents
  if (item.text) highlight.selectionText = { highlight: item.text }
  return highlight
}

/** One import-ledger row: which `notes` row an embedded annotation became, and its last sync. */
export type EmbeddedAnnotationLedgerEntry = {
  sourceKey: string
  noteId: string
  /** `embeddedAnnotationSourceHash` of the item when it was last written to the row. */
  sourceHash: string
  /** `highlightContentHash` of what the import last wrote to the row. */
  noteHash: string
}

export type EmbeddedAnnotationSyncStep = { index: number; key: string; item: ScannedPdfAnnotation }

export type EmbeddedAnnotationSyncPlan = {
  /** Never imported: a new row each. */
  inserts: EmbeddedAnnotationSyncStep[]
  /** Changed in the file since the last sync, row untouched in the app since: rewrite the row. */
  updates: (EmbeddedAnnotationSyncStep & { noteId: string })[]
  /** Same as at the last sync. */
  unchanged: number
  /** Changed in the file, but the user edited the row in the app: the app's version wins. */
  keptAppEdits: number
  /** Imported before, then deleted in the app: stays deleted. */
  dismissed: number
  /** Indices (into the scanned list) of items the app now paints itself, deleted ones included. */
  managed: number[]
  /** Ledger rows to re-key before anything else (anchor key → `/NM` key, same row). */
  rekeys: { from: string; to: string }[]
  /** Removed from the file (complete scans only), row untouched in the app: delete row + entry. */
  deletions: { key: string; noteId: string }[]
  /** Removed from the file, row already deleted in the app: drop the ledger entry. */
  tombstonesCleared: string[]
  /** Removed from the file, but the row was edited in the app: row and entry are kept. */
  keptAppEditsOnRemoval: number
}

export type EmbeddedAnnotationSyncOptions = {
  /**
   * The scan saw the whole file (document loaded, every page read, no cap hit). Only then can a
   * missing ledger entry mean "removed from the file"; an incomplete scan never deletes anything.
   */
  complete?: boolean
}

/**
 * Compare a fresh scan with the ledger. `noteHashOf(noteId)` is the current `highlightContentHash`
 * of that row, undefined when the row no longer exists. Deletions are only planned for a
 * `complete` scan, and never for a row the user edited in the app.
 */
export function planEmbeddedAnnotationSync(
  items: readonly ScannedPdfAnnotation[],
  ledger: ReadonlyMap<string, EmbeddedAnnotationLedgerEntry>,
  noteHashOf: (noteId: string) => string | undefined,
  options: EmbeddedAnnotationSyncOptions = {},
): EmbeddedAnnotationSyncPlan {
  const plan: EmbeddedAnnotationSyncPlan = {
    inserts: [],
    updates: [],
    unchanged: 0,
    keptAppEdits: 0,
    dismissed: 0,
    managed: [],
    rekeys: [],
    deletions: [],
    tombstonesCleared: [],
    keptAppEditsOnRemoval: 0,
  }
  const identities = embeddedAnnotationIdentities(items)

  // Pass 1: exact keys. Pass 2: a named item whose name is new to the ledger may still be an
  // annotation imported before `/NM` support, under its anchor key — re-key that row.
  const matched = new Map<number, EmbeddedAnnotationLedgerEntry>()
  const claimed = new Set<string>()
  identities.forEach(({ key }, index) => {
    const entry = ledger.get(key)
    if (entry && !claimed.has(key)) {
      matched.set(index, entry)
      claimed.add(key)
    }
  })
  identities.forEach(({ key, legacyKey }, index) => {
    if (matched.has(index) || key === legacyKey || claimed.has(legacyKey)) return
    const entry = ledger.get(legacyKey)
    if (!entry) return
    matched.set(index, { ...entry, sourceKey: key })
    claimed.add(legacyKey)
    plan.rekeys.push({ from: legacyKey, to: key })
  })

  items.forEach((item, index) => {
    const key = identities[index]!.key
    const step = { index, key, item }
    plan.managed.push(index)
    const entry = matched.get(index)
    if (!entry) {
      plan.inserts.push(step)
      return
    }
    const noteHash = noteHashOf(entry.noteId)
    if (noteHash === undefined) plan.dismissed += 1
    else if (embeddedAnnotationSourceHash(item) === entry.sourceHash) plan.unchanged += 1
    else if (noteHash !== entry.noteHash) plan.keptAppEdits += 1
    else plan.updates.push({ ...step, noteId: entry.noteId })
  })

  if (options.complete) {
    for (const [key, entry] of ledger) {
      if (claimed.has(key)) continue
      const noteHash = noteHashOf(entry.noteId)
      if (noteHash === undefined) plan.tombstonesCleared.push(key)
      else if (noteHash === entry.noteHash) plan.deletions.push({ key, noteId: entry.noteId })
      else plan.keptAppEditsOnRemoval += 1
    }
  }
  return plan
}

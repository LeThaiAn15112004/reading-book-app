/**
 * Markdown annotations (highlight / underline / squiggly / strikethrough / replace / insert / note) —
 * anchoring and the persisted shape. Same `notes` rows as the other formats:
 *  - `locatorExtended.locator` = a `text-offset` location (`blockId: 'md'`) at the annotation's START
 *    offset, `chapterIndex` = its start piece — the jump target and sidebar grouping;
 *  - `mdAnnotation` = `{ startSegment, startOffset, endSegment, endOffset, caret? }`, validated at the IPC
 *    boundary like `pdfAnnotation` (see `MdAnnotation` for the offset rule);
 *  - `locatorExtended.text` = the quote (+ context) it was made on: offsets say WHERE, the quote says
 *    WHAT — a row whose quote no longer sits at its offsets (file changed outside the app) is hidden,
 *    never moved to look-alike text, and comes back if the matching text does.
 */

import { TextOffsetLocation, type MdAnnotation, type NoteLocator, type NoteSelectionText } from '../domain/index.js'
import { packBookmarkLocator } from '../app-models/bookmark-location.js'
import { DEFAULT_HIGHLIGHT_COLOR } from '../app-models/highlight-colors.js'
import {
  parseSelectionTextRef,
  type HighlightStyleKind,
  type ReaderHighlightBase,
} from '../app-models/highlight-location.js'
import { TXT_CONTEXT_CHARS, TXT_QUOTE_MAX_CHARS } from '../txt/txt-text.js'

/** `blockId` of every Markdown `text-offset` location. */
export const MD_BLOCK_ID = 'md'
/** Upper bound on the serialized `mdAnnotation` crossing IPC. */
export const MD_ANNOTATION_MAX_REF_LENGTH = 512
/** Highest accepted piece index / offset (a 5 MB file is far below both). */
export const MD_ANNOTATION_MAX_INDEX = 50_000_000

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MD_ANNOTATION_MAX_INDEX
}

export type MdPoint = { segment: number; offset: number }

/** Negative when `a` comes first, positive when `b` does, 0 for the same point. */
export function compareMdPoints(a: MdPoint, b: MdPoint): number {
  return a.segment !== b.segment ? a.segment - b.segment : a.offset - b.offset
}

/** Strict validation of an untrusted `mdAnnotation` (IPC input, or a row read back from SQLite). */
export function parseMdAnnotation(value: unknown): MdAnnotation | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const { startSegment, startOffset, endSegment, endOffset } = v
  if (!isIndex(startSegment) || !isIndex(startOffset) || !isIndex(endSegment) || !isIndex(endOffset)) return undefined
  const order = compareMdPoints({ segment: startSegment, offset: startOffset }, { segment: endSegment, offset: endOffset })
  if (v.caret !== undefined) {
    // An insertion point is one point, and only ever flagged `true`.
    if (v.caret !== true || order !== 0) return undefined
    return { startSegment, startOffset, endSegment, endOffset, caret: true }
  }
  if (order >= 0) return undefined
  return { startSegment, startOffset, endSegment, endOffset }
}

/** `parseMdAnnotation` over the JSON string that crosses IPC (size-capped before parsing). */
export function parseMdAnnotationRef(raw: unknown): MdAnnotation | undefined {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > MD_ANNOTATION_MAX_REF_LENGTH) return undefined
  try {
    return parseMdAnnotation(JSON.parse(raw))
  } catch {
    return undefined
  }
}

export function packMdAnnotationRef(annotation: MdAnnotation): string {
  const { startSegment, startOffset, endSegment, endOffset } = annotation
  return JSON.stringify(
    annotation.caret
      ? { startSegment, startOffset, endSegment, endOffset, caret: true }
      : { startSegment, startOffset, endSegment, endOffset },
  )
}

/** The annotation's jump target: a `text-offset` at its start offset. */
export function mdAnnotationLocation(annotation: MdAnnotation): TextOffsetLocation {
  return new TextOffsetLocation(annotation.startOffset, MD_BLOCK_ID)
}

/** Locator JSON for a Markdown annotation — `chapterIndex` = its start piece. */
export function packMdHighlightLocator(annotation: MdAnnotation): string {
  return packBookmarkLocator(mdAnnotationLocation(annotation), annotation.startSegment)
}

/** Cross-check at the IPC boundary: the jump target must be the annotation's own start. */
export function isConsistentMdHighlight(locator: NoteLocator, annotation: MdAnnotation): boolean {
  return (
    locator.kind === 'text-offset' &&
    locator.offset === annotation.startOffset &&
    locator.blockId === MD_BLOCK_ID &&
    locator.chapterIndex === annotation.startSegment
  )
}

/**
 * Reading position: a `text-offset` location whose `blockId` carries the piece (`md:<piece>`) and whose
 * `offset` is the offset inside it — the same layout-independent point an annotation uses, so a different
 * font, width or theme still reopens on the same line.
 */
export function mdReadingLocation(point: MdPoint): TextOffsetLocation {
  return new TextOffsetLocation(point.offset, `${MD_BLOCK_ID}:${point.segment}`)
}

const MD_READING_BLOCK = /^md:(\d{1,8})$/

/** A saved location → the Markdown point it names; undefined for anything else (absent, other format). */
export function parseMdReadingLocation(location: unknown): MdPoint | undefined {
  if (!(location instanceof TextOffsetLocation)) return undefined
  const match = MD_READING_BLOCK.exec(location.blockId ?? '')
  if (!match || !isIndex(location.offset)) return undefined
  return { segment: Number(match[1]), offset: location.offset }
}

/** Renderer-side view of one Markdown annotation row. */
export type MdReaderHighlight = ReaderHighlightBase & {
  startSegment: number
  startOffset: number
  endSegment: number
  endOffset: number
  /** Inserted Text: one insertion point, not a run of text. */
  caret?: true
  /** The start piece — the shared sidebar groups rows by it. */
  chapterIndex: number
}

export function isMdReaderHighlight(h: ReaderHighlightBase): h is MdReaderHighlight {
  const v = h as Partial<MdReaderHighlight>
  return typeof v.startSegment === 'number' && typeof v.endSegment === 'number'
}

/** The anchor of a renderer row. */
export function mdAnnotationOf(h: MdReaderHighlight): MdAnnotation {
  const base = {
    startSegment: h.startSegment,
    startOffset: h.startOffset,
    endSegment: h.endSegment,
    endOffset: h.endOffset,
  }
  return h.caret ? { ...base, caret: true } : base
}

export interface MdHighlightDtoLike {
  id: string
  locatorRef: string
  styleKind: HighlightStyleKind
  colorHex: string
  note?: string
  tags: string[]
  selectionTextRef?: string
  mdAnnotationRef?: string
  createdAt: string
  updatedAt: string
}

/** IPC row → renderer row; null unless the row is a Markdown annotation. */
export function mdHighlightDtoToReaderHighlight(dto: MdHighlightDtoLike): MdReaderHighlight | null {
  const locatorRef = dto.locatorRef?.trim()
  if (!locatorRef) return null
  const annotation = parseMdAnnotationRef(dto.mdAnnotationRef)
  if (!annotation) return null
  return {
    id: dto.id,
    locatorRef,
    startSegment: annotation.startSegment,
    startOffset: annotation.startOffset,
    endSegment: annotation.endSegment,
    endOffset: annotation.endOffset,
    ...(annotation.caret ? { caret: true as const } : {}),
    chapterIndex: annotation.startSegment,
    styleKind: dto.styleKind,
    colorHex: dto.colorHex?.trim() || DEFAULT_HIGHLIGHT_COLOR,
    note: dto.note?.trim() || undefined,
    tags: dto.tags ?? [],
    selectionText: parseSelectionTextRef(dto.selectionTextRef),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

/**
 * Does the text now at the annotation's place still match what it was made on? A truncated quote
 * must be a prefix of the text; no quote (a caret, or an old row) always matches.
 */
export function mdQuoteMatches(currentText: string, quote: string | undefined): boolean {
  if (!quote) return true
  return currentText.startsWith(quote)
}

/** Quote + surrounding context for a selection (stored in `locatorExtended.text`). */
export function buildMdSelectionText(before: string, selected: string, after: string): NoteSelectionText {
  const out: NoteSelectionText = { highlight: selected.slice(0, TXT_QUOTE_MAX_CHARS) }
  const b = before.slice(Math.max(0, before.length - TXT_CONTEXT_CHARS))
  const a = after.slice(0, TXT_CONTEXT_CHARS)
  if (b) out.before = b
  if (a) out.after = a
  return out
}

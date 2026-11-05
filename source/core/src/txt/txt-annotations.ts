/**
 * TXT annotations (highlight / underline / strikethrough / note) — anchoring and the rule for what
 * a text edit does to them. Same `notes` rows as EPUB / PDF markup:
 *  - `locatorExtended.locator` = a `text-offset` location at the annotation's START (jump target +
 *    sidebar), `chapterIndex` 0 — the shape bookmarks already use;
 *  - `txtAnnotation` = `{ startOffset, endOffset }` (half-open, UTF-16 code units into the canonical
 *    text — `txt-text.ts`), validated at the IPC boundary like `pdfAnnotation`;
 *  - `locatorExtended.text` = the quote (+ context) the annotation was made on. Offsets say WHERE,
 *    the quote says WHAT — a stale row is recognised by the quote no longer sitting at its offsets.
 *
 * Edit rule (product decision, docs/implementation_plan/txt_reader.md §4):
 *  - an edit entirely BEFORE an annotation (it ends at or before the annotation's start) moves it;
 *  - an edit entirely AFTER it (it starts at or after the annotation's end) leaves it alone;
 *  - any other edit touches the annotation's text → the annotation is removed;
 *  - nothing else is ever removed just because its offsets changed.
 * Typing exactly at an annotation's edge therefore never grows it and never deletes it.
 */

import {
  TextOffsetLocation,
  type NoteLocator,
  type NoteSelectionText,
  type TxtAnnotation,
} from '../domain/index.js'
import { packBookmarkLocator } from '../app-models/bookmark-location.js'
import { DEFAULT_HIGHLIGHT_COLOR } from '../app-models/highlight-colors.js'
import {
  parseSelectionTextRef,
  type HighlightStyleKind,
  type ReaderHighlightBase,
} from '../app-models/highlight-location.js'
import { textEditDelta, type TextEdit } from './txt-edit.js'
import { TXT_CONTEXT_CHARS, TXT_QUOTE_MAX_CHARS, isCodePointBoundary } from './txt-text.js'

/** The part of an annotation the edit rule works on. */
export interface TxtSpan {
  id: string
  startOffset: number
  endOffset: number
}

/** `blockId` of every TXT `text-offset` location (a TXT book is one block of text). */
export const TXT_BLOCK_ID = 'txt'
/** Upper bound on the serialized `txtAnnotation` crossing IPC. */
export const TXT_ANNOTATION_MAX_REF_LENGTH = 1024

export type EditRelation = 'before' | 'after' | 'affected'

/** Where an annotation sits relative to an edit. */
export function relationToEdit(span: TxtSpan, edit: TextEdit): EditRelation {
  if (span.endOffset <= edit.start) return 'before'
  if (span.startOffset >= edit.start + edit.deleteLength) return 'after'
  return 'affected'
}

export interface AnnotationEditPlan<T extends TxtSpan> {
  /** Annotations that survive, in input order, with their offsets already moved. */
  kept: T[]
  /** Annotations the edit touched (original offsets, so they can be restored by an undo). */
  removed: T[]
  /** Ids of kept annotations whose offsets changed. */
  shiftedIds: string[]
}

/** Apply the edit rule to every annotation. Pure: inputs are not mutated. */
export function planAnnotationEdit<T extends TxtSpan>(
  items: readonly T[],
  edit: TextEdit,
): AnnotationEditPlan<T> {
  const delta = textEditDelta(edit)
  const kept: T[] = []
  const removed: T[] = []
  const shiftedIds: string[] = []
  for (const item of items) {
    const relation = relationToEdit(item, edit)
    if (relation === 'affected') {
      removed.push(item)
    } else if (relation === 'after' && delta !== 0) {
      kept.push({ ...item, startOffset: item.startOffset + delta, endOffset: item.endOffset + delta })
      shiftedIds.push(item.id)
    } else {
      kept.push(item)
    }
  }
  return { kept, removed, shiftedIds }
}

/** Offsets form a non-empty range on code-point boundaries of a `length`-code-unit text. */
export function isValidTxtRange(startOffset: number, endOffset: number, text: string): boolean {
  return (
    Number.isInteger(startOffset) &&
    Number.isInteger(endOffset) &&
    startOffset >= 0 &&
    startOffset < endOffset &&
    endOffset <= text.length &&
    isCodePointBoundary(text, startOffset) &&
    isCodePointBoundary(text, endOffset)
  )
}

/** The quote still sits where the annotation says (a truncated quote must be a prefix of the span). */
export function quoteMatchesText(text: string, span: TxtSpan, quote: string | undefined): boolean {
  if (!quote) return true
  if (quote.length > span.endOffset - span.startOffset) return false
  return text.startsWith(quote, span.startOffset)
}

export interface QuotedTxtSpan extends TxtSpan {
  selectionText?: NoteSelectionText
}

/**
 * Split annotations into those that still describe `text` and those that no longer do (the file was
 * changed outside the app, or a copy was lost). Stale ones are NOT moved to look-alike text: they
 * are only hidden, so they come back if the matching text does.
 */
export function splitAnnotationsByText<T extends QuotedTxtSpan>(
  items: readonly T[],
  text: string,
): { valid: T[]; stale: T[] } {
  const valid: T[] = []
  const stale: T[] = []
  for (const item of items) {
    const ok =
      isValidTxtRange(item.startOffset, item.endOffset, text) &&
      quoteMatchesText(text, item, item.selectionText?.highlight)
    ;(ok ? valid : stale).push(item)
  }
  return { valid, stale }
}

/** Quote + surrounding context for a selection (stored in `locatorExtended.text`). */
export function buildTxtSelectionText(text: string, startOffset: number, endOffset: number): NoteSelectionText {
  const quoteEnd = Math.min(endOffset, startOffset + TXT_QUOTE_MAX_CHARS)
  const before = text.slice(Math.max(0, startOffset - TXT_CONTEXT_CHARS), startOffset)
  const after = text.slice(endOffset, endOffset + TXT_CONTEXT_CHARS)
  const out: NoteSelectionText = { highlight: text.slice(startOffset, quoteEnd) }
  if (before) out.before = before
  if (after) out.after = after
  return out
}

// ---------------------------------------------------------------------------------------------
// Persisted shape ↔ renderer rows
// ---------------------------------------------------------------------------------------------

/** Strict validation of an untrusted `txtAnnotation` (IPC input, or a row read back from SQLite). */
export function parseTxtAnnotation(value: unknown): TxtAnnotation | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const { startOffset, endOffset } = v
  if (typeof startOffset !== 'number' || typeof endOffset !== 'number') return undefined
  if (!Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset)) return undefined
  if (startOffset < 0 || endOffset <= startOffset) return undefined
  return { startOffset, endOffset }
}

/** `parseTxtAnnotation` over the JSON string that crosses IPC (size-capped before parsing). */
export function parseTxtAnnotationRef(raw: unknown): TxtAnnotation | undefined {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > TXT_ANNOTATION_MAX_REF_LENGTH) return undefined
  try {
    return parseTxtAnnotation(JSON.parse(raw))
  } catch {
    return undefined
  }
}

export function packTxtAnnotationRef(annotation: TxtAnnotation): string {
  return JSON.stringify({ startOffset: annotation.startOffset, endOffset: annotation.endOffset })
}

/** The annotation's jump target: a `text-offset` at its start. */
export function txtAnnotationLocation(annotation: TxtAnnotation): TextOffsetLocation {
  return new TextOffsetLocation(annotation.startOffset, TXT_BLOCK_ID)
}

/** Locator JSON for a TXT annotation — `chapterIndex` 0 (one block), like TXT bookmarks. */
export function packTxtHighlightLocator(annotation: TxtAnnotation): string {
  return packBookmarkLocator(txtAnnotationLocation(annotation), 0)
}

/** Cross-check at the IPC boundary: the jump target must be the annotation's own start. */
export function isConsistentTxtHighlight(locator: NoteLocator, annotation: TxtAnnotation): boolean {
  return locator.kind === 'text-offset' && locator.offset === annotation.startOffset
}

/** Renderer-side view of one TXT annotation row. */
export type TxtReaderHighlight = ReaderHighlightBase & {
  startOffset: number
  endOffset: number
  /** Always 0 — the whole book is one block; kept so the shared sidebar can group rows. */
  chapterIndex: number
}

export function isTxtReaderHighlight(h: ReaderHighlightBase): h is TxtReaderHighlight {
  const v = h as Partial<TxtReaderHighlight>
  return typeof v.startOffset === 'number' && typeof v.endOffset === 'number'
}

export interface TxtHighlightDtoLike {
  id: string
  locatorRef: string
  styleKind: HighlightStyleKind
  colorHex: string
  note?: string
  tags: string[]
  selectionTextRef?: string
  txtAnnotationRef?: string
  createdAt: string
  updatedAt: string
}

/** IPC row → renderer row; null unless the row is a TXT annotation. */
export function txtHighlightDtoToReaderHighlight(dto: TxtHighlightDtoLike): TxtReaderHighlight | null {
  const locatorRef = dto.locatorRef?.trim()
  if (!locatorRef) return null
  const annotation = parseTxtAnnotationRef(dto.txtAnnotationRef)
  if (!annotation) return null
  return {
    id: dto.id,
    locatorRef,
    startOffset: annotation.startOffset,
    endOffset: annotation.endOffset,
    chapterIndex: 0,
    styleKind: dto.styleKind,
    colorHex: dto.colorHex?.trim() || DEFAULT_HIGHLIGHT_COLOR,
    note: dto.note?.trim() || undefined,
    tags: dto.tags ?? [],
    selectionText: parseSelectionTextRef(dto.selectionTextRef),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

/** A renderer row with new offsets (locator JSON follows the new start). */
export function withTxtOffsets(h: TxtReaderHighlight, startOffset: number, endOffset: number): TxtReaderHighlight {
  return { ...h, startOffset, endOffset, locatorRef: packTxtHighlightLocator({ startOffset, endOffset }) }
}

/** The topmost (last drawn) annotation covering `offset`, or null. */
export function txtMarkAt<T extends TxtSpan>(marks: readonly T[], offset: number): T | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i]!
    if (offset >= mark.startOffset && offset < mark.endOffset) return mark
  }
  return null
}

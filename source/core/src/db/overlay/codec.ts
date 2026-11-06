/**
 * Overlay row ⇄ domain codecs shared by Desktop's `SqliteOverlayStore` and Mobile's `MobileOverlayStore`
 * (spec 009 T033): `notes.note_json` builders and readers, and the reading-state → session mappings. Pure.
 */
import type { BookmarkRecord } from '../../domain/annotation/bookmark.js'
import type { HighlightRecord, HighlightStyleKind } from '../../domain/annotation/highlight.js'
import type {
  INoteState,
  MdAnnotation,
  NoteLocator,
  NoteSelectionText,
  PdfAnnotation,
  PdfInkStroke,
  TxtAnnotation,
} from '../../domain/annotation/note.js'
import { ReadingSessionState } from '../../domain/reading/reading-session-state.js'
import { parsePdfAnnotation } from '../../app-models/pdf-highlight.js'
import type { PdfInkRecord } from '../../ink/pdf-ink.js'
import { parsePdfInk } from '../../ink/pdf-ink.js'
import { parseMdAnnotation } from '../../md/md-annotations.js'
import type { ReadingStateJson } from '../../persistence/books-json.js'
import { unpackSessionLocation } from '../../persistence/session-location.js'
import { parseTxtAnnotation } from '../../txt/txt-annotations.js'

/** One `notes` row as SQLite returns it. */
export interface NoteRow {
  id: string
  book_id: string
  note_json: string
  created_at: string
  updated_at: string
}

/** The DTO-facing reading state of one book (what `overlay:getSessionState` answers). */
export interface SessionRecord {
  bookId: string
  lastReadLocation?: string
  lastReadLabel?: string
  percent: number
  fontFamily?: string
  fontSize?: number
  fontWeight?: string
  lineHeight?: number
  textAlign?: string
  layoutMode?: string
  pageTurnMode?: string
  marginsEnabled?: boolean
  marginPreset?: string
  isLandscape?: boolean
  updatedAt: string
}

export const DEFAULT_HIGHLIGHT_COLOR = '#FFEB3B'
export const DEFAULT_INK_COLOR = '#1E88E5'

/** Every kind the highlight queries list (read side). */
export const HIGHLIGHT_STYLE_KINDS: readonly HighlightStyleKind[] = [
  'highlight',
  'underline',
  'strikethrough',
  'squiggly',
  'replace',
  'insert',
  'textbox',
  // PDF shapes: rows of the same kind of table, list and history (pdf_shape_tools.md)
  'rectangle',
  'ellipse',
  'line',
  'arrow',
  // PDF Typewriter note (specs/005-typewriter-note)
  'typewriter',
  // PDF file attachment on a page (specs/007-pdf-file-attachment) — written only by the attachment operations and the live sync
  'attachment',
]

function parseNote(row: NoteRow): INoteState | undefined {
  try {
    return JSON.parse(row.note_json) as INoteState
  } catch {
    return undefined
  }
}

/** The parsed `note_json` of a row, for export (`undefined` when unreadable). */
export const noteStateOfRow = parseNote

function finiteOrUndefined(value: number | null | undefined): number | undefined {
  return value != null && Number.isFinite(value) ? value : undefined
}

function trimmedOrUndefined(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined
}

/** `books.reading_state_json` → SessionRecord (same normalisation the old table columns got). */
export function sessionRecordFromState(bookId: string, state: ReadingStateJson, fallbackUpdatedAt: string): SessionRecord {
  const unpacked = unpackSessionLocation(state.lastReadLocation ?? '')
  return {
    bookId,
    lastReadLocation: unpacked?.location.toString(),
    lastReadLabel: unpacked?.label,
    percent: finiteOrUndefined(state.percent) ?? 0,
    fontFamily: trimmedOrUndefined(state.fontFamily),
    fontSize: finiteOrUndefined(state.fontSize),
    fontWeight: trimmedOrUndefined(state.fontWeight),
    lineHeight: finiteOrUndefined(state.lineHeight),
    textAlign: trimmedOrUndefined(state.textAlign),
    layoutMode: trimmedOrUndefined(state.layoutMode),
    pageTurnMode: trimmedOrUndefined(state.pageTurnMode),
    marginsEnabled: state.marginsEnabled ?? undefined,
    marginPreset: trimmedOrUndefined(state.marginPreset),
    isLandscape: state.isLandscape === true,
    updatedAt: state.updatedAt || fallbackUpdatedAt,
  }
}

/** Domain state — only exists once a valid Location has been stored. */
export function sessionStateFromReadingState(bookId: string, state: ReadingStateJson, fallbackUpdatedAt: string): ReadingSessionState | undefined {
  const unpacked = unpackSessionLocation(state.lastReadLocation ?? '')
  if (!unpacked) return undefined
  const record = sessionRecordFromState(bookId, state, fallbackUpdatedAt)
  return new ReadingSessionState({
    bookId,
    lastReadLocation: unpacked.location,
    lastReadLabel: unpacked.label,
    percent: record.percent,
    fontFamily: record.fontFamily,
    fontSize: record.fontSize,
    fontWeight: record.fontWeight,
    lineHeight: record.lineHeight,
    textAlign: record.textAlign,
    layoutMode: record.layoutMode,
    pageTurnMode: record.pageTurnMode,
    marginsEnabled: record.marginsEnabled,
    marginPreset: record.marginPreset,
    isLandscape: record.isLandscape,
    updatedAt: record.updatedAt,
  })
}

/** The full-overwrite state JSON of `saveSessionState`. */
export function readingStateOfSession(s: ReadingSessionState, updatedAt: string, packedLocation: string): ReadingStateJson {
  return {
    lastReadLocation: packedLocation,
    percent: ReadingSessionState.clampPercent(s.percent),
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    lineHeight: s.lineHeight,
    textAlign: s.textAlign,
    layoutMode: s.layoutMode,
    pageTurnMode: s.pageTurnMode,
    marginsEnabled: s.marginsEnabled,
    marginPreset: s.marginPreset,
    isLandscape: s.isLandscape === true,
    updatedAt,
  }
}

/** The merge-patch of `saveSessionPreferences`; `undefined` members vanish in JSON, which means "keep". */
export function preferencesPatch(record: SessionRecord, packedLocation: string | undefined, nowIso: string): ReadingStateJson {
  return {
    updatedAt: record.updatedAt || nowIso,
    // Location and percent move together: percent is meaningless without the location it measures.
    lastReadLocation: packedLocation,
    percent: packedLocation !== undefined ? ReadingSessionState.clampPercent(record.percent) : undefined,
    fontFamily: record.fontFamily,
    fontSize: record.fontSize,
    fontWeight: record.fontWeight,
    lineHeight: record.lineHeight,
    textAlign: record.textAlign,
    layoutMode: record.layoutMode,
    pageTurnMode: record.pageTurnMode,
    marginsEnabled: record.marginsEnabled,
    marginPreset: record.marginPreset,
    isLandscape: record.isLandscape,
  }
}

export function bookmarkFromRow(row: NoteRow): BookmarkRecord | undefined {
  const note = parseNote(row)
  const locator = note?.locatorExtended?.locator
  // A bookmark with no jump target cannot be rendered or jumped to — skip the row rather than surfacing an entry that
  // would silently do nothing when clicked.
  if (!note || !locator) return undefined
  return {
    id: row.id,
    bookId: row.book_id,
    locator,
    label: note.label?.trim() || undefined,
    excerpt: note.textualValue?.trim() || undefined,
    createdAt: row.created_at,
  }
}

export function buildBookmarkNoteJson(input: {
  locator: NoteLocator
  label?: string
  excerpt?: string
  createdAt: string
  modifiedAt: string
}): string {
  const note: INoteState = {
    schemaVersion: 1,
    type: 'bookmark',
    group: 'bookmark',
    locatorExtended: { locator: input.locator },
    textualValue: input.excerpt,
    label: input.label,
    created: input.createdAt,
    modified: input.modifiedAt,
  }
  return JSON.stringify(note)
}

export function highlightFromRow(row: NoteRow): HighlightRecord | undefined {
  const note = parseNote(row)
  const locator = note?.locatorExtended?.locator
  if (!note || !locator) return undefined
  const styleKind: HighlightStyleKind = HIGHLIGHT_STYLE_KINDS.includes(note.type as HighlightStyleKind) ? (note.type as HighlightStyleKind) : 'highlight'
  return {
    id: row.id,
    bookId: row.book_id,
    locator,
    styleKind,
    colorHex: note.style?.colorHex?.trim() || DEFAULT_HIGHLIGHT_COLOR,
    // A Typewriter note's text is the document itself: offsets of its style runs index it, so it is never trimmed.
    note: styleKind === 'typewriter' ? (note.note ?? undefined) : note.note?.trim() || undefined,
    tags: Array.isArray(note.tags) ? note.tags : [],
    selectionText: note.locatorExtended?.text,
    // Re-validated so a hand-edited / corrupt row can't reach the renderer.
    pdfAnnotation: note.pdfAnnotation ? parsePdfAnnotation(note.pdfAnnotation, note.note ?? undefined) : undefined,
    txtAnnotation: note.txtAnnotation ? parseTxtAnnotation(note.txtAnnotation) : undefined,
    mdAnnotation: note.mdAnnotation ? parseMdAnnotation(note.mdAnnotation) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function buildHighlightNoteJson(input: {
  locator: NoteLocator
  styleKind: HighlightStyleKind
  colorHex: string
  note?: string
  tags?: string[]
  selectionText?: NoteSelectionText
  pdfAnnotation?: PdfAnnotation
  txtAnnotation?: TxtAnnotation
  mdAnnotation?: MdAnnotation
  createdAt: string
  modifiedAt: string
}): string {
  const note: INoteState = {
    schemaVersion: 1,
    type: input.styleKind,
    group: 'annotation',
    locatorExtended: { locator: input.locator, text: input.selectionText },
    pdfAnnotation: input.pdfAnnotation,
    txtAnnotation: input.txtAnnotation,
    mdAnnotation: input.mdAnnotation,
    textualValue: input.selectionText?.highlight,
    note: input.note ?? null,
    style: { colorHex: input.colorHex },
    tags: input.tags?.length ? input.tags : undefined,
    created: input.createdAt,
    modified: input.modifiedAt,
  }
  return JSON.stringify(note)
}

export function inkFromRow(row: NoteRow): PdfInkRecord | undefined {
  const note = parseNote(row)
  const locator = note?.locatorExtended?.locator
  // Re-validated so a hand-edited / corrupt row can't reach the renderer.
  const ink = note?.pdfInk ? parsePdfInk(note.pdfInk) : undefined
  if (!note || !locator || !ink) return undefined
  return {
    id: row.id,
    bookId: row.book_id,
    locator,
    colorHex: note.style?.colorHex?.trim() || DEFAULT_INK_COLOR,
    opacity: typeof note.style?.opacity === 'number' ? note.style.opacity : 1,
    ink,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function buildInkNoteJson(input: {
  locator: NoteLocator
  colorHex: string
  opacity: number
  ink: PdfInkStroke
  createdAt: string
  modifiedAt: string
}): string {
  const note: INoteState = {
    schemaVersion: 1,
    type: 'ink',
    group: 'annotation',
    locatorExtended: { locator: input.locator },
    pdfInk: input.ink,
    style: { colorHex: input.colorHex, opacity: input.opacity },
    created: input.createdAt,
    modified: input.modifiedAt,
  }
  return JSON.stringify(note)
}

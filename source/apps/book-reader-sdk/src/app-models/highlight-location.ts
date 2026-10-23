/**
 * Map reader highlights ↔ locator JSON for the `notes` overlay table.
 *
 * A highlight's jump target is a range CFI (`epubcfi(base,start,end)`) wrapped the same way a
 * bookmark's point CFI is — `Location.toString()` JSON plus the `chapterIndex` captured at
 * creation time — so the packing/parsing helpers are reused verbatim from bookmarks.
 */

import { CfiLocation, type Location, type NoteSelectionText } from '../domain/index.js'
import {
  chapterIndexFromLocatorRef,
  packBookmarkLocator,
  parseBookmarkLocation,
} from './bookmark-location.js'
import { DEFAULT_HIGHLIGHT_COLOR } from './highlight-colors.js'

export type HighlightStyleKind =
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'squiggly'
  | 'replace'
  | 'insert'
  | 'textbox'
  // PDF shapes (pdf_shape_tools.md)
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow'

/**
 * The format-independent part of a renderer-side highlight row — everything the shared
 * annotation UI (color picker, edit popup, note popup, sidebar card) reads. EPUB rows extend it
 * with a CFI (`ReaderHighlight`), PDF rows with page rects (`PdfReaderHighlight`).
 */
export type ReaderHighlightBase = {
  id: string
  /** Locator JSON exactly as stored — round-trips back to IPC unchanged. */
  locatorRef: string
  styleKind: HighlightStyleKind
  colorHex: string
  note?: string
  tags: string[]
  selectionText?: NoteSelectionText
  createdAt: string
  updatedAt: string
}

/** Renderer-side view of one EPUB highlight row. */
export type ReaderHighlight = ReaderHighlightBase & {
  /** Full range CFI string (`epubcfi(base,start,end)`) extracted from the locator. */
  cfiRange: string
  chapterIndex: number
}

/** Pack a CFI Location + chapterIndex — identical packing to bookmarks, kept as a
 *  highlight-named alias for call-site clarity. */
export function packHighlightLocator(location: Location, chapterIndex: number): string {
  return packBookmarkLocator(location, chapterIndex)
}

export function packSelectionTextRef(text?: NoteSelectionText): string | undefined {
  if (!text || (!text.before && !text.highlight && !text.after)) return undefined
  return JSON.stringify(text)
}

export function parseSelectionTextRef(raw?: string): NoteSelectionText | undefined {
  if (!raw?.trim()) return undefined
  try {
    return JSON.parse(raw) as NoteSelectionText
  } catch {
    return undefined
  }
}

export function highlightDtoToReaderHighlight(dto: {
  id: string
  locatorRef: string
  styleKind: HighlightStyleKind
  colorHex: string
  note?: string
  tags: string[]
  selectionTextRef?: string
  createdAt: string
  updatedAt: string
}): ReaderHighlight | null {
  const locatorRef = dto.locatorRef?.trim()
  if (!locatorRef) return null
  const location = parseBookmarkLocation(locatorRef)
  // The EPUB mapper (rendering goes through epub.js's CFI-based rendition.annotations): a
  // non-CFI locator is not an EPUB row — PDF rows (`page-rect` + `pdfAnnotation`) are mapped by
  // `pdfHighlightDtoToReaderHighlight` instead — so drop it rather than list an unrenderable entry.
  if (!(location instanceof CfiLocation)) return null

  return {
    id: dto.id,
    locatorRef,
    cfiRange: location.cfi,
    chapterIndex: chapterIndexFromLocatorRef(locatorRef),
    styleKind: dto.styleKind,
    colorHex: dto.colorHex?.trim() || DEFAULT_HIGHLIGHT_COLOR,
    note: dto.note?.trim() || undefined,
    tags: dto.tags ?? [],
    selectionText: parseSelectionTextRef(dto.selectionTextRef),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

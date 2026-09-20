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

export type HighlightStyleKind = 'highlight' | 'underline' | 'strikethrough' | 'textbox'

/** Renderer-side view of one highlight row. */
export type ReaderHighlight = {
  id: string
  /** Locator JSON exactly as stored — round-trips back to IPC unchanged. */
  locatorRef: string
  /** Full range CFI string (`epubcfi(base,start,end)`) extracted from the locator. */
  cfiRange: string
  chapterIndex: number
  styleKind: HighlightStyleKind
  colorHex: string
  note?: string
  tags: string[]
  selectionText?: NoteSelectionText
  createdAt: string
  updatedAt: string
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
  // Highlights are EPUB-only in this feature (rendering goes through epub.js's
  // rendition.annotations, which is CFI-based) — a non-CFI locator means a stale/foreign row,
  // drop it defensively rather than listing an entry that can never render.
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

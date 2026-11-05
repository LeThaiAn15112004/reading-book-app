/**
 * Map reader bookmarks ↔ locator JSON for the `notes` overlay table (T5.5 / FR-11).
 *
 * A bookmark's jump target is a serialized domain `Location` carrying one extra field,
 * `chapterIndex` — the reader's on-screen chapter when the bookmark was placed. `Location.parse`
 * ignores that extra, so the same string round-trips as both a jump target (tier 1, exact) and a
 * chapter fallback (tier 2, when the exact location cannot be resolved).
 */

import { Location, TextOffsetLocation } from '../domain/index.js'

const FAKE_CHAPTER_RE = /^fake:(\d+)/

/** Renderer-side view of one bookmark row. */
export type ReaderBookmark = {
  id: string
  /** Locator JSON exactly as stored — round-trips back to IPC unchanged. */
  locatorRef: string
  chapterIndex: number
  label: string
  excerpt?: string
  createdAt: string
}

/** Pack a domain Location + chapterIndex into the single JSON string stored as the locator. */
export function packBookmarkLocator(location: Location, chapterIndex: number): string {
  const plain = JSON.parse(location.toString()) as Record<string, unknown>
  plain.chapterIndex = Math.max(0, Math.floor(chapterIndex))
  return JSON.stringify(plain)
}

export function chapterIndexFromLocatorRef(raw: string): number {
  try {
    const data = JSON.parse(raw) as { chapterIndex?: unknown }
    if (typeof data.chapterIndex === 'number' && Number.isFinite(data.chapterIndex)) {
      return Math.max(0, Math.floor(data.chapterIndex))
    }
  } catch {
    /* fall through to the fake-surface encoding below */
  }
  try {
    // Non-EPUB surfaces encode their chapter in the blockId (`fake:<n>`) rather than as a
    // separate field, so a locator written before chapterIndex existed still resolves.
    const location = Location.parse(raw)
    if (location instanceof TextOffsetLocation) {
      const match = location.blockId?.match(FAKE_CHAPTER_RE)
      if (match) return Number(match[1])
    }
  } catch {
    /* keep 0 */
  }
  return 0
}

export function parseBookmarkLocation(raw: string): Location | undefined {
  const locatorRef = raw?.trim()
  if (!locatorRef) return undefined
  try {
    return Location.parse(locatorRef)
  } catch {
    return undefined
  }
}

export function bookmarkDtoToReaderBookmark(dto: {
  id: string
  locatorRef: string
  label?: string
  excerpt?: string
  createdAt: string
}): ReaderBookmark | null {
  const locatorRef = dto.locatorRef?.trim()
  if (!locatorRef) return null
  // Drop rows whose locator no longer parses instead of listing an entry that would do
  // nothing when clicked.
  if (!parseBookmarkLocation(locatorRef)) return null

  return {
    id: dto.id,
    locatorRef,
    chapterIndex: chapterIndexFromLocatorRef(locatorRef),
    label: dto.label?.trim() || 'Bookmark',
    excerpt: dto.excerpt?.trim() || undefined,
    createdAt: dto.createdAt,
  }
}

export function readerBookmarkJumpLocation(
  bookmark: ReaderBookmark,
): Location | undefined {
  return parseBookmarkLocation(bookmark.locatorRef)
}

/** The Location used to compare/toggle bookmarks at the reader's current place. */
export function resolveCurrentBookmarkLocation(options: {
  isEpubSurface: boolean
  chapterIndex: number
  epubLocation?: Location | null
}): Location | undefined {
  if (options.isEpubSurface) {
    return options.epubLocation ?? undefined
  }
  // Formats without a real renderer yet only have chapter granularity to anchor to.
  return new TextOffsetLocation(0, `fake:${Math.max(0, options.chapterIndex)}`)
}

export function readerBookmarkMatchesLocation(
  bookmark: ReaderBookmark,
  location: Location,
): boolean {
  const bookmarkLocation = readerBookmarkJumpLocation(bookmark)
  if (!bookmarkLocation) return false
  return bookmarkLocation.equals(location)
}

export function findReaderBookmarksAtLocation(
  bookmarks: ReaderBookmark[],
  location: Location,
): ReaderBookmark[] {
  return bookmarks.filter((bookmark) =>
    readerBookmarkMatchesLocation(bookmark, location),
  )
}

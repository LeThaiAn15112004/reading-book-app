/**
 * Map reader bookmarks ↔ Location JSON for OverlayStore (T5.5 / FR-11).
 */

import { Location, TextOffsetLocation } from '@reading-book/domain'
import type { ReaderBookmark } from './readerSession'

const FAKE_CHAPTER_RE = /^fake:(\d+)/

/** Pack domain Location + chapterIndex into one TEXT value for bookmarks.location_ref. */
export function packReaderBookmarkLocation(
  location: Location,
  chapterIndex: number,
): string {
  const plain = JSON.parse(location.toString()) as Record<string, unknown>
  plain.chapterIndex = Math.max(0, Math.floor(chapterIndex))
  return JSON.stringify(plain)
}

export function chapterIndexFromBookmarkLocationRef(raw: string): number {
  try {
    const data = JSON.parse(raw) as { chapterIndex?: unknown }
    if (typeof data.chapterIndex === 'number' && Number.isFinite(data.chapterIndex)) {
      return Math.max(0, Math.floor(data.chapterIndex))
    }
  } catch {
    /* fall through */
  }
  try {
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

export function bookmarkDtoToReaderBookmark(dto: {
  id: string
  locationRef: string
  label?: string
  createdAt: string
}): ReaderBookmark | null {
  const locationRef = dto.locationRef?.trim()
  if (!locationRef) return null
  try {
    Location.parse(locationRef)
  } catch {
    return null
  }
  return {
    id: dto.id,
    locationRef,
    chapterIndex: chapterIndexFromBookmarkLocationRef(locationRef),
    label: dto.label?.trim() || 'Bookmark',
    createdAt: dto.createdAt,
  }
}

export function readerBookmarkJumpLocation(
  bookmark: ReaderBookmark,
): Location | undefined {
  try {
    return Location.parse(bookmark.locationRef)
  } catch {
    return undefined
  }
}

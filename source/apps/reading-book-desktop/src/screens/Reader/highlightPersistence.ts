/**
 * Map reader highlights ↔ packed domain Location for OverlayStore (T5.2).
 */

import {
  CfiLocation,
  Highlight,
  TextOffsetLocation,
} from '@reading-book/domain'
import { splitCfiRange } from '../../reader/renderers/epub/selection-cfi'
import {
  highlightColorFromHex,
  type EpubReaderHighlight,
  type FakeReaderHighlight,
  type ReaderHighlight,
} from './readerSession'

const FAKE_BLOCK_RE = /^fake:(\d+):(\d+)$/

export function packReaderHighlightLocation(h: ReaderHighlight): string {
  if (h.source === 'epub') {
    // Pack the paint-able range CFI as start; end keeps the end point CFI.
    return Highlight.packLocation(
      new CfiLocation(h.cfiRange || h.locationStart),
      new CfiLocation(h.locationEnd || h.locationStart || h.cfiRange),
    )
  }
  const blockId = `fake:${h.chapterIndex}:${h.paragraphIndex}`
  return Highlight.packLocation(
    new TextOffsetLocation(0, blockId),
    new TextOffsetLocation(Math.max(0, h.selectedText.length), blockId),
  )
}

export function readerHighlightToDomain(
  bookId: string,
  h: ReaderHighlight,
): Highlight {
  return new Highlight({
    id: h.id,
    bookId,
    location: packReaderHighlightLocation(h),
    selectedText: h.selectedText,
    colorHex: h.colorHex,
    note: h.note,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  })
}

export function annotationDtoToReaderHighlight(dto: {
  id: string
  location: string
  selectedText: string
  colorHex: string
  note?: string
  createdAt: string
  updatedAt: string
}): ReaderHighlight | null {
  try {
    const { start, end } = Highlight.unpackLocation(dto.location)
    const colorHex = dto.colorHex.trim().toLowerCase() || '#f59e0b'
    const color = highlightColorFromHex(colorHex)
    const note = dto.note?.trim() || undefined
    const createdAt = dto.createdAt
    const updatedAt = dto.updatedAt

    if (start instanceof CfiLocation && end instanceof CfiLocation) {
      const cfiRange = start.cfi
      const split = splitCfiRange(cfiRange)
      const hl: EpubReaderHighlight = {
        source: 'epub',
        id: dto.id,
        cfiRange,
        locationStart: split.locationStart || cfiRange,
        locationEnd: split.locationEnd || end.cfi || cfiRange,
        selectedText: dto.selectedText,
        color,
        colorHex,
        chapterIndex: 0,
        note,
        createdAt,
        updatedAt,
      }
      return hl
    }

    if (start instanceof TextOffsetLocation) {
      const match = start.blockId?.match(FAKE_BLOCK_RE)
      const chapterIndex = match ? Number(match[1]) : 0
      const paragraphIndex = match ? Number(match[2]) : 0
      const hl: FakeReaderHighlight = {
        source: 'fake',
        id: dto.id,
        chapterIndex,
        paragraphIndex,
        selectedText: dto.selectedText,
        color,
        colorHex,
        note,
        createdAt,
        updatedAt,
      }
      return hl
    }

    return null
  } catch {
    return null
  }
}

/** Prefer a jumpable CFI: locationStart, else cfiRange. */
export function epubJumpCfi(h: EpubReaderHighlight): string {
  return h.locationStart?.trim() || h.cfiRange.trim()
}

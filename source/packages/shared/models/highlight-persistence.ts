/**

 * Map reader highlights ↔ generic `annotations` rows (T5.2).

 */



import {

  CfiLocation,

  Highlight,

  TextOffsetLocation,

} from '@reading-book/domain'

import {

  cfiChapterSignature,

  spineIndexFromCfiPath,

  splitCfiRange,

} from '../utils/epub-cfi.js'

import {

  highlightColorFromHex,

  type EpubReaderHighlight,

  type FakeReaderHighlight,

  type ReaderAnnotationStatus,

  type ReaderHighlight,

} from './reader-session.js'



const FAKE_BLOCK_RE = /^fake:(\d+):(\d+)$/



const DEFAULT_HIGHLIGHT_COLOR_HEX = '#f59e0b'



type AnnotationStyleLike = Record<string, unknown>



type AnnotationDtoLike = {

  id: string

  type: string

  /**

   * Legacy 1-based spine page from `annotations.page_number`. EPUB is reflowable and

   * writes null here — the CFI in `locationData` is the only positional source of truth.

   */

  pageNumber?: number | null

  locationData: string

  content?: string

  /** Free-text note the user typed (`annotations.notes`). */

  notes?: string | null

  style: AnnotationStyleLike

  status: string

  isChecked: boolean

  createdAt: string

  updatedAt: string

}



export type HighlightAnnotationInput = {

  bookId: string

  id: string

  type: 'highlight'

  /** null for reflowable EPUB — see `readerHighlightPageNumber`. */

  pageNumber: number | null

  locationData: string

  content: string

  /** Free-text note the user typed; persisted to `annotations.notes`. */

  notes?: string

  style: { colorHex: string; note?: string }

  status: ReaderAnnotationStatus

  isChecked: boolean

  createdAt: string

  updatedAt: string

}



/**

 * Persist-time `page_number`. EPUB is reflowable and has no stable physical page, so

 * it stores null and relies entirely on the CFI inside `locationData`; only the

 * offset-addressed ("fake") surface keeps a 1-based section number.

 */

export function readerHighlightPageNumber(h: ReaderHighlight): number | null {

  if (h.source === 'epub') return null

  return Math.max(1, Math.floor(h.chapterIndex) + 1)

}



/**

 * Resolve the spine/chapter index used for grouping. The CFI is authoritative — the

 * legacy `page_number` is only consulted for pre-CFI rows that have no usable path.

 */

export function chapterIndexFromAnnotationDto(

  pageNumber: number | null | undefined,

  cfi?: string,

): number {

  if (cfi) {

    const fromCfi = spineIndexFromCfiPath(cfi)

    if (fromCfi != null && fromCfi >= 0) return fromCfi

  }

  return typeof pageNumber === 'number' && Number.isFinite(pageNumber)

    ? Math.max(0, Math.floor(pageNumber) - 1)

    : 0

}



export function packReaderHighlightLocation(h: ReaderHighlight): string {

  if (h.source === 'epub') {

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



export function readerHighlightToAnnotationInput(

  bookId: string,

  h: ReaderHighlight,

): HighlightAnnotationInput {

  return {

    bookId,

    id: h.id,

    type: 'highlight',

    pageNumber: readerHighlightPageNumber(h),

    locationData: packReaderHighlightLocation(h),

    content: h.selectedText,

    ...(h.note?.trim() ? { notes: h.note.trim() } : {}),

    style: {

      colorHex: h.colorHex,

      ...(h.note?.trim() ? { note: h.note.trim() } : {}),

    },

    status: h.status ?? 'None',

    isChecked: h.isChecked ?? false,

    createdAt: h.createdAt,

    updatedAt: h.updatedAt,

  }

}



function styleString(style: AnnotationStyleLike, key: string): string | undefined {

  const value = style[key]

  return typeof value === 'string' && value.trim() ? value.trim() : undefined

}



function readerStatus(value: string): ReaderAnnotationStatus {

  return value === 'Review' || value === 'Done' ? value : 'None'

}



export function annotationDtoToReaderHighlight(

  dto: AnnotationDtoLike,

): ReaderHighlight | null {

  if (dto.type !== 'highlight') return null

  try {

    const { start, end } = Highlight.unpackLocation(dto.locationData)

    const style = dto.style ?? {}

    const colorHex =

      styleString(style, 'colorHex')?.toLowerCase() ?? DEFAULT_HIGHLIGHT_COLOR_HEX

    const color = highlightColorFromHex(colorHex)

    // `annotations.notes` is the current home; `style.note` is the pre-016 fallback.

    const note = dto.notes?.trim() || styleString(style, 'note')

    const selectedText = dto.content ?? ''

    const status = readerStatus(dto.status)

    const isChecked = dto.isChecked

    const createdAt = dto.createdAt

    const updatedAt = dto.updatedAt



    if (start instanceof CfiLocation && end instanceof CfiLocation) {

      const cfiRange = start.cfi.trim()

      if (!cfiRange || !cfiChapterSignature(cfiRange)) return null

      const split = splitCfiRange(cfiRange)

      const hl: EpubReaderHighlight = {

        source: 'epub',

        id: dto.id,

        cfiRange,

        locationStart: split.locationStart || cfiRange,

        locationEnd: split.locationEnd || end.cfi || cfiRange,

        selectedText,

        color,

        colorHex,

        chapterIndex: chapterIndexFromAnnotationDto(dto.pageNumber, cfiRange),

        note,

        status,

        isChecked,

        createdAt,

        updatedAt,

      }

      return hl

    }



    if (start instanceof TextOffsetLocation) {

      const match = start.blockId?.match(FAKE_BLOCK_RE)

      const fromBlock = match ? Number(match[1]) : NaN

      const chapterIndex = Number.isFinite(fromBlock)

        ? fromBlock

        : chapterIndexFromAnnotationDto(dto.pageNumber)

      const paragraphIndex = match ? Number(match[2]) : 0

      const hl: FakeReaderHighlight = {

        source: 'fake',

        id: dto.id,

        chapterIndex,

        paragraphIndex,

        selectedText,

        color,

        colorHex,

        note,

        status,

        isChecked,

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



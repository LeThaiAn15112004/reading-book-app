import { describe, expect, it } from 'vitest'
import { CfiLocation, Location, PageRectLocation } from '../../src/domain/index.js'
import { highlightDtoToReaderHighlight } from '../../src/app-models/highlight-location.js'
import { applyHighlightHistoryStep } from '../../src/app-models/highlight-undo.js'
import { createInMemoryStorage } from '../../src/testing/in-memory.js'
import {
  createHighlightHistory,
  highlightAdd,
  highlightReplace,
} from '../../src/app-models/highlight-history.js'
import {
  PDF_ANNOTATION_MAX_RECTS,
  PDF_ANNOTATION_MAX_REF_LENGTH,
  isConsistentPdfHighlight,
  isPdfReaderHighlight,
  normalizePdfHighlightRects,
  packPdfHighlightLocator,
  parsePdfAnnotation,
  parsePdfAnnotationRef,
  pdfAnnotationFromRects,
  pdfAnnotationRefForRects,
  pdfHighlightDtoToReaderHighlight,
  pdfMarkAt,
  pdfRectsFromAnnotation,
  type PdfHighlightRect,
  type PdfReaderHighlight,
} from '../../src/app-models/pdf-highlight.js'

/** Two lines on page 3 and one on page 4 — a selection that crosses a page break. */
const MULTI_PAGE: PdfHighlightRect[] = [
  { page: 3, x: 0.1, y: 0.8, width: 0.7, height: 0.02 },
  { page: 3, x: 0.1, y: 0.83, width: 0.4, height: 0.02 },
  { page: 4, x: 0.1, y: 0.05, width: 0.3, height: 0.02 },
]

function dtoFor(rects: PdfHighlightRect[], extra: Partial<Parameters<typeof pdfHighlightDtoToReaderHighlight>[0]> = {}) {
  const annotation = pdfAnnotationFromRects(rects)!
  return {
    id: 'h1',
    locatorRef: packPdfHighlightLocator(annotation),
    styleKind: 'highlight' as const,
    colorHex: '#ffeb3b',
    tags: [],
    selectionTextRef: JSON.stringify({ highlight: 'quoted text' }),
    pdfAnnotationRef: JSON.stringify(annotation),
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    ...extra,
  }
}

describe('PDF annotation page numbering (1-based page ↔ 0-based pageIndex)', () => {
  it('converts once each way and keeps every rect of a multi-line, multi-page selection', () => {
    const annotation = pdfAnnotationFromRects(MULTI_PAGE)!
    expect(annotation.pageIndex).toBe(2)
    expect(annotation.rects.map((r) => r.pageIndex)).toEqual([2, 2, 3])
    expect(pdfRectsFromAnnotation(annotation)).toEqual(MULTI_PAGE)
  })

  it('reads a rect without its own pageIndex as being on the annotation page', () => {
    expect(pdfRectsFromAnnotation({ pageIndex: 0, rects: [{ x: 0, y: 0, width: 0.5, height: 0.5 }] })).toEqual([
      { page: 1, x: 0, y: 0, width: 0.5, height: 0.5 },
    ])
  })
})

describe('normalizePdfHighlightRects', () => {
  it('clamps glyph boxes that poke past the page edge and drops empty / non-finite rects', () => {
    expect(
      normalizePdfHighlightRects([
        { page: 1, x: -0.01, y: 0.5, width: 0.2, height: 0.1 },
        { page: 1, x: 0.95, y: 0.5, width: 0.1, height: 0.1 },
        { page: 1, x: 0.2, y: 0.2, width: 0, height: 0.1 },
        { page: 1, x: Number.NaN, y: 0.2, width: 0.1, height: 0.1 },
        { page: 0, x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
        { page: 1, x: 1.2, y: 0.2, width: 0.1, height: 0.1 },
      ]),
    ).toEqual([
      { page: 1, x: 0, y: 0.5, width: 0.19, height: 0.1 },
      { page: 1, x: 0.95, y: 0.5, width: 0.05, height: 0.1 },
    ])
  })

  it('caps the number of rects', () => {
    const many = Array.from({ length: PDF_ANNOTATION_MAX_RECTS + 50 }, () => ({ page: 1, x: 0.1, y: 0.1, width: 0.1, height: 0.1 }))
    expect(normalizePdfHighlightRects(many)).toHaveLength(PDF_ANNOTATION_MAX_RECTS)
  })

  it('yields no annotation when nothing usable remains', () => {
    expect(pdfAnnotationFromRects([{ page: 1, x: 0.1, y: 0.1, width: 0, height: 0 }])).toBeUndefined()
    expect(pdfAnnotationRefForRects([])).toBeUndefined()
  })
})

describe('parsePdfAnnotation (IPC / row validation)', () => {
  const valid = { pageIndex: 1, rects: [{ pageIndex: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.04 }] }

  it('accepts a valid payload', () => {
    expect(parsePdfAnnotation(valid)).toEqual(valid)
  })

  it.each([
    ['no object', null],
    ['negative page', { ...valid, pageIndex: -1 }],
    ['fractional page', { ...valid, pageIndex: 1.5 }],
    ['page as string', { ...valid, pageIndex: '1' }],
    ['no rects', { pageIndex: 0, rects: [] }],
    ['rects not an array', { pageIndex: 0, rects: {} }],
    ['too many rects', { pageIndex: 0, rects: Array.from({ length: PDF_ANNOTATION_MAX_RECTS + 1 }, () => valid.rects[0]) }],
    ['infinite coordinate', { pageIndex: 1, rects: [{ x: Infinity, y: 0, width: 0.1, height: 0.1 }] }],
    ['zero width', { pageIndex: 1, rects: [{ x: 0.1, y: 0, width: 0, height: 0.1 }] }],
    ['negative height', { pageIndex: 1, rects: [{ x: 0.1, y: 0, width: 0.1, height: -0.1 }] }],
    ['outside the page (right)', { pageIndex: 1, rects: [{ x: 0.95, y: 0, width: 0.1, height: 0.1 }] }],
    ['outside the page (top)', { pageIndex: 1, rects: [{ x: 0.1, y: -0.2, width: 0.1, height: 0.1 }] }],
    ['rect before the first page', { pageIndex: 3, rects: [{ pageIndex: 2, x: 0.1, y: 0.1, width: 0.1, height: 0.1 }] }],
    ['contents not a string', { ...valid, contents: 42 }],
  ])('rejects %s', (_label, payload) => {
    expect(parsePdfAnnotation(payload)).toBeUndefined()
  })

  it('caps the serialized size before parsing', () => {
    expect(parsePdfAnnotationRef(JSON.stringify(valid))).toEqual(valid)
    expect(parsePdfAnnotationRef('x'.repeat(PDF_ANNOTATION_MAX_REF_LENGTH + 1))).toBeUndefined()
    expect(parsePdfAnnotationRef('{not json')).toBeUndefined()
    expect(parsePdfAnnotationRef(42)).toBeUndefined()
  })
})

describe('PDF locator', () => {
  it('is a page-rect on the first page with the bounding box there and chapterIndex = 0-based page', () => {
    const annotation = pdfAnnotationFromRects(MULTI_PAGE)!
    const locator = JSON.parse(packPdfHighlightLocator(annotation))
    expect(locator).toEqual({
      kind: 'page-rect',
      page: 3,
      rect: { x: 0.1, y: 0.8, width: 0.7, height: 0.05 },
      chapterIndex: 2,
    })
    const location = Location.parse(JSON.stringify(locator))
    expect(location).toBeInstanceOf(PageRectLocation)
    expect(isConsistentPdfHighlight(locator, annotation)).toBe(true)
    expect(isConsistentPdfHighlight({ ...locator, page: 4 }, annotation)).toBe(false)
    expect(isConsistentPdfHighlight({ kind: 'cfi', cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)' }, annotation)).toBe(false)
  })
})

describe('pdfHighlightDtoToReaderHighlight', () => {
  it('maps a PDF row (rects, page, sidebar group, text)', () => {
    const row = pdfHighlightDtoToReaderHighlight(dtoFor(MULTI_PAGE, { styleKind: 'strikethrough', note: '  why  ' }))
    expect(row).toMatchObject({
      id: 'h1',
      page: 3,
      chapterIndex: 2,
      rects: MULTI_PAGE,
      styleKind: 'strikethrough',
      note: 'why',
      selectionText: { highlight: 'quoted text' },
    })
    expect(row && isPdfReaderHighlight(row)).toBe(true)
  })

  it('drops rows that are not PDF annotations or disagree with their locator', () => {
    expect(pdfHighlightDtoToReaderHighlight(dtoFor(MULTI_PAGE, { pdfAnnotationRef: undefined }))).toBeNull()
    expect(
      pdfHighlightDtoToReaderHighlight(
        dtoFor(MULTI_PAGE, { locatorRef: JSON.stringify({ kind: 'page-rect', page: 9, chapterIndex: 8 }) }),
      ),
    ).toBeNull()
    expect(
      pdfHighlightDtoToReaderHighlight(
        dtoFor(MULTI_PAGE, { locatorRef: new CfiLocation('epubcfi(/6/2!/4/2,/1:0,/1:5)').toString() }),
      ),
    ).toBeNull()
  })

  it('keeps PDF and EPUB rows apart: each mapper only takes its own format', () => {
    const pdfDto = dtoFor(MULTI_PAGE)
    const epubDto = {
      ...pdfDto,
      id: 'e1',
      locatorRef: JSON.stringify({ kind: 'cfi', cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', chapterIndex: 0 }),
      pdfAnnotationRef: undefined,
    }
    expect(highlightDtoToReaderHighlight(pdfDto)).toBeNull()
    expect(pdfHighlightDtoToReaderHighlight(epubDto)).toBeNull()
    expect(highlightDtoToReaderHighlight(epubDto)?.cfiRange).toBe('epubcfi(/6/2!/4/2,/1:0,/1:5)')
  })
})

describe('pdfMarkAt', () => {
  const marks = [
    { id: 'under', rects: [{ page: 2, x: 0.1, y: 0.1, width: 0.5, height: 0.05 }] },
    { id: 'over', rects: [{ page: 2, x: 0.3, y: 0.1, width: 0.5, height: 0.05 }] },
    { id: 'other-page', rects: [{ page: 3, x: 0, y: 0, width: 1, height: 1 }] },
  ]

  it('returns the topmost mark under the point on that page', () => {
    expect(pdfMarkAt(marks, 2, 0.4, 0.12)?.id).toBe('over')
    expect(pdfMarkAt(marks, 2, 0.15, 0.12)?.id).toBe('under')
    expect(pdfMarkAt(marks, 2, 0.95, 0.12)).toBeNull()
    expect(pdfMarkAt(marks, 1, 0.4, 0.12)).toBeNull()
  })

  it('honours the slop around a rect', () => {
    expect(pdfMarkAt(marks, 2, 0.4, 0.16)).toBeNull()
    expect(pdfMarkAt(marks, 2, 0.4, 0.16, 0, 0.02)?.id).toBe('over')
  })
})

describe('OverlayStore round trip (in-memory reference store)', () => {
  it('stores pdfAnnotation next to the locator, per book, without touching EPUB rows', async () => {
    const { overlays } = createInMemoryStorage()
    const annotation = pdfAnnotationFromRects(MULTI_PAGE)!
    const locator = JSON.parse(packPdfHighlightLocator(annotation))
    await overlays.saveHighlight({
      id: 'p1',
      bookId: 'pdf-book',
      locator,
      styleKind: 'underline',
      colorHex: '#4fc3f7',
      pdfAnnotation: annotation,
    })
    await overlays.saveHighlight({
      id: 'e1',
      bookId: 'epub-book',
      locator: { kind: 'cfi', cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', chapterIndex: 0 },
      styleKind: 'highlight',
      colorHex: '#ffeb3b',
    })

    const pdfRows = await overlays.listHighlights('pdf-book')
    expect(pdfRows.map((r) => r.id)).toEqual(['p1'])
    expect(pdfRows[0]!.pdfAnnotation).toEqual(annotation)
    const epubRows = await overlays.listHighlights('epub-book')
    expect(epubRows.map((r) => r.id)).toEqual(['e1'])
    expect(epubRows[0]!.pdfAnnotation).toBeUndefined()

    expect(await overlays.deleteHighlight('epub-book', 'p1')).toBe(false)
    expect(await overlays.deleteHighlight('pdf-book', 'p1')).toBe(true)
    expect(await overlays.listHighlights('pdf-book')).toEqual([])
  })
})

describe('generic highlight history for PDF rows', () => {
  it('undoes and redoes add / replace without any CFI', () => {
    const row = pdfHighlightDtoToReaderHighlight(dtoFor(MULTI_PAGE))! satisfies PdfReaderHighlight
    const recolored = { ...row, colorHex: '#4caf50' }
    const history = createHighlightHistory<PdfReaderHighlight>()
    history.push(highlightAdd(row))
    history.push(highlightReplace(row, recolored))

    const log: string[] = []
    const handlers = {
      restore: (h: PdfReaderHighlight) => log.push(`restore ${h.colorHex}`),
      remove: (id: string) => log.push(`remove ${id}`),
    }
    applyHighlightHistoryStep(history.undo()!, 'undo', handlers)
    applyHighlightHistoryStep(history.undo()!, 'undo', handlers)
    applyHighlightHistoryStep(history.redo()!, 'redo', handlers)
    expect(log).toEqual(['restore #ffeb3b', 'remove h1', 'restore #ffeb3b'])
  })
})

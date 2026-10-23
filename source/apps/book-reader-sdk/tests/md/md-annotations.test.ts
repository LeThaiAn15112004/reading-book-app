import { describe, expect, it } from 'vitest'
import {
  buildMdSelectionText,
  compareMdPoints,
  isConsistentMdHighlight,
  isMdReaderHighlight,
  mdAnnotationOf,
  mdHighlightDtoToReaderHighlight,
  mdQuoteMatches,
  packMdAnnotationRef,
  packMdHighlightLocator,
  parseMdAnnotation,
  parseMdAnnotationRef,
} from '../../src/md/md-annotations.js'
import { TXT_QUOTE_MAX_CHARS } from '../../src/txt/txt-text.js'
import { parseBookmarkLocation } from '../../src/app-models/bookmark-location.js'

const range = { startSegment: 1, startOffset: 10, endSegment: 1, endOffset: 25 }
const caret = { startSegment: 2, startOffset: 7, endSegment: 2, endOffset: 7, caret: true as const }

function dto(annotation: typeof range | typeof caret, extra: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    locatorRef: packMdHighlightLocator(annotation),
    styleKind: 'highlight' as const,
    colorHex: '#ffeb3b',
    tags: [],
    mdAnnotationRef: packMdAnnotationRef(annotation),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  }
}

describe('Markdown annotation anchor', () => {
  it('orders points by piece, then offset', () => {
    expect(compareMdPoints({ segment: 0, offset: 99 }, { segment: 1, offset: 0 })).toBeLessThan(0)
    expect(compareMdPoints({ segment: 1, offset: 5 }, { segment: 1, offset: 5 })).toBe(0)
    expect(compareMdPoints({ segment: 2, offset: 0 }, { segment: 1, offset: 50 })).toBeGreaterThan(0)
  })

  it('accepts a range within one piece, across pieces, and a caret', () => {
    expect(parseMdAnnotation(range)).toEqual(range)
    expect(parseMdAnnotation({ ...range, endSegment: 3, endOffset: 2 })).toMatchObject({ endSegment: 3 })
    expect(parseMdAnnotation(caret)).toEqual(caret)
  })

  it('rejects an empty or backwards range, and bad numbers', () => {
    expect(parseMdAnnotation({ ...range, endOffset: 10 })).toBeUndefined()
    expect(parseMdAnnotation({ ...range, endOffset: 3 })).toBeUndefined()
    expect(parseMdAnnotation({ ...range, endSegment: 0 })).toBeUndefined()
    expect(parseMdAnnotation({ ...range, startOffset: -1 })).toBeUndefined()
    expect(parseMdAnnotation({ ...range, startOffset: 1.5 })).toBeUndefined()
    expect(parseMdAnnotation({ ...range, endOffset: Number.NaN })).toBeUndefined()
    expect(parseMdAnnotation({ ...range, endOffset: 1e12 })).toBeUndefined()
    expect(parseMdAnnotation({ startSegment: '1', startOffset: 0, endSegment: 1, endOffset: 2 })).toBeUndefined()
    expect(parseMdAnnotation(null)).toBeUndefined()
  })

  it('a caret is one point, flagged only with true', () => {
    expect(parseMdAnnotation({ ...range, caret: true })).toBeUndefined()
    expect(parseMdAnnotation({ ...caret, caret: false })).toBeUndefined()
    expect(parseMdAnnotation({ ...caret, caret: 'yes' })).toBeUndefined()
    expect(parseMdAnnotation({ ...caret, endOffset: 8 })).toBeUndefined()
  })

  it('round-trips through the IPC string and refuses oversize / garbage', () => {
    expect(parseMdAnnotationRef(packMdAnnotationRef(range))).toEqual(range)
    expect(parseMdAnnotationRef(packMdAnnotationRef(caret))).toEqual(caret)
    expect(parseMdAnnotationRef('{nope')).toBeUndefined()
    expect(parseMdAnnotationRef('')).toBeUndefined()
    expect(parseMdAnnotationRef(`{"startSegment":0,"startOffset":0,"endSegment":0,"endOffset":1,"x":"${'a'.repeat(600)}"}`)).toBeUndefined()
    expect(parseMdAnnotationRef(42)).toBeUndefined()
  })
})

describe('Markdown annotation locator and rows', () => {
  it('the locator is a text-offset at the start, in block md, grouped by the start piece', () => {
    const locator = parseBookmarkLocation(packMdHighlightLocator(range))!
    expect(locator.kind).toBe('text-offset')
    expect(locator).toMatchObject({ offset: 10, blockId: 'md' })
    expect(JSON.parse(packMdHighlightLocator(range)).chapterIndex).toBe(1)
  })

  it('the boundary check ties the locator to the anchor', () => {
    const json = JSON.parse(packMdHighlightLocator(range))
    expect(isConsistentMdHighlight(json, range)).toBe(true)
    expect(isConsistentMdHighlight(json, { ...range, startOffset: 11 })).toBe(false)
    expect(isConsistentMdHighlight(json, { ...range, startSegment: 2, endSegment: 2 })).toBe(false)
    expect(isConsistentMdHighlight({ ...json, blockId: 'txt' }, range)).toBe(false)
    expect(isConsistentMdHighlight({ kind: 'page-rect', page: 1 } as never, range)).toBe(false)
  })

  it('maps an IPC row to a reader row and back to the same anchor', () => {
    const row = mdHighlightDtoToReaderHighlight(dto(range, { note: 'n' }))!
    expect(isMdReaderHighlight(row)).toBe(true)
    expect(row).toMatchObject({ startSegment: 1, startOffset: 10, endSegment: 1, endOffset: 25, chapterIndex: 1, note: 'n' })
    expect(row.caret).toBeUndefined()
    expect(mdAnnotationOf(row)).toEqual(range)
    const c = mdHighlightDtoToReaderHighlight(dto(caret, { styleKind: 'insert' }))!
    expect(c.caret).toBe(true)
    expect(mdAnnotationOf(c)).toEqual(caret)
  })

  it('rows of other formats are not Markdown rows', () => {
    expect(mdHighlightDtoToReaderHighlight({ ...dto(range), mdAnnotationRef: undefined })).toBeNull()
    expect(mdHighlightDtoToReaderHighlight({ ...dto(range), mdAnnotationRef: '{"pageIndex":0}' })).toBeNull()
    expect(mdHighlightDtoToReaderHighlight({ ...dto(range), locatorRef: '' })).toBeNull()
  })
})

describe('Markdown quote check and selection text', () => {
  it('keeps a mark only while the text at its place still starts with its quote', () => {
    expect(mdQuoteMatches('Alpha beta gamma', 'Alpha beta')).toBe(true)
    expect(mdQuoteMatches('Alpha beta gamma', 'Alpha BETA')).toBe(false)
    expect(mdQuoteMatches('Anything', undefined)).toBe(true)
    expect(mdQuoteMatches('Anything', '')).toBe(true)
    expect(mdQuoteMatches('', 'x')).toBe(false)
  })

  it('works on combining marks and emoji without normalising them', () => {
    const nfd = 'Tiếng Việt 🌳'
    expect(mdQuoteMatches(nfd, 'Tiếng')).toBe(true)
    expect(mdQuoteMatches(nfd, 'Tiếng')).toBe(false)
  })

  it('builds a quote with bounded context', () => {
    const text = buildMdSelectionText('x'.repeat(100), 'quoted words', 'y'.repeat(100))
    expect(text.highlight).toBe('quoted words')
    expect(text.before!.length).toBeLessThanOrEqual(64)
    expect(text.after!.length).toBeLessThanOrEqual(64)
    expect(buildMdSelectionText('', 'only', '')).toEqual({ highlight: 'only' })
    expect(buildMdSelectionText('a', 'q'.repeat(TXT_QUOTE_MAX_CHARS + 500), 'b').highlight!.length).toBe(TXT_QUOTE_MAX_CHARS)
  })
})

describe('Markdown reading position', () => {
  it('round-trips a point through a text-offset location and its JSON', async () => {
    const { mdReadingLocation, parseMdReadingLocation } = await import('../../src/md/md-annotations.js')
    const { Location } = await import('../../src/domain/index.js')
    const loc = mdReadingLocation({ segment: 3, offset: 120 })
    expect(parseMdReadingLocation(Location.parse(loc.toString()))).toEqual({ segment: 3, offset: 120 })
    expect(parseMdReadingLocation(mdReadingLocation({ segment: 0, offset: 0 }))).toEqual({ segment: 0, offset: 0 })
  })

  it('ignores anything that is not a Markdown position', async () => {
    const { parseMdReadingLocation } = await import('../../src/md/md-annotations.js')
    const { TextOffsetLocation, PageRectLocation } = await import('../../src/domain/index.js')
    expect(parseMdReadingLocation(undefined)).toBeUndefined()
    expect(parseMdReadingLocation(new TextOffsetLocation(5, 'txt'))).toBeUndefined()
    expect(parseMdReadingLocation(new TextOffsetLocation(5))).toBeUndefined()
    expect(parseMdReadingLocation(new TextOffsetLocation(5, 'md:'))).toBeUndefined()
    expect(parseMdReadingLocation(new TextOffsetLocation(5, 'md:-1'))).toBeUndefined()
    expect(parseMdReadingLocation(new TextOffsetLocation(5, 'md:2x'))).toBeUndefined()
    expect(parseMdReadingLocation(new PageRectLocation(2))).toBeUndefined()
  })
})

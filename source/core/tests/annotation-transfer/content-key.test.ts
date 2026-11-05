import { describe, expect, it } from 'vitest'
import { contentKeyOf, type TransferAnnotation } from '../../src/annotation-transfer/index.js'

const a = (over: Partial<TransferAnnotation> = {}): TransferAnnotation => ({
  sourceId: 'x',
  type: 'highlight',
  locator: { kind: 'page-rect', page: 12 },
  selectionText: { highlight: 'câu trích' },
  note: 'ghi chú',
  colorHex: '#FFEB3B',
  createdAt: '2026-10-20T00:00:00Z',
  origin: 'app',
  pdfAnnotation: { pageIndex: 11, rects: [{ x: 0.123456, y: 0.31, width: 0.55, height: 0.02 }] },
  ...over,
})

describe('contentKeyOf', () => {
  it('is equal for the same content under different ids, colours and times', () => {
    const other = a({ sourceId: 'other', colorHex: '#000000', createdAt: '2020-01-01T00:00:00Z', modifiedAt: '2021-01-01T00:00:00Z' })
    expect(contentKeyOf(other)).toBe(contentKeyOf(a()))
  })

  it('differs when the comment, quote, type or place differs', () => {
    const k = contentKeyOf(a())
    expect(contentKeyOf(a({ note: 'khác' }))).not.toBe(k)
    expect(contentKeyOf(a({ selectionText: { highlight: 'khác' } }))).not.toBe(k)
    expect(contentKeyOf(a({ type: 'underline' }))).not.toBe(k)
    expect(contentKeyOf(a({ locator: { kind: 'page-rect', page: 13 } }))).not.toBe(k)
  })

  it('does not depend on key order or on rounding noise below four decimals', () => {
    const reordered = a({ pdfAnnotation: { rects: [{ height: 0.02, width: 0.55, y: 0.31, x: 0.12345600001 }], pageIndex: 11 } })
    expect(contentKeyOf(reordered)).toBe(contentKeyOf(a()))
    const moved = a({ pdfAnnotation: { pageIndex: 11, rects: [{ x: 0.2, y: 0.31, width: 0.55, height: 0.02 }] } })
    expect(contentKeyOf(moved)).not.toBe(contentKeyOf(a()))
  })

  it('uses offsets for TXT and the anchor for Markdown', () => {
    const txt = (s: number, e: number) =>
      a({ locator: { kind: 'text-offset', offset: s, blockId: 'txt' }, pdfAnnotation: undefined, txtAnnotation: { startOffset: s, endOffset: e } })
    expect(contentKeyOf(txt(1, 5))).toBe(contentKeyOf(txt(1, 5)))
    expect(contentKeyOf(txt(1, 5))).not.toBe(contentKeyOf(txt(1, 6)))
    const md = (o: number) =>
      a({
        locator: { kind: 'text-offset', offset: 0, blockId: 'md' },
        pdfAnnotation: undefined,
        mdAnnotation: { startSegment: 4, startOffset: 0, endSegment: 4, endOffset: o },
      })
    expect(contentKeyOf(md(38))).not.toBe(contentKeyOf(md(39)))
  })
})

import { describe, expect, it } from 'vitest'
import { PageRectLocation } from '../../src/domain/index.js'
import { parseBookmarkLocation } from '../../src/app-models/bookmark-location.js'
import {
  PDF_INK_MAX_PATHS,
  PDF_INK_MAX_POINTS,
  PDF_INK_MAX_REF_LENGTH,
  isConsistentPdfInk,
  normalizeInkPoints,
  packPdfInkLocator,
  packPdfInkRef,
  parsePdfInk,
  parsePdfInkRef,
  pdfInkBounds,
} from '../../src/ink/pdf-ink.js'

const stroke = () => ({
  pageIndex: 2,
  paths: [
    [
      [0.1, 0.2],
      [0.4, 0.6],
    ],
  ],
  penStyle: 'pen' as const,
  width: 0.004,
})

describe('parsePdfInk', () => {
  it('accepts a valid stroke and round-trips through the ref', () => {
    expect(parsePdfInk(stroke())).toEqual(stroke())
    expect(parsePdfInkRef(packPdfInkRef(stroke() as never))).toEqual(stroke())
  })

  it('rejects non-finite, out-of-box and malformed points', () => {
    for (const bad of [[Number.NaN, 0.5], [0.5, Infinity], [-0.1, 0.5], [0.5, 1.2], [0.5]]) {
      expect(parsePdfInk({ ...stroke(), paths: [[[0.1, 0.1], bad]] })).toBeUndefined()
    }
    expect(parsePdfInk({ ...stroke(), paths: [[[0.1, 0.1]]] })).toBeUndefined()
    expect(parsePdfInk({ ...stroke(), paths: [] })).toBeUndefined()
  })

  it('tolerates float noise at the page edge', () => {
    expect(parsePdfInk({ ...stroke(), paths: [[[0, 0], [1 + 1e-9, 1]]] })).toBeDefined()
  })

  it('rejects bad page index, width and pen style', () => {
    expect(parsePdfInk({ ...stroke(), pageIndex: -1 })).toBeUndefined()
    expect(parsePdfInk({ ...stroke(), pageIndex: 1.5 })).toBeUndefined()
    expect(parsePdfInk({ ...stroke(), width: 0 })).toBeUndefined()
    expect(parsePdfInk({ ...stroke(), width: 0.5 })).toBeUndefined()
    expect(parsePdfInk({ ...stroke(), penStyle: 'brush' })).toBeUndefined()
    expect(parsePdfInk(null)).toBeUndefined()
  })

  it('enforces the point / path / size caps', () => {
    const many = Array.from({ length: PDF_INK_MAX_POINTS + 1 }, (_, i) => [(i % 100) / 100, 0.5])
    expect(parsePdfInk({ ...stroke(), paths: [many] })).toBeUndefined()
    const paths = Array.from({ length: PDF_INK_MAX_PATHS + 1 }, () => [
      [0.1, 0.1],
      [0.2, 0.2],
    ])
    expect(parsePdfInk({ ...stroke(), paths })).toBeUndefined()
    expect(parsePdfInkRef('x'.repeat(PDF_INK_MAX_REF_LENGTH + 1))).toBeUndefined()
    expect(parsePdfInkRef('not json')).toBeUndefined()
    expect(parsePdfInkRef(42)).toBeUndefined()
  })
})

describe('locator', () => {
  it('is a page-rect on the 1-based page, covering the stroke', () => {
    const ink = stroke() as never
    const b = pdfInkBounds(ink)
    expect(b.x).toBeCloseTo(0.1, 9)
    expect(b.y).toBeCloseTo(0.2, 9)
    expect(b.width).toBeCloseTo(0.3, 9)
    expect(b.height).toBeCloseTo(0.4, 9)
    const location = parseBookmarkLocation(packPdfInkLocator(ink))
    expect(location).toBeInstanceOf(PageRectLocation)
    expect((location as PageRectLocation).page).toBe(3)
    expect(isConsistentPdfInk({ kind: 'page-rect', page: 3 } as never, ink)).toBe(true)
    expect(isConsistentPdfInk({ kind: 'page-rect', page: 2 } as never, ink)).toBe(false)
    expect(isConsistentPdfInk({ kind: 'cfi' } as never, ink)).toBe(false)
  })
})

describe('normalizeInkPoints', () => {
  it('rounds, clamps and drops non-finite points', () => {
    expect(normalizeInkPoints([[0.123456789, 1.5], [Number.NaN, 0], [-1, 0.5]])).toEqual([
      [0.12346, 1],
      [0, 0.5],
    ])
  })
})

import { describe, expect, it } from 'vitest'
import {
  clientToPageUnit,
  embeddedAnnotationIdentities,
  highlightContentHash,
  isPdfWritableStyle,
  moveShapeEndpoint,
  parsePdfAnnotation,
  parseScannedPdfAnnotation,
  pdfAnnotationRefForRects,
  pdfHighlightDtoToReaderHighlight,
  pdfShapeAnnotation,
  pdfShapeHit,
  pdfWriteAnnotationsFromHighlight,
  packPdfHighlightLocator,
  planPdfAnnotationWrite,
  planTwoWaySync,
  readPdfJsAnnotation,
  resizeShapeBox,
  restrokeShape,
  shapeArrowBarbs,
  shapeColorHex,
  shapeFromDrag,
  shapeOpacityOf,
  shapeStrokeHex,
  type ExportableHighlight,
  type PdfShapeKind,
  type ScannedPdfAnnotation,
} from '../../src/index.js'

const RATIO = 1.4
const STROKE = 0.003

describe('shapeFromDrag — normalization in every direction', () => {
  const a: [number, number] = [0.2, 0.3]
  const b: [number, number] = [0.6, 0.5]
  const drags: [string, [number, number], [number, number]][] = [
    ['down-right', a, b],
    ['up-left', b, a],
    ['down-left', [0.6, 0.3], [0.2, 0.5]],
    ['up-right', [0.2, 0.5], [0.6, 0.3]],
  ]
  it.each(drags)('rectangle and ellipse: %s drag spans the same box', (_name, start, end) => {
    for (const kind of ['rectangle', 'ellipse'] as PdfShapeKind[]) {
      const g = shapeFromDrag(kind, start, end, STROKE, RATIO)!
      expect(g.rect).toEqual({ x: 0.2, y: 0.3, width: 0.4, height: 0.2 })
      expect(g.shape.line).toBeUndefined()
      expect(g.shape.strokeWidth).toBe(STROKE)
    }
  })

  it('line and arrow keep their direction (start → end) and a padded bounding box', () => {
    const g = shapeFromDrag('arrow', b, a, STROKE, RATIO)!
    expect(g.shape.line).toEqual([0.6, 0.5, 0.2, 0.3])
    expect(g.rect.x).toBeLessThan(0.2)
    expect(g.rect.x + g.rect.width).toBeGreaterThan(0.6)
    const line = shapeFromDrag('line', a, b, STROKE, RATIO)!
    expect(line.rect.width).toBeLessThanOrEqual(g.rect.width) // an arrow head needs more room than a plain line
  })

  it('a perfectly horizontal / vertical line still has a non-empty box', () => {
    const h = shapeFromDrag('line', [0.2, 0.5], [0.7, 0.5], STROKE, RATIO)!
    expect(h.rect.height).toBeGreaterThan(0)
    const v = shapeFromDrag('arrow', [0.5, 0.2], [0.5, 0.7], STROKE, RATIO)!
    expect(v.rect.width).toBeGreaterThan(0)
  })

  it('a click or a degenerate drag creates nothing', () => {
    expect(shapeFromDrag('rectangle', a, a, STROKE, RATIO)).toBeNull()
    expect(shapeFromDrag('ellipse', [0.2, 0.2], [0.5, 0.2], STROKE, RATIO)).toBeNull() // zero height
    expect(shapeFromDrag('line', a, [0.2001, 0.3001], STROKE, RATIO)).toBeNull()
    expect(shapeFromDrag('rectangle', [NaN, 0], [1, 1], STROKE, RATIO)).toBeNull()
  })

  it('geometry is independent of the zoom level: the same drag in pixels at 100% and 250% gives the same shape', () => {
    const at = (w: number) => ({ left: 10, top: 20, width: w, height: w * RATIO })
    const drag = (w: number) => {
      const rect = at(w)
      const p = clientToPageUnit(rect.left + 0.2 * w, rect.top + 0.3 * rect.height, rect)!
      const q = clientToPageUnit(rect.left + 0.6 * w, rect.top + 0.5 * rect.height, rect)!
      return shapeFromDrag('rectangle', p, q, STROKE, RATIO)!
    }
    const x1 = drag(600)
    const x2 = drag(1500)
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(x1.rect[key]).toBeCloseTo(x2.rect[key], 4)
  })

  it('points outside the page are clamped onto it', () => {
    const g = shapeFromDrag('rectangle', [-0.3, 0.2], [1.4, 0.6], STROKE, RATIO)!
    expect(g.rect.x).toBe(0)
    expect(g.rect.x + g.rect.width).toBe(1)
  })

  it('the pen width is clamped to a sane range', () => {
    expect(shapeFromDrag('rectangle', a, b, 5, RATIO)!.shape.strokeWidth).toBeLessThanOrEqual(0.02)
    expect(shapeFromDrag('rectangle', a, b, 0, RATIO)!.shape.strokeWidth).toBeGreaterThan(0)
  })
})

describe('resize', () => {
  const rect = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 }
  it('a box handle moves only its edges and never collapses or leaves the page', () => {
    expect(resizeShapeBox(rect, 'se', [0.8, 0.6], RATIO)).toEqual({ x: 0.2, y: 0.3, width: 0.6, height: 0.3 })
    const tiny = resizeShapeBox(rect, 'e', [0.0, 0.4], RATIO)
    expect(tiny.x).toBe(0.2)
    expect(tiny.width).toBeGreaterThan(0)
    const big = resizeShapeBox(rect, 'se', [9, 9], RATIO)
    expect(big.x + big.width).toBeLessThanOrEqual(1)
    expect(big.y + big.height).toBeLessThanOrEqual(1)
  })

  it('a line endpoint moves alone; the box follows; a too-short result is refused', () => {
    const g = shapeFromDrag('arrow', [0.2, 0.3], [0.6, 0.5], STROKE, RATIO)!
    const moved = moveShapeEndpoint('arrow', g.shape, 'end', [0.9, 0.9], RATIO)!
    expect(moved.shape.line).toEqual([0.2, 0.3, 0.9, 0.9])
    expect(moved.rect.x + moved.rect.width).toBeGreaterThan(0.9)
    expect(moveShapeEndpoint('arrow', g.shape, 'start', [0.6001, 0.5001], RATIO)).toBeNull()
  })

  it('changing the pen width of a line regrows its box; a rectangle keeps its box', () => {
    const g = shapeFromDrag('line', [0.2, 0.3], [0.6, 0.5], STROKE, RATIO)!
    const thick = restrokeShape('line', g.rect, g.shape, 0.01, RATIO)
    expect(thick.rect.width).toBeGreaterThan(g.rect.width)
    expect(thick.shape.line).toEqual(g.shape.line)
    const r = shapeFromDrag('rectangle', [0.2, 0.3], [0.6, 0.5], STROKE, RATIO)!
    expect(restrokeShape('rectangle', r.rect, r.shape, 0.01, RATIO).rect).toEqual(r.rect)
  })
})

describe('hit testing', () => {
  const r = shapeFromDrag('rectangle', [0.2, 0.3], [0.6, 0.5], STROKE, RATIO)!
  const e = shapeFromDrag('ellipse', [0.2, 0.3], [0.6, 0.5], STROKE, RATIO)!
  const l = shapeFromDrag('arrow', [0.2, 0.3], [0.6, 0.5], STROKE, RATIO)!
  const slop = 0.005
  it('a hollow rectangle / ellipse is hit on its outline, not in the middle (text underneath stays selectable)', () => {
    expect(pdfShapeHit('rectangle', r.rect, r.shape, 0.2, 0.4, RATIO, slop)).toBe(true)
    expect(pdfShapeHit('rectangle', r.rect, r.shape, 0.4, 0.4, RATIO, slop)).toBe(false)
    expect(pdfShapeHit('ellipse', e.rect, e.shape, 0.2, 0.4, RATIO, slop)).toBe(true)
    expect(pdfShapeHit('ellipse', e.rect, e.shape, 0.4, 0.4, RATIO, slop)).toBe(false)
    expect(pdfShapeHit('ellipse', e.rect, e.shape, 0.21, 0.31, RATIO, slop)).toBe(false) // box corner, outside the curve
  })
  it('a line / arrow is hit along its segment (and the arrow head), not away from it', () => {
    expect(pdfShapeHit('arrow', l.rect, l.shape, 0.4, 0.4, RATIO, slop)).toBe(true)
    expect(pdfShapeHit('arrow', l.rect, l.shape, 0.4, 0.3, RATIO, slop)).toBe(false)
    const [barb] = shapeArrowBarbs(l.shape.line!, STROKE, RATIO)
    expect(pdfShapeHit('arrow', l.rect, l.shape, barb[0], barb[1], RATIO, slop)).toBe(true)
  })
})

describe('storage format', () => {
  const g = shapeFromDrag('arrow', [0.2, 0.3], [0.6, 0.5], STROKE, RATIO)!
  it('a shape annotation round-trips through parsePdfAnnotation (the validator every save and load uses)', () => {
    const stored = pdfShapeAnnotation(2, g.rect, g.shape)
    expect(parsePdfAnnotation(JSON.parse(JSON.stringify(stored)))).toEqual(stored)
  })
  it('malformed shape payloads are rejected as a whole', () => {
    const base = pdfShapeAnnotation(0, g.rect, g.shape)
    expect(parsePdfAnnotation({ ...base, shape: { strokeWidth: -1 } })).toBeUndefined()
    expect(parsePdfAnnotation({ ...base, shape: { strokeWidth: 0.003, line: [0, 0, 2, 1] } })).toBeUndefined()
    expect(parsePdfAnnotation({ ...base, shape: { strokeWidth: 0.003, line: [0, 0, 1] } })).toBeUndefined()
    expect(parsePdfAnnotation({ ...base, rects: [...base.rects, ...base.rects] })).toBeUndefined() // a shape is ONE box
  })
  it('the DTO → renderer mapping keeps the shape; the IPC ref carries it', () => {
    const rects = [{ page: 3, ...g.rect }]
    const ref = pdfAnnotationRefForRects(rects, { shape: g.shape })!
    const mapped = pdfHighlightDtoToReaderHighlight({
      id: 's1',
      locatorRef: packPdfHighlightLocator(parsePdfAnnotation(JSON.parse(ref))!),
      styleKind: 'arrow',
      colorHex: '#FF0000',
      tags: [],
      pdfAnnotationRef: ref,
      createdAt: 'a',
      updatedAt: 'b',
    })
    expect(mapped?.shape).toEqual(g.shape)
    expect(mapped?.styleKind).toBe('arrow')
    expect(JSON.parse(ref).shape).toEqual(g.shape)
  })
  it('colour and opacity share one string (#RRGGBB[AA]), like every other annotation', () => {
    expect(shapeColorHex('#1e88e5', 1)).toBe('#1E88E5')
    const half = shapeColorHex('#1E88E5', 0.5)
    expect(half).toBe('#1E88E580')
    expect(shapeOpacityOf(half)).toBeCloseTo(0.502, 3)
    expect(shapeStrokeHex(half)).toBe('#1E88E5')
    expect(shapeOpacityOf('#1E88E5')).toBe(1)
  })
})

const row = (styleKind: PdfShapeKind, over: Partial<ExportableHighlight> = {}): ExportableHighlight => {
  const g = shapeFromDrag(styleKind, [0.2, 0.3], [0.6, 0.5], STROKE, RATIO)!
  return {
    id: 'row-1',
    createdAt: '2026-10-23T10:00:00.000Z',
    updatedAt: '2026-10-23T10:00:00.000Z',
    styleKind,
    colorHex: '#E53935',
    pdfAnnotation: pdfShapeAnnotation(1, g.rect, g.shape),
    ...over,
  }
}

describe('PDF write mapping (Readmate row → standard PDF annotation)', () => {
  it.each([
    ['rectangle', 'Square', false],
    ['ellipse', 'Circle', false],
    ['line', 'Line', false],
    ['arrow', 'Line', true],
  ] as const)('%s is written as ONE %s annotation named readmate:<id>', (kind, subtype, arrow) => {
    expect(isPdfWritableStyle(kind)).toBe(true)
    const parts = pdfWriteAnnotationsFromHighlight(row(kind))
    expect(parts).toHaveLength(1)
    const p = parts[0]!
    expect(p.subtype).toBe(subtype)
    expect(p.nm).toBe('readmate:row-1')
    expect(p.pageIndex).toBe(1)
    expect(Boolean(p.arrow)).toBe(arrow)
    expect(p.shape?.strokeWidth).toBe(STROKE)
    expect(p.color[0]).toBeCloseTo(0.898, 2)
    if (subtype === 'Line') expect(p.shape?.line).toHaveLength(4)
  })
  it('opacity travels as /CA; a row without shape geometry is not written', () => {
    expect(pdfWriteAnnotationsFromHighlight(row('rectangle', { colorHex: '#E5393580' }))[0]!.opacity).toBeCloseTo(0.502, 3)
    const bare = row('rectangle')
    expect(pdfWriteAnnotationsFromHighlight({ ...bare, pdfAnnotation: { ...bare.pdfAnnotation!, shape: undefined } })).toEqual([])
  })
})

describe('two-way sync plan for shapes', () => {
  const none = { complete: true, ledger: [] as never[], items: [] as ScannedPdfAnnotation[] }
  it('a new shape row is ADDED to the file once, never duplicated on the next plan', () => {
    const r = row('rectangle')
    const first = planTwoWaySync({ ...none, rows: [r] })
    expect(first.file.add).toHaveLength(1)
    expect(first.file.add[0]!.subtype).toBe('Square')
    // After the write the scan returns the item named readmate:row-1 → it is linked, not added again.
    const item: ScannedPdfAnnotation = {
      objectId: '12R',
      subtype: 'Square',
      pageIndex: 1,
      rects: [{ ...r.pdfAnnotation!.rects[0]!, pageIndex: 1 }],
      colorHex: '#E53935',
      nm: 'readmate:row-1',
      shape: r.pdfAnnotation!.shape,
    }
    const second = planTwoWaySync({ ...none, items: [item], rows: [r] })
    expect(second.file.add).toHaveLength(0)
    expect(second.links).toHaveLength(1)
    expect(second.inserts).toHaveLength(0)
  })

  it('a deleted shape row removes its file annotation instead of re-importing it', () => {
    const item: ScannedPdfAnnotation = {
      objectId: '12R',
      subtype: 'Circle',
      pageIndex: 1,
      rects: [{ pageIndex: 1, x: 0.2, y: 0.3, width: 0.4, height: 0.2 }],
      nm: 'readmate:gone',
      shape: { strokeWidth: STROKE },
    }
    // The export planner removes a Readmate-named annotation whose row no longer exists.
    const plan = planPdfAnnotationWrite({ scanned: [item], ledger: new Map(), rows: [] })
    expect(plan.remove).toEqual([{ objectId: '12R', pageIndex: 1 }])
    expect(plan.add).toHaveLength(0)
  })

  it('arrow ↔ line, colour, opacity, width and geometry are compared as separate fields', () => {
    const r = row('arrow')
    const item: ScannedPdfAnnotation = {
      objectId: '12R',
      subtype: 'Line',
      pageIndex: 1,
      rects: [{ pageIndex: 1, ...r.pdfAnnotation!.rects[0]! }],
      colorHex: '#E53935',
      nm: 'readmate:row-1',
      shape: r.pdfAnnotation!.shape,
      arrow: true,
    }
    const key = embeddedAnnotationIdentities([item])[0]!.key
    const ledger = [{ sourceKey: key, noteId: r.id, sourceHash: 'x', noteHash: highlightContentHash(r) }]
    const same = planTwoWaySync({ complete: true, items: [item], ledger, rows: [r] })
    expect(same.file.replace).toHaveLength(0)
    // The user changes the colour in Readmate (base unknown → legacy path compares hashes): the file is rewritten.
    const recolored = { ...r, colorHex: '#43A047' }
    const changed = planTwoWaySync({ complete: true, items: [item], ledger, rows: [recolored] })
    expect(changed.file.replace.length + changed.conflicts.length + changed.rowUpdates.length).toBeGreaterThan(0)
  })

  it('shape content hash reacts to width / endpoints (so an edit is seen as a change)', () => {
    const a = row('arrow')
    const b = { ...a, pdfAnnotation: { ...a.pdfAnnotation!, shape: { ...a.pdfAnnotation!.shape!, strokeWidth: 0.006 } } }
    expect(highlightContentHash(a)).not.toBe(highlightContentHash(b))
  })
})

describe('scanning a PDF.js annotation', () => {
  const page = { pageIndex: 0, transform: [1, 0, 0, -1, 0, 800], width: 600, height: 800 }
  it('reads a Square with its pen width and a Line with its endpoints', () => {
    const sq = readPdfJsAnnotation({ id: '5R', subtype: 'Square', rect: [60, 400, 360, 600], color: new Uint8ClampedArray([229, 57, 53]), borderStyle: { width: 3 } }, page)!
    expect(sq.rects[0]).toMatchObject({ x: 0.1, y: 0.25 })
    expect(sq.shape!.strokeWidth).toBeCloseTo(3 / 600, 6)
    const ln = readPdfJsAnnotation({ id: '6R', subtype: 'Line', rect: [10, 600, 310, 700], lineCoordinates: [10, 600, 310, 700], borderStyle: { width: 2 } }, page)!
    expect(ln.shape!.line![0]).toBeCloseTo(10 / 600, 6)
    expect(ln.shape!.line![1]).toBeCloseTo(200 / 800, 6)
    expect(readPdfJsAnnotation({ id: '7R', subtype: 'Line', rect: [0, 0, 10, 10] }, page)).toBeNull() // no endpoints
  })
  it('the worker-boundary validator accepts shapes and rejects inconsistent ones', () => {
    const base = { objectId: '5R', pageIndex: 0, rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }] }
    expect(parseScannedPdfAnnotation({ ...base, subtype: 'Square', shape: { strokeWidth: 0.003 } })).not.toBeNull()
    expect(parseScannedPdfAnnotation({ ...base, subtype: 'Square' })).toBeNull() // a shape item without its geometry
    expect(parseScannedPdfAnnotation({ ...base, subtype: 'Highlight', shape: { strokeWidth: 0.003 } })).toBeNull()
    expect(parseScannedPdfAnnotation({ ...base, subtype: 'Line', shape: { strokeWidth: 0.003 } })).toBeNull() // a Line needs endpoints
    expect(parseScannedPdfAnnotation({ ...base, subtype: 'Square', shape: { strokeWidth: 0.003 }, arrow: true })).toBeNull()
  })
})

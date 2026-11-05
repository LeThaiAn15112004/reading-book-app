import { describe, expect, it } from 'vitest'
import {
  PDF_GRAPHIC_MIN_EXTENT,
  parsePdfGraphicOp,
  pdfGraphicAllows,
  pdfGraphicAt,
  pdfGraphicCaps,
  pdfGraphicHit,
  readPdfJsGraphic,
  resizePdfGraphicBox,
  type PdfGraphicObject,
} from '../../src/index.js'

// A 600 × 800 pt page, PDF.js viewport at scale 1: user y up → display y down.
const PAGE = { pageIndex: 0, transform: [1, 0, 0, -1, 0, 800], width: 600, height: 800 }
const RATIO = 800 / 600

const square = (extra: Record<string, unknown> = {}) => ({
  id: '12R',
  subtype: 'Square',
  rect: [60, 400, 360, 600], // user space → display x 60..360, y 200..400
  color: new Uint8ClampedArray([30, 160, 230]),
  borderStyle: { width: 2 },
  ...extra,
})

describe('readPdfJsGraphic', () => {
  it('maps /Rect into the displayed page box and reads colour and line width', () => {
    const g = readPdfJsGraphic(square(), PAGE, true)!
    expect(g.box.x).toBeCloseTo(0.1, 6)
    expect(g.box.y).toBeCloseTo(0.25, 6)
    expect(g.box.width).toBeCloseTo(0.5, 6)
    expect(g.box.height).toBeCloseTo(0.25, 6)
    expect(g.colorHex).toBe('#1EA0E6')
    expect(g.strokeWidth).toBeCloseTo(2 / 600, 8)
    expect(g.filled).toBe(false)
  })

  it('ignores other subtypes, hidden / NoView objects, replies and empty boxes', () => {
    expect(readPdfJsGraphic({ ...square(), subtype: 'Highlight' }, PAGE, true)).toBeNull()
    expect(readPdfJsGraphic({ ...square(), subtype: 'Widget' }, PAGE, true)).toBeNull()
    expect(readPdfJsGraphic(square({ annotationFlags: 2 }), PAGE, true)).toBeNull()
    expect(readPdfJsGraphic(square({ annotationFlags: 32 }), PAGE, true)).toBeNull()
    expect(readPdfJsGraphic(square({ inReplyTo: '9R' }), PAGE, true)).toBeNull()
    expect(readPdfJsGraphic(square({ rect: [10, 10, 10, 50] }), PAGE, true)).toBeNull()
    expect(readPdfJsGraphic(null, PAGE, true)).toBeNull()
  })

  it('Ink keeps its centre-lines; an Ink without them cannot be edited', () => {
    const ink = readPdfJsGraphic({ id: '5R', subtype: 'Ink', rect: [0, 0, 100, 100], inkLists: [[0, 0, 50, 50, 100, 100]] }, PAGE, true)!
    expect(ink.paths).toHaveLength(1)
    expect(ink.paths![0]).toHaveLength(3)
    expect(ink.caps).toEqual({ resize: true, color: true, delete: true })
    const bare = readPdfJsGraphic({ id: '6R', subtype: 'Ink', rect: [0, 0, 100, 100] }, PAGE, true)!
    expect(bare.caps).toEqual({ resize: false, color: false, delete: false })
  })

  it('Line and FreeText only offer delete; an inline (non-editable) object offers nothing', () => {
    expect(pdfGraphicCaps('Line', true)).toEqual({ resize: false, color: false, delete: true })
    expect(pdfGraphicCaps('FreeText', true)).toEqual({ resize: false, color: false, delete: true })
    expect(pdfGraphicCaps('Square', true)).toEqual({ resize: true, color: true, delete: true })
    expect(readPdfJsGraphic(square(), PAGE, false)!.caps).toEqual({ resize: false, color: false, delete: false })
  })
})

describe('parsePdfGraphicOp / pdfGraphicAllows', () => {
  it('accepts only well-formed ops', () => {
    expect(parsePdfGraphicOp({ kind: 'delete' })).toEqual({ kind: 'delete' })
    expect(parsePdfGraphicOp({ kind: 'color', colorHex: '#abcdef' })).toEqual({ kind: 'color', colorHex: '#ABCDEF' })
    expect(parsePdfGraphicOp({ kind: 'color', colorHex: 'red' })).toBeNull()
    expect(parsePdfGraphicOp({ kind: 'resize', box: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 } })).not.toBeNull()
    expect(parsePdfGraphicOp({ kind: 'resize', box: { x: 0.9, y: 0.1, width: 0.3, height: 0.2 } })).toBeNull() // off the page
    expect(parsePdfGraphicOp({ kind: 'resize', box: { x: 0.1, y: 0.1, width: 0.001, height: 0.2 } })).toBeNull() // collapsed
    expect(parsePdfGraphicOp({ kind: 'resize', box: { x: NaN, y: 0, width: 0.2, height: 0.2 } })).toBeNull()
    expect(parsePdfGraphicOp({ kind: 'rm -rf' })).toBeNull()
    expect(parsePdfGraphicOp('delete')).toBeNull()
  })
  it('an op the object cannot take safely is refused', () => {
    const lineCaps = pdfGraphicCaps('Line', true)
    expect(pdfGraphicAllows(lineCaps, { kind: 'delete' })).toBe(true)
    expect(pdfGraphicAllows(lineCaps, { kind: 'color', colorHex: '#000000' })).toBe(false)
    expect(pdfGraphicAllows(lineCaps, { kind: 'resize', box: { x: 0, y: 0, width: 0.5, height: 0.5 } })).toBe(false)
  })
})

describe('pdfGraphicHit / pdfGraphicAt', () => {
  const hollow = readPdfJsGraphic(square(), PAGE, true)!
  const filled = readPdfJsGraphic(square({ id: '13R', interiorColor: new Uint8ClampedArray([255, 0, 0]) }), PAGE, true)!
  const slop = 0.005

  it('a hollow square is hit on its border, not in its middle', () => {
    expect(pdfGraphicHit(hollow, 0.1, 0.3, RATIO, slop)).toBe(true) // on the left edge
    expect(pdfGraphicHit(hollow, 0.35, 0.325, RATIO, slop)).toBe(false) // inside
    expect(pdfGraphicHit(hollow, 0.9, 0.9, RATIO, slop)).toBe(false)
  })
  it('a filled square is hit anywhere inside', () => {
    expect(pdfGraphicHit(filled, 0.35, 0.325, RATIO, slop)).toBe(true)
  })
  it('a circle is hit on its ellipse, not at the box corner', () => {
    const circle = readPdfJsGraphic(square({ id: '14R', subtype: 'Circle' }), PAGE, true)!
    expect(pdfGraphicHit(circle, 0.1, 0.375, RATIO, slop)).toBe(true) // left-most point
    expect(pdfGraphicHit(circle, 0.11, 0.26, RATIO, slop)).toBe(false) // near the corner
  })
  it('a Line is hit along its centre-line only', () => {
    const line = readPdfJsGraphic({ id: '7R', subtype: 'Line', rect: [0, 0, 300, 300], lineCoordinates: [0, 0, 300, 300] }, PAGE, true)!
    expect(pdfGraphicHit(line, 0.25, 0.8125, RATIO, slop)).toBe(true) // on the diagonal
    expect(pdfGraphicHit(line, 0.5, 0.5, RATIO, slop)).toBe(false) // far from the diagonal
  })

  it('overlapping objects: topmost wins, but the selected one stays grabbable', () => {
    const under = filled
    const over = readPdfJsGraphic(square({ id: '15R', interiorColor: new Uint8ClampedArray([0, 255, 0]) }), PAGE, true)!
    const list: PdfGraphicObject[] = [under, over]
    expect(pdfGraphicAt(list, null, 0, 0.3, 0.3, RATIO, slop)?.objectId).toBe('15R')
    expect(pdfGraphicAt(list, '13R', 0, 0.3, 0.3, RATIO, slop)?.objectId).toBe('13R')
    expect(pdfGraphicAt(list, null, 1, 0.3, 0.3, RATIO, slop)).toBeNull()
    expect(pdfGraphicAt(list, null, 0, 0.95, 0.95, RATIO, slop)).toBeNull()
  })
})

describe('resizePdfGraphicBox', () => {
  const box = { x: 0.1, y: 0.25, width: 0.5, height: 0.25 }
  it('moves only the dragged edges', () => {
    const out = resizePdfGraphicBox(box, 'se', [0.8, 0.6], RATIO)
    expect(out).toEqual({ x: 0.1, y: 0.25, width: 0.7000000000000001, height: 0.35 })
  })
  it('never collapses or flips and stays on the page', () => {
    const out = resizePdfGraphicBox(box, 'e', [0, 0.3], RATIO)
    expect(out.x).toBe(0.1)
    expect(out.width).toBeCloseTo(PDF_GRAPHIC_MIN_EXTENT, 8)
    const big = resizePdfGraphicBox(box, 'se', [5, 5], RATIO)
    expect(big.x + big.width).toBeLessThanOrEqual(1)
    expect(big.y + big.height).toBeLessThanOrEqual(1)
  })
})

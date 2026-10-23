import { describe, expect, it } from 'vitest'
import {
  INK_PEN_PRESETS,
  INK_PEN_STYLES,
  clampInkOpacity,
  inkStrokeLayers,
  clampInkWidth,
  isInkPenStyle,
  restyleInk,
} from '../../src/ink/ink-pen-styles.js'
import { PDF_INK_MAX_WIDTH, PDF_INK_MIN_WIDTH, parsePdfInk } from '../../src/ink/pdf-ink.js'

describe('pen style presets', () => {
  it('offers Pen, Pencil, Marker and Brush (no Calligraphy)', () => {
    expect(INK_PEN_STYLES).toEqual(['pen', 'pencil', 'marker', 'brush'])
    expect(isInkPenStyle('marker')).toBe(true)
    expect(isInkPenStyle('brush')).toBe(true)
    expect(isInkPenStyle('calligraphy')).toBe(false)
    expect(isInkPenStyle(undefined)).toBe(false)
  })

  it('Pen is opaque and fixed; Pencil is thin and slightly translucent; Marker is wide, translucent and multiplies', () => {
    const { pen, pencil, marker } = INK_PEN_PRESETS
    expect(pen.opacity).toBe(1)
    expect(pen.opacityEditable).toBe(false)
    expect(pen.blend).toBe('normal')
    expect(pencil.opacity).toBeGreaterThan(0.5)
    expect(pencil.opacity).toBeLessThan(1)
    expect(pencil.opacityEditable).toBe(true)
    expect(pencil.width).toBeLessThan(pen.width)
    expect(pencil.blend).toBe('normal')
    expect(marker.width).toBeGreaterThan(pen.width * 2)
    expect(marker.opacity).toBeLessThan(0.5)
    expect(marker.opacityEditable).toBe(true)
    expect(marker.blend).toBe('multiply')
  })

  it('every default is a stroke the parser accepts, with a valid colour', () => {
    for (const style of INK_PEN_STYLES) {
      const p = INK_PEN_PRESETS[style]
      expect(p.colorHex).toMatch(/^#[0-9A-F]{6}$/)
      expect(parsePdfInk({ pageIndex: 0, paths: [[[0.1, 0.1], [0.2, 0.2]]], penStyle: style, width: p.width })).toBeDefined()
      expect(p.widthMin).toBeGreaterThanOrEqual(PDF_INK_MIN_WIDTH)
      expect(p.widthMax).toBeLessThanOrEqual(PDF_INK_MAX_WIDTH)
      expect(p.width).toBeGreaterThanOrEqual(p.widthMin)
      expect(p.width).toBeLessThanOrEqual(p.widthMax)
      expect(p.opacity).toBeGreaterThanOrEqual(p.opacityMin)
      expect(p.opacity).toBeLessThanOrEqual(p.opacityMax)
    }
  })
})

describe('Brush', () => {
  it('is a soft, rounded, translucent style with its own defaults and independent ranges', () => {
    const { brush, pen, pencil, marker } = INK_PEN_PRESETS
    expect(brush.label).toBe('Brush')
    expect(brush.opacityEditable).toBe(true)
    expect(brush.opacity).toBeLessThan(1)
    expect(brush.blend).toBe('normal')
    expect(brush.width).toBeGreaterThan(pen.width)
    expect(brush.colorHex).not.toBe(pen.colorHex)
    for (const other of [pen, pencil, marker]) expect(brush).not.toEqual(other)
  })

  it('is painted as concentric layers (faint wide edge, dense core); every other style is one solid layer', () => {
    const layers = inkStrokeLayers('brush')
    expect(layers.length).toBeGreaterThanOrEqual(3)
    expect(layers[0]!.scale).toBe(1) // the outermost layer is the stroke width itself
    for (let i = 1; i < layers.length; i++) {
      expect(layers[i]!.scale).toBeLessThan(layers[i - 1]!.scale)
      expect(layers[i]!.alpha).toBeGreaterThan(layers[i - 1]!.alpha)
    }
    expect(layers.every((l) => l.alpha > 0 && l.alpha <= 1 && l.scale > 0 && l.scale <= 1)).toBe(true)
    for (const style of ['pen', 'pencil', 'marker'] as const) expect(inkStrokeLayers(style)).toEqual([{ scale: 1, alpha: 1 }])
  })

  it('clamps its width / opacity to its own ranges and restyles from / to the other styles sensibly', () => {
    expect(clampInkWidth('brush', 0)).toBe(INK_PEN_PRESETS.brush.widthMin)
    expect(clampInkWidth('brush', 1)).toBe(INK_PEN_PRESETS.brush.widthMax)
    expect(clampInkOpacity('brush', 0)).toBe(INK_PEN_PRESETS.brush.opacityMin)
    expect(clampInkOpacity('brush', 2)).toBe(1)
    expect(restyleInk({ penStyle: 'pen', width: 0.004, opacity: 1 }, 'brush')).toEqual({ penStyle: 'brush', width: 0.004, opacity: INK_PEN_PRESETS.brush.opacity })
    expect(restyleInk({ penStyle: 'marker', width: 0.02, opacity: 0.5 }, 'brush')).toEqual({ penStyle: 'brush', width: 0.02, opacity: 0.5 })
    expect(restyleInk({ penStyle: 'brush', width: 0.02, opacity: 0.5 }, 'pen')).toEqual({ penStyle: 'pen', width: 0.02, opacity: 1 })
  })
})

describe('clamping', () => {
  it('Pen opacity is always 1; the others clamp to their range and ignore junk', () => {
    expect(clampInkOpacity('pen', 0.2)).toBe(1)
    expect(clampInkOpacity('pencil', 0.1)).toBe(INK_PEN_PRESETS.pencil.opacityMin)
    expect(clampInkOpacity('pencil', 5)).toBe(1)
    expect(clampInkOpacity('marker', 0.9)).toBe(INK_PEN_PRESETS.marker.opacityMax)
    expect(clampInkOpacity('marker', 0.5)).toBe(0.5)
    expect(clampInkOpacity('marker', Number.NaN)).toBe(INK_PEN_PRESETS.marker.opacity)
  })

  it('widths stay inside the style range and the parser range', () => {
    expect(clampInkWidth('pen', 0)).toBe(INK_PEN_PRESETS.pen.widthMin)
    expect(clampInkWidth('pen', 9)).toBe(INK_PEN_PRESETS.pen.widthMax)
    expect(clampInkWidth('marker', 0.001)).toBe(INK_PEN_PRESETS.marker.widthMin)
    expect(clampInkWidth('marker', 0.02)).toBe(0.02)
    expect(clampInkWidth('pencil', Number.NaN)).toBe(INK_PEN_PRESETS.pencil.width)
  })
})

describe('restyleInk', () => {
  it('Pen → Marker takes the Marker defaults for opacity and keeps the width inside the new range', () => {
    expect(restyleInk({ penStyle: 'pen', width: 0.004, opacity: 1 }, 'marker')).toEqual({
      penStyle: 'marker',
      width: INK_PEN_PRESETS.marker.widthMin,
      opacity: INK_PEN_PRESETS.marker.opacity,
    })
  })

  it('Pencil ↔ Marker keeps a chosen opacity (clamped); anything → Pen is opaque', () => {
    expect(restyleInk({ penStyle: 'pencil', width: 0.008, opacity: 0.6 }, 'marker')).toEqual({ penStyle: 'marker', width: 0.008, opacity: 0.6 })
    expect(restyleInk({ penStyle: 'pencil', width: 0.008, opacity: 0.95 }, 'marker').opacity).toBe(INK_PEN_PRESETS.marker.opacityMax)
    expect(restyleInk({ penStyle: 'marker', width: 0.016, opacity: 0.35 }, 'pen')).toEqual({ penStyle: 'pen', width: 0.016, opacity: 1 })
  })
})

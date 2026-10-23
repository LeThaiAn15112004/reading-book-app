/**
 * Pen style presets of freehand Ink (docs/implementation_plan/pdf_freehand_ink_eraser_plan.md §3.1, Phase 2).
 *
 * Every style is ONE PDF `/Ink` stroke plus app-side metadata: a preset over colour, width and opacity and
 * a blend flag — never a texture. Pencil is a thin, slightly translucent line (a grain cannot be written
 * into a standard Ink annotation); Marker is wide, translucent and drawn with multiply blending (a later
 * write-back sets it in the appearance stream; readers that ignore it show plain alpha). Brush is a soft,
 * rounded stroke: the same centre-line, painted as a few concentric translucent layers (`inkStrokeLayers`) so
 * the edge fades — constant width, no pressure, no bristles. Only the centre-line, colour, width and opacity
 * are stored; a later write-back may write it as a plain constant-width Ink (see the plan, §3.1).
 */

import type { InkPenStyle } from '../domain/index.js'
import { PDF_INK_MAX_WIDTH, PDF_INK_MIN_WIDTH } from './ink-limits.js'

export type InkPenPreset = {
  label: string
  /** Default colour (`#RRGGBB`). */
  colorHex: string
  /** Default width, fraction of the page width. */
  width: number
  /** Default opacity, 0–1. */
  opacity: number
  /** Whether the user may change the opacity (Pen is always fully opaque). */
  opacityEditable: boolean
  /** Opacity range when editable. */
  opacityMin: number
  opacityMax: number
  /** Thickness slider range (inside the SDK's accepted width range). */
  widthMin: number
  widthMax: number
  /** How the stroke composites over the page. */
  blend: 'normal' | 'multiply'
}

/** The styles the UI offers, in menu order. Calligraphy is not offered. */
export const INK_PEN_STYLES: readonly InkPenStyle[] = ['pen', 'pencil', 'marker', 'brush']

export const INK_PEN_PRESETS: Readonly<Record<InkPenStyle, InkPenPreset>> = {
  pen: {
    label: 'Pen',
    colorHex: '#1E88E5',
    width: 0.004,
    opacity: 1,
    opacityEditable: false,
    opacityMin: 1,
    opacityMax: 1,
    widthMin: 0.0015,
    widthMax: 0.02,
    blend: 'normal',
  },
  pencil: {
    label: 'Pencil',
    colorHex: '#424242',
    width: 0.0025,
    opacity: 0.8,
    opacityEditable: true,
    opacityMin: 0.3,
    opacityMax: 1,
    widthMin: 0.0015,
    widthMax: 0.012,
    blend: 'normal',
  },
  marker: {
    label: 'Marker',
    colorHex: '#FFEB3B',
    width: 0.016,
    opacity: 0.35,
    opacityEditable: true,
    opacityMin: 0.15,
    opacityMax: 0.8,
    widthMin: 0.006,
    widthMax: 0.04,
    blend: 'multiply',
  },
  brush: {
    label: 'Brush',
    colorHex: '#8E24AA',
    width: 0.012,
    opacity: 0.85,
    opacityEditable: true,
    opacityMin: 0.3,
    opacityMax: 1,
    widthMin: 0.004,
    widthMax: 0.04,
    blend: 'normal',
  },
}

/** One concentric layer of a soft stroke: its width as a share of the stroke width and its own alpha. */
export type InkStrokeLayer = { scale: number; alpha: number }

const SOLID_LAYER: readonly InkStrokeLayer[] = [{ scale: 1, alpha: 1 }]
/** Wide faint edge → dense core. Drawn inside one group, so the stroke's opacity applies to the whole brush mark. */
const BRUSH_LAYERS: readonly InkStrokeLayer[] = [
  { scale: 1, alpha: 0.3 },
  { scale: 0.72, alpha: 0.5 },
  { scale: 0.42, alpha: 0.9 },
]

/** The layers a stroke of `style` is painted with: one solid layer, except the Brush's soft edge. */
export function inkStrokeLayers(style: InkPenStyle): readonly InkStrokeLayer[] {
  return style === 'brush' ? BRUSH_LAYERS : SOLID_LAYER
}

export function isInkPenStyle(value: unknown): value is InkPenStyle {
  return typeof value === 'string' && (INK_PEN_STYLES as readonly string[]).includes(value)
}

/** The opacity a stroke of `style` really gets: Pen is always 1, the others are clamped to their range. */
export function clampInkOpacity(style: InkPenStyle, opacity: number): number {
  const preset = INK_PEN_PRESETS[style]
  if (!preset.opacityEditable) return preset.opacity
  if (!Number.isFinite(opacity)) return preset.opacity
  return Math.round(Math.min(preset.opacityMax, Math.max(preset.opacityMin, opacity)) * 1000) / 1000
}

/** A width inside both the style's slider range and the range the parser accepts. */
export function clampInkWidth(style: InkPenStyle, width: number): number {
  const preset = INK_PEN_PRESETS[style]
  if (!Number.isFinite(width)) return preset.width
  const bounded = Math.min(Math.min(preset.widthMax, PDF_INK_MAX_WIDTH), Math.max(Math.max(preset.widthMin, PDF_INK_MIN_WIDTH), width))
  return Math.round(bounded * 100000) / 100000
}

/**
 * The look a stroke takes when it is switched to `next` (colour is untouched): the width is kept inside
 * the new style's range; the opacity is the new style's default unless both styles let the user choose
 * one, in which case it is kept (clamped).
 */
export function restyleInk(
  current: { penStyle: InkPenStyle; width: number; opacity: number },
  next: InkPenStyle,
): { penStyle: InkPenStyle; width: number; opacity: number } {
  const keepOpacity = INK_PEN_PRESETS[current.penStyle].opacityEditable && INK_PEN_PRESETS[next].opacityEditable
  return {
    penStyle: next,
    width: clampInkWidth(next, current.width),
    opacity: keepOpacity ? clampInkOpacity(next, current.opacity) : INK_PEN_PRESETS[next].opacity,
  }
}

/**
 * Typewriter note (PDF): the rich-text document stored in `pdfAnnotation.typewriter`.
 * specs/005-typewriter-note/data-model.md §2. Offsets are UTF-16 indices into the row's plain `note` text.
 */

import { isTypewriterFamily, TYPEWRITER_DEFAULT_FAMILY, type TypewriterFamilyId } from './typewriter-fonts.js'

export const TYPEWRITER_MAX_CHARS = 10_000
export const TYPEWRITER_MAX_RUNS = 500
export const TYPEWRITER_MAX_ALIGN_SPANS = 200
/** Font size bounds as a fraction of the page width (6–144 pt on a 612 pt page). */
export const TYPEWRITER_MIN_SIZE = 6 / 612
export const TYPEWRITER_MAX_SIZE = 144 / 612
export const TYPEWRITER_DEFAULT_SIZE = 12 / 612
/** Narrowest box, fraction of the page width. */
export const TYPEWRITER_MIN_BOX_WIDTH = 0.04

export type TypewriterAlign = 'left' | 'center' | 'right' | 'justify'
export const TYPEWRITER_ALIGNS: readonly TypewriterAlign[] = ['left', 'center', 'right', 'justify']

export interface TypewriterTextStyle {
  family: TypewriterFamilyId
  size: number
  color: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
}

export interface TypewriterStyleRun {
  start: number
  end: number
  style: Partial<TypewriterTextStyle>
}

export interface TypewriterAlignSpan {
  start: number
  align: TypewriterAlign
}

export interface PdfTypewriterDoc {
  v: 1
  base: TypewriterTextStyle
  runs: TypewriterStyleRun[]
  align: TypewriterAlignSpan[]
  boxHeightMode?: 'auto'
}

export const STYLE_KEYS = ['family', 'size', 'color', 'bold', 'italic', 'underline', 'strike'] as const
export type TypewriterStyleKey = (typeof STYLE_KEYS)[number]

export function defaultTypewriterStyle(): TypewriterTextStyle {
  return {
    family: TYPEWRITER_DEFAULT_FAMILY,
    size: TYPEWRITER_DEFAULT_SIZE,
    color: '#000000',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
  }
}

export function emptyTypewriterDoc(base: TypewriterTextStyle = defaultTypewriterStyle()): PdfTypewriterDoc {
  return { v: 1, base: { ...base }, runs: [], align: [] }
}

/** NFC, `\r\n` / `\r` / U+2028 / U+2029 → `\n`, every other control character removed. */
export function normalizeTypewriterText(input: string): string {
  return input
    .replace(/\r\n|\r|\u{2028}|\u{2029}/gu, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F­]/g, '')
    .normalize('NFC')
}

export function isBlankTypewriterText(text: string): boolean {
  return text.trim().length === 0
}

export function isValidTypewriterText(text: string): boolean {
  return (
    typeof text === 'string' &&
    text.length >= 1 &&
    text.length <= TYPEWRITER_MAX_CHARS &&
    !isBlankTypewriterText(text) &&
    text === normalizeTypewriterText(text)
  )
}

const HEX = /^#[0-9a-fA-F]{6}$/

export function isTypewriterColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

export function clampTypewriterSize(size: number): number {
  return Math.min(TYPEWRITER_MAX_SIZE, Math.max(TYPEWRITER_MIN_SIZE, size))
}

function validKey(key: TypewriterStyleKey, value: unknown): boolean {
  switch (key) {
    case 'family':
      return isTypewriterFamily(value)
    case 'size':
      return typeof value === 'number' && Number.isFinite(value) && value >= TYPEWRITER_MIN_SIZE - 1e-9 && value <= TYPEWRITER_MAX_SIZE + 1e-9
    case 'color':
      return isTypewriterColor(value)
    default:
      return typeof value === 'boolean'
  }
}

function parseFullStyle(value: unknown): TypewriterTextStyle | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  for (const k of STYLE_KEYS) if (!validKey(k, v[k])) return undefined
  return {
    family: v.family as TypewriterFamilyId,
    size: clampTypewriterSize(v.size as number),
    color: (v.color as string).toUpperCase(),
    bold: v.bold as boolean,
    italic: v.italic as boolean,
    underline: v.underline as boolean,
    strike: v.strike as boolean,
  }
}

function parsePartialStyle(value: unknown): Partial<TypewriterTextStyle> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v)) {
    if (!(STYLE_KEYS as readonly string[]).includes(k)) return undefined
    if (!validKey(k as TypewriterStyleKey, v[k])) return undefined
    out[k] = k === 'color' ? (v[k] as string).toUpperCase() : v[k]
  }
  return Object.keys(out).length > 0 ? (out as Partial<TypewriterTextStyle>) : undefined
}

export function styleEquals(a: Partial<TypewriterTextStyle>, b: Partial<TypewriterTextStyle>): boolean {
  for (const k of STYLE_KEYS) if (a[k] !== b[k]) return false
  return true
}

function splitsSurrogate(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false
  const before = text.charCodeAt(offset - 1)
  const after = text.charCodeAt(offset)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
}

/**
 * Validates the data-model §2 invariants against `text`; returns a clean copy or `undefined`.
 * `text` must already be a valid Typewriter text (1–10 000 code units, NFC, not blank).
 */
export function parseTypewriterDoc(value: unknown, text: string): PdfTypewriterDoc | undefined {
  if (!isValidTypewriterText(text)) return undefined
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  if (v.v !== 1) return undefined
  const base = parseFullStyle(v.base)
  if (!base) return undefined
  if (!Array.isArray(v.runs) || v.runs.length > TYPEWRITER_MAX_RUNS) return undefined
  if (!Array.isArray(v.align) || v.align.length > TYPEWRITER_MAX_ALIGN_SPANS) return undefined

  const runs: TypewriterStyleRun[] = []
  for (const raw of v.runs as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return undefined
    const r = raw as Record<string, unknown>
    if (!Number.isInteger(r.start) || !Number.isInteger(r.end)) return undefined
    const s = r.start as number
    const e = r.end as number
    if (s < 0 || s >= e || e > text.length) return undefined
    if (splitsSurrogate(text, s) || splitsSurrogate(text, e)) return undefined
    const style = parsePartialStyle(r.style)
    if (!style) return undefined
    const prev = runs[runs.length - 1]
    if (prev) {
      if (s < prev.end) return undefined
      if (s === prev.end && styleEquals(prev.style, style)) return undefined
    }
    runs.push({ start: s, end: e, style })
  }

  const align: TypewriterAlignSpan[] = []
  for (const raw of v.align as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return undefined
    const a = raw as Record<string, unknown>
    if (!Number.isInteger(a.start) || !TYPEWRITER_ALIGNS.includes(a.align as TypewriterAlign)) return undefined
    const s = a.start as number
    if (s < 0 || s >= text.length) return undefined
    if (s !== 0 && text[s - 1] !== '\n') return undefined
    const prev = align[align.length - 1]
    if (prev && s <= prev.start) return undefined
    align.push({ start: s, align: a.align as TypewriterAlign })
  }
  return { v: 1, base, runs, align }
}

/** `base` overlaid with the run covering `offset`. */
export function effectiveStyle(doc: PdfTypewriterDoc, offset: number): TypewriterTextStyle {
  for (const run of doc.runs) {
    if (offset < run.start) break
    if (offset < run.end) return { ...doc.base, ...run.style }
  }
  return { ...doc.base }
}

/** Alignment of the paragraph that contains `offset`. */
export function alignAt(doc: PdfTypewriterDoc, text: string, offset: number): TypewriterAlign {
  const start = offset <= 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1
  let result: TypewriterAlign = 'left'
  for (const span of doc.align) {
    if (span.start > start) break
    if (span.start === start) result = span.align
  }
  return result
}

const BOX_EPSILON = 1e-6

/** A Typewriter box (normalized 0–1 over the page): inside the page and at least the minimum width. */
export function isValidTypewriterBox(box: { x: number; y: number; width: number; height: number }): boolean {
  const { x, y, width, height } = box
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return false
  if (x < -BOX_EPSILON || y < -BOX_EPSILON || height <= 0) return false
  if (width < TYPEWRITER_MIN_BOX_WIDTH - BOX_EPSILON) return false
  return x + width <= 1 + BOX_EPSILON && y + height <= 1 + BOX_EPSILON
}

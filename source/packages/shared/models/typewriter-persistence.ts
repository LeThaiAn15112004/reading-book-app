/**
 * Map reader typewriter notes ↔ generic `annotations` rows (T5.6b / T5.6d).
 */

import { spineIndexFromCfiPath } from '../utils/epub-cfi.js'
import type {
  ReaderAnnotationStatus,
  ReaderTypewriterNote,
  TypewriterNoteSource,
} from './reader-session.js'
import {
  TYPEWRITER_DEFAULT_COLOR_HEX,
  TYPEWRITER_DEFAULT_FONT_SIZE,
  clampTypewriterFontSize,
  normalizeTypewriterColorHex,
  normalizeTypewriterContent,
} from './typewriter-rich-text.js'

type AnnotationStyleLike = Record<string, unknown>

type AnnotationDtoLike = {
  id: string
  type: string
  pageNumber?: number
  locationData: string
  content?: string
  style: AnnotationStyleLike
  status: string
  isChecked: boolean
  createdAt: string
  updatedAt: string
}

export type TextboxAnnotationInput = {
  bookId: string
  id: string
  type: 'textbox'
  pageNumber: number
  locationData: string
  content: string
  style: {
    /** Default text color for the box (inline colors live in `content` HTML). */
    colorHex?: string
    fontFamily?: string
    /** Default font size in px for the box. */
    fontSize?: number
  }
  status: ReaderAnnotationStatus
  isChecked: boolean
  createdAt: string
  updatedAt: string
}

export type TypewriterOffsetPx = { x: number; y: number }

export type TypewriterLocation =
  | { v: 2; anchor: 'fake-pct'; xPct: number; yPct: number }
  | {
      v: 2
      anchor: 'cfi-offset'
      cfi: string
      offsetPx: TypewriterOffsetPx
      xPct: number
      yPct: number
    }
  | { v: 2; anchor: 'page-rect'; page: number; xPct: number; yPct: number }
  | { v: 1; anchor: 'legacy-pct'; xPct: number; yPct: number }

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function parseOffsetPx(raw: unknown): TypewriterOffsetPx | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const x = obj.x
  const y = obj.y
  if (typeof x !== 'number' || !Number.isFinite(x)) return null
  if (typeof y !== 'number' || !Number.isFinite(y)) return null
  return { x, y }
}

/** Parse opaque `location_data` for textbox annotations (v2 + legacy pct). */
export function parseTypewriterLocation(
  raw: string,
): TypewriterLocation | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const obj = parsed as Record<string, unknown>
    const xPct = obj.xPct
    const yPct = obj.yPct
    if (typeof xPct !== 'number' || !Number.isFinite(xPct)) return null
    if (typeof yPct !== 'number' || !Number.isFinite(yPct)) return null
    const cx = clampPct(xPct)
    const cy = clampPct(yPct)

    const anchor = obj.anchor
    const version = obj.v

    if (version === 2 && anchor === 'fake-pct') {
      return { v: 2, anchor: 'fake-pct', xPct: cx, yPct: cy }
    }
    if (version === 2 && anchor === 'cfi-offset') {
      const cfi = typeof obj.cfi === 'string' ? obj.cfi.trim() : ''
      const offsetPx = parseOffsetPx(obj.offsetPx)
      if (!cfi || !offsetPx) return null
      return { v: 2, anchor: 'cfi-offset', cfi, offsetPx, xPct: cx, yPct: cy }
    }
    if (version === 2 && anchor === 'page-rect') {
      const page = obj.page
      if (typeof page !== 'number' || !Number.isFinite(page) || page < 1) {
        return null
      }
      return {
        v: 2,
        anchor: 'page-rect',
        page: Math.floor(page),
        xPct: cx,
        yPct: cy,
      }
    }

    return { v: 1, anchor: 'legacy-pct', xPct: cx, yPct: cy }
  } catch {
    return null
  }
}

export function serializeTypewriterLocation(loc: TypewriterLocation): string {
  switch (loc.anchor) {
    case 'fake-pct':
      return JSON.stringify({
        v: 2,
        anchor: 'fake-pct',
        xPct: clampPct(loc.xPct),
        yPct: clampPct(loc.yPct),
      })
    case 'cfi-offset':
      return JSON.stringify({
        v: 2,
        anchor: 'cfi-offset',
        cfi: loc.cfi.trim(),
        offsetPx: loc.offsetPx,
        xPct: clampPct(loc.xPct),
        yPct: clampPct(loc.yPct),
      })
    case 'page-rect':
      return JSON.stringify({
        v: 2,
        anchor: 'page-rect',
        page: Math.max(1, Math.floor(loc.page)),
        xPct: clampPct(loc.xPct),
        yPct: clampPct(loc.yPct),
      })
    case 'legacy-pct':
      return JSON.stringify({
        xPct: clampPct(loc.xPct),
        yPct: clampPct(loc.yPct),
      })
  }
}

/** Serialize PDF page-rect anchor (render deferred to G6 T6.2). */
export function serializeTypewriterPageRect(
  page: number,
  xPct: number,
  yPct: number,
): string {
  return serializeTypewriterLocation({
    v: 2,
    anchor: 'page-rect',
    page: Math.max(1, Math.floor(page)),
    xPct,
    yPct,
  })
}

/** Validate `{ xPct, yPct }` position JSON; returns null if unusable. */
export function parseTypewriterPosition(
  raw: string,
): { xPct: number; yPct: number } | null {
  const loc = parseTypewriterLocation(raw)
  if (!loc) return null
  return { xPct: loc.xPct, yPct: loc.yPct }
}

/** Clamp percent coords and serialize legacy pct-only `location_data`. */
export function serializeTypewriterPosition(
  xPct: number,
  yPct: number,
): string {
  return serializeTypewriterLocation({
    v: 2,
    anchor: 'fake-pct',
    xPct,
    yPct,
  })
}

export function typewriterLocationSource(
  loc: TypewriterLocation,
): TypewriterNoteSource | undefined {
  switch (loc.anchor) {
    case 'cfi-offset':
      return 'epub'
    case 'fake-pct':
      return 'fake'
    case 'page-rect':
      return 'pdf'
    case 'legacy-pct':
      return undefined
  }
}

export function typewriterLocationCfi(loc: TypewriterLocation): string | undefined {
  return loc.anchor === 'cfi-offset' ? loc.cfi : undefined
}

function styleString(style: AnnotationStyleLike, key: string): string | undefined {
  const value = style[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function styleNumber(style: AnnotationStyleLike, key: string): number | undefined {
  const value = style[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readerStatus(value: string): ReaderAnnotationStatus {
  return value === 'Review' || value === 'Done' ? value : 'None'
}

function pageNumberForLocation(
  loc: TypewriterLocation,
  chapterIndex: number,
): number {
  if (loc.anchor === 'page-rect') return Math.max(1, Math.floor(loc.page))
  // cfi-offset / pct: denormalize spine chapter into page_number for list grouping
  return Math.max(1, Math.floor(chapterIndex) + 1)
}

export function readerTypewriterToAnnotationInput(
  bookId: string,
  note: ReaderTypewriterNote,
): TextboxAnnotationInput {
  const style: TextboxAnnotationInput['style'] = {}
  const colorHex = normalizeTypewriterColorHex(note.colorHex)
  if (colorHex) style.colorHex = colorHex
  if (note.fontFamily?.trim()) style.fontFamily = note.fontFamily.trim()
  if (note.fontSize != null && Number.isFinite(note.fontSize)) {
    style.fontSize = clampTypewriterFontSize(note.fontSize)
  }

  const loc = parseTypewriterLocation(note.positionData)

  return {
    bookId,
    id: note.id,
    type: 'textbox',
    pageNumber: loc
      ? pageNumberForLocation(loc, note.chapterIndex)
      : Math.max(1, note.chapterIndex + 1),
    locationData: note.positionData,
    content: normalizeTypewriterContent(note.content),
    style,
    status: note.status ?? 'None',
    isChecked: note.isChecked ?? false,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
}

export function annotationDtoToReaderTypewriter(
  dto: AnnotationDtoLike,
): ReaderTypewriterNote | null {
  if (dto.type !== 'textbox') return null
  const loc = parseTypewriterLocation(dto.locationData)
  if (!loc) return null

  const source = typewriterLocationSource(loc)
  const cfi = typewriterLocationCfi(loc)

  let chapterIndex = 0
  if (loc.anchor === 'page-rect') {
    chapterIndex = Math.max(0, Math.floor(loc.page) - 1)
  } else {
    const fromPage =
      typeof dto.pageNumber === 'number' && Number.isFinite(dto.pageNumber)
        ? Math.max(0, Math.floor(dto.pageNumber) - 1)
        : 0
    chapterIndex = fromPage
    // Older cfi-offset rows were saved with page_number=1 — recover from CFI.
    if (chapterIndex === 0 && cfi) {
      const fromCfi = spineIndexFromCfiPath(cfi)
      if (fromCfi != null && fromCfi > 0) chapterIndex = fromCfi
    }
  }
  const style = dto.style ?? {}
  const colorHex =
    normalizeTypewriterColorHex(styleString(style, 'colorHex')) ??
    TYPEWRITER_DEFAULT_COLOR_HEX
  const fontFamily = styleString(style, 'fontFamily')
  const rawFontSize = styleNumber(style, 'fontSize')
  const fontSize =
    rawFontSize != null
      ? clampTypewriterFontSize(rawFontSize)
      : TYPEWRITER_DEFAULT_FONT_SIZE

  return {
    id: dto.id,
    type: 'textbox',
    chapterIndex,
    positionData: dto.locationData,
    content: normalizeTypewriterContent(dto.content ?? ''),
    colorHex,
    fontSize,
    ...(source ? { source } : {}),
    ...(cfi ? { cfi } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    status: readerStatus(dto.status),
    isChecked: dto.isChecked,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

/** Jumpable CFI for EPUB textbox (T5.6d). */
export function epubTypewriterJumpCfi(note: ReaderTypewriterNote): string | undefined {
  if (note.cfi?.trim()) return note.cfi.trim()
  const loc = parseTypewriterLocation(note.positionData)
  if (loc?.anchor === 'cfi-offset') return loc.cfi
  return undefined
}

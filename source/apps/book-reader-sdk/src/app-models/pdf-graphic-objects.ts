/**
 * Graphic objects that live INSIDE a PDF file and were not made by this app (a Square / Circle / Ink /
 * Line / FreeText … annotation written by another reader): what the app can show a hover / selection
 * outline for, which edits are offered for each, and the hit test.
 *
 * Read from PDF.js annotation data in the Main-side scan worker (`readPdfJsGraphic`), shipped to the
 * renderer as plain data, edited by Main through an incremental update (resize = new box, colour,
 * delete). Boxes are normalized 0–1 over the displayed page; distances are in page-width units
 * (y × `heightRatio`), like freehand Ink.
 */
import { distanceToInkPaths } from '../ink/ink-geometry.js'
import type { InkPoint } from '../ink/pdf-ink.js'
import type { PdfPageViewportInfo } from './pdf-embedded-annotations.js'

export const PDF_GRAPHIC_SUBTYPES = ['Square', 'Circle', 'Ink', 'Line', 'PolyLine', 'Polygon', 'FreeText', 'Stamp'] as const
export type PdfGraphicSubtype = (typeof PDF_GRAPHIC_SUBTYPES)[number]

/** What the app may do to an object safely. Anything not listed is simply not offered. */
export type PdfGraphicCaps = { resize: boolean; color: boolean; delete: boolean }

export type PdfGraphicBox = { x: number; y: number; width: number; height: number }

export type PdfGraphicObject = {
  /** PDF.js id of the annotation in the file as scanned (`12R`). */
  objectId: string
  subtype: PdfGraphicSubtype
  /** 0-based page. */
  pageIndex: number
  /** The annotation's `/Rect`, in the displayed page box. */
  box: PdfGraphicBox
  /** `#RRGGBB` of `/C`, when it has one. */
  colorHex?: string
  /** Has an interior fill (`/IC`), so the inside is part of the object. */
  filled: boolean
  /** Line width, page-width units. */
  strokeWidth: number
  /** Centre-lines for Ink / Line / PolyLine / Polygon (hit testing); absent for box-shaped objects. */
  paths?: InkPoint[][]
  caps: PdfGraphicCaps
}

/** Subtypes whose appearance the writer can rebuild (so resize + colour are safe). */
const REBUILDABLE: readonly PdfGraphicSubtype[] = ['Square', 'Circle', 'Ink']

/** Capabilities of an object: `editable` = the annotation is an indirect object the writer can rewrite and nothing exotic is attached. */
export function pdfGraphicCaps(subtype: PdfGraphicSubtype, editable: boolean): PdfGraphicCaps {
  if (!editable) return { resize: false, color: false, delete: false }
  const rebuild = REBUILDABLE.includes(subtype)
  return { resize: rebuild, color: rebuild, delete: true }
}

export const PDF_GRAPHIC_MAX_OBJECTS = 2000
const MAX_PATH_POINTS = 4000
const NOT_SHOWN_FLAGS = 1 | 2 | 32 // Invisible, Hidden, NoView

function finiteNumbers(value: unknown): number[] | undefined {
  if (!value || typeof value !== 'object' || typeof (value as { length?: unknown }).length !== 'number') return undefined
  const out = Array.from(value as ArrayLike<unknown>)
  return out.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (out as number[]) : undefined
}

function hexOf(value: unknown): string | undefined {
  const rgb = finiteNumbers(value)
  if (!rgb || rgb.length !== 3) return undefined
  return `#${rgb.map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0').toUpperCase()).join('')}`
}

/**
 * One PDF.js annotation data object → a graphic object, or null when it is not one of
 * `PDF_GRAPHIC_SUBTYPES`, is not shown, is a reply, or has no usable geometry. `editable` comes from the
 * caller (it knows the raw file); it only gates `caps`.
 */
export function readPdfJsGraphic(raw: unknown, page: PdfPageViewportInfo, editable: boolean): PdfGraphicObject | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const subtype = data.subtype
  if (typeof subtype !== 'string' || !(PDF_GRAPHIC_SUBTYPES as readonly string[]).includes(subtype)) return null
  if (typeof data.annotationFlags === 'number' && (data.annotationFlags & NOT_SHOWN_FLAGS) !== 0) return null
  if (data.inReplyTo) return null
  if (typeof data.id !== 'string' || !data.id || data.id.length > 64) return null
  if (!Number.isInteger(page.pageIndex) || page.pageIndex < 0) return null
  if (page.transform.length !== 6 || !page.transform.every((n) => Number.isFinite(n)) || !(page.width > 0) || !(page.height > 0)) return null

  const rect = finiteNumbers(data.rect)
  if (!rect || rect.length !== 4) return null
  const [a, b, c, d, e, f] = page.transform as [number, number, number, number, number, number]
  const toDisplay = (x: number, y: number): InkPoint => [(a * x + c * y + e) / page.width, (b * x + d * y + f) / page.height]
  const p1 = toDisplay(rect[0]!, rect[1]!)
  const p2 = toDisplay(rect[2]!, rect[3]!)
  const box: PdfGraphicBox = {
    x: Math.min(p1[0], p2[0]),
    y: Math.min(p1[1], p2[1]),
    width: Math.abs(p2[0] - p1[0]),
    height: Math.abs(p2[1] - p1[1]),
  }
  if (!(box.width > 0) || !(box.height > 0)) return null

  const lists: number[][] = []
  if (subtype === 'Ink') {
    const inkLists = data.inkLists
    if (Array.isArray(inkLists)) {
      for (const list of inkLists) {
        const flat = finiteNumbers(list)
        if (flat) lists.push(flat)
      }
    }
  } else if (subtype === 'Line') {
    const line = finiteNumbers(data.lineCoordinates)
    if (line && line.length === 4) lists.push(line)
  } else if (subtype === 'PolyLine' || subtype === 'Polygon') {
    const vertices = finiteNumbers(data.vertices)
    if (vertices && vertices.length >= 4) lists.push(subtype === 'Polygon' ? [...vertices, vertices[0]!, vertices[1]!] : vertices)
  }
  let paths: InkPoint[][] | undefined
  let total = 0
  if (lists.length > 0) {
    paths = []
    for (const flat of lists) {
      const path: InkPoint[] = []
      for (let i = 0; i + 1 < flat.length; i += 2) path.push(toDisplay(flat[i]!, flat[i + 1]!))
      total += path.length
      if (total > MAX_PATH_POINTS) return null
      if (path.length > 0) paths.push(path)
    }
    if (paths.length === 0) paths = undefined
  }

  const borderWidth = (data.borderStyle as { width?: unknown } | undefined)?.width
  const widthUser = typeof borderWidth === 'number' && Number.isFinite(borderWidth) && borderWidth >= 0 ? borderWidth : 1
  const widthScale = Math.hypot(a, b) / page.width
  const colorHex = hexOf(data.color)
  const object: PdfGraphicObject = {
    objectId: data.id,
    subtype: subtype as PdfGraphicSubtype,
    pageIndex: page.pageIndex,
    box,
    filled: finiteNumbers(data.interiorColor)?.length === 3,
    strokeWidth: widthUser * widthScale,
    caps: pdfGraphicCaps(subtype as PdfGraphicSubtype, editable && (subtype !== 'Ink' || paths !== undefined)),
  }
  if (colorHex) object.colorHex = colorHex
  if (paths) object.paths = paths
  return object
}

/** Re-validate a graphic object that crossed IPC. */
export function parsePdfGraphicObject(value: unknown): PdfGraphicObject | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.objectId !== 'string' || !v.objectId || v.objectId.length > 64) return null
  if (typeof v.subtype !== 'string' || !(PDF_GRAPHIC_SUBTYPES as readonly string[]).includes(v.subtype)) return null
  if (!Number.isInteger(v.pageIndex) || (v.pageIndex as number) < 0) return null
  const box = v.box as Record<string, unknown> | undefined
  if (!box || !['x', 'y', 'width', 'height'].every((k) => typeof box[k] === 'number' && Number.isFinite(box[k] as number))) return null
  const caps = v.caps as Record<string, unknown> | undefined
  if (!caps || typeof caps.resize !== 'boolean' || typeof caps.color !== 'boolean' || typeof caps.delete !== 'boolean') return null
  if (typeof v.strokeWidth !== 'number' || !Number.isFinite(v.strokeWidth) || typeof v.filled !== 'boolean') return null
  if (v.colorHex !== undefined && (typeof v.colorHex !== 'string' || !/^#[0-9A-F]{6}$/i.test(v.colorHex))) return null
  return value as PdfGraphicObject
}

/** An edit the renderer asks Main to apply to one object. */
export type PdfGraphicOp =
  | { kind: 'delete' }
  | { kind: 'color'; colorHex: string }
  /** New `/Rect`, normalized over the displayed page box. */
  | { kind: 'resize'; box: PdfGraphicBox }

export const PDF_GRAPHIC_MIN_EXTENT = 0.01

/** Validate an untrusted op (IPC input): known kind, `#RRGGBB`, a box inside the page with a real size. */
export function parsePdfGraphicOp(value: unknown): PdfGraphicOp | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.kind === 'delete') return { kind: 'delete' }
  if (v.kind === 'color') return typeof v.colorHex === 'string' && /^#[0-9a-f]{6}$/i.test(v.colorHex) ? { kind: 'color', colorHex: v.colorHex.toUpperCase() } : null
  if (v.kind === 'resize') {
    const b = v.box as Record<string, unknown> | undefined
    if (!b) return null
    const { x, y, width, height } = b as Record<string, number>
    if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
    if (width! < PDF_GRAPHIC_MIN_EXTENT || height! < PDF_GRAPHIC_MIN_EXTENT) return null
    if (x! < 0 || y! < 0 || x! + width! > 1.0001 || y! + height! > 1.0001) return null
    return { kind: 'resize', box: { x: x!, y: y!, width: width!, height: height! } }
  }
  return null
}

/** Is the op one the object's capabilities allow? */
export function pdfGraphicAllows(caps: PdfGraphicCaps, op: PdfGraphicOp): boolean {
  return op.kind === 'delete' ? caps.delete : op.kind === 'color' ? caps.color : caps.resize
}

/**
 * Does a pointer at page point (`x`, `y`) hit the object? Line-like objects by distance to their
 * centre-line; boxes and ellipses by their outline band, or their inside when they have a fill (or are a
 * FreeText / Stamp). `slop` is page-width units.
 */
export function pdfGraphicHit(object: PdfGraphicObject, x: number, y: number, heightRatio: number, slop: number): boolean {
  const reach = object.strokeWidth / 2 + slop
  if (object.paths) return distanceToInkPaths(object.paths, x, y, heightRatio) <= reach
  const { box } = object
  const insideBy = (grow: number) => x >= box.x - grow && x <= box.x + box.width + grow && y * heightRatio >= box.y * heightRatio - grow && y * heightRatio <= (box.y + box.height) * heightRatio + grow
  if (object.subtype === 'Circle') {
    const rx = box.width / 2
    const ry = (box.height * heightRatio) / 2
    if (!(rx > 0) || !(ry > 0)) return false
    const q = Math.hypot((x - (box.x + rx)) / rx, (y * heightRatio - (box.y * heightRatio + ry)) / ry)
    const unit = Math.min(rx, ry)
    return object.filled ? q <= 1 + reach / unit : Math.abs(q - 1) * unit <= reach
  }
  if (object.subtype === 'Square' && !object.filled) {
    if (!insideBy(reach)) return false
    const inner = Math.max(0, reach)
    const w = box.width - 2 * inner
    const h = (box.height * heightRatio) - 2 * inner
    const insideInner = w > 0 && h > 0 && x > box.x + inner && x < box.x + box.width - inner && y * heightRatio > box.y * heightRatio + inner && y * heightRatio < (box.y + box.height) * heightRatio - inner
    return !insideInner
  }
  return insideBy(slop)
}

/**
 * The object under the pointer on `pageIndex`: the selected one wherever it is hit (so it stays
 * grabbable), else the topmost (last in the file's paint order). Null on empty space.
 */
export function pdfGraphicAt(
  objects: readonly PdfGraphicObject[],
  selectedId: string | null,
  pageIndex: number,
  x: number,
  y: number,
  heightRatio: number,
  slop: number,
): PdfGraphicObject | null {
  if (selectedId !== null) {
    const selected = objects.find((o) => o.objectId === selectedId && o.pageIndex === pageIndex)
    if (selected && pdfGraphicHit(selected, x, y, heightRatio, slop)) return selected
  }
  for (let i = objects.length - 1; i >= 0; i--) {
    const object = objects[i]!
    if (object.pageIndex === pageIndex && pdfGraphicHit(object, x, y, heightRatio, slop)) return object
  }
  return null
}

/**
 * Drag one handle of `box` to `pointer` (the handle's own position, normalized): the opposite edges stay,
 * the box keeps `PDF_GRAPHIC_MIN_EXTENT` (page-width units) and stays on the page.
 */
export function resizePdfGraphicBox(box: PdfGraphicBox, handle: string, pointer: InkPoint, heightRatio: number): PdfGraphicBox {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
  const minW = PDF_GRAPHIC_MIN_EXTENT
  const minH = PDF_GRAPHIC_MIN_EXTENT / heightRatio
  let left = box.x
  let right = box.x + box.width
  let top = box.y
  let bottom = box.y + box.height
  if (handle.includes('w')) left = Math.min(clamp01(pointer[0]), right - minW)
  if (handle.includes('e')) right = Math.max(clamp01(pointer[0]), left + minW)
  if (handle.includes('n')) top = Math.min(clamp01(pointer[1]), bottom - minH)
  if (handle.includes('s')) bottom = Math.max(clamp01(pointer[1]), top + minH)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * Graphic objects inside a PDF (Square / Circle / Ink / Line / FreeText … written by another reader):
 * list them, and apply ONE edit — resize, colour or delete — as an incremental update (original bytes
 * untouched), read back and verified. Runs inside the scan worker thread; pure Node (no Electron, no
 * SQLite). Policy (is the file writable, may a signed file be changed) is decided by the caller.
 *
 * Square / Circle / Ink get a freshly built appearance stream (so every reader shows the edit);
 * everything else is only ever deleted. See docs/implementation_plan/pdf_graphic_objects.md.
 */
import {
  PDF_GRAPHIC_MAX_OBJECTS,
  pdfGraphicAllows,
  readPdfJsGraphic,
  type PdfGraphicBox,
  type PdfGraphicObject,
  type PdfGraphicOp,
} from '@reading-book/book-reader-sdk'
import { loadPdfjs } from '../chunking/pdf-text'
import { PdfRawObjects, parsePdfJsRef } from './pdf-raw-objects'
import { appearanceStreamBody, appendAnnotationUpdate, appendRawObjects, pdfDateNow, PdfWriteError, type PageGeometry } from './pdf-incremental-writer'
import { dictValue, num, parseDict, patchDict, refText } from './pdf-syntax'

export type PdfGraphicListResult = { objects: PdfGraphicObject[]; complete: boolean }

export type PdfGraphicEditResult = PdfGraphicListResult & { output: Uint8Array }

export class PdfGraphicError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_allowed' | 'verify_failed',
    message: string,
  ) {
    super(message)
  }
}

type RawGraphic = {
  subtype: string
  /** User-space `/Rect`, normalized to `[x1 < x2, y1 < y2]`. */
  rect: [number, number, number, number]
  /** `/C` as 0–1 RGB; null when absent. */
  color: [number, number, number] | null
  interior: [number, number, number] | null
  /** Border width, user units. */
  width: number
  opacity: number
  inkLists: number[][]
}

type GraphicScan = { objects: PdfGraphicObject[]; raws: Map<string, RawGraphic>; pages: PageGeometry[]; complete: boolean }

function rgbOf(value: unknown): [number, number, number] | null {
  if (!value || typeof value !== 'object') return null
  const rgb = Array.from(value as ArrayLike<number>)
  if (rgb.length !== 3 || !rgb.every((n) => Number.isFinite(n))) return null
  return [rgb[0]! / 255, rgb[1]! / 255, rgb[2]! / 255]
}

/** `/IC` (as 0–255 bytes, PDF.js style) and `/CA` of an annotation body; missing / malformed entries are simply absent. */
function rawExtras(body: string): { interiorColor?: number[]; opacity?: number } {
  const extras: { interiorColor?: number[]; opacity?: number } = {}
  try {
    const dict = parseDict(body)
    const ic = dictValue(body, dict, 'IC')
    if (ic?.trim().startsWith('[')) {
      const values = ic.replace(/[[\]]/g, ' ').trim().split(/\s+/).map(Number)
      if (values.length === 3 && values.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) extras.interiorColor = values.map((n) => n * 255)
    }
    const ca = Number(dictValue(body, dict, 'CA'))
    if (Number.isFinite(ca) && ca >= 0 && ca <= 1) extras.opacity = ca
  } catch {
    // A dictionary we can't parse keeps PDF.js's view of the object.
  }
  return extras
}

async function scanGraphics(bytes: Uint8Array): Promise<GraphicScan> {
  const pdfjs = await loadPdfjs()
  // PDF.js detaches the buffer it is given and refuses Node Buffers: hand it a plain copy.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: true })
  const rawObjects = new PdfRawObjects(bytes)
  const encrypted = rawObjects.encrypted
  const objects: PdfGraphicObject[] = []
  const raws = new Map<string, RawGraphic>()
  const pages: PageGeometry[] = []
  let complete = true
  try {
    const doc = await task.promise
    scan: for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      try {
        const page = await doc.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 1 })
        if (page.ref) {
          pages.push({ pageIndex: pageNumber - 1, ref: { num: page.ref.num, gen: page.ref.gen }, transform: [...viewport.transform], width: viewport.width, height: viewport.height })
        }
        const info = { pageIndex: pageNumber - 1, transform: viewport.transform, width: viewport.width, height: viewport.height }
        const annotations: Record<string, unknown>[] = await page.getAnnotations({ intent: 'display' })
        for (const raw of annotations) {
          const id = typeof raw.id === 'string' ? raw.id : ''
          const ref = id ? parsePdfJsRef(id) : null
          const body = ref && !encrypted ? rawObjects.body(ref.num, ref.gen) : undefined
          // Indirect objects only; a cloudy border (/BE) is more than a plain box.
          const editable = body !== undefined && !/\/BE\s*<</.test(body)
          // PDF.js does not expose /IC or /CA of these types: read them from the file's own dictionary.
          const merged: Record<string, unknown> = body === undefined ? raw : { ...raw, ...rawExtras(body) }
          const object = readPdfJsGraphic(merged, info, editable)
          if (!object) continue
          if (objects.length >= PDF_GRAPHIC_MAX_OBJECTS) {
            complete = false
            break scan
          }
          objects.push(object)
          const rect = Array.from((raw.rect as ArrayLike<number>) ?? [])
          raws.set(object.objectId, {
            subtype: object.subtype,
            rect: [Math.min(rect[0]!, rect[2]!), Math.min(rect[1]!, rect[3]!), Math.max(rect[0]!, rect[2]!), Math.max(rect[1]!, rect[3]!)],
            color: rgbOf(raw.color),
            interior: rgbOf(merged.interiorColor),
            width: typeof (raw.borderStyle as { width?: unknown } | undefined)?.width === 'number' ? (raw.borderStyle as { width: number }).width : 1,
            opacity: typeof merged.opacity === 'number' && merged.opacity >= 0 && merged.opacity <= 1 ? merged.opacity : 1,
            inkLists: Array.isArray(raw.inkLists) ? raw.inkLists.map((l) => Array.from(l as ArrayLike<number>)) : [],
          })
        }
        page.cleanup()
      } catch {
        complete = false
      }
    }
  } finally {
    await task.destroy()
  }
  return { objects, raws, pages, complete }
}

/** The graphic objects of a PDF, in page order then paint order. */
export async function listPdfGraphicsBytes(bytes: Uint8Array): Promise<PdfGraphicListResult> {
  const { objects, complete } = await scanGraphics(bytes)
  return { objects, complete }
}

function inverseOf(m: readonly number[]): (x: number, y: number) => [number, number] {
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number]
  const det = a * d - b * c
  if (!det) throw new PdfWriteError('unsupported_pdf', 'degenerate page transform')
  return (X, Y) => [(d * (X - e) - c * (Y - f)) / det, (-b * (X - e) + a * (Y - f)) / det]
}

/** A displayed-page box (normalized) → a user-space `[x1, y1, x2, y2]`. */
function userRectOf(box: PdfGraphicBox, page: PageGeometry): [number, number, number, number] {
  const toUser = inverseOf(page.transform)
  const p1 = toUser(box.x * page.width, box.y * page.height)
  const p2 = toUser((box.x + box.width) * page.width, (box.y + box.height) * page.height)
  return [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])]
}

const KAPPA = 0.5522847498

/** Appearance content (user space, BBox = `/Rect`) of a Square / Circle / Ink. */
function appearanceContent(raw: RawGraphic, rect: readonly number[], inkLists: readonly (readonly number[])[], color: readonly number[]): string {
  const [x1, y1, x2, y2] = rect as [number, number, number, number]
  const w = Math.max(0, raw.width)
  const ops = ['q', '/GS0 gs']
  const stroke = `${color.map(num).join(' ')} RG`
  if (raw.subtype === 'Ink') {
    ops.push(stroke, `${num(w)} w 1 J 1 j`)
    for (const list of inkLists) {
      if (list.length < 2) continue
      ops.push(`${num(list[0]!)} ${num(list[1]!)} m`)
      if (list.length === 2) ops.push(`${num(list[0]!)} ${num(list[1]!)} l`)
      for (let i = 2; i + 1 < list.length; i += 2) ops.push(`${num(list[i]!)} ${num(list[i + 1]!)} l`)
      ops.push('S')
    }
    ops.push('Q')
    return ops.join('\n')
  }
  const fill = raw.interior
  if (fill) ops.push(`${fill.map(num).join(' ')} rg`)
  if (w > 0) ops.push(stroke, `${num(w)} w`)
  const paint = fill && w > 0 ? 'B' : w > 0 ? 'S' : fill ? 'f' : 'n'
  const left = x1 + w / 2
  const bottom = y1 + w / 2
  const width = x2 - x1 - w
  const height = y2 - y1 - w
  if (width > 0 && height > 0) {
    if (raw.subtype === 'Circle') {
      const cx = left + width / 2
      const cy = bottom + height / 2
      const rx = width / 2
      const ry = height / 2
      ops.push(
        `${num(cx + rx)} ${num(cy)} m`,
        `${num(cx + rx)} ${num(cy + KAPPA * ry)} ${num(cx + KAPPA * rx)} ${num(cy + ry)} ${num(cx)} ${num(cy + ry)} c`,
        `${num(cx - KAPPA * rx)} ${num(cy + ry)} ${num(cx - rx)} ${num(cy + KAPPA * ry)} ${num(cx - rx)} ${num(cy)} c`,
        `${num(cx - rx)} ${num(cy - KAPPA * ry)} ${num(cx - KAPPA * rx)} ${num(cy - ry)} ${num(cx)} ${num(cy - ry)} c`,
        `${num(cx + KAPPA * rx)} ${num(cy - ry)} ${num(cx + rx)} ${num(cy - KAPPA * ry)} ${num(cx + rx)} ${num(cy)} c`,
        'h',
        paint,
      )
    } else {
      ops.push(`${num(left)} ${num(bottom)} ${num(width)} ${num(height)} re`, paint)
    }
  }
  ops.push('Q')
  return ops.join('\n')
}

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance

/**
 * Apply `op` to the object `objectId` of `bytes`. Throws `PdfGraphicError` (unknown object, an op its
 * capabilities don't allow, a read-back that does not match) or `PdfWriteError` (encrypted / structure the
 * writer can't append to) — nothing is produced then.
 */
export async function editPdfGraphicBytes(bytes: Uint8Array, objectId: string, op: PdfGraphicOp): Promise<PdfGraphicEditResult> {
  const before = await scanGraphics(bytes)
  if (!before.complete) throw new PdfWriteError('unsupported_pdf', 'the file could not be read completely')
  const object = before.objects.find((o) => o.objectId === objectId)
  const raw = before.raws.get(objectId)
  if (!object || !raw) throw new PdfGraphicError('not_found', 'the object is not in the file any more')
  if (!pdfGraphicAllows(object.caps, op)) throw new PdfGraphicError('not_allowed', `${op.kind} is not offered for a ${object.subtype}`)
  const page = before.pages.find((p) => p.pageIndex === object.pageIndex)
  const ref = parsePdfJsRef(objectId)
  if (!page || !ref) throw new PdfWriteError('unsupported_pdf', 'the object cannot be rewritten')

  let output: Uint8Array
  let wantRect: [number, number, number, number] | null = null
  let wantColor: [number, number, number] | null = null
  if (op.kind === 'delete') {
    output = appendAnnotationUpdate(bytes, new Map(before.pages.map((p) => [p.pageIndex, p])), { add: [], replace: [], remove: [{ objectId, pageIndex: object.pageIndex }] })
  } else {
    const rect = op.kind === 'resize' ? userRectOf(op.box, page) : raw.rect
    const colorOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
    const color = op.kind === 'color' ? colorOf(op.colorHex) : (raw.color ?? [0, 0, 0])
    wantRect = rect
    wantColor = color
    const [ox1, oy1, ox2, oy2] = raw.rect
    const [nx1, ny1, nx2, ny2] = rect
    if (!(ox2 - ox1 > 0) || !(oy2 - oy1 > 0) || !(nx2 - nx1 > 0) || !(ny2 - ny1 > 0)) throw new PdfWriteError('unsupported_pdf', 'degenerate box')
    const sx = (nx2 - nx1) / (ox2 - ox1)
    const sy = (ny2 - ny1) / (oy2 - oy1)
    const inkLists = raw.inkLists.map((list) => list.map((v, i) => (i % 2 === 0 ? nx1 + (v - ox1) * sx : ny1 + (v - oy1) * sy)))
    output = appendRawObjects(bytes, ({ objects, allocate }) => {
      const old = objects.body(ref.num, ref.gen)
      if (old === undefined) throw new PdfWriteError('unsupported_pdf', `object ${ref.num} not found`)
      const dict = parseDict(old)
      if (dictValue(old, dict, 'Subtype') !== `/${raw.subtype}`) throw new PdfWriteError('unsupported_pdf', 'the object changed type')
      const ap = allocate()
      const opacity = num(raw.opacity)
      const apBody = appearanceStreamBody(
        `/Type /XObject /Subtype /Form /FormType 1 /BBox [${rect.map(num).join(' ')}] /Resources << /ExtGState << /GS0 << /Type /ExtGState /CA ${opacity} /ca ${opacity} >> >> >>`,
        appearanceContent(raw, rect, inkLists, color),
      )
      const updates: Record<string, string | null> = {
        Rect: `[${rect.map(num).join(' ')}]`,
        C: `[${color.map(num).join(' ')}]`,
        AP: `<< /N ${refText(ap)} >>`,
        M: `(${pdfDateNow()})`,
        RD: null,
      }
      if (raw.subtype === 'Ink') updates.InkList = `[${inkLists.map((l) => `[${l.map(num).join(' ')}]`).join(' ')}]`
      return [
        { ...ap, body: apBody },
        { num: ref.num, gen: ref.gen, body: patchDict(old, dict, updates) },
      ]
    })
  }

  const after = await scanGraphics(output)
  if (!after.complete) throw new PdfGraphicError('verify_failed', 'the written file could not be read completely')
  const now = after.objects.find((o) => o.objectId === objectId)
  if (op.kind === 'delete') {
    if (now) throw new PdfGraphicError('verify_failed', 'the object was not removed')
    if (after.objects.length !== before.objects.length - 1) throw new PdfGraphicError('verify_failed', 'another object changed')
  } else {
    if (!now || now.subtype !== object.subtype || now.pageIndex !== object.pageIndex) throw new PdfGraphicError('verify_failed', 'the object changed type or page')
    if (after.objects.length !== before.objects.length) throw new PdfGraphicError('verify_failed', 'another object changed')
    const read = after.raws.get(objectId)!
    if (wantRect && !wantRect.every((v, i) => near(v, read.rect[i]!, 0.05))) throw new PdfGraphicError('verify_failed', 'the box was not written')
    if (wantColor && (!read.color || !wantColor.every((v, i) => near(v, read.color![i]!, 1.01 / 255)))) throw new PdfGraphicError('verify_failed', 'the colour was not written')
  }
  return { output, objects: after.objects, complete: after.complete }
}

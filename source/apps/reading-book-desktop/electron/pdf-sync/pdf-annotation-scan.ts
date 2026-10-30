/**
 * Scan the annotations embedded in a PDF's bytes: PDF.js (Node `legacy` build) for the annotation
 * data, `pdf-raw-objects.ts` for each annotation's `/NM`. Runs inside the scan worker thread
 * (pdf-annotation-scan.worker.ts), never on the Main event loop; also imported by the spikes.
 * Must not import `electron`.
 */
import {
  ATTACHMENT_MAX_COUNT,
  EMBEDDED_PDF_SCAN_MAX_ANNOTATIONS,
  READMATE_NM_PREFIX,
  clampShapeStroke,
  isEmbeddedShapeSubtype,
  parseScannedPdfAnnotation,
  buildAttachmentId,
  clampAttachmentBox,
  readPdfJsAnnotation,
  sanitizeAttachmentFileName,
  type PdfAttachmentInfo,
  type ScannedPdfAnnotation,
} from '@reading-book/book-reader-sdk'
import { createHash } from 'node:crypto'
import { loadPdfjs } from '../chunking/pdf-text'
import { PdfRawObjects, parsePdfJsRef, readAnnotationNames } from './pdf-raw-objects'
import type { PageGeometry } from './pdf-incremental-writer'
import { dictValue, parseDict } from './pdf-syntax'

type ShapeExtras = { arrow?: true; opacity?: number; /** `/L`, user space, in the file's own order (PDF.js sorts it into a box). */ line?: number[]; /** `/BS /W`, user units (PDF.js drops it for some types). */ width?: number }

/** `/LE` (an arrow end), `/CA` and `/L` of a shape the app wrote — read from the file's own dictionary (PDF.js exposes `/LE` / `/CA` not at all and `/L` only normalized, i.e. without direction). */
function readShapeExtras(bytes: Uint8Array, objectIds: readonly string[]): Map<string, ShapeExtras> {
  const out = new Map<string, ShapeExtras>()
  if (objectIds.length === 0) return out
  const objects = new PdfRawObjects(bytes)
  if (objects.encrypted) return out
  for (const id of objectIds) {
    const ref = parsePdfJsRef(id)
    const body = ref ? objects.body(ref.num, ref.gen) : undefined
    if (body === undefined) continue
    try {
      const dict = parseDict(body)
      const extras: ShapeExtras = {}
      const l = dictValue(body, dict, 'L')
      if (l?.trim().startsWith('[')) {
        const values = l.replace(/[[\]]/g, ' ').trim().split(/\s+/).map(Number)
        if (values.length === 4 && values.every((n) => Number.isFinite(n))) extras.line = values
      }
      const bs = dictValue(body, dict, 'BS')
      if (bs?.trim().startsWith('<<')) {
        const w = Number(dictValue(bs, parseDict(bs), 'W'))
        if (Number.isFinite(w) && w > 0) extras.width = w
      }
      const le = dictValue(body, dict, 'LE')
      const ends = le?.replace(/[[\]]/g, ' ').trim().split(/\s+/) ?? []
      if (ends.length === 2 && ends[1] !== '/None' && ends[0] === '/None') extras.arrow = true
      const ca = Number(dictValue(body, dict, 'CA'))
      if (Number.isFinite(ca) && ca >= 0 && ca < 1) extras.opacity = ca
      out.set(id, extras)
    } catch {
      // An unreadable dictionary keeps PDF.js's view of the item.
    }
  }
  return out
}

export type PdfAnnotationScanResult = {
  /** Supported annotations in page order, then `/Annots` order (the order identity keys count in). */
  items: ScannedPdfAnnotation[]
  /**
   * True only when every page's annotations were read without an error and the item cap was not
   * hit — the condition for treating a missing annotation as deleted from the file.
   */
  complete: boolean
  pageCount: number
  /** Every page's object and scale-1 viewport (what the writer maps coordinates with). */
  pages: PageGeometry[]
  /**
   * File attachments other readers put on pages (Readmate's own are `items`): shown, opened and saved, never edited
   * (specs/007-pdf-file-attachment research R8). Ids match the ones `attachments:open` resolves.
   */
  pageAttachments: ScannedPageAttachment[]
}

/** A page-level file attachment not made by Readmate (contracts §3). */
export type ScannedPageAttachment = {
  attachmentId: string
  pageIndex: number
  /** The icon box, normalised to the displayed page and clamped inside it. */
  rect: { x: number; y: number; width: number; height: number }
  name: string
  /** Actual decoded size; null when the file holds no readable content. */
  sizeBytes: number | null
  /** PDF.js id, to hide its own appearance on the canvas once the app draws the icon. */
  objectId: string
}

type RawAttachmentAnnotation = { id?: unknown; subtype?: unknown; rect?: unknown; file?: { filename?: unknown; rawFilename?: unknown; content?: unknown } }

const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** The icon box of a FileAttachment annotation, normalised to the displayed page (null for a degenerate one). */
function attachmentBox(rect: unknown, page: { transform: readonly number[]; width: number; height: number }): ScannedPageAttachment['rect'] | null {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const [a, b, c, d, e, f] = page.transform as [number, number, number, number, number, number]
  const [x1, y1, x2, y2] = rect as [number, number, number, number]
  const xs = [a * x1 + c * y1 + e, a * x2 + c * y2 + e]
  const ys = [b * x1 + d * y1 + f, b * x2 + d * y2 + f]
  const width = (Math.max(...xs) - Math.min(...xs)) / page.width
  const height = (Math.max(...ys) - Math.min(...ys)) / page.height
  if (!(width > 0) || !(height > 0)) return null
  return clampAttachmentBox({ x: Math.min(...xs) / page.width, y: Math.min(...ys) / page.height, width, height })
}

/**
 * Throws when the document itself can't be opened (broken / truncated / password-protected file):
 * the caller then keeps everything as it is and retries on the next change.
 */
export async function scanPdfAnnotationBytes(bytes: Uint8Array): Promise<PdfAnnotationScanResult> {
  const pdfjs = await loadPdfjs()
  // PDF.js takes ownership of (detaches) the buffer it is given — keep `bytes` for `/NM` — and
  // refuses Node Buffers: always hand it a plain Uint8Array copy.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
  })
  const scanned: ScannedPdfAnnotation[] = []
  const pageAttachments: ScannedPageAttachment[] = []
  /** What the file says each FileAttachment holds (decoded name, size, SHA-256), by PDF.js id. */
  const attachmentInfo = new Map<string, PdfAttachmentInfo | null>()
  let complete = true
  let pageCount = 0
  const pages: PageGeometry[] = []
  try {
    const doc = await task.promise
    pageCount = doc.numPages
    scan: for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      try {
        const page = await doc.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 1 })
        if (page.ref) {
          pages.push({ pageIndex: pageNumber - 1, ref: { num: page.ref.num, gen: page.ref.gen }, transform: [...viewport.transform], width: viewport.width, height: viewport.height })
        }
        const annotations: unknown[] = await page.getAnnotations({ intent: 'display' })
        if (annotations.some((raw) => (raw as RawAttachmentAnnotation).subtype === 'FileAttachment')) {
          // Ordinals of page attachments count over EVERY FileAttachment of the page, as attachments:open does (intent 'any').
          const all = (await page.getAnnotations({ intent: 'any' })) as RawAttachmentAnnotation[]
          const shown = new Set(annotations.map((raw) => (raw as RawAttachmentAnnotation).id))
          let ordinal = 0
          for (const raw of all) {
            if (raw.subtype !== 'FileAttachment' || !raw.file || typeof raw.file !== 'object' || typeof raw.id !== 'string') continue
            const at = ordinal++
            const content = raw.file.content instanceof Uint8Array ? raw.file.content : null
            const name = sanitizeAttachmentFileName(raw.file.filename || raw.file.rawFilename, 'attachment')
            const hash = sha256Hex(content ?? new Uint8Array(0))
            attachmentInfo.set(raw.id, content && content.byteLength > 0 ? { name, sizeBytes: content.byteLength, sha256: hash } : null)
            if (!shown.has(raw.id) || pageAttachments.length >= ATTACHMENT_MAX_COUNT) continue
            const rect = attachmentBox(raw.rect, viewport)
            if (!rect) continue
            pageAttachments.push({
              attachmentId: buildAttachmentId('page', pageNumber, at, hash),
              pageIndex: pageNumber - 1,
              rect,
              name,
              sizeBytes: content ? content.byteLength : null,
              objectId: raw.id,
            })
          }
        }
        if (annotations.length > 0) {
          const info = { pageIndex: pageNumber - 1, transform: viewport.transform, width: viewport.width, height: viewport.height }
          for (const raw of annotations) {
            const item = readPdfJsAnnotation(raw, info)
            if (!item) continue
            if (scanned.length >= EMBEDDED_PDF_SCAN_MAX_ANNOTATIONS) {
              complete = false
              break scan
            }
            scanned.push(item)
          }
        }
        page.cleanup()
      } catch {
        complete = false
      }
    }
  } finally {
    await task.destroy()
  }

  const names = readAnnotationNames(bytes, scanned.map((a) => a.objectId))
  const extras = readShapeExtras(bytes, scanned.filter((a) => isEmbeddedShapeSubtype(a.subtype)).map((a) => a.objectId))
  const items: ScannedPdfAnnotation[] = []
  for (const item of scanned) {
    const nm = names.get(item.objectId)
    // A shape another reader drew stays the FILE's own graphic object (hover / select / edit in place, see
    // pdf_graphic_objects.md): only the shapes Readmate wrote itself (`readmate:<id>`) are annotations here.
    if ((isEmbeddedShapeSubtype(item.subtype) || item.subtype === 'FreeText') && !nm?.startsWith(READMATE_NM_PREFIX)) continue
    // Likewise a file attachment: only Readmate's own are annotations (others' are `pageAttachments`).
    if (item.subtype === 'FileAttachment') {
      if (!nm?.startsWith(READMATE_NM_PREFIX)) continue
      // Its embedded file is missing or empty (another program stripped it): it no longer holds a file, so it is not
      // an annotation — never a reason to call the whole scan incomplete (that would stop every deletion of the
      // book). It stays listed as an attachment of the page (open / save say it is empty) and, the file being
      // authoritative for attachments, a complete scan removes its row like any attachment deleted elsewhere.
      if (!attachmentInfo.get(item.objectId)) continue
      pageAttachments.splice(0, pageAttachments.length, ...pageAttachments.filter((p) => p.objectId !== item.objectId))
    }
    const { line, width, ...more } = extras.get(item.objectId) ?? {}
    let shape = item.shape
    const page = line || width ? pages.find((p) => p.pageIndex === item.pageIndex) : undefined
    if (shape && width && page) shape = { ...shape, strokeWidth: clampShapeStroke((width * Math.hypot(page.transform[0]!, page.transform[1]!)) / page.width) }
    if (shape && line && page) {
      const [a, b, c, d, e, f] = page.transform as [number, number, number, number, number, number]
      const at = (x: number, y: number): [number, number] => [Math.min(1, Math.max(0, (a * x + c * y + e) / page.width)), Math.min(1, Math.max(0, (b * x + d * y + f) / page.height))]
      const p1 = at(line[0]!, line[1]!)
      const p2 = at(line[2]!, line[3]!)
      shape = { ...shape, line: [p1[0], p1[1], p2[0], p2[1]] }
    }
    const attachment = item.subtype === 'FileAttachment' ? (attachmentInfo.get(item.objectId) ?? undefined) : undefined
    const checked = parseScannedPdfAnnotation({ ...item, ...(shape ? { shape } : {}), ...(nm ? { nm } : {}), ...(attachment ? { attachment } : {}), ...more })
    if (checked) items.push(checked)
    else complete = false
  }
  return { items, complete, pageCount, pages, pageAttachments }
}

/** What the read-back of an attachment write must find (specs/007-pdf-file-attachment research R6). */
export type AttachmentVerifyExpectation = {
  /** pdf.js id of the FileAttachment annotation (`${num}R`). */
  annotationId: string
  pageIndex: number
  /** Present after a create / move: the `/Rect` written (user space) and the content's SHA-256. Absent after a delete. */
  present?: { rect: [number, number, number, number]; sha256: string }
  /** pdf.js ids of annotations that must still be there (everything scanned before the write, minus a deleted one). */
  keepIds: readonly string[]
}

export type AttachmentVerifyResult = { ok: true } | { ok: false; detail: string }

const RECT_TOLERANCE = 0.5

/**
 * Read a freshly written PDF back with pdf.js: the attachment annotation is (or, after a delete, is no longer)
 * on its page with the expected rect and decoded content, and no other annotation went missing. Never throws
 * for a bad file — that is a failed verification.
 */
export async function verifyPdfAttachmentBytes(bytes: Uint8Array, expect: AttachmentVerifyExpectation): Promise<AttachmentVerifyResult> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: true })
  try {
    const doc = await task.promise
    const seen = new Set<string>()
    let found: { pageIndex: number; rect: number[]; content: unknown } | null = null
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      try {
        const annotations = (await page.getAnnotations({ intent: 'any' })) as Array<{ id?: string; subtype?: string; rect?: number[]; file?: { content?: unknown } }>
        for (const annotation of annotations) {
          if (typeof annotation.id !== 'string') continue
          seen.add(annotation.id)
          if (annotation.id === expect.annotationId && annotation.subtype === 'FileAttachment') {
            found = { pageIndex: pageNumber - 1, rect: annotation.rect ?? [], content: annotation.file?.content }
          }
        }
      } finally {
        page.cleanup()
      }
    }
    for (const id of expect.keepIds) if (!seen.has(id)) return { ok: false, detail: `annotation ${id} is missing after the write` }
    if (!expect.present) return found ? { ok: false, detail: 'the deleted attachment is still on the page' } : { ok: true }
    if (!found) return { ok: false, detail: 'the attachment annotation was not found' }
    if (found.pageIndex !== expect.pageIndex) return { ok: false, detail: `the attachment is on page ${found.pageIndex + 1}` }
    const [x1, y1, x2, y2] = expect.present.rect
    const want = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
    if (found.rect.length !== 4 || found.rect.some((v, i) => Math.abs(v - want[i]!) > RECT_TOLERANCE)) return { ok: false, detail: 'the attachment rect differs' }
    if (!(found.content instanceof Uint8Array)) return { ok: false, detail: 'the attachment has no readable content' }
    if (createHash('sha256').update(found.content).digest('hex') !== expect.present.sha256) return { ok: false, detail: 'the attachment content differs' }
    return { ok: true }
  } catch (err) {
    return { ok: false, detail: `the written PDF cannot be read back: ${err instanceof Error ? err.message : String(err)}` }
  } finally {
    await task.destroy()
  }
}

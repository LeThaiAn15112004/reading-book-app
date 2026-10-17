/**
 * Append ONE incremental update (ISO 32000-1 §7.5.6) that adds, rewrites or removes annotations —
 * the way Foxit / Acrobat save. The original bytes are kept untouched: the result is
 * `original + "\n" + new objects + xref section + trailer`. See docs/implementation_plan/pdf_annotation_export.md.
 *
 * Understands only what it touches: the last xref section and trailer (classic table or xref
 * stream), page dictionaries and their `/Annots` (inline or indirect), annotation dictionaries.
 * Anything it can't handle is refused with a `PdfWriteError` — never written "best effort".
 * Pure Node (no Electron, no UI, no SQLite); runs in the scan worker.
 */
import type { PdfWriteAnnotation } from '@reading-book/book-reader-sdk'
import { PdfRawObjects, parsePdfJsRef } from './pdf-raw-objects'
import {
  PdfSyntaxError,
  dictValue,
  num,
  parseDict,
  parseRef,
  parseRefArray,
  patchDict,
  refText,
  textString,
  type PdfRef,
} from './pdf-syntax'

export type PdfWriteErrorCode = 'encrypted' | 'unsupported_pdf'

export class PdfWriteError extends Error {
  constructor(
    readonly code: PdfWriteErrorCode,
    message: string,
  ) {
    super(message)
  }
}

/** A page as PDF.js reports it: its object, and its scale-1 viewport (user space → display px). */
export type PageGeometry = {
  pageIndex: number
  ref: PdfRef
  transform: readonly number[]
  width: number
  height: number
}

export type AnnotationUpdate = {
  add: readonly PdfWriteAnnotation[]
  replace: readonly { objectId: string; annotation: PdfWriteAnnotation }[]
  remove: readonly { objectId: string; pageIndex: number }[]
}

/** Side length of a sticky-note icon, in PDF units. */
const NOTE_ICON = 20

type Point = [number, number]

function inverse(m: readonly number[]): (x: number, y: number) => Point {
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number]
  const det = a * d - b * c
  if (!det) throw new PdfWriteError('unsupported_pdf', 'degenerate page transform')
  return (X, Y) => [(d * (X - e) - c * (Y - f)) / det, (-b * (X - e) + a * (Y - f)) / det]
}

type Quad = { tl: Point; tr: Point; bl: Point; br: Point }

function quadsFor(annotation: PdfWriteAnnotation, page: PageGeometry): Quad[] {
  const toUser = inverse(page.transform)
  return annotation.rects.map((r) => {
    const x1 = r.x * page.width
    const y1 = r.y * page.height
    const x2 = (r.x + r.width) * page.width
    const y2 = (r.y + r.height) * page.height
    return { tl: toUser(x1, y1), tr: toUser(x2, y1), bl: toUser(x1, y2), br: toUser(x2, y2) }
  })
}

function bbox(points: Point[], pad: number): [number, number, number, number] {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const pt = (p: Point) => `${num(p[0])} ${num(p[1])}`

/** The appearance stream content (in user space, BBox = Rect) of a text-markup annotation. */
function appearanceContent(annotation: PdfWriteAnnotation, quads: Quad[]): string {
  const [r, g, b] = annotation.color.map(num)
  const ops: string[] = ['q', '/GS0 gs']
  if (annotation.subtype === 'Highlight') {
    ops.push(`${r} ${g} ${b} rg`)
    for (const q of quads) ops.push(`${pt(q.tl)} m ${pt(q.tr)} l ${pt(q.br)} l ${pt(q.bl)} l h f`)
  } else {
    ops.push(`${r} ${g} ${b} RG`)
    for (const q of quads) {
      const width = Math.max(0.5, dist(q.tl, q.bl) * 0.07)
      if (annotation.subtype === 'Underline') {
        // Along the bottom edge, nudged up by half the stroke so it stays inside the box.
        const up: Point = [(q.tl[0] - q.bl[0]) * 0.06, (q.tl[1] - q.bl[1]) * 0.06]
        ops.push(`${num(width)} w ${pt([q.bl[0] + up[0], q.bl[1] + up[1]])} m ${pt([q.br[0] + up[0], q.br[1] + up[1]])} l S`)
      } else {
        ops.push(`${num(width)} w ${pt(mid(q.tl, q.bl))} m ${pt(mid(q.tr, q.br))} l S`)
      }
    }
  }
  ops.push('Q')
  return ops.join('\n')
}

type NewObject = { num: number; gen: number; body: string }

function streamObject(dict: string, content: string): string {
  return `<< ${dict} /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
}

/** The last xref section and its trailer. */
function readTrailer(objects: PdfRawObjects): { prev: number; kind: 'table' | 'stream'; size: number; root: string; info?: string; id?: string } {
  const text = objects.text
  const tail = text.slice(-4096)
  const at = tail.lastIndexOf('startxref')
  if (at === -1) throw new PdfWriteError('unsupported_pdf', 'no startxref')
  const prev = Number(/startxref\s+(\d+)/.exec(tail.slice(at))?.[1])
  if (!Number.isInteger(prev) || prev <= 0 || prev >= text.length) throw new PdfWriteError('unsupported_pdf', 'bad startxref')
  let kind: 'table' | 'stream'
  let dictText: string
  let dict
  if (text.startsWith('xref', prev)) {
    kind = 'table'
    const trailerAt = text.indexOf('trailer', prev)
    if (trailerAt === -1) throw new PdfWriteError('unsupported_pdf', 'no trailer')
    dictText = text
    dict = parseDict(text, trailerAt)
  } else if (/^\d+\s+\d+\s+obj/.test(text.slice(prev, prev + 32))) {
    kind = 'stream'
    dictText = text
    dict = parseDict(text, prev)
    if (!/^\/XRef$/.test(dictValue(text, dict, 'Type') ?? '')) throw new PdfWriteError('unsupported_pdf', 'startxref does not point at an xref stream')
  } else {
    throw new PdfWriteError('unsupported_pdf', 'startxref does not point at an xref section')
  }
  if (dictValue(dictText, dict, 'Encrypt') !== undefined) throw new PdfWriteError('encrypted', 'the PDF is encrypted')
  const size = Number(dictValue(dictText, dict, 'Size'))
  const root = dictValue(dictText, dict, 'Root')
  if (!Number.isInteger(size) || size <= 0 || !parseRef(root)) throw new PdfWriteError('unsupported_pdf', 'trailer without /Size or /Root')
  const info = dictValue(dictText, dict, 'Info')
  const id = dictValue(dictText, dict, 'ID')
  return { prev, kind, size, root: root!, info: parseRef(info) ? info : undefined, id }
}

function annotationDict(annotation: PdfWriteAnnotation, page: PageGeometry, apRef: PdfRef | null, created: string, modified: string, keep: Record<string, string>): string {
  const [r, g, b] = annotation.color.map(num)
  const parts = [`/Type /Annot /Subtype /${annotation.subtype}`]
  if (annotation.subtype === 'Text') {
    const quads = quadsFor(annotation, page)
    const last = quads[quads.length - 1]!
    const [x, y] = last.tr
    parts.push(`/Rect [${num(x)} ${num(y - NOTE_ICON)} ${num(x + NOTE_ICON)} ${num(y)}]`, '/Name /Comment /Open false', '/F 28')
  } else {
    const quads = quadsFor(annotation, page)
    const points = quads.flatMap((q) => [q.tl, q.tr, q.bl, q.br])
    const rect = bbox(points, 1)
    parts.push(
      `/Rect [${rect.map(num).join(' ')}]`,
      `/QuadPoints [${quads.flatMap((q) => [q.tl, q.tr, q.bl, q.br]).map(pt).join(' ')}]`,
      '/F 4',
    )
    if (annotation.opacity < 1) parts.push(`/CA ${num(annotation.opacity)}`)
  }
  parts.push(`/C [${r} ${g} ${b}]`)
  if (annotation.contents) parts.push(`/Contents ${textString(annotation.contents)}`)
  parts.push(`/T ${textString(annotation.author)}`, `/NM ${textString(annotation.nm)}`, `/M ${textString(modified)}`, `/CreationDate ${textString(created)}`)
  parts.push(`/P ${refText(page.ref)}`)
  if (apRef) parts.push(`/AP << /N ${refText(apRef)} >>`)
  for (const [key, value] of Object.entries(keep)) parts.push(`/${key} ${value}`)
  return `<< ${parts.join(' ')} >>`
}

function pdfDate(iso: string): string {
  const d = new Date(iso)
  const t = Number.isNaN(d.getTime()) ? new Date() : d
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}Z`
}

/** Throws `PdfWriteError` when the writer can't append to this file (encrypted / unsupported trailer). */
export function assertPdfWritable(bytes: Uint8Array): void {
  try {
    const objects = new PdfRawObjects(bytes)
    if (objects.encrypted) throw new PdfWriteError('encrypted', 'the PDF is encrypted')
    readTrailer(objects)
  } catch (err) {
    if (err instanceof PdfSyntaxError) throw new PdfWriteError('unsupported_pdf', err.message)
    throw err
  }
}

/**
 * `bytes` + one incremental update applying `update`. `pages` must hold every page the update
 * touches. Throws `PdfWriteError` (encrypted / unsupported structure) — nothing is produced then.
 */
export function appendAnnotationUpdate(bytes: Uint8Array, pages: ReadonlyMap<number, PageGeometry>, update: AnnotationUpdate): Uint8Array {
  try {
    return appendUnchecked(bytes, pages, update)
  } catch (err) {
    if (err instanceof PdfSyntaxError) throw new PdfWriteError('unsupported_pdf', err.message)
    throw err
  }
}

function appendUnchecked(bytes: Uint8Array, pages: ReadonlyMap<number, PageGeometry>, update: AnnotationUpdate): Uint8Array {
  const objects = new PdfRawObjects(bytes)
  if (objects.encrypted) throw new PdfWriteError('encrypted', 'the PDF is encrypted')
  const trailer = readTrailer(objects)
  let nextNum = trailer.size
  const written: NewObject[] = []
  const pageOf = (pageIndex: number): PageGeometry => {
    const page = pages.get(pageIndex)
    if (!page) throw new PdfWriteError('unsupported_pdf', `page ${pageIndex + 1} is unknown`)
    return page
  }

  const writeAnnotation = (annotation: PdfWriteAnnotation, target: PdfRef | null, keep: Record<string, string>): PdfRef => {
    const page = pageOf(annotation.pageIndex)
    let apRef: PdfRef | null = null
    if (annotation.subtype !== 'Text') {
      const quads = quadsFor(annotation, page)
      const rect = bbox(quads.flatMap((q) => [q.tl, q.tr, q.bl, q.br]), 1)
      const opacity = num(annotation.opacity)
      const blend = annotation.subtype === 'Highlight' ? ' /BM /Multiply' : ''
      apRef = { num: nextNum++, gen: 0 }
      written.push({
        ...apRef,
        body: streamObject(
          `/Type /XObject /Subtype /Form /FormType 1 /BBox [${rect.map(num).join(' ')}] /Resources << /ExtGState << /GS0 << /Type /ExtGState /CA ${opacity} /ca ${opacity}${blend} >> >> >>`,
          appearanceContent(annotation, quads),
        ),
      })
    }
    const ref = target ?? { num: nextNum++, gen: 0 }
    written.push({ ...ref, body: annotationDict(annotation, page, apRef, pdfDate(annotation.createdAt), pdfDate(annotation.modifiedAt), keep) })
    return ref
  }

  // Replacements keep their object number (and their /Popup, /IRT, /StructParent links).
  for (const { objectId, annotation } of update.replace) {
    const ref = parsePdfJsRef(objectId)
    if (!ref) throw new PdfWriteError('unsupported_pdf', `cannot rewrite inline annotation ${objectId}`)
    const keep: Record<string, string> = {}
    const old = objects.body(ref.num, ref.gen)
    if (old !== undefined) {
      const dict = parseDict(old)
      for (const key of ['Popup', 'IRT', 'RT', 'StructParent', 'OC']) {
        const value = dictValue(old, dict, key)
        if (value !== undefined) keep[key] = value
      }
    }
    writeAnnotation(annotation, ref, keep)
  }

  // Page /Annots changes: additions and removals grouped per page.
  const perPage = new Map<number, { add: PdfRef[]; remove: Set<string> }>()
  const changesFor = (pageIndex: number) => {
    let entry = perPage.get(pageIndex)
    if (!entry) perPage.set(pageIndex, (entry = { add: [], remove: new Set() }))
    return entry
  }
  for (const annotation of update.add) changesFor(annotation.pageIndex).add.push(writeAnnotation(annotation, null, {}))
  for (const { objectId, pageIndex } of update.remove) {
    const ref = parsePdfJsRef(objectId)
    if (!ref) throw new PdfWriteError('unsupported_pdf', `cannot remove inline annotation ${objectId}`)
    changesFor(pageIndex).remove.add(`${ref.num} ${ref.gen}`)
  }

  for (const [pageIndex, change] of perPage) {
    const page = pageOf(pageIndex)
    const pageBody = objects.body(page.ref.num, page.ref.gen)
    if (pageBody === undefined) throw new PdfWriteError('unsupported_pdf', `page object ${page.ref.num} not found`)
    const pageDict = parseDict(pageBody)
    const annotsValue = dictValue(pageBody, pageDict, 'Annots')
    const indirect = parseRef(annotsValue)
    let current: PdfRef[]
    if (indirect) {
      const arrayBody = objects.body(indirect.num, indirect.gen)
      if (arrayBody === undefined) throw new PdfWriteError('unsupported_pdf', '/Annots array not found')
      current = parseRefArray(arrayBody)
    } else current = annotsValue ? parseRefArray(annotsValue) : []

    if (change.remove.size > 0) {
      // Also drop each removed annotation's popup (its /Popup, or a popup whose /Parent it is).
      for (const ref of current) {
        const key = `${ref.num} ${ref.gen}`
        const body = objects.body(ref.num, ref.gen)
        if (body === undefined) continue
        try {
          const dict = parseDict(body)
          if (change.remove.has(key)) {
            const popup = parseRef(dictValue(body, dict, 'Popup'))
            if (popup) change.remove.add(`${popup.num} ${popup.gen}`)
          } else if (dictValue(body, dict, 'Subtype') === '/Popup') {
            const parent = parseRef(dictValue(body, dict, 'Parent'))
            if (parent && change.remove.has(`${parent.num} ${parent.gen}`)) change.remove.add(key)
          }
        } catch {
          // An annotation we can't parse is left where it is.
        }
      }
    }
    const next = [...current.filter((r) => !change.remove.has(`${r.num} ${r.gen}`)), ...change.add]
    const arrayText = `[${next.map(refText).join(' ')}]`
    if (indirect) written.push({ ...indirect, body: arrayText })
    else written.push({ ...page.ref, body: patchDict(pageBody, pageDict, { Annots: arrayText }) })
  }

  if (written.length === 0) return new Uint8Array(bytes)
  return serialize(objects.text, trailer, written, nextNum)
}

function serialize(original: string, trailer: ReturnType<typeof readTrailer>, written: NewObject[], nextNum: number): Uint8Array {
  let out = original.endsWith('\n') || original.endsWith('\r') ? '' : '\n'
  const base = original.length
  const offsets = new Map<number, { gen: number; offset: number }>()
  for (const object of written) {
    offsets.set(object.num, { gen: object.gen, offset: base + Buffer.byteLength(out, 'latin1') })
    out += `${object.num} ${object.gen} obj\n${object.body}\nendobj\n`
  }
  const trailerExtras = `/Root ${trailer.root}${trailer.info ? ` /Info ${trailer.info}` : ''}${trailer.id ? ` /ID ${trailer.id}` : ''} /Prev ${trailer.prev}`

  if (trailer.kind === 'table') {
    const xrefAt = base + Buffer.byteLength(out, 'latin1')
    const nums = [...offsets.keys()].sort((a, b) => a - b)
    out += 'xref\n'
    for (let i = 0; i < nums.length; ) {
      let j = i
      while (j + 1 < nums.length && nums[j + 1] === nums[j]! + 1) j++
      out += `${nums[i]} ${j - i + 1}\n`
      for (let k = i; k <= j; k++) {
        const { gen, offset } = offsets.get(nums[k]!)!
        out += `${String(offset).padStart(10, '0')} ${String(gen).padStart(5, '0')} n \n`
      }
      i = j + 1
    }
    out += `trailer\n<< /Size ${Math.max(nextNum, trailer.size)} ${trailerExtras} >>\nstartxref\n${xrefAt}\n%%EOF\n`
  } else {
    // The previous section is an xref stream: continue with one (W [1 4 2], uncompressed).
    const xrefNum = nextNum
    const xrefAt = base + Buffer.byteLength(out, 'latin1')
    offsets.set(xrefNum, { gen: 0, offset: xrefAt })
    const nums = [...offsets.keys()].sort((a, b) => a - b)
    const index: number[] = []
    const rows: Buffer[] = []
    for (let i = 0; i < nums.length; ) {
      let j = i
      while (j + 1 < nums.length && nums[j + 1] === nums[j]! + 1) j++
      index.push(nums[i]!, j - i + 1)
      for (let k = i; k <= j; k++) {
        const { gen, offset } = offsets.get(nums[k]!)!
        const row = Buffer.alloc(7)
        row.writeUInt8(1, 0)
        row.writeUInt32BE(offset, 1)
        row.writeUInt16BE(gen, 5)
        rows.push(row)
      }
      i = j + 1
    }
    const data = Buffer.concat(rows).toString('latin1')
    out += `${xrefNum} 0 obj\n<< /Type /XRef /Size ${xrefNum + 1} /W [1 4 2] /Index [${index.join(' ')}] ${trailerExtras} /Length ${data.length} >>\nstream\n${data}\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`
  }
  return new Uint8Array(Buffer.concat([Buffer.from(original, 'latin1'), Buffer.from(out, 'latin1')]))
}

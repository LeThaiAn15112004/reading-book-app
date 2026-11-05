/**
 * The annotations file (`.readmate-notes.json`): its shape, serialisation and validation.
 * specs/006-annotation-import-export/data-model.md and contracts/annotation-file.schema.json.
 *
 * The file carries the stored note fields verbatim (locator, quote, comment, per-format payload); it
 * does not invent a location model. Deep validation of the per-format payloads (`pdfAnnotation`,
 * `txtAnnotation`, `mdAnnotation`) is done by the import planner with the existing parsers; here they
 * only have to be objects.
 */
import type { NoteLocator, NoteSelectionText } from '../domain/index.js'

export const FILE_VERSION = 1
export const FILE_EXTENSION = '.readmate-notes.json'

export type TransferFormat = 'epub' | 'pdf' | 'txt' | 'md'
export const TRANSFER_FORMATS: readonly TransferFormat[] = ['epub', 'pdf', 'txt', 'md']

/** `note_json.type` values that are annotations (not bookmarks, not ink). */
export const TRANSFER_ANNOTATION_TYPES = [
  'highlight',
  'underline',
  'squiggly',
  'strikethrough',
  'replace',
  'insert',
  'textbox',
  'rectangle',
  'ellipse',
  'line',
  'arrow',
  'typewriter',
] as const
export type TransferAnnotationType = (typeof TRANSFER_ANNOTATION_TYPES)[number]

export type TransferOrigin = 'app' | 'file'

export interface TransferBook {
  title: string
  author?: string
  format: TransferFormat
  /** `books.sha256` of the file at export time. */
  sha256: string
  /** PDF only, optional: the library's page count when it was known. */
  pageCount?: number
}

export interface TransferAnnotation {
  /** Row id at the source; informational (see data-model "Identity"). */
  sourceId: string
  type: TransferAnnotationType
  locator: NoteLocator
  selectionText?: NoteSelectionText
  /** The comment; for `typewriter` the document text (never trimmed). */
  note?: string
  tags?: string[]
  /** `#RRGGBB`, shapes `#RRGGBBAA`. */
  colorHex: string
  pdfAnnotation?: Record<string, unknown>
  txtAnnotation?: Record<string, unknown>
  mdAnnotation?: Record<string, unknown>
  createdAt: string
  modifiedAt?: string
  origin: TransferOrigin
  /** PDF `file`-origin only: the annotation's `/NM`, when known. */
  nm?: string
  /**
   * PDF `file`-origin only: the identity keys the app's sync ledger holds for this annotation (`nm1:<page>:<hash>#n`
   * or `pdf1:...`, one per page it touches). The ledger stores only the hashed name, so this — not `nm` — is what lets
   * an importer recognise the same annotation in a scan of the target PDF.
   */
  sourceKeys?: string[]
}

export interface AnnotationFile {
  fileVersion: number
  exportedBy: string
  exportedAt: string
  book: TransferBook
  /** TXT only: content hash of the edited copy the offsets refer to (revision numbers are device-local). */
  txt?: { contentSha256: string }
  annotations: TransferAnnotation[]
}

export type TransferErrorCode = 'not_annotation_file' | 'damaged' | 'newer_version'

/** An annotation of the file that failed validation (counted as "not placed" by the importer). */
export interface RejectedAnnotation {
  index: number
  type?: string
  quote?: string
  reason: string
}

export type ParseAnnotationFileResult =
  | { ok: true; file: AnnotationFile; rejected: RejectedAnnotation[] }
  | { ok: false; errorCode: TransferErrorCode }

const SHA256_RE = /^[0-9a-f]{64}$/
const COLOR_RE = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

function isIsoLike(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Date.parse(v))
}

function parseLocator(v: unknown): NoteLocator | undefined {
  if (!isObject(v)) return undefined
  const chapterIndex = v.chapterIndex
  if (chapterIndex !== undefined && !isNonNegInt(chapterIndex)) return undefined
  const extra = chapterIndex === undefined ? {} : { chapterIndex }
  if (v.kind === 'cfi') {
    if (typeof v.cfi !== 'string' || !v.cfi.trim()) return undefined
    return { kind: 'cfi', cfi: v.cfi, ...extra }
  }
  if (v.kind === 'page-rect') {
    if (typeof v.page !== 'number' || !Number.isInteger(v.page) || v.page < 1) return undefined
    const loc: NoteLocator = { kind: 'page-rect', page: v.page, ...extra }
    if (v.rect !== undefined) {
      const r = v.rect
      if (!isObject(r) || !['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k] as number))) return undefined
      loc.rect = { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number }
    }
    return loc
  }
  if (v.kind === 'text-offset') {
    if (!isNonNegInt(v.offset)) return undefined
    if (v.blockId !== undefined && typeof v.blockId !== 'string') return undefined
    return v.blockId === undefined ? { kind: 'text-offset', offset: v.offset, ...extra } : { kind: 'text-offset', offset: v.offset, blockId: v.blockId, ...extra }
  }
  return undefined
}

function parseSelectionText(v: unknown): NoteSelectionText | undefined | null {
  if (v === undefined) return undefined
  if (!isObject(v)) return null
  const out: NoteSelectionText = {}
  for (const key of ['before', 'highlight', 'after'] as const) {
    const part = v[key]
    if (part === undefined) continue
    if (typeof part !== 'string') return null
    out[key] = part
  }
  return out
}

/** One annotation → the validated value or the reason it was rejected. */
function parseAnnotation(raw: unknown): { ok: true; value: TransferAnnotation } | { ok: false; reason: string; type?: string; quote?: string } {
  if (!isObject(raw)) return { ok: false, reason: 'not an object' }
  const type = typeof raw.type === 'string' ? raw.type : undefined
  const quote = isObject(raw.selectionText) && typeof raw.selectionText.highlight === 'string' ? raw.selectionText.highlight : undefined
  const fail = (reason: string) => ({ ok: false as const, reason, type, quote })

  if (!(TRANSFER_ANNOTATION_TYPES as readonly string[]).includes(type ?? '')) return fail('unknown annotation type')
  if (typeof raw.sourceId !== 'string' || !raw.sourceId) return fail('missing id')
  const locator = parseLocator(raw.locator)
  if (!locator) return fail('invalid location')
  const selectionText = parseSelectionText(raw.selectionText)
  if (selectionText === null) return fail('invalid quote')
  if (typeof raw.colorHex !== 'string' || !COLOR_RE.test(raw.colorHex)) return fail('invalid colour')
  if (!isIsoLike(raw.createdAt)) return fail('invalid created time')
  if (raw.modifiedAt !== undefined && !isIsoLike(raw.modifiedAt)) return fail('invalid modified time')
  if (raw.origin !== 'app' && raw.origin !== 'file') return fail('invalid origin')
  if (raw.note !== undefined && typeof raw.note !== 'string') return fail('invalid comment')
  if (raw.tags !== undefined && !(Array.isArray(raw.tags) && raw.tags.every((t) => typeof t === 'string'))) return fail('invalid tags')
  if (raw.nm !== undefined && typeof raw.nm !== 'string') return fail('invalid name')
  if (raw.sourceKeys !== undefined && !(Array.isArray(raw.sourceKeys) && raw.sourceKeys.every((k) => typeof k === 'string'))) return fail('invalid source keys')
  for (const key of ['pdfAnnotation', 'txtAnnotation', 'mdAnnotation'] as const) {
    if (raw[key] !== undefined && !isObject(raw[key])) return fail(`invalid ${key}`)
  }

  const value: TransferAnnotation = {
    sourceId: raw.sourceId,
    type: type as TransferAnnotationType,
    locator,
    colorHex: raw.colorHex,
    createdAt: raw.createdAt as string,
    origin: raw.origin,
  }
  if (selectionText) value.selectionText = selectionText
  if (typeof raw.note === 'string') value.note = raw.note
  if (Array.isArray(raw.tags) && raw.tags.length) value.tags = raw.tags as string[]
  if (typeof raw.modifiedAt === 'string') value.modifiedAt = raw.modifiedAt
  if (typeof raw.nm === 'string') value.nm = raw.nm
  if (Array.isArray(raw.sourceKeys) && raw.sourceKeys.length) value.sourceKeys = raw.sourceKeys as string[]
  if (isObject(raw.pdfAnnotation)) value.pdfAnnotation = raw.pdfAnnotation
  if (isObject(raw.txtAnnotation)) value.txtAnnotation = raw.txtAnnotation
  if (isObject(raw.mdAnnotation)) value.mdAnnotation = raw.mdAnnotation
  return { ok: true, value }
}

function parseBook(raw: unknown): TransferBook | undefined {
  if (!isObject(raw)) return undefined
  if (typeof raw.title !== 'string') return undefined
  if (!(TRANSFER_FORMATS as readonly string[]).includes(raw.format as string)) return undefined
  if (typeof raw.sha256 !== 'string' || !SHA256_RE.test(raw.sha256)) return undefined
  if (raw.author !== undefined && typeof raw.author !== 'string') return undefined
  if (raw.pageCount !== undefined && !(typeof raw.pageCount === 'number' && Number.isInteger(raw.pageCount) && raw.pageCount >= 1)) return undefined
  const book: TransferBook = { title: raw.title, format: raw.format as TransferFormat, sha256: raw.sha256 }
  if (typeof raw.author === 'string') book.author = raw.author
  if (typeof raw.pageCount === 'number') book.pageCount = raw.pageCount
  return book
}

/**
 * Parse the text of a picked file. `not_annotation_file`: valid JSON that is not one of our files (or not
 * JSON object at all); `damaged`: not JSON, or ours but unusable; `newer_version`: written by a newer app.
 * A single invalid annotation does not fail the file: it is returned in `rejected`.
 */
export function parseAnnotationFile(text: string): ParseAnnotationFileResult {
  let json: unknown
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return { ok: false, errorCode: 'damaged' }
  }
  if (!isObject(json) || json.fileVersion === undefined || json.book === undefined || json.annotations === undefined) {
    return { ok: false, errorCode: 'not_annotation_file' }
  }
  if (typeof json.fileVersion !== 'number' || !Number.isInteger(json.fileVersion) || json.fileVersion < 1) return { ok: false, errorCode: 'damaged' }
  if (json.fileVersion > FILE_VERSION) return { ok: false, errorCode: 'newer_version' }

  const book = parseBook(json.book)
  if (!book) return { ok: false, errorCode: 'damaged' }
  if (!Array.isArray(json.annotations) || json.annotations.length === 0) return { ok: false, errorCode: 'damaged' }
  if (typeof json.exportedBy !== 'string' || !isIsoLike(json.exportedAt)) return { ok: false, errorCode: 'damaged' }

  let txt: AnnotationFile['txt']
  if (json.txt !== undefined) {
    if (!isObject(json.txt) || typeof json.txt.contentSha256 !== 'string' || !SHA256_RE.test(json.txt.contentSha256)) return { ok: false, errorCode: 'damaged' }
    txt = { contentSha256: json.txt.contentSha256 }
  }

  const annotations: TransferAnnotation[] = []
  const rejected: RejectedAnnotation[] = []
  json.annotations.forEach((raw, index) => {
    const parsed = parseAnnotation(raw)
    if (parsed.ok) annotations.push(parsed.value)
    else rejected.push({ index, type: parsed.type, quote: parsed.quote, reason: parsed.reason })
  })

  const file: AnnotationFile = { fileVersion: json.fileVersion, exportedBy: json.exportedBy, exportedAt: json.exportedAt as string, book, annotations }
  if (txt) file.txt = txt
  return { ok: true, file, rejected }
}

/** Pretty-printed UTF-8 JSON text of a file (the writer adds nothing else; Unicode is kept as-is). */
export function serializeAnnotationFile(file: AnnotationFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

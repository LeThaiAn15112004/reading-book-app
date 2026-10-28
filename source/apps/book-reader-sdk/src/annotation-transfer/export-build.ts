/**
 * Builds the annotations file from stored note rows (specs/006-annotation-import-export, FR-001..003).
 * Pure: the caller (Main) reads the rows, decides each row's origin and writes the result.
 */
import type { INoteState } from '../domain/index.js'
import {
  FILE_VERSION,
  TRANSFER_ANNOTATION_TYPES,
  type AnnotationFile,
  type TransferAnnotation,
  type TransferAnnotationType,
  type TransferBook,
  type TransferOrigin,
} from './file-format.js'

/** One stored annotation row plus what only the caller knows about it. */
export interface ExportRow {
  id: string
  /** Row `created_at`. */
  createdAt: string
  /** Row `updated_at`. */
  updatedAt: string
  /** Parsed `note_json`. */
  note: INoteState
  /** PDF: whether the annotation was read from the file (`file`) or made in the app (`app`). Defaults to `app`. */
  origin?: TransferOrigin
  /** PDF `file` origin: the sync ledger's identity keys for the row. */
  sourceKeys?: readonly string[]
  /** PDF `file` origin: the annotation's `/NM`, when known. */
  nm?: string
}

export interface BuildAnnotationFileInput {
  book: TransferBook
  rows: readonly ExportRow[]
  /** TXT only: `txt_documents.content_sha256` of the edited copy, when the book has one. */
  txtContentSha256?: string
  appVersion: string
  now: Date
}

export type BuildAnnotationFileResult =
  | { ok: true; file: AnnotationFile; exported: number; skipped: number }
  | { ok: false; errorCode: 'empty' }

const DEFAULT_COLOR = '#FFEB3B'

function isTransferType(type: unknown): type is TransferAnnotationType {
  return (TRANSFER_ANNOTATION_TYPES as readonly unknown[]).includes(type)
}

function toAnnotation(row: ExportRow): TransferAnnotation | null {
  const n = row.note
  const locator = n.locatorExtended?.locator
  if (!locator || !isTransferType(n.type)) return null
  const out: TransferAnnotation = {
    sourceId: row.id,
    type: n.type,
    locator,
    colorHex: n.style?.colorHex?.trim() || DEFAULT_COLOR,
    createdAt: row.createdAt,
    modifiedAt: row.updatedAt,
    origin: row.origin ?? 'app',
  }
  const text = n.locatorExtended?.text
  if (text && (text.before !== undefined || text.highlight !== undefined || text.after !== undefined)) out.selectionText = { ...text }
  // A typewriter note's text is the document itself; every other comment is stored trimmed already.
  if (typeof n.note === 'string' && n.note !== '') out.note = n.note
  if (n.tags?.length) out.tags = [...n.tags]
  if (n.pdfAnnotation) out.pdfAnnotation = n.pdfAnnotation as unknown as Record<string, unknown>
  if (n.txtAnnotation) out.txtAnnotation = n.txtAnnotation as unknown as Record<string, unknown>
  if (n.mdAnnotation) out.mdAnnotation = n.mdAnnotation as unknown as Record<string, unknown>
  if (out.origin === 'file') {
    if (row.nm) out.nm = row.nm
    if (row.sourceKeys?.length) out.sourceKeys = [...row.sourceKeys]
  }
  return out
}

/** Reading order: chapter, then page and top-to-bottom, then offset / Markdown anchor; ties by creation time. */
function orderKey(a: TransferAnnotation): [number, number, number, number, string] {
  const loc = a.locator
  const chapter = ('chapterIndex' in loc && loc.chapterIndex) || 0
  if (loc.kind === 'page-rect') {
    const rects = (a.pdfAnnotation as { rects?: Array<{ pageIndex?: number; y?: number; x?: number }> } | undefined)?.rects
    const first = rects?.[0]
    return [chapter, loc.page, first?.y ?? loc.rect?.y ?? 0, first?.x ?? loc.rect?.x ?? 0, a.createdAt]
  }
  if (loc.kind === 'text-offset') {
    const md = a.mdAnnotation as { startSegment?: number; startOffset?: number } | undefined
    if (md) return [chapter, md.startSegment ?? 0, md.startOffset ?? loc.offset, 0, a.createdAt]
    return [chapter, 0, loc.offset, 0, a.createdAt]
  }
  return [chapter, 0, 0, 0, a.createdAt]
}

function compareKeys(x: ReturnType<typeof orderKey>, y: ReturnType<typeof orderKey>): number {
  for (let i = 0; i < 4; i++) {
    const d = (x[i] as number) - (y[i] as number)
    if (d !== 0) return d
  }
  return x[4] < y[4] ? -1 : x[4] > y[4] ? 1 : 0
}

export function buildAnnotationFile(input: BuildAnnotationFileInput): BuildAnnotationFileResult {
  const annotations: TransferAnnotation[] = []
  let skipped = 0
  for (const row of input.rows) {
    const a = toAnnotation(row)
    if (a) annotations.push(a)
    else skipped += 1
  }
  if (annotations.length === 0) return { ok: false, errorCode: 'empty' }

  annotations.sort((a, b) => compareKeys(orderKey(a), orderKey(b)))
  const file: AnnotationFile = {
    fileVersion: FILE_VERSION,
    exportedBy: `Readmate ${input.appVersion}`,
    exportedAt: input.now.toISOString(),
    book: input.book,
    annotations,
  }
  if (input.book.format === 'txt' && input.txtContentSha256) file.txt = { contentSha256: input.txtContentSha256 }
  return { ok: true, file, exported: annotations.length, skipped }
}

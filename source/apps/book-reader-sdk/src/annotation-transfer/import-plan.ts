/**
 * Plans an import (specs/006-annotation-import-export, FR-004..FR-009): which annotations of a file are added to a
 * target book, which are already there, and which cannot be placed. Pure — Main supplies the target's existing keys,
 * the PDF scan keys and the id check; nothing here reads or writes a store.
 */
import type { INoteState, MdAnnotation, NoteLocator, NoteSelectionText, PdfAnnotation, TxtAnnotation } from '../domain/index.js'
import { parsePdfAnnotation, isConsistentPdfHighlight } from '../app-models/pdf-highlight.js'
import { isConsistentTxtHighlight, parseTxtAnnotation } from '../txt/txt-annotations.js'
import { isConsistentMdHighlight, parseMdAnnotation } from '../md/md-annotations.js'
import { contentKeyOf } from './content-key.js'
import type { AnnotationFile, RejectedAnnotation, TransferAnnotation, TransferAnnotationType } from './file-format.js'

/** An annotation ready to be written to the target book. Payloads are the re-validated (normalised) ones. */
export interface PlannedAdd {
  /** The id to store the row under; null = the caller generates a new one (the source id is not usable). */
  id: string | null
  sourceId: string
  type: TransferAnnotationType
  locator: NoteLocator
  selectionText?: NoteSelectionText
  note?: string
  tags?: string[]
  colorHex: string
  createdAt: string
  pdfAnnotation?: PdfAnnotation
  txtAnnotation?: TxtAnnotation
  mdAnnotation?: MdAnnotation
  /** The content key, so the caller can recompute "already present" cheaply. */
  contentKey: string
}

export interface NotPlaced {
  type?: string
  quote?: string
  reason: string
}

export interface ImportPlan {
  toAdd: PlannedAdd[]
  /** Annotations skipped because the book already holds them (or an identical one appeared earlier in the file). */
  present: number
  notPlaced: NotPlaced[]
}

/**
 * How the file's annotations relate to the target book's content (spec FR-011):
 * `exact` — identical content, the stored locations are used as they are;
 * `pdf-page-position` — a PDF that is the same document (same title and author, equal known page counts) but not the same
 *   bytes: placed by page and rectangle only, never by searching, and only when the page exists;
 * `none` — a different edition: nothing can be placed (TXT quote re-anchoring is added by task T031).
 */
export type PlacementMode = 'exact' | 'pdf-page-position' | 'none'

export interface PlacementTarget {
  title: string
  author?: string
  format: string
  sha256: string
  /** PDF: the library's page count, when known. */
  pageCount?: number
  /** TXT: `txt_documents.content_sha256` of the target's edited copy, when it has one. */
  txtContentSha256?: string
}

/** Case-, accent-form- and spacing-insensitive text for comparing titles and authors. */
function norm(text: string | undefined): string {
  return (text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function decidePlacement(file: Pick<AnnotationFile, 'book' | 'txt'>, target: PlacementTarget): PlacementMode {
  const { book } = file
  if (book.format !== target.format) return 'none'
  const sameBytes = book.sha256 === target.sha256
  if (book.format === 'txt') {
    // The offsets belong to the text the file was made from: the edited copy when there was one, else the original file.
    if (file.txt) return target.txtContentSha256 === file.txt.contentSha256 ? 'exact' : 'none'
    return sameBytes && !target.txtContentSha256 ? 'exact' : 'none'
  }
  if (sameBytes) return 'exact'
  if (book.format === 'pdf') {
    const sameDocument = norm(book.title) === norm(target.title) && norm(book.author) === norm(target.author)
    if (sameDocument && book.pageCount !== undefined && target.pageCount !== undefined && book.pageCount === target.pageCount) {
      return 'pdf-page-position'
    }
  }
  return 'none'
}

export interface PlanImportInput {
  file: AnnotationFile
  /** Annotations of the file that failed validation while parsing. */
  rejected: readonly RejectedAnnotation[]
  /** Content keys of the target's current annotations (`contentKeyOfNote`). */
  existingKeys: ReadonlySet<string>
  /** PDF targets: identity keys (`embeddedAnnotationIdentities`) of the annotations found in a scan of the target file. */
  scanKeys?: ReadonlySet<string>
  /** From `decidePlacement`. */
  placement: PlacementMode
  /** `pdf-page-position`: the target's page count. */
  targetPageCount?: number
  /** True when no row anywhere uses this id (a reused id of another book would be overwritten by the store's upsert). */
  isUsableId: (id: string) => boolean
}

/** The content key of a stored row (parsed `note_json`); null for a row without a location. */
export function contentKeyOfNote(note: INoteState): string | null {
  const locator = note.locatorExtended?.locator
  if (!locator) return null
  return contentKeyOf({
    type: note.type as TransferAnnotationType,
    locator,
    selectionText: note.locatorExtended?.text,
    note: typeof note.note === 'string' ? note.note : undefined,
    pdfAnnotation: note.pdfAnnotation as unknown as Record<string, unknown> | undefined,
    txtAnnotation: note.txtAnnotation as unknown as Record<string, unknown> | undefined,
    mdAnnotation: note.mdAnnotation as unknown as Record<string, unknown> | undefined,
  })
}

type Payloads = { pdfAnnotation?: PdfAnnotation; txtAnnotation?: TxtAnnotation; mdAnnotation?: MdAnnotation }

/** Re-validate the per-format payload with the parsers the stores use; a reason string when the annotation cannot be stored. */
function validatePayload(a: TransferAnnotation, format: AnnotationFile['book']['format']): { ok: true; payloads: Payloads } | { ok: false; reason: string } {
  if (format === 'epub') {
    if (a.locator.kind !== 'cfi') return { ok: false, reason: 'location does not belong to an EPUB' }
    return { ok: true, payloads: {} }
  }
  if (format === 'pdf') {
    const parsed = parsePdfAnnotation(a.pdfAnnotation, a.note)
    if (!parsed) return { ok: false, reason: 'invalid PDF annotation' }
    if (!isConsistentPdfHighlight(a.locator, parsed)) return { ok: false, reason: 'PDF location does not match its page' }
    return { ok: true, payloads: { pdfAnnotation: parsed } }
  }
  if (format === 'txt') {
    const parsed = parseTxtAnnotation(a.txtAnnotation)
    if (!parsed) return { ok: false, reason: 'invalid text range' }
    if (!isConsistentTxtHighlight(a.locator, parsed)) return { ok: false, reason: 'text location does not match its range' }
    return { ok: true, payloads: { txtAnnotation: parsed } }
  }
  const parsed = parseMdAnnotation(a.mdAnnotation)
  if (!parsed) return { ok: false, reason: 'invalid Markdown anchor' }
  if (!isConsistentMdHighlight(a.locator, parsed)) return { ok: false, reason: 'Markdown location does not match its anchor' }
  return { ok: true, payloads: { mdAnnotation: parsed } }
}

export function planImport(input: PlanImportInput): ImportPlan {
  const { file } = input
  const plan: ImportPlan = { toAdd: [], present: 0, notPlaced: input.rejected.map((r) => ({ type: r.type, quote: r.quote, reason: r.reason })) }
  const seen = new Set<string>(input.existingKeys)
  const usedIds = new Set<string>()

  for (const a of file.annotations) {
    if (input.placement === 'none') {
      plan.notPlaced.push({ type: a.type, quote: a.selectionText?.highlight, reason: 'different edition of the book' })
      continue
    }
    if (input.placement === 'pdf-page-position' && (a.locator.kind !== 'page-rect' || !input.targetPageCount || a.locator.page > input.targetPageCount)) {
      plan.notPlaced.push({ type: a.type, quote: a.selectionText?.highlight, reason: 'page is beyond the end of the target document' })
      continue
    }
    const checked = validatePayload(a, file.book.format)
    if (!checked.ok) {
      plan.notPlaced.push({ type: a.type, quote: a.selectionText?.highlight, reason: checked.reason })
      continue
    }
    const key = contentKeyOf({
      type: a.type,
      locator: a.locator,
      selectionText: a.selectionText,
      note: a.note,
      pdfAnnotation: checked.payloads.pdfAnnotation as unknown as Record<string, unknown> | undefined,
      txtAnnotation: checked.payloads.txtAnnotation as unknown as Record<string, unknown> | undefined,
      mdAnnotation: checked.payloads.mdAnnotation as unknown as Record<string, unknown> | undefined,
    })
    // Already in the book, or already seen earlier in this file.
    if (seen.has(key)) {
      plan.present += 1
      continue
    }
    // Read from the PDF by another reader and still in the target file: the sync keeps it, importing would duplicate it.
    if (a.origin === 'file' && a.sourceKeys?.some((k) => input.scanKeys?.has(k))) {
      plan.present += 1
      continue
    }
    seen.add(key)
    const reuse = !usedIds.has(a.sourceId) && input.isUsableId(a.sourceId)
    if (reuse) usedIds.add(a.sourceId)
    const add: PlannedAdd = {
      id: reuse ? a.sourceId : null,
      sourceId: a.sourceId,
      type: a.type,
      locator: a.locator,
      colorHex: a.colorHex,
      createdAt: a.createdAt,
      contentKey: key,
      ...checked.payloads,
    }
    if (a.selectionText) add.selectionText = a.selectionText
    if (a.note !== undefined) add.note = a.note
    if (a.tags) add.tags = a.tags
    plan.toAdd.push(add)
  }
  return plan
}

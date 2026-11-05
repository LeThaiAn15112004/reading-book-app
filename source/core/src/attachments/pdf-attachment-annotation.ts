/**
 * A file attachment Readmate places on a PDF page (FileAttachment annotation, `notes` row of style kind
 * `attachment`): its payload and icon geometry. Pure — no `fs` / `electron`; Main writes the file content into
 * the PDF. See specs/007-pdf-file-attachment/ (data-model.md §1, contracts/pdf-file-attachment.md).
 */
import { ATTACHMENT_MAX_BYTES, sanitizeAttachmentFileName } from './attachment-policy.js'

/** What the app keeps about a file embedded in the PDF (`pdfAnnotation.attachment`). The content is only in the PDF. */
export type PdfAttachmentInfo = {
  /** Sanitised file name (`sanitizeAttachmentFileName` output) — never a path. */
  name: string
  /** Uncompressed size actually written, 1 … `ATTACHMENT_MAX_BYTES`. */
  sizeBytes: number
  /** SHA-256 of the uncompressed content written, lowercase hex. */
  sha256: string
  /** Source file mtime at pick time (ISO 8601). */
  modifiedAt?: string
}

const SHA256_HEX = /^[0-9a-f]{64}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/** Validate an untrusted `pdfAnnotation.attachment` (renderer payload, stored JSON). Anything off → null. */
export function parsePdfAttachmentInfo(value: unknown): PdfAttachmentInfo | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.name !== 'string' || v.name.length === 0 || sanitizeAttachmentFileName(v.name) !== v.name) return null
  if (typeof v.sizeBytes !== 'number' || !Number.isInteger(v.sizeBytes) || v.sizeBytes < 1 || v.sizeBytes > ATTACHMENT_MAX_BYTES) return null
  if (typeof v.sha256 !== 'string' || !SHA256_HEX.test(v.sha256)) return null
  const info: PdfAttachmentInfo = { name: v.name, sizeBytes: v.sizeBytes, sha256: v.sha256 }
  if (v.modifiedAt !== undefined) {
    if (typeof v.modifiedAt !== 'string' || !ISO_DATE.test(v.modifiedAt) || Number.isNaN(Date.parse(v.modifiedAt))) return null
    info.modifiedAt = v.modifiedAt
  }
  return info
}

/** Side of the attachment icon in PDF units (the same size as a sticky-note icon). */
export const ATTACHMENT_ICON_PT = 20

/** A box normalised 0–1 to the displayed page (top-left origin, y down), like every PDF annotation rect. */
export type NormalizedBox = { x: number; y: number; width: number; height: number }

/**
 * The icon box for a click at `point` (normalised) on a page whose scale-1 viewport is `page.width` ×
 * `page.height` (PDF units, rotation and crop already applied): top-left at the click, 20 × 20 units, then
 * clamped inside the page (FR-010).
 */
export function attachmentIconBox(point: { x: number; y: number }, page: { width: number; height: number }): NormalizedBox {
  const width = Math.min(1, ATTACHMENT_ICON_PT / page.width)
  const height = Math.min(1, ATTACHMENT_ICON_PT / page.height)
  return clampAttachmentBox({ x: point.x, y: point.y, width, height })
}

/** Keep the box's size and move it wholly inside `[0,1]²`. */
export function clampAttachmentBox(box: NormalizedBox): NormalizedBox {
  const width = Math.min(1, Math.max(0, box.width))
  const height = Math.min(1, Math.max(0, box.height))
  const x = Math.min(1 - width, Math.max(0, Number.isFinite(box.x) ? box.x : 0))
  const y = Math.min(1 - height, Math.max(0, Number.isFinite(box.y) ? box.y : 0))
  return { x, y, width, height }
}

/** A size as people read it: bytes below 1 KB, then KB / MB with one decimal (1 MB = 1024 × 1024 bytes). */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A refused / failed attachments:create or attachments:change, as the renderer gets it (contracts §1–2). */
export type AttachFailure =
  | { code: 'cancelled' }
  | { code: 'blocked'; reason: string; signerName?: string }
  | { code: 'empty' | 'read_failed' | 'source_changed'; fileName?: string }
  | { code: 'too_large'; sizeBytes: number; limitBytes: number; fileName?: string }
  | { code: 'too_large_for_pdf'; sizeBytes: number; pdfSizeBytes: number; limitBytes: number; fileName?: string }
  | { code: 'write_failed'; errno?: string }
  | { code: 'verify_failed' | 'unsupported_pdf' | 'encrypted' | 'not_found' | 'not_editable' | 'invalid_request' | 'busy' }

const BLOCK_REASON_TEXT: Record<string, string> = {
  managed_copy: 'this PDF is a copy Readmate keeps itself (downloaded from a link or a cloud service), not your own file',
  read_only: 'the PDF file or its folder is read-only',
  encrypted: 'the PDF is encrypted',
  unsupported_pdf: 'the PDF’s structure does not allow adding to it safely',
  signed: 'the PDF is digitally signed',
  changed: 'another program changed the PDF meanwhile — try again',
}

/** What the refused operation was: the wording of a refusal follows it. */
export type AttachAction = 'attach' | 'move' | 'delete'

const ACTION_TEXT: Record<AttachAction, string> = { attach: 'add a file to this PDF', move: 'move this attachment', delete: 'delete this attachment' }
const NOTHING_DONE: Record<AttachAction, string> = { attach: 'Nothing was attached.', move: 'Nothing was moved.', delete: 'Nothing was deleted.' }

/** A size limit as people read it: whole megabytes without a decimal ("100 MB"), anything else like a file size. */
function formatLimit(bytes: number): string {
  return bytes % (1024 * 1024) === 0 ? `${bytes / (1024 * 1024)} MB` : formatAttachmentSize(bytes)
}

/**
 * What to tell the user about a refused or failed attach / move / delete (FR-011, FR-012, US4). Sizes have one
 * decimal ("150.2 MB — the limit is 100 MB"); the limit is Readmate's own choice and is worded as such, never as a
 * limit of PDF, Foxit or Acrobat. The refused file's name leads the message when it is known. Null for a cancelled
 * picker (nothing to say).
 */
export function describeAttachFailure(failure: AttachFailure, action: AttachAction = 'attach'): string | null {
  const named = (text: string, fileName?: string) => (fileName ? `“${fileName}” ${text}` : `This file ${text}`)
  const nothing = NOTHING_DONE[action]
  switch (failure.code) {
    case 'cancelled':
      return null
    case 'blocked':
      return `Readmate can’t ${ACTION_TEXT[action]}: ${BLOCK_REASON_TEXT[failure.reason] ?? 'the file cannot be written'}. ${nothing}`
    case 'empty':
      return named(`is empty (0 bytes), so there is nothing to attach. ${nothing}`, failure.fileName)
    case 'read_failed':
      return named(`could not be read (it may be locked, moved or not permitted). ${nothing}`, failure.fileName)
    case 'source_changed':
      return named(`changed while it was being read. ${nothing} Try again once it is no longer changing.`, failure.fileName)
    case 'too_large':
      return named(`is ${formatAttachmentSize(failure.sizeBytes)} — the limit is ${formatLimit(failure.limitBytes)}. ${nothing}`, failure.fileName)
    case 'too_large_for_pdf':
      return named(
        `is ${formatAttachmentSize(failure.sizeBytes)} and this PDF is ${formatAttachmentSize(failure.pdfSizeBytes)} — together they are over ${formatLimit(failure.limitBytes)}, the most Readmate writes into one PDF at a time. ${nothing}`,
        failure.fileName,
      )
    case 'write_failed':
      return failure.errno === 'ENOSPC' || failure.errno === 'EDQUOT'
        ? `There is not enough disk space to write the PDF. The PDF was not changed.`
        : `The PDF could not be written${failure.errno && failure.errno !== 'DB' ? ` (${failure.errno})` : ''}. The PDF was not changed.`
    case 'verify_failed':
      return 'The written PDF did not check out, so it was not kept. The PDF was not changed.'
    case 'unsupported_pdf':
      return `This PDF’s structure does not allow changing it safely. ${nothing}`
    case 'encrypted':
      return `This PDF is encrypted, so Readmate can’t ${ACTION_TEXT[action]}.`
    case 'not_found':
      return action === 'attach' ? 'The PDF could not be found.' : 'This attachment is no longer in the PDF.'
    case 'not_editable':
      return 'This attachment was made in another app; Readmate can open or save it, but not move or delete it.'
    case 'invalid_request':
    case 'busy':
      return `That did not work. ${nothing}`
  }
}

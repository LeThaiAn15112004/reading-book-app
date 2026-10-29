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

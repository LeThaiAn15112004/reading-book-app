/**
 * Read the files embedded in a PDF's bytes: document-level (the catalog's `/Names /EmbeddedFiles`
 * tree, `getAttachments()`) and page-level (`FileAttachment` annotations, `getAnnotations()`).
 * PDF.js (Node `legacy` build) does the parsing. Runs inside the scan worker thread
 * (pdf-sync/pdf-annotation-scan.worker.ts) so a large or hostile file never blocks Main; also
 * imported by the spikes. Must not import `electron`.
 *
 * Ordinary PDF resources (fonts, images, XObjects) are never listed — only these two embedded-file
 * records are attachments.
 */
import { createHash } from 'node:crypto'
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  buildAttachmentId,
  sanitizeAttachmentFileName,
  type AttachmentSource,
  type BookAttachment,
} from '@reading-book/book-reader-sdk'
import { loadPdfjs } from '../chunking/pdf-text'

export type PdfAttachmentListResult = {
  items: BookAttachment[]
  /** More than `ATTACHMENT_MAX_COUNT` files: the rest are not listed. */
  truncated: boolean
}

export type PdfAttachmentExtractResult =
  | { ok: true; name: string; content: Uint8Array }
  | { ok: false; code: 'not_found' | 'empty' | 'too_large' }

type RawFileSpec = { filename?: unknown; rawFilename?: unknown; description?: unknown; content?: unknown }

type FoundAttachment = {
  descriptor: BookAttachment
  /** Present only while extracting; the listing never carries the bytes. */
  content: Uint8Array | null
}

const DESCRIPTION_MAX_LENGTH = 500
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

function asBytes(value: unknown): Uint8Array | null {
  return value instanceof Uint8Array ? value : null
}

function cleanDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(CONTROL_CHARS, '').trim().slice(0, DESCRIPTION_MAX_LENGTH)
  return text || null
}

function describe(
  spec: RawFileSpec,
  source: AttachmentSource,
  page: number | null,
  ordinal: number,
): FoundAttachment {
  const content = asBytes(spec.content)
  // A missing record name falls back to the raw one, then to a generic name (never empty).
  const name = sanitizeAttachmentFileName(spec.filename || spec.rawFilename, 'attachment')
  const hash = createHash('sha256').update(content ?? new Uint8Array(0)).digest('hex')
  return {
    descriptor: {
      id: buildAttachmentId(source, page, ordinal, hash),
      name,
      size: content ? content.byteLength : null,
      description: cleanDescription(spec.description),
      page,
      source,
    },
    content,
  }
}

async function openDocument(bytes: Uint8Array) {
  const pdfjs = await loadPdfjs()
  // PDF.js detaches the buffer it is given and refuses Node Buffers: hand it a plain copy.
  return pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  })
}

/**
 * Every attachment, in a fixed order: document-level first (name-tree order), then page by page
 * (annotation order). `stopAt` ends the page scan early once that id is found (extraction).
 */
async function collect(
  bytes: Uint8Array,
  stopAt?: string,
): Promise<{ found: FoundAttachment[]; truncated: boolean }> {
  const task = await openDocument(bytes)
  const found: FoundAttachment[] = []
  let truncated = false
  const push = (entry: FoundAttachment): boolean => {
    if (found.length >= ATTACHMENT_MAX_COUNT) {
      truncated = true
      return false
    }
    found.push(entry)
    return true
  }
  try {
    const doc = await task.promise
    const documentLevel: unknown = await doc.getAttachments()
    if (documentLevel && typeof documentLevel === 'object') {
      let ordinal = 0
      for (const spec of Object.values(documentLevel as Record<string, RawFileSpec>)) {
        if (!spec || typeof spec !== 'object') continue
        if (!push(describe(spec, 'document', null, ordinal++))) break
        if (stopAt && found[found.length - 1]!.descriptor.id === stopAt) return { found, truncated }
      }
    }
    for (let pageNumber = 1; pageNumber <= doc.numPages && !truncated; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      let ordinal = 0
      try {
        const annotations = (await page.getAnnotations({ intent: 'any' })) as Array<{
          subtype?: string
          file?: RawFileSpec
        }>
        for (const annotation of annotations) {
          if (annotation.subtype !== 'FileAttachment' || !annotation.file || typeof annotation.file !== 'object') continue
          if (!push(describe(annotation.file, 'page', pageNumber, ordinal++))) break
          if (stopAt && found[found.length - 1]!.descriptor.id === stopAt) return { found, truncated }
        }
      } finally {
        page.cleanup()
      }
    }
    return { found, truncated }
  } finally {
    await task.destroy()
  }
}

/** Descriptors only — the bytes stay in the worker. */
export async function listPdfAttachmentBytes(bytes: Uint8Array): Promise<PdfAttachmentListResult> {
  const { found, truncated } = await collect(bytes)
  return { items: found.map((entry) => entry.descriptor), truncated }
}

/**
 * The bytes of the attachment `id` in THIS file, or why not. The id is looked up in the file's own
 * records (never trusted as a position or path); the size limit is applied to the real data.
 */
export async function extractPdfAttachmentBytes(bytes: Uint8Array, id: string): Promise<PdfAttachmentExtractResult> {
  const { found } = await collect(bytes, id)
  const match = found.find((entry) => entry.descriptor.id === id)
  if (!match) return { ok: false, code: 'not_found' }
  const content = match.content
  if (!content || content.byteLength === 0) return { ok: false, code: 'empty' }
  if (content.byteLength > ATTACHMENT_MAX_BYTES) return { ok: false, code: 'too_large' }
  return { ok: true, name: match.descriptor.name, content: content.slice() }
}

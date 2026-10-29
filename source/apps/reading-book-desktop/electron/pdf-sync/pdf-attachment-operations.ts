/**
 * The file-attachment operations behind attachments:create / attachments:change (specs/007-pdf-file-attachment
 * contracts §1–2): every step that touches the book's PDF runs in the live sync's per-book slot, the write is the
 * streamed + verified one of pdf-attachment-writer.ts, and the `notes` row is written only once the file holds the
 * attachment. Dependencies are injected so the spikes drive the real logic on temp files without Electron.
 */
import { createHash, randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  READMATE_PDF_AUTHOR,
  attachmentIconBox,
  checkAttachSize,
  packPdfHighlightLocator,
  sanitizeAttachmentFileName,
  type HighlightRecord,
  type NoteLocator,
  type PdfAnnotation,
  type SaveHighlightInput,
} from '@reading-book/book-reader-sdk'
import type { AttachmentVerifyExpectation, AttachmentVerifyResult, PdfAnnotationScanResult } from './pdf-annotation-scan'
import { AttachmentVerifyError, StagedContentChangedError, TargetChangedError, stageAttachmentSource, writeAttachmentUpdate } from './pdf-attachment-writer'
import type { AttachmentAnnotationSpec, AttachmentFileSpec, AttachmentUpdatePlan, PageGeometry } from './pdf-incremental-writer'
import type { FileOperationOutcome } from './pdf-annotation-sync-service'
import type { WriteEligibility } from './pdf-write-eligibility'

/** Icon frame colour of a new attachment (no colour picker in this version). */
export const ATTACHMENT_ICON_COLOR = '#1E88E5'

export type CreateAttachmentRequest = { bookId: string; pageIndex: number; point: { x: number; y: number } }

export type BlockReason = Exclude<WriteEligibility, { ok: true }>['reason'] | 'changed'

export type CreateAttachmentResult =
  | { ok: true; highlight: HighlightRecord }
  | { ok: false; code: 'cancelled' }
  | { ok: false; code: 'blocked'; reason: BlockReason; signerName?: string }
  | { ok: false; code: 'empty' | 'read_failed' | 'source_changed'; fileName?: string }
  | { ok: false; code: 'too_large'; sizeBytes: number; limitBytes: number; fileName?: string }
  | { ok: false; code: 'too_large_for_pdf'; sizeBytes: number; pdfSizeBytes: number; limitBytes: number; fileName?: string }
  | { ok: false; code: 'write_failed'; errno?: string }
  | { ok: false; code: 'verify_failed' | 'unsupported_pdf' | 'encrypted' | 'not_found' | 'invalid_request' | 'busy' }

export type AttachmentOperationDeps = {
  /** The book's validated PDF path (`resolveBookFile`, PDF only), or null. */
  resolvePdfPath: (bookId: string) => Promise<string | null>
  /** `runFileOperation` of the live sync (research R5). */
  runFileOperation: <T>(bookId: string, op: (context: { allowSigned: boolean }) => Promise<FileOperationOutcome<T>>) => Promise<T>
  checkWritable: (filePath: string, bytes: Uint8Array, allowSigned: boolean) => Promise<WriteEligibility>
  /** Main-owned open dialog (one file). Null when cancelled. */
  chooseFile: () => Promise<string | null>
  /** The scan worker's `scan`, `attachment-plan` and `attachment-verify`. */
  scan: (bytes: Uint8Array) => Promise<PdfAnnotationScanResult>
  plan: (bytes: Uint8Array, page: PageGeometry, annotation: AttachmentAnnotationSpec, file: AttachmentFileSpec) => Promise<AttachmentUpdatePlan>
  verify: (bytes: Uint8Array, expect: AttachmentVerifyExpectation) => Promise<AttachmentVerifyResult>
  /** `SqliteOverlayStore.writeHighlight`. */
  saveRow: (input: SaveHighlightInput) => HighlightRecord
  stagingRoot: string
  log?: (message: string, detail?: unknown) => void
}

const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function errnoOf(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : undefined
}

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex)
  return m ? [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255] : [0.12, 0.53, 0.9]
}

function isPoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false
  const { x, y } = value as Record<string, unknown>
  return typeof x === 'number' && typeof y === 'number' && x >= 0 && x <= 1 && y >= 0 && y <= 1
}

/** Validate an untrusted attachments:create payload. */
export function parseCreateAttachmentRequest(input: unknown): CreateAttachmentRequest | null {
  if (!input || typeof input !== 'object') return null
  const v = input as Record<string, unknown>
  if (typeof v.bookId !== 'string' || !v.bookId.trim()) return null
  if (typeof v.pageIndex !== 'number' || !Number.isInteger(v.pageIndex) || v.pageIndex < 0) return null
  if (!isPoint(v.point)) return null
  return { bookId: v.bookId.trim(), pageIndex: v.pageIndex, point: { x: v.point.x, y: v.point.y } }
}

/** A failed worker / writer step → the result the renderer gets. */
function writeFailure(err: unknown): CreateAttachmentResult {
  if (err instanceof AttachmentVerifyError) return { ok: false, code: 'verify_failed' }
  if (err instanceof TargetChangedError) return { ok: false, code: 'blocked', reason: 'changed' }
  if (err instanceof StagedContentChangedError) return { ok: false, code: 'read_failed' }
  const code = errnoOf(err)
  if (code === 'encrypted' || code === 'unsupported_pdf') return { ok: false, code }
  return { ok: false, code: 'write_failed', errno: code }
}

/**
 * attachments:create (contracts §1). Order: payload → book → write check (the picker is NOT opened when the file
 * cannot be written) → picker (outside the slot: the live sync is not held while the user browses) → stage the
 * file (size checked before it is read) → in the slot again: write check, scan, plan, streamed write, read-back of
 * the temp file, rename → the `notes` row. Nothing in the file or SQLite changes on any failure.
 */
export async function createPdfAttachment(deps: AttachmentOperationDeps, input: unknown): Promise<CreateAttachmentResult> {
  const request = parseCreateAttachmentRequest(input)
  if (!request) return { ok: false, code: 'invalid_request' }
  const filePath = await deps.resolvePdfPath(request.bookId)
  if (!filePath) return { ok: false, code: 'not_found' }

  // 1. May this file be written at all? Asked before the picker opens (FR-012).
  const precheck = await deps.runFileOperation<CreateAttachmentResult | { ok: true; pdfSize: number }>(request.bookId, async ({ allowSigned }) => {
    const bytes = new Uint8Array(await fsp.readFile(filePath))
    const eligibility = await deps.checkWritable(filePath, bytes, allowSigned)
    if (!eligibility.ok) return { result: { ok: false, code: 'blocked', reason: eligibility.reason, ...(eligibility.signerName ? { signerName: eligibility.signerName } : {}) } }
    return { result: { ok: true, pdfSize: bytes.length } }
  })
  if (!precheck.ok) return precheck
  if (!('pdfSize' in precheck)) return { ok: false, code: 'invalid_request' }

  // 2. The user picks the file.
  const sourcePath = await deps.chooseFile()
  if (!sourcePath) return { ok: false, code: 'cancelled' }
  const fileName = sanitizeAttachmentFileName(path.basename(sourcePath), 'attachment')

  // 3. Stage it: size checked before it is read, content hashed, a change while reading refused.
  const staged = await stageAttachmentSource(sourcePath, deps.stagingRoot, { pdfSizeBytes: precheck.pdfSize })
  if (!staged.ok) return { ...staged, fileName }
  try {
    return await deps.runFileOperation<CreateAttachmentResult>(request.bookId, async ({ allowSigned }) => {
      const bytes = new Uint8Array(await fsp.readFile(filePath))
      const eligibility = await deps.checkWritable(filePath, bytes, allowSigned)
      if (!eligibility.ok) return { result: { ok: false, code: 'blocked', reason: eligibility.reason, ...(eligibility.signerName ? { signerName: eligibility.signerName } : {}) } }
      const size = checkAttachSize(staged.staged.sizeBytes, bytes.length)
      if (!size.ok) return { result: { ...size, fileName } }

      let scanned: PdfAnnotationScanResult
      try {
        scanned = await deps.scan(bytes)
      } catch (err) {
        deps.log?.('[attachments] the PDF could not be read before attaching', err)
        return { result: { ok: false, code: 'unsupported_pdf' } }
      }
      const page = scanned.pages.find((p) => p.pageIndex === request.pageIndex)
      if (!page) return { result: { ok: false, code: 'invalid_request' } }

      const rowId = randomUUID()
      const now = new Date().toISOString()
      const box = attachmentIconBox(request.point, page)
      const annotationSpec: AttachmentAnnotationSpec = {
        nm: `readmate:${rowId}`,
        pageIndex: request.pageIndex,
        box,
        color: rgb(ATTACHMENT_ICON_COLOR),
        author: READMATE_PDF_AUTHOR,
        contents: fileName,
        createdAt: now,
        modifiedAt: now,
      }
      const fileSpec: AttachmentFileSpec = { name: fileName, sizeBytes: staged.staged.sizeBytes, md5Hex: staged.staged.md5Hex, modifiedAt: staged.staged.modifiedAt }
      let newFile: { sha256: string; sizeBytes: number } | null = null
      try {
        const plan = await deps.plan(bytes, page, annotationSpec, fileSpec)
        const keepIds = [...scanned.items.map((i) => i.objectId), ...scanned.pageAttachments.map((a) => a.objectId)]
        await writeAttachmentUpdate({
          target: filePath,
          bytes,
          bytesSha256: sha256Hex(bytes),
          plan,
          content: { stagedPath: staged.staged.stagedPath, sha256: staged.staged.sha256 },
          verify: async (tempPath) => {
            const written = new Uint8Array(await fsp.readFile(tempPath))
            const verdict = await deps.verify(written, {
              annotationId: `${plan.annotationRef.num}R`,
              pageIndex: request.pageIndex,
              present: { rect: plan.rect, sha256: staged.staged.sha256 },
              keepIds,
            })
            if (!verdict.ok) return verdict.detail
            newFile = { sha256: sha256Hex(written), sizeBytes: written.length }
            return null
          },
        })
      } catch (err) {
        deps.log?.('[attachments] the attachment was not written; the PDF is unchanged', err)
        return { result: writeFailure(err) }
      }

      // 4. The file holds it: now the row (no ledger entry — the next sync cycle links it, research R7).
      const pdfAnnotation: PdfAnnotation = {
        pageIndex: request.pageIndex,
        rects: [{ pageIndex: request.pageIndex, ...box }],
        attachment: { name: fileName, sizeBytes: staged.staged.sizeBytes, sha256: staged.staged.sha256, modifiedAt: staged.staged.modifiedAt },
      }
      try {
        const highlight = deps.saveRow({
          id: rowId,
          bookId: request.bookId,
          locator: JSON.parse(packPdfHighlightLocator(pdfAnnotation)) as NoteLocator,
          styleKind: 'attachment',
          colorHex: ATTACHMENT_ICON_COLOR,
          tags: [],
          pdfAnnotation,
          createdAt: now,
        })
        return { result: { ok: true, highlight }, newFile: newFile ?? undefined }
      } catch (err) {
        // The file has it; the next sync cycle imports it as a row (a `readmate:` attachment without a row).
        deps.log?.('[attachments] written into the PDF but the row could not be saved; the next sync imports it', err)
        return { result: { ok: false, code: 'write_failed', errno: 'DB' }, newFile: newFile ?? undefined }
      }
    })
  } finally {
    await staged.staged.cleanup()
  }
}

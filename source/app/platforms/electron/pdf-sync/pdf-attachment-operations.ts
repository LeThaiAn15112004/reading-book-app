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
import { AttachmentVerifyError, StagedContentChangedError, TargetChangedError, stageAttachmentSource, writeAttachmentChange, writeAttachmentUpdate } from './pdf-attachment-writer'
import {
  attachmentRectFor,
  type AttachmentAnnotationSpec,
  type AttachmentChange,
  type AttachmentFileSpec,
  type AttachmentUpdatePlan,
  type PageGeometry,
} from './pdf-incremental-writer'
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

export type ChangeAttachmentRequest =
  | { bookId: string; rowId: string; op: 'move'; rect: { x: number; y: number; width: number; height: number } }
  | { bookId: string; rowId: string; op: 'delete' }

export type ChangeAttachmentResult =
  | { ok: true; highlight?: HighlightRecord }
  | { ok: false; code: 'blocked'; reason: BlockReason; signerName?: string }
  | { ok: false; code: 'write_failed'; errno?: string }
  | { ok: false; code: 'not_found' | 'not_editable' | 'verify_failed' | 'unsupported_pdf' | 'encrypted' | 'invalid_request' }

export type AttachmentChangeDeps = Pick<AttachmentOperationDeps, 'resolvePdfPath' | 'runFileOperation' | 'checkWritable' | 'scan' | 'verify' | 'log'> & {
  /** The worker's `attachment-change`: `bytes` + the move / delete update. */
  change: (bytes: Uint8Array, page: PageGeometry, change: AttachmentChange) => Promise<Uint8Array>
  /** `SqliteOverlayStore.getAttachmentRow`: the row when it is a file-attachment row of the book. */
  getRow: (bookId: string, rowId: string) => HighlightRecord | undefined
  /** Is `rowId` an annotation row of the book of another kind (→ `not_editable`)? */
  isOtherRow: (bookId: string, rowId: string) => boolean
  /** `SqliteOverlayStore.commitAttachmentChange`: ONE transaction. */
  commit: (bookId: string, rowId: string, change: { op: 'move'; input: SaveHighlightInput } | { op: 'delete' }) => HighlightRecord | null
}

const ROW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SIZE_TOLERANCE = 1e-6

function isBox(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== 'object') return false
  const { x, y, width, height } = value as Record<string, unknown>
  return [x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))
}

/** Validate an untrusted attachments:change payload. Another reader's attachment id (`page-…` / `doc-…`) → `{ foreign }`. */
export function parseChangeAttachmentRequest(input: unknown): ChangeAttachmentRequest | { foreign: true } | null {
  if (!input || typeof input !== 'object') return null
  const v = input as Record<string, unknown>
  if (typeof v.bookId !== 'string' || !v.bookId.trim() || typeof v.rowId !== 'string') return null
  if (!ROW_ID.test(v.rowId)) return /^(page|doc)-[0-9a-z-]+$/.test(v.rowId) ? { foreign: true } : null
  const base = { bookId: v.bookId.trim(), rowId: v.rowId }
  if (v.op === 'delete') return { ...base, op: 'delete' }
  if (v.op === 'move' && isBox(v.rect)) return { ...base, op: 'move', rect: { x: v.rect.x, y: v.rect.y, width: v.rect.width, height: v.rect.height } }
  return null
}

/**
 * attachments:change (contracts §2): move or delete a Readmate-made file attachment. Only rows of kind
 * `attachment` whose `/NM readmate:<rowId>` is in the current file qualify. Inside the live sync's slot: write
 * check → scan → the update (same object number on a move, `/Annots` on a delete) → temp file, read back, target
 * re-checked → rename → ONE transaction on the row. Nothing in the file or SQLite changes on any failure; the
 * delete confirmation is the renderer's.
 */
export async function changePdfAttachment(deps: AttachmentChangeDeps, input: unknown): Promise<ChangeAttachmentResult> {
  const request = parseChangeAttachmentRequest(input)
  if (!request) return { ok: false, code: 'invalid_request' }
  if ('foreign' in request) return { ok: false, code: 'not_editable' }
  const filePath = await deps.resolvePdfPath(request.bookId)
  if (!filePath) return { ok: false, code: 'not_found' }
  const row = deps.getRow(request.bookId, request.rowId)
  if (!row) return { ok: false, code: deps.isOtherRow(request.bookId, request.rowId) ? 'not_editable' : 'not_found' }
  const stored = row.pdfAnnotation?.rects[0]
  const info = row.pdfAnnotation?.attachment
  if (!row.pdfAnnotation || !stored || !info) return { ok: false, code: 'not_found' }
  const rowAnnotation = row.pdfAnnotation
  if (request.op === 'move') {
    const r = request.rect
    const sameSize = Math.abs(r.width - stored.width) <= SIZE_TOLERANCE && Math.abs(r.height - stored.height) <= SIZE_TOLERANCE
    const inside = r.x >= -SIZE_TOLERANCE && r.y >= -SIZE_TOLERANCE && r.x + r.width <= 1 + SIZE_TOLERANCE && r.y + r.height <= 1 + SIZE_TOLERANCE
    if (!sameSize || !inside) return { ok: false, code: 'invalid_request' }
  }

  return deps.runFileOperation<ChangeAttachmentResult>(request.bookId, async ({ allowSigned }) => {
    const bytes = new Uint8Array(await fsp.readFile(filePath))
    const eligibility = await deps.checkWritable(filePath, bytes, allowSigned)
    if (!eligibility.ok) return { result: { ok: false, code: 'blocked', reason: eligibility.reason, ...(eligibility.signerName ? { signerName: eligibility.signerName } : {}) } }
    let scanned: PdfAnnotationScanResult
    try {
      scanned = await deps.scan(bytes)
    } catch (err) {
      deps.log?.('[attachments] the PDF could not be read before changing an attachment', err)
      return { result: { ok: false, code: 'unsupported_pdf' } }
    }
    const item = scanned.items.find((i) => i.subtype === 'FileAttachment' && i.nm === `readmate:${request.rowId}`)
    if (!item) return { result: { ok: false, code: 'not_found' } }
    const page = scanned.pages.find((p) => p.pageIndex === item.pageIndex)
    if (!page) return { result: { ok: false, code: 'unsupported_pdf' } }

    const annotation: AttachmentAnnotationSpec | null =
      request.op === 'move'
        ? {
            nm: `readmate:${request.rowId}`,
            pageIndex: item.pageIndex,
            box: request.rect,
            color: rgb(row.colorHex || ATTACHMENT_ICON_COLOR),
            author: READMATE_PDF_AUTHOR,
            contents: info.name,
            createdAt: row.createdAt,
            modifiedAt: new Date().toISOString(),
          }
        : null
    const change: AttachmentChange = annotation
      ? { op: 'move', objectId: item.objectId, annotation }
      : { op: 'delete', objectId: item.objectId, pageIndex: item.pageIndex }
    const everything = [...scanned.items.map((i) => i.objectId), ...scanned.pageAttachments.map((a) => a.objectId)]
    let newFile: { sha256: string; sizeBytes: number } | null = null
    try {
      const next = await deps.change(bytes, page, change)
      await writeAttachmentChange({
        target: filePath,
        bytes,
        bytesSha256: sha256Hex(bytes),
        next,
        verify: async (tempPath) => {
          const written = new Uint8Array(await fsp.readFile(tempPath))
          const verdict = await deps.verify(written, {
            annotationId: item.objectId,
            pageIndex: item.pageIndex,
            ...(annotation ? { present: { rect: attachmentRectFor(annotation, page), sha256: info.sha256 } } : {}),
            keepIds: annotation ? everything : everything.filter((id) => id !== item.objectId),
          })
          if (!verdict.ok) return verdict.detail
          newFile = { sha256: sha256Hex(written), sizeBytes: written.length }
          return null
        },
      })
    } catch (err) {
      deps.log?.(`[attachments] the attachment was not ${annotation ? 'moved' : 'deleted'}; the PDF is unchanged`, err)
      return { result: writeFailure(err) as ChangeAttachmentResult }
    }

    try {
      if (!annotation) {
        deps.commit(request.bookId, request.rowId, { op: 'delete' })
        return { result: { ok: true }, newFile: newFile ?? undefined }
      }
      const pdfAnnotation: PdfAnnotation = { ...rowAnnotation, rects: [{ pageIndex: item.pageIndex, ...annotation.box }] }
      const highlight = deps.commit(request.bookId, request.rowId, {
        op: 'move',
        input: {
          id: request.rowId,
          bookId: request.bookId,
          locator: JSON.parse(packPdfHighlightLocator(pdfAnnotation)) as NoteLocator,
          styleKind: 'attachment',
          colorHex: row.colorHex,
          tags: row.tags,
          pdfAnnotation,
          createdAt: row.createdAt,
        },
      })
      return { result: highlight ? { ok: true, highlight } : { ok: true }, newFile: newFile ?? undefined }
    } catch (err) {
      // The file has the change; the next sync cycle brings the row in line (the file is authoritative, research R7).
      deps.log?.('[attachments] the PDF was changed but the row could not be updated; the next sync follows the file', err)
      return { result: { ok: false, code: 'write_failed', errno: 'DB' }, newFile: newFile ?? undefined }
    }
  })
}

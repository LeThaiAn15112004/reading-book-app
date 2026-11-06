import fsp from 'node:fs/promises'
import { ipcMain } from 'electron'
import { parsePdfGraphicOp } from '@reading-book/book-reader-sdk'
import { bookFileStorage, resolveBookFile } from '../files/sandbox'
import { writeFileSafely } from '../pdf-sync/pdf-annotation-export'
import { sha256Hex } from '../pdf-sync/pdf-annotation-sync-service'
import type { PdfGraphicEditResult, PdfGraphicListResult } from '../pdf-sync/pdf-graphics'
import { checkPdfWritable } from '../pdf-sync/pdf-write-eligibility'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { verifyPdf } from '../signature/signature-service'
import type { ApplyPdfGraphicResult, ListPdfGraphicsResult, PdfGraphicFailureCodeDto } from './api-types'
import { GraphicsChannels } from './channels'
import { runInScanWorker } from './overlay.ipc'

async function pdfPathOf(bookId: string): Promise<string | null> {
  const book = await getLibraryStore().findById(bookId)
  if (!book || book.format !== 'pdf') return null
  const file = await resolveBookFile(book)
  return file.ok ? file.path : null
}

const WORKER_CODES: readonly PdfGraphicFailureCodeDto[] = ['not_found', 'not_allowed', 'verify_failed', 'encrypted', 'unsupported_pdf']

function failureCodeOf(err: unknown): PdfGraphicFailureCodeDto {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
  return (WORKER_CODES as readonly string[]).includes(code) ? (code as PdfGraphicFailureCodeDto) : 'failed'
}

/**
 * Handlers for graphics:* — the graphic objects inside a PDF (not made by this app) and their edits. The
 * renderer only ever sends a book id, an object id and a validated op; Main re-checks that the file may be
 * written (user-owned, writable, unencrypted, unsigned), that the object still allows the op, and that the
 * file did not change meanwhile — then appends one incremental update and verifies the read-back.
 */
export function registerGraphicsIpc(): void {
  ipcMain.removeHandler(GraphicsChannels.list)
  ipcMain.handle(GraphicsChannels.list, async (_event, bookId: unknown): Promise<ListPdfGraphicsResult> => {
    void _event
    if (typeof bookId !== 'string' || !bookId.trim()) return { ok: false, errorCode: 'not_found' }
    const filePath = await pdfPathOf(bookId.trim())
    if (!filePath) return { ok: false, errorCode: 'not_found' }
    try {
      const bytes = new Uint8Array(await fsp.readFile(filePath))
      const result = await runInScanWorker<PdfGraphicListResult>({ kind: 'graphics-list', bytes })
      return { ok: true, objects: result.objects, complete: result.complete }
    } catch {
      return { ok: false, errorCode: 'failed' }
    }
  })

  ipcMain.removeHandler(GraphicsChannels.apply)
  ipcMain.handle(GraphicsChannels.apply, async (_event, input: unknown): Promise<ApplyPdfGraphicResult> => {
    void _event
    const { bookId, objectId, op: rawOp } = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    const op = parsePdfGraphicOp(rawOp)
    if (typeof bookId !== 'string' || !bookId.trim() || typeof objectId !== 'string' || !objectId || objectId.length > 64 || !op) {
      return { ok: false, errorCode: 'not_allowed' }
    }
    const id = bookId.trim()
    const filePath = await pdfPathOf(id)
    if (!filePath) return { ok: false, errorCode: 'not_found' }

    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await fsp.readFile(filePath))
    } catch {
      return { ok: false, errorCode: 'failed' }
    }
    const sha = sha256Hex(bytes)
    const eligibility = await checkPdfWritable({
      filePath,
      bytes,
      isReferenced: (p) => bookFileStorage(p) === 'referenced',
      verifySignature: verifyPdf,
      allowSigned: false,
    })
    if (!eligibility.ok) return { ok: false, errorCode: eligibility.reason, signerName: eligibility.signerName }

    let edited: PdfGraphicEditResult
    try {
      edited = await runInScanWorker<PdfGraphicEditResult>({ kind: 'graphic-edit', bytes, objectId, op })
    } catch (err) {
      console.warn('[graphics] the edit could not be prepared; the file is untouched', err)
      return { ok: false, errorCode: failureCodeOf(err) }
    }

    // The file must still be exactly the version the edit was made from.
    try {
      const current = new Uint8Array(await fsp.readFile(filePath))
      if (sha256Hex(current) !== sha) return { ok: false, errorCode: 'changed' }
      await writeFileSafely(filePath, edited.output)
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
      return { ok: false, errorCode: code === 'EBUSY' || code === 'EPERM' ? 'locked' : code === 'EACCES' || code === 'EROFS' ? 'read_only' : 'failed' }
    }
    const newSha = sha256Hex(edited.output)
    try {
      getLibraryStore().updateFileFingerprint(id, newSha, edited.output.length)
    } catch (err) {
      console.warn('[graphics] could not record the file version', err)
    }
    return { ok: true, objects: edited.objects, sha256: newSha }
  })
}

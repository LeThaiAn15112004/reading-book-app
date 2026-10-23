/**
 * List / open / save the files embedded in a book's PDF. Every Electron or OS dependency is injected
 * (`AttachmentServiceDeps`), so the same code runs in the app and in the Main spike
 * (spikes/attachments) with a mocked OS opener and save dialog. Must not import `electron`.
 *
 * Trust: the renderer only names a `bookId` and an `attachmentId`. The PDF is found through the
 * library (`resolvePdf`), its bytes are read here, and the attachment is looked up in THOSE bytes —
 * nothing the renderer sends is a path, a name or content. The PDF itself is only ever read.
 * See docs/implementation_plan/pdf_attachments.md.
 */
import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  checkAttachmentSize,
  classifyAttachment,
  describeAttachmentBlock,
  isAttachmentId,
  sanitizeAttachmentFileName,
  type BookAttachment,
} from '@reading-book/book-reader-sdk'
import type { PdfAttachmentExtractResult, PdfAttachmentListResult } from './pdf-attachments'

export type AttachmentErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'attachment_not_found'
  | 'missing_file'
  | 'read_failed'
  | 'extract_failed'
  | 'empty'
  | 'too_large'
  | 'blocked'
  | 'write_failed'
  | 'access_denied'
  | 'open_failed'
  | 'busy'
  | 'canceled'

export type AttachmentFailure = {
  ok: false
  errorCode: AttachmentErrorCode
  errorMessage: string
  /** The attachment's sanitised name, when it was resolved before the failure. */
  fileName?: string
}

export type ListAttachmentsOutcome =
  | { ok: true; items: BookAttachment[]; truncated: boolean }
  | AttachmentFailure

export type AttachmentActionOutcome = { ok: true; fileName: string } | AttachmentFailure

export type AttachmentServiceDeps = {
  /** The book's PDF file, or why not (library lookup + `resolveBookFile`). Non-PDF books are `not_found`. */
  resolvePdf(bookId: string): Promise<{ ok: true; path: string } | { ok: false; code: 'not_found' | 'missing_file' | 'read_failed' }>
  readFile(filePath: string): Promise<Uint8Array>
  list(bytes: Uint8Array): Promise<PdfAttachmentListResult>
  extract(bytes: Uint8Array, attachmentId: string): Promise<PdfAttachmentExtractResult>
  /** Main-owned directory for files handed to the OS; created on demand. */
  tempRoot: string
  /** Electron's `shell.openPath`: '' on success, else an error message. */
  openPath(filePath: string): Promise<string>
  /** Native save dialog (Main-owned); null when the user cancels. */
  chooseSaveTarget(suggestedName: string): Promise<string | null>
  /** True for a Save As target that must not be written (inside app data, or the book's own file). */
  isForbiddenTarget(target: string, pdfPath: string): boolean
}

const MAX_ID_LENGTH = 200

function fail(errorCode: AttachmentErrorCode, errorMessage: string, fileName?: string): AttachmentFailure {
  return fileName ? { ok: false, errorCode, errorMessage, fileName } : { ok: false, errorCode, errorMessage }
}

function errnoOf(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : undefined
}

function describeWriteError(err: unknown, fileName: string): AttachmentFailure {
  const code = errnoOf(err)
  if (code === 'EACCES' || code === 'EPERM') {
    return fail('access_denied', 'Readmate was not allowed to write there. Choose another location.', fileName)
  }
  if (code === 'ENOSPC') return fail('write_failed', 'There is not enough free disk space to save this file.', fileName)
  return fail('write_failed', 'The file could not be written.', fileName)
}

/** `dir` is a directory Main just created; the file must be a direct child with exactly `name`. */
function assertDirectChild(dir: string, file: string, name: string): void {
  const relative = path.relative(dir, file)
  if (relative !== name || path.isAbsolute(relative) || path.dirname(file) !== dir) {
    throw new Error('attachment path escaped its directory')
  }
}

export function createAttachmentService(deps: AttachmentServiceDeps) {
  const inFlight = new Set<string>()

  async function readPdf(bookId: unknown): Promise<
    { ok: true; id: string; path: string; bytes: Uint8Array } | AttachmentFailure
  > {
    if (typeof bookId !== 'string' || !bookId.trim() || bookId.length > MAX_ID_LENGTH) {
      return fail('invalid_request', 'Invalid request.')
    }
    const id = bookId.trim()
    const source = await deps.resolvePdf(id)
    if (!source.ok) {
      if (source.code === 'missing_file') {
        return fail('missing_file', 'The book file could not be found. It may have been moved, renamed, or deleted.')
      }
      if (source.code === 'read_failed') return fail('read_failed', 'Could not read the book file.')
      return fail('not_found', 'Book not found.')
    }
    try {
      return { ok: true, id, path: source.path, bytes: await deps.readFile(source.path) }
    } catch {
      return fail('read_failed', 'Could not read the book file.')
    }
  }

  /** Validate ids, read the PDF, and pull the one attachment out of those bytes. */
  async function loadAttachment(
    bookId: unknown,
    attachmentId: unknown,
  ): Promise<{ ok: true; pdfPath: string; name: string; content: Uint8Array } | AttachmentFailure> {
    if (!isAttachmentId(attachmentId)) return fail('invalid_request', 'Invalid request.')
    const pdf = await readPdf(bookId)
    if (!pdf.ok) return pdf
    let extracted: PdfAttachmentExtractResult
    try {
      extracted = await deps.extract(pdf.bytes, attachmentId)
    } catch {
      return fail('extract_failed', 'The attachment could not be extracted from this PDF.')
    }
    if (!extracted.ok) {
      switch (extracted.code) {
        case 'not_found':
          return fail('attachment_not_found', 'This attachment is no longer in the PDF.')
        case 'empty':
          return fail('empty', 'This attachment is empty.')
        case 'too_large':
          return fail('too_large', 'This attachment is larger than the 100 MB limit.')
      }
    }
    // The worker already applied the limit; the bytes that actually arrived are checked again here.
    const size = checkAttachmentSize(extracted.content.byteLength)
    if (!size.ok) {
      return size.reason === 'empty'
        ? fail('empty', 'This attachment is empty.')
        : fail('too_large', 'This attachment is larger than the 100 MB limit.')
    }
    return { ok: true, pdfPath: pdf.path, name: sanitizeAttachmentFileName(extracted.name), content: extracted.content }
  }

  /** One open / save per (book, attachment) at a time — a second request while one runs is refused. */
  async function exclusive<T extends AttachmentActionOutcome>(
    key: string,
    run: () => Promise<T>,
  ): Promise<T | AttachmentFailure> {
    if (inFlight.has(key)) return fail('busy', 'This attachment is already being opened.')
    inFlight.add(key)
    try {
      return await run()
    } finally {
      inFlight.delete(key)
    }
  }

  return {
    async list(bookId: unknown): Promise<ListAttachmentsOutcome> {
      const pdf = await readPdf(bookId)
      if (!pdf.ok) return pdf
      try {
        const { items, truncated } = await deps.list(pdf.bytes)
        return { ok: true, items, truncated }
      } catch {
        return fail('extract_failed', 'The attachments of this PDF could not be read.')
      }
    },

    /**
     * Extract → policy → temp file → OS. A prohibited file is refused before anything is written
     * (`blocked`); Save As is a separate call.
     */
    open(bookId: unknown, attachmentId: unknown): Promise<AttachmentActionOutcome> {
      return exclusive(`open:${String(bookId)}:${String(attachmentId)}`, async () => {
        const loaded = await loadAttachment(bookId, attachmentId)
        if (!loaded.ok) return loaded
        const { name, content } = loaded

        const verdict = classifyAttachment(name, content.subarray(0, 64))
        if (!verdict.open) return fail('blocked', describeAttachmentBlock(verdict.reason), name)

        // A fresh directory per open: no collisions between same-named files, and the file keeps its
        // own (sanitised) name for the application that opens it.
        const dir = path.join(deps.tempRoot, randomUUID())
        const file = path.join(dir, name)
        try {
          assertDirectChild(dir, file, name)
          await fsp.mkdir(dir, { recursive: true })
          await fsp.writeFile(file, content, { flag: 'wx', mode: 0o600 })
        } catch (err) {
          await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined)
          return describeWriteError(err, name)
        }

        const openError = await deps.openPath(file).catch((err: unknown) => (err instanceof Error ? err.message : 'failed'))
        if (openError) {
          // Nothing launched, so nothing can be using the file: remove it again.
          await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined)
          return fail(
            'open_failed',
            'No application could open this file. Install a program that handles this file type, or save it instead.',
            name,
          )
        }
        return { ok: true, fileName: name }
      })
    },

    /** Explicit, separate action: write the attachment's bytes where the user chooses. */
    saveAs(bookId: unknown, attachmentId: unknown): Promise<AttachmentActionOutcome> {
      return exclusive(`save:${String(bookId)}:${String(attachmentId)}`, async () => {
        const loaded = await loadAttachment(bookId, attachmentId)
        if (!loaded.ok) return loaded
        const { name, content, pdfPath } = loaded
        const target = await deps.chooseSaveTarget(name)
        if (!target) return fail('canceled', 'Save canceled.', name)
        if (deps.isForbiddenTarget(target, pdfPath)) {
          return fail('access_denied', 'That location cannot be used. Choose another folder.', name)
        }
        try {
          await fsp.writeFile(target, content)
        } catch (err) {
          return describeWriteError(err, name)
        }
        return { ok: true, fileName: path.basename(target) }
      })
    },
  }
}

export type AttachmentService = ReturnType<typeof createAttachmentService>

/**
 * Remove the whole temp root. Best effort: where an application still holds a file open (Windows
 * refuses to delete it) that entry survives and the next startup tries again; an error never
 * propagates. Callers only invoke it at startup and at quit — never while a session is running.
 */
export async function cleanAttachmentTemp(tempRoot: string): Promise<boolean> {
  try {
    await fsp.rm(tempRoot, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

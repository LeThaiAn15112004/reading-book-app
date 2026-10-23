/**
 * Worker-thread entry for embedded-annotation work (own bundle entry, see vite.config.ts; driven by
 * `runInScanWorker` in electron/ipc/overlay.ipc.ts). Long-lived: one worker serves every request of
 * the session and is only stopped at app quit (or when a request hangs). Spawning a pdf.js worker
 * per scan and letting it exit crashed the Electron Main process (0xC0000005) in the E2E runs;
 * reusing one does not.
 *
 * Requests:
 *  - `scan`  — the embedded annotations of a PDF (live sync, pdf_embedded_annotation_live_sync.md);
 *  - `write` — Readmate's annotations appended to a PDF as one incremental update, read back and
 *              verified (export, pdf_annotation_export.md);
 *  - `apply` — already-planned file operations appended and verified (two-way sync,
 *              pdf_annotation_two_way_sync.md);
 *  - `attachments-list` / `attachment-extract` — the files embedded in a PDF (read-only,
 *              pdf_attachments.md).
 * Gets the bytes Main already read and checked; never touches SQLite or the file system. Must not
 * import `electron`.
 */
import { parentPort } from 'node:worker_threads'
import {
  extractPdfAttachmentBytes,
  listPdfAttachmentBytes,
  type PdfAttachmentExtractResult,
  type PdfAttachmentListResult,
} from '../attachments/pdf-attachments'
import { scanPdfAnnotationBytes, type PdfAnnotationScanResult } from './pdf-annotation-scan'
import {
  PdfVerifyError,
  applyAnnotationOps,
  writeAnnotationsToPdf,
  type PdfAnnotationApplyInput,
  type PdfAnnotationApplyOutput,
  type PdfAnnotationWriteInput,
  type PdfAnnotationWriteOutput,
} from './pdf-annotation-write'
import { PdfWriteError } from './pdf-incremental-writer'

export type ScanWorkerRequest =
  | { id: number; kind: 'scan'; bytes: Uint8Array }
  | { id: number; kind: 'attachments-list'; bytes: Uint8Array }
  | { id: number; kind: 'attachment-extract'; bytes: Uint8Array; attachmentId: string }
  | ({ id: number; kind: 'write' } & PdfAnnotationWriteInput)
  | ({ id: number; kind: 'apply' } & PdfAnnotationApplyInput)

export type WorkerResult =
  | PdfAnnotationScanResult
  | PdfAnnotationWriteOutput
  | PdfAnnotationApplyOutput
  | PdfAttachmentListResult
  | PdfAttachmentExtractResult

export type ScanWorkerReply =
  | { id: number; type: 'done'; result: WorkerResult }
  | { id: number; type: 'error'; message: string; code?: string }

function codeOf(err: unknown): string | undefined {
  if (err instanceof PdfWriteError) return err.code
  if (err instanceof PdfVerifyError) return 'verify_failed'
  return undefined
}

parentPort?.on('message', (request: ScanWorkerRequest) => {
  const work: Promise<WorkerResult> =
    request.kind === 'write'
      ? writeAnnotationsToPdf(request)
      : request.kind === 'apply'
        ? applyAnnotationOps(request)
        : request.kind === 'attachments-list'
          ? listPdfAttachmentBytes(request.bytes)
          : request.kind === 'attachment-extract'
            ? extractPdfAttachmentBytes(request.bytes, request.attachmentId)
            : scanPdfAnnotationBytes(request.bytes)
  work.then(
    (result) => {
      const transfer = 'output' in result ? [result.output.buffer as ArrayBuffer] : []
      parentPort?.postMessage({ id: request.id, type: 'done', result } satisfies ScanWorkerReply, transfer)
    },
    (err: unknown) =>
      parentPort?.postMessage({
        id: request.id,
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        code: codeOf(err),
      } satisfies ScanWorkerReply),
  )
})

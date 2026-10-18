import {
  Location,
  isConsistentPdfHighlight,
  planTwoWaySync,
  packPdfAnnotationRef,
  parsePdfAnnotationRef,
  type BookmarkRecord,
  type HighlightRecord,
  type NoteLocator,
  type NoteSelectionText,
  type PdfAnnotation,
} from '@reading-book/book-reader-sdk'
import { BrowserWindow, app, dialog, ipcMain, type WebContents } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { servedBookSha256 } from '../files/open-book-content'
import { bookFileStorage, isPathInsideUserData, resolveBookFile } from '../files/sandbox'
import type { AnnotationUpdate } from '../pdf-sync/pdf-incremental-writer'
import { checkPdfWritable } from '../pdf-sync/pdf-write-eligibility'
import { exportAnnotatedPdf as runExport, writeFileSafely } from '../pdf-sync/pdf-annotation-export'
import type { PdfAnnotationApplyOutput } from '../pdf-sync/pdf-annotation-write'
import { verifyPdf } from '../signature/signature-service'
import type { PdfAnnotationWriteInput, PdfAnnotationWriteOutput } from '../pdf-sync/pdf-annotation-write'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import type { PdfAnnotationScanResult } from '../pdf-sync/pdf-annotation-scan'
import {
  createPdfAnnotationSyncService,
  type PdfAnnotationSyncEvent,
  type PdfAnnotationSyncService,
} from '../pdf-sync/pdf-annotation-sync-service'
import {
  getOverlayStore,
  type SessionRecord,
} from '../persistence/sqlite-overlay-store'
import type {
  BookmarkDto,
  DeleteBookmarkInput,
  DeleteHighlightInput,
  HighlightDto,
  OkResult,
  ReadingSessionStateDto,
  SaveBookmarkInput,
  SaveHighlightInput,
  SaveReadingSessionStateInput,
  ExportAnnotatedPdfResult,
  PdfAnnotationConflictDto,
  PdfEmbeddedAnnotationsChangedDto,
  ResolvePdfAnnotationConflictResult,
  WatchPdfEmbeddedAnnotationsResult,
} from './api-types'
import { OverlayChannels } from './channels'

function toSessionDto(state: SessionRecord): ReadingSessionStateDto {
  const dto: ReadingSessionStateDto = {
    bookId: state.bookId,
    percent: state.percent,
    isLandscape: state.isLandscape,
    updatedAt: state.updatedAt,
  }
  if (state.lastReadLocation) dto.lastReadLocation = state.lastReadLocation
  if (state.lastReadLabel) dto.lastReadLabel = state.lastReadLabel
  if (state.fontFamily) dto.fontFamily = state.fontFamily
  if (state.fontSize != null) dto.fontSize = state.fontSize
  if (state.fontWeight) dto.fontWeight = state.fontWeight
  if (state.lineHeight != null) dto.lineHeight = state.lineHeight
  if (state.textAlign) dto.textAlign = state.textAlign
  if (state.layoutMode) dto.layoutMode = state.layoutMode
  if (state.pageTurnMode) dto.pageTurnMode = state.pageTurnMode
  if (state.marginsEnabled != null) dto.marginsEnabled = state.marginsEnabled
  if (state.marginPreset) dto.marginPreset = state.marginPreset
  return dto
}

function inputToSessionRecord(input: SaveReadingSessionStateInput): SessionRecord {
  return {
    bookId: input.bookId.trim(),
    lastReadLocation: input.lastReadLocation?.trim() || undefined,
    lastReadLabel: input.lastReadLabel,
    percent: input.percent ?? 0,
    fontFamily: input.fontFamily?.trim() || undefined,
    fontSize: input.fontSize != null && Number.isFinite(input.fontSize)
      ? input.fontSize
      : undefined,
    fontWeight: input.fontWeight?.trim() || undefined,
    lineHeight: input.lineHeight != null && Number.isFinite(input.lineHeight)
      ? input.lineHeight
      : undefined,
    textAlign: input.textAlign?.trim() || undefined,
    layoutMode: input.layoutMode?.trim() || undefined,
    pageTurnMode: input.pageTurnMode?.trim() || undefined,
    marginsEnabled: input.marginsEnabled,
    marginPreset: input.marginPreset?.trim() || undefined,
    isLandscape: input.isLandscape,
    updatedAt: input.updatedAt?.trim() || new Date().toISOString(),
  }
}

function toBookmarkDto(bookmark: BookmarkRecord): BookmarkDto {
  const dto: BookmarkDto = {
    id: bookmark.id,
    bookId: bookmark.bookId,
    locatorRef: JSON.stringify(bookmark.locator),
    createdAt: bookmark.createdAt,
  }
  if (bookmark.label) dto.label = bookmark.label
  if (bookmark.excerpt) dto.excerpt = bookmark.excerpt
  return dto
}

function toHighlightDto(highlight: HighlightRecord): HighlightDto {
  const dto: HighlightDto = {
    id: highlight.id,
    bookId: highlight.bookId,
    locatorRef: JSON.stringify(highlight.locator),
    styleKind: highlight.styleKind,
    colorHex: highlight.colorHex,
    tags: highlight.tags,
    createdAt: highlight.createdAt,
    updatedAt: highlight.updatedAt,
  }
  if (highlight.note) dto.note = highlight.note
  if (highlight.selectionText) dto.selectionTextRef = JSON.stringify(highlight.selectionText)
  if (highlight.pdfAnnotation) dto.pdfAnnotationRef = packPdfAnnotationRef(highlight.pdfAnnotation)
  return dto
}

/**
 * Decodes a renderer-supplied locator string. Returns undefined when it is not a valid
 * `Location` JSON, so a malformed bookmark is rejected at the boundary instead of being stored
 * and only failing later, at jump time, when it can no longer be traced back to its origin.
 */
function parseLocatorRef(raw: unknown): NoteLocator | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  try {
    // Location.parse validates `kind` and its required fields; extras like `chapterIndex`
    // ride along in the JSON untouched.
    Location.parse(raw)
    return JSON.parse(raw) as NoteLocator
  } catch {
    return undefined
  }
}

/** Parses the JSON `{before?, highlight?, after?}` blob a highlight's selection carries. */
function parseSelectionTextRef(raw: unknown): NoteSelectionText | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  try {
    return JSON.parse(raw) as NoteSelectionText
  } catch {
    return undefined
  }
}

/**
 * Handlers for overlay:* — reading session state (T4.3), bookmarks (FR-11), and highlights.
 */
export function registerOverlayIpc(): void {
  const overlays = getOverlayStore()

  ipcMain.removeHandler(OverlayChannels.getSessionState)
  ipcMain.handle(
    OverlayChannels.getSessionState,
    async (_event, bookId: unknown): Promise<ReadingSessionStateDto | null> => {
      void _event
      if (typeof bookId !== 'string' || !bookId.trim()) return null
      const state = await overlays.getSessionRecord(bookId.trim())
      return state ? toSessionDto(state) : null
    },
  )

  ipcMain.removeHandler(OverlayChannels.saveSessionState)
  ipcMain.handle(
    OverlayChannels.saveSessionState,
    async (_event, input: unknown): Promise<OkResult> => {
      void _event
      if (!input || typeof input !== 'object') return { ok: false }
      const body = input as SaveReadingSessionStateInput
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) return { ok: false }
      try {
        const state = inputToSessionRecord(body)
        await overlays.saveSessionPreferences(state)
        return { ok: true }
      } catch {
        return { ok: false }
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.listBookmarks)
  ipcMain.handle(
    OverlayChannels.listBookmarks,
    async (_event, bookId: unknown): Promise<BookmarkDto[]> => {
      void _event
      if (typeof bookId !== 'string' || !bookId.trim()) return []
      const bookmarks = await overlays.listBookmarks(bookId.trim())
      return bookmarks.map(toBookmarkDto)
    },
  )

  ipcMain.removeHandler(OverlayChannels.saveBookmark)
  ipcMain.handle(
    OverlayChannels.saveBookmark,
    async (_event, input: unknown): Promise<BookmarkDto | null> => {
      void _event
      if (!input || typeof input !== 'object') return null
      const body = input as SaveBookmarkInput
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) return null

      const locator = parseLocatorRef(body.locatorRef)
      if (!locator) return null

      try {
        const saved = await overlays.saveBookmark({
          id: body.id?.trim() || undefined,
          bookId: body.bookId.trim(),
          locator,
          label: body.label?.trim() || undefined,
          excerpt: body.excerpt?.trim() || undefined,
          createdAt: body.createdAt?.trim() || undefined,
        })
        return toBookmarkDto(saved)
      } catch {
        return null
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.deleteBookmark)
  ipcMain.handle(
    OverlayChannels.deleteBookmark,
    async (_event, input: unknown): Promise<OkResult> => {
      void _event
      if (!input || typeof input !== 'object') return { ok: false }
      const body = input as DeleteBookmarkInput
      if (typeof body.bookId !== 'string' || typeof body.id !== 'string') {
        return { ok: false }
      }
      try {
        const ok = await overlays.deleteBookmark(body.bookId, body.id)
        return { ok }
      } catch {
        return { ok: false }
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.listHighlights)
  ipcMain.handle(
    OverlayChannels.listHighlights,
    async (_event, bookId: unknown): Promise<HighlightDto[]> => {
      void _event
      if (typeof bookId !== 'string' || !bookId.trim()) return []
      const highlights = await overlays.listHighlights(bookId.trim())
      return highlights.map(toHighlightDto)
    },
  )

  ipcMain.removeHandler(OverlayChannels.saveHighlight)
  ipcMain.handle(
    OverlayChannels.saveHighlight,
    async (_event, input: unknown): Promise<HighlightDto | null> => {
      void _event
      if (!input || typeof input !== 'object') return null
      const body = input as SaveHighlightInput
      if (typeof body.bookId !== 'string' || !body.bookId.trim()) return null

      const locator = parseLocatorRef(body.locatorRef)
      if (!locator) return null
      const validStyleKinds = ['highlight', 'underline', 'strikethrough', 'textbox']
      if (!validStyleKinds.includes(body.styleKind)) return null
      if (typeof body.colorHex !== 'string' || !body.colorHex.trim()) return null

      // PDF markup: the geometry must be valid on its own and agree with the jump target. A
      // present-but-invalid payload rejects the save rather than storing a mark that can't paint.
      let pdfAnnotation: PdfAnnotation | undefined
      if (body.pdfAnnotationRef !== undefined) {
        pdfAnnotation = parsePdfAnnotationRef(body.pdfAnnotationRef)
        if (!pdfAnnotation || !isConsistentPdfHighlight(locator, pdfAnnotation)) return null
      }

      try {
        const saved = await overlays.saveHighlight({
          id: body.id?.trim() || undefined,
          bookId: body.bookId.trim(),
          locator,
          styleKind: body.styleKind,
          colorHex: body.colorHex.trim(),
          note: body.note?.trim() || undefined,
          tags: body.tags,
          selectionText: parseSelectionTextRef(body.selectionTextRef),
          pdfAnnotation,
          createdAt: body.createdAt?.trim() || undefined,
        })
        pdfAnnotationSync().notifyAppChange(saved.bookId)
        return toHighlightDto(saved)
      } catch {
        return null
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.deleteHighlight)
  ipcMain.handle(
    OverlayChannels.deleteHighlight,
    async (_event, input: unknown): Promise<OkResult> => {
      void _event
      if (!input || typeof input !== 'object') return { ok: false }
      const body = input as DeleteHighlightInput
      if (typeof body.bookId !== 'string' || typeof body.id !== 'string') {
        return { ok: false }
      }
      try {
        const ok = await overlays.deleteHighlight(body.bookId, body.id)
        if (ok) pdfAnnotationSync().notifyAppChange(body.bookId.trim())
        return { ok }
      } catch {
        return { ok: false }
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.watchPdfEmbeddedAnnotations)
  ipcMain.handle(
    OverlayChannels.watchPdfEmbeddedAnnotations,
    async (event, bookId: unknown): Promise<WatchPdfEmbeddedAnnotationsResult> => {
      if (typeof bookId !== 'string' || !bookId.trim()) return { ok: false, errorCode: 'not_found' }
      return pdfAnnotationSync().watch(event.sender, bookId.trim())
    },
  )

  ipcMain.removeHandler(OverlayChannels.exportAnnotatedPdf)
  ipcMain.handle(
    OverlayChannels.exportAnnotatedPdf,
    async (event, bookId: unknown, options: unknown): Promise<ExportAnnotatedPdfResult> => {
      if (typeof bookId !== 'string' || !bookId.trim()) return { ok: false, errorCode: 'not_found' }
      const id = bookId.trim()
      const book = await getLibraryStore().findById(id)
      if (!book || book.format !== 'pdf') return { ok: false, errorCode: 'not_found' }
      const acknowledgeSignature = !!(options && typeof options === 'object' && (options as { acknowledgeSignature?: unknown }).acknowledgeSignature === true)
      return runExport(
        {
          resolveSource: async () => {
            const file = await resolveBookFile(book)
            return file.ok ? file.path : null
          },
          ledger: () => overlays.listEmbeddedLedger(id),
          rows: () => overlays.listHighlights(id),
          verifySignature: (bytes) => verifyPdf(bytes),
          chooseTarget: async () => {
            const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
            const safeTitle = (book.title || 'book').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'book'
            const dialogOptions: Electron.SaveDialogOptions = {
              title: 'Export PDF with annotations',
              defaultPath: path.join(app.getPath('documents'), `${safeTitle} (annotated).pdf`),
              filters: [{ name: 'PDF', extensions: ['pdf'] }],
              properties: ['showOverwriteConfirmation', 'createDirectory'],
            }
            const picked = parent ? await dialog.showSaveDialog(parent, dialogOptions) : await dialog.showSaveDialog(dialogOptions)
            if (picked.canceled || !picked.filePath) return null
            return picked.filePath.toLowerCase().endsWith('.pdf') ? picked.filePath : `${picked.filePath}.pdf`
          },
          isForbiddenTarget: (target) => isPathInsideUserData(target),
          write: writeInWorker,
        },
        { acknowledgeSignature },
      )
    },
  )

  ipcMain.removeHandler(OverlayChannels.confirmSignedPdfWrite)
  ipcMain.handle(OverlayChannels.confirmSignedPdfWrite, async (event, bookId: unknown): Promise<OkResult> => {
    if (typeof bookId !== 'string' || !bookId.trim()) return { ok: false }
    return { ok: pdfAnnotationSync().allowSignedWrite(event.sender, bookId.trim()) }
  })

  ipcMain.removeHandler(OverlayChannels.listPdfAnnotationConflicts)
  ipcMain.handle(OverlayChannels.listPdfAnnotationConflicts, async (_event, bookId: unknown): Promise<PdfAnnotationConflictDto[]> => {
    void _event
    if (typeof bookId !== 'string' || !bookId.trim()) return []
    return overlays.listPdfAnnotationConflicts(bookId.trim()).map(({ noteId, conflict }) => ({ noteId, kind: conflict.kind, fields: conflict.fields }))
  })

  ipcMain.removeHandler(OverlayChannels.resolvePdfAnnotationConflict)
  ipcMain.handle(
    OverlayChannels.resolvePdfAnnotationConflict,
    async (_event, bookId: unknown, noteId: unknown, choice: unknown): Promise<ResolvePdfAnnotationConflictResult> => {
      void _event
      if (typeof bookId !== 'string' || typeof noteId !== 'string' || (choice !== 'keep-readmate' && choice !== 'use-pdf')) return { ok: false }
      const id = bookId.trim()
      try {
        const result = overlays.resolvePdfAnnotationConflict(id, noteId, choice)
        if (!result) return { ok: false }
        pdfAnnotationSync().notifyAppChange(id)
        return { ok: true, updated: result.updated ? toHighlightDto(result.updated) : undefined, deletedId: result.deleted }
      } catch (err) {
        console.warn('[overlay] resolving an annotation conflict failed', err)
        return { ok: false }
      }
    },
  )

  ipcMain.removeHandler(OverlayChannels.unwatchPdfEmbeddedAnnotations)
  ipcMain.handle(
    OverlayChannels.unwatchPdfEmbeddedAnnotations,
    async (event, bookId: unknown): Promise<OkResult> => {
      if (typeof bookId !== 'string' || !bookId.trim()) return { ok: false }
      pdfAnnotationSync().unwatch(event.sender, bookId.trim())
      return { ok: true }
    },
  )
}

/** Emitted next to main.js by the extra bundle entry in vite.config.ts. */
const SCAN_WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pdf-annotation-scan.worker.js')
const SCAN_WORKER_HEAP_LIMIT_MB = 512
/** A scan that hangs (pathological file) is abandoned — nothing is written, the next change retries. */
const SCAN_TIMEOUT_MS = 60_000

type WorkerReply =
  | { id: number; type: 'done'; result: unknown }
  | { id: number; type: 'error'; message: string; code?: string }
type PendingRequest = { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

let scanWorker: Worker | null = null
let nextRequestId = 1
const pendingRequests = new Map<number, PendingRequest>()

function failPendingRequests(err: Error): void {
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(err)
    pendingRequests.delete(id)
  }
}

/** Stop the worker (hung request, crash, app quit); the next request starts a fresh one. */
function stopScanWorker(reason: Error): void {
  const worker = scanWorker
  scanWorker = null
  failPendingRequests(reason)
  void worker?.terminate()
}

/**
 * The one long-lived scan worker (lazily started). One worker serves every request: spawning a
 * pdf.js worker per scan and letting it exit crashed the Electron Main process (0xC0000005) in E2E runs.
 */
function ensureScanWorker(): Worker {
  if (scanWorker) return scanWorker
  const worker = new Worker(SCAN_WORKER_PATH, { resourceLimits: { maxOldGenerationSizeMb: SCAN_WORKER_HEAP_LIMIT_MB } })
  worker.on('message', (reply: WorkerReply) => {
    const pending = pendingRequests.get(reply.id)
    if (!pending) return
    pendingRequests.delete(reply.id)
    clearTimeout(pending.timer)
    if (reply.type === 'done') pending.resolve(reply.result)
    else pending.reject(Object.assign(new Error(reply.message), { code: reply.code }))
  })
  worker.on('error', (err) => {
    if (scanWorker === worker) stopScanWorker(err)
  })
  worker.on('exit', (code) => {
    if (scanWorker === worker) {
      scanWorker = null
      failPendingRequests(new Error(`scan worker exited with code ${code}`))
    }
  })
  // Never keeps the app alive on its own.
  worker.unref()
  scanWorker = worker
  return worker
}

/**
 * Send one request to the scan worker. The worker gets its own copy of the PDF bytes (transferred,
 * so it isn't copied twice): callers keep theirs — the two-way cycle scans and then writes the same
 * bytes, and a transferred buffer would be detached on the caller's side.
 */
function runInScanWorker<T>(input: Record<string, unknown> & { bytes: Uint8Array }): Promise<T> {
  const request = { ...input, bytes: input.bytes.slice() }
  return new Promise((resolve, reject) => {
    const worker = ensureScanWorker()
    const id = nextRequestId++
    const timer = setTimeout(() => {
      // A request that hangs (pathological file) takes the worker down with it; nothing is written.
      if (pendingRequests.has(id)) stopScanWorker(new Error('scan worker request timed out'))
    }, SCAN_TIMEOUT_MS)
    pendingRequests.set(id, { resolve: resolve as (r: unknown) => void, reject, timer })
    worker.postMessage({ ...request, id }, [request.bytes.buffer as ArrayBuffer])
  })
}

const scanInWorker = (bytes: Uint8Array) => runInScanWorker<PdfAnnotationScanResult>({ kind: 'scan', bytes })
const writeInWorker = (input: PdfAnnotationWriteInput) => runInScanWorker<PdfAnnotationWriteOutput>({ kind: 'write', ...input })

function toChangedDto(event: PdfAnnotationSyncEvent): PdfEmbeddedAnnotationsChangedDto {
  return {
    bookId: event.bookId,
    reason: event.reason,
    inserted: event.outcome.inserted.map(toHighlightDto),
    updated: event.outcome.updated.map(toHighlightDto),
    deletedIds: event.outcome.deleted,
    hiddenObjectIds: event.matchesDisplayedFile
      ? event.outcome.managedIndices.map((i) => event.items[i]!.objectId)
      : [],
    complete: event.complete,
    conflicts: event.outcome.conflicts.map(({ noteId, conflict }) => ({ noteId, kind: conflict.kind, fields: conflict.fields })),
    writeStatus: event.writeStatus,
    signerName: event.signerName,
    timing: { totalMs: event.timing.totalMs, scanMs: event.timing.scanMs },
  }
}

let syncService: PdfAnnotationSyncService | null = null

/** The app's live embedded-annotation sync (docs/implementation_plan/pdf_embedded_annotation_live_sync.md). */
function pdfAnnotationSync(): PdfAnnotationSyncService {
  syncService ??= createPdfAnnotationSyncService({
    resolvePdfPath: async (bookId) => {
      const book = await getLibraryStore().findById(bookId)
      if (!book || book.format !== 'pdf') return null
      const file = await resolveBookFile(book)
      return file.ok ? file.path : null
    },
    scan: scanInWorker,
    sync: (bookId, items, options) => getOverlayStore().syncEmbeddedPdfAnnotations(bookId, items, options),
    servedSha256: servedBookSha256,
    emit: (target, event) => {
      const contents = target as WebContents
      if (!contents.isDestroyed()) contents.send(OverlayChannels.pdfEmbeddedAnnotationsChanged, toChangedDto(event))
    },
    log: (message, detail) => console.warn(message, detail ?? ''),
    twoWay: {
      checkWritable: (_bookId, filePath, bytes, allowSigned) =>
        checkPdfWritable({
          filePath,
          bytes,
          isReferenced: (p) => bookFileStorage(p) === 'referenced',
          verifySignature: verifyPdf,
          allowSigned,
        }),
      recordFileVersion: (bookId, sha256, sizeBytes) => {
        getLibraryStore().updateFileFingerprint(bookId, sha256, sizeBytes)
      },
      plan: async (bookId, items, complete) =>
        planTwoWaySync({ items, complete, ledger: getOverlayStore().listTwoWayLedger(bookId), rows: await getOverlayStore().listHighlights(bookId) }),
      apply: (bookId, plan, items, after) => getOverlayStore().applyTwoWaySync(bookId, plan, items, after),
      applyOps: (bytes: Uint8Array, ops: AnnotationUpdate) => runInScanWorker<PdfAnnotationApplyOutput>({ kind: 'apply', bytes, ops }),
      writeFile: writeFileSafely,
    },
  })
  return syncService
}

/** Stop every file watch and the scan worker (app quit). */
export function disposePdfAnnotationSync(): void {
  syncService?.disposeAll()
  if (scanWorker) stopScanWorker(new Error('app quit'))
}

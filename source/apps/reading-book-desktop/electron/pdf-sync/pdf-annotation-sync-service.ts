/**
 * Live sync of the annotations embedded in the PDF open in a reader window — Foxit / Acrobat save →
 * Readmate updates SQLite and the reader without reopening the book. Read-only on the file.
 * docs/implementation_plan/pdf_embedded_annotation_live_sync.md.
 *
 * One session per renderer (`webContents`): the PDF its reader has open. A session:
 *  1. syncs once right away (`reason: 'open'`);
 *  2. watches the file (`StableFileWatcher`) and syncs again on every settled change;
 *  3. runs one sync at a time — a change during a sync makes exactly one more run follow;
 *  4. ends on unwatch, on watching another book, when the window goes away, or on app quit.
 *
 * Two-way mode (docs/implementation_plan/pdf_annotation_two_way_sync.md) — ALWAYS on in the app (there
 * is no write-back switch): a cycle also writes Readmate's changes into the file (one incremental
 * update, read back and verified), after `checkWritable` approved this very file and after checking
 * it is still the version that was scanned; `notifyAppChange` (a row saved / deleted in Readmate)
 * triggers a cycle. Readmate's own write is recognised by its SHA-256 and never synced back (no
 * loop). A file that can't be written safely (app-owned copy, read-only, encrypted, unsupported,
 * signed without confirmation, locked) is never written and never reported as written: the data
 * stays pending in SQLite and the renderer is told why, once per reason.
 *
 * Dependencies are injected (`createPdfAnnotationSyncService`) so the spikes can drive the real
 * logic on real temp files without Electron; `pdfAnnotationSyncService()` wires the app's own.
 */
import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import { hasFileWrites, type ScannedPdfAnnotation, type TwoWayPlan } from '@reading-book/book-reader-sdk'
import type { PdfAnnotationScanResult } from './pdf-annotation-scan'
import type { WriteBlockReason, WriteEligibility } from './pdf-write-eligibility'
import { StableFileWatcher, sameSignature, statSignature, type FileSignature, type StableFileWatcherOptions } from './stable-file-watcher'
import type { EmbeddedPdfSyncOutcome, TwoWaySyncOutcome } from '../persistence/sqlite-overlay-store'
import type { AnnotationUpdate } from './pdf-incremental-writer'

/** A complete PDF ends with `%%EOF` (possibly followed by a little whitespace / junk). */
const EOF_WINDOW_BYTES = 2048
/** After a failed sync (scan error, transaction error), retry this many times, this far apart. */
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1500
/** A file another app keeps locked: retry this many times, this far apart (then on the next trigger). */
const LOCKED_RETRIES = 10
const LOCKED_RETRY_DELAY_MS = 3000
/** Rapid edits in Readmate are batched into one write. */
const APP_CHANGE_DEBOUNCE_MS = 300

export type SyncReason = 'open' | 'file-change' | 'app-change'
/** `written`; a failure (`locked`: another app holds the file, retried a bounded number of times; `failed`); or why the file may not be written. */
export type WriteStatus = 'written' | 'locked' | 'failed' | WriteBlockReason

/** Pushed to the renderer after a sync that changed something (and always after the open sync). */
/** Where one Typewriter note stands in the file after a cycle (contracts §3). `in_file`: written. */
export type TypewriterFileStatus = {
  id: string
  code: 'in_file' | 'file_not_writable' | 'unsupported_characters' | 'font_unavailable' | 'does_not_fit'
  characters?: string[]
}

export type PdfAnnotationSyncEvent = {
  bookId: string
  reason: SyncReason
  outcome: Pick<EmbeddedPdfSyncOutcome, 'inserted' | 'updated' | 'deleted' | 'managedIndices'> & {
    conflicts: TwoWaySyncOutcome['conflicts']
  }
  /** Two-way mode: what happened to the file write this cycle needed (absent when none was needed). */
  writeStatus?: WriteStatus
  /** For `writeStatus: 'signed'`: the signer, when known. */
  signerName?: string
  /** The Typewriter notes this cycle tried to write, and the result for each (a note not listed was not touched). */
  typewriterStatus?: TypewriterFileStatus[]
  /** PDF.js ids of the scanned items, aligned with `outcome.managedIndices`. */
  items: readonly ScannedPdfAnnotation[]
  /**
   * The scanned bytes are the ones the renderer is displaying (open sync only, SHA-256 equal to
   * what `library:openBookContent` served) — only then may object ids be used on its canvas.
   */
  matchesDisplayedFile: boolean
  complete: boolean
  timing: { firstEventAt: number | null; scanMs: number; totalMs: number }
}

/** The minimal `webContents` surface the service needs (an Electron WebContents fits). */
export type SyncTarget = {
  id: number
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
}

export type PdfAnnotationSyncDeps = {
  /** The book's validated, readable path (`resolveBookFile`), or null (not a PDF / missing / denied). */
  resolvePdfPath: (bookId: string) => Promise<string | null>
  scan: (bytes: Uint8Array) => Promise<PdfAnnotationScanResult>
  sync: (bookId: string, items: readonly ScannedPdfAnnotation[], options: { complete: boolean }) => EmbeddedPdfSyncOutcome | null
  /** SHA-256 of the bytes `library:openBookContent` last served for this book. */
  servedSha256: (bookId: string) => string | undefined
  emit: (target: SyncTarget, event: PdfAnnotationSyncEvent) => void
  watcherOptions?: Omit<StableFileWatcherOptions, 'onStable' | 'initialSignature'>
  log?: (message: string, detail?: unknown) => void
  /** Retry timing (tests shorten it). */
  retryTiming?: { retryMs?: number; lockedMs?: number; lockedMax?: number }
  /**
   * Two-way sync (write-back). The app always passes it; absent = read-only import (only the
   * phase 1 test harness runs without it).
   */
  twoWay?: {
    /** Is this exact file safe to write right now? Asked before every write (`checkPdfWritable`). */
    checkWritable: (bookId: string, filePath: string, bytes: Uint8Array, allowSigned: boolean) => Promise<WriteEligibility>
    /**
     * The file is now at this version (SHA-256, size) — after Readmate's own write or an external
     * save. Keeps `books.sha256` current so "Locate file" keeps matching.
     */
    recordFileVersion?: (bookId: string, sha256: string, sizeBytes: number) => void
    /** `planTwoWaySync` with the book's ledger and rows. */
    plan: (bookId: string, items: readonly ScannedPdfAnnotation[], complete: boolean) => Promise<TwoWayPlan>
    /** The store's `applyTwoWaySync`. */
    apply: (bookId: string, plan: TwoWayPlan, items: readonly ScannedPdfAnnotation[], after: readonly ScannedPdfAnnotation[] | null) => TwoWaySyncOutcome | null
    /** Append + verify in the worker. */
    applyOps: (bytes: Uint8Array, ops: AnnotationUpdate) => Promise<{ output: Uint8Array; after: { items: ScannedPdfAnnotation[] }; skipped?: { nm: string; code: TypewriterFileStatus['code']; characters?: string[] }[] }>
    /** Replace the file safely (temp + rename). */
    writeFile: (filePath: string, bytes: Uint8Array) => Promise<void>
  }
}

type Session = {
  target: SyncTarget
  bookId: string
  filePath: string
  watcher: StableFileWatcher | null
  running: boolean
  pending: { reason: SyncReason; firstEventAt: number | null } | null
  lastSyncedSha: string | null
  retries: number
  retryTimer: ReturnType<typeof setTimeout> | null
  appChangeTimer: ReturnType<typeof setTimeout> | null
  /** The user confirmed writing into this (signed) file; valid until the session ends. */
  allowSigned: boolean
  /** Last write status told to the renderer — a blocked status is announced once, not every cycle. */
  lastStatus: WriteStatus | undefined
  /** Last file version handed to `recordFileVersion`. */
  recordedSha: string | null
  disposed: boolean
  /** Resolves when the current run (and any queued follow-up) is finished — for tests. */
  idle: Promise<void>
  resolveIdle: (() => void) | null
}

export type WatchResult = { ok: true } | { ok: false; errorCode: 'not_found' | 'unavailable' }

function hasEofMarker(bytes: Uint8Array): boolean {
  const tail = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).subarray(Math.max(0, bytes.byteLength - EOF_WINDOW_BYTES))
  return tail.includes('%%EOF', 0, 'latin1')
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function createPdfAnnotationSyncService(deps: PdfAnnotationSyncDeps) {
  const sessions = new Map<number, Session>()
  const log = deps.log ?? (() => {})
  const maxRetries = MAX_RETRIES
  const retryMs = deps.retryTiming?.retryMs ?? RETRY_DELAY_MS
  const lockedMs = deps.retryTiming?.lockedMs ?? LOCKED_RETRY_DELAY_MS
  const lockedMax = deps.retryTiming?.lockedMax ?? LOCKED_RETRIES

  function dispose(session: Session): void {
    session.disposed = true
    session.watcher?.dispose()
    session.watcher = null
    if (session.retryTimer) clearTimeout(session.retryTimer)
    session.retryTimer = null
    if (session.appChangeTimer) clearTimeout(session.appChangeTimer)
    session.appChangeTimer = null
    session.resolveIdle?.()
    if (sessions.get(session.target.id) === session) sessions.delete(session.target.id)
  }

  /**
   * Queue a cycle. A fresh trigger (open, file change, an edit in Readmate) gets its own bounded retry
   * budget; a retry or an internal restart (`isRetry`) does not reset it — so retrying is bounded per
   * trigger, never unlimited, and a lock that outlasted one budget doesn't starve later edits.
   */
  function request(session: Session, reason: SyncReason, firstEventAt: number | null, isRetry = false): void {
    if (session.disposed) return
    if (!isRetry) session.retries = 0
    // `open` wins over a queued change (it also carries the canvas-hiding ids); a file change wins over
    // an app change (the cycle reconciles both anyway, and a file change must not be skipped).
    const rank = (r: SyncReason) => (r === 'open' ? 2 : r === 'file-change' ? 1 : 0)
    const keep = session.pending && rank(session.pending.reason) >= rank(reason) ? session.pending.reason : reason
    session.pending = { reason: keep, firstEventAt: session.pending?.firstEventAt ?? firstEventAt }
    if (!session.running) void drain(session)
  }

  async function drain(session: Session): Promise<void> {
    session.running = true
    if (!session.resolveIdle) {
      session.idle = new Promise<void>((resolve) => {
        session.resolveIdle = resolve
      })
    }
    try {
      while (session.pending && !session.disposed) {
        const { reason, firstEventAt } = session.pending
        session.pending = null
        await runOnce(session, reason, firstEventAt)
      }
    } finally {
      session.running = false
      const resolve = session.resolveIdle
      session.resolveIdle = null
      resolve?.()
    }
  }

  function scheduleRetry(session: Session, reason: SyncReason, firstEventAt: number | null, locked = false): void {
    const max = locked ? lockedMax : maxRetries
    if (session.disposed || session.retries >= max || session.retryTimer) return
    session.retries++
    session.retryTimer = setTimeout(() => {
      session.retryTimer = null
      request(session, reason, firstEventAt, true)
    }, locked ? lockedMs : retryMs)
    session.retryTimer.unref?.()
  }

  function errnoCode(err: unknown): string {
    return err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
  }

  /** Two-way cycle: reconcile both sides, writing the file when the plan needs it and the file may be written. */
  async function runTwoWay(
    session: Session,
    reason: SyncReason,
    firstEventAt: number | null,
    startedAt: number,
    filePath: string,
    bytes: Uint8Array,
    sha: string,
    scanned: PdfAnnotationScanResult,
    scanMs: number,
  ): Promise<void> {
    const twoWay = deps.twoWay!
    const plan = await twoWay.plan(session.bookId, scanned.items, scanned.complete)
    if (session.disposed) return
    let after: readonly ScannedPdfAnnotation[] | null = null
    let writeStatus: WriteStatus | undefined
    let signerName: string | undefined
    let newSha = sha
    let newSize = bytes.length
    const twRows = plan.writtenRows.filter((w) => w.row.styleKind === 'typewriter')
    let typewriterStatus: TypewriterFileStatus[] | undefined
    if (hasFileWrites(plan)) {
      const eligibility = await twoWay.checkWritable(session.bookId, filePath, bytes, session.allowSigned)
      if (session.disposed) return
      if (!eligibility.ok) {
        // Not written, not reported as written: Readmate's changes stay pending in SQLite.
        writeStatus = eligibility.reason
        signerName = eligibility.signerName
        log(`[pdf-sync] not writing into the file (${eligibility.reason}); Readmate's changes stay pending`)
        typewriterStatus = twRows.map((w) => ({ id: w.noteId, code: 'file_not_writable' as const }))
      } else {
        let written: Awaited<ReturnType<typeof twoWay.applyOps>> | null = null
        try {
          written = await twoWay.applyOps(bytes, plan.file)
        } catch (err) {
          log('[pdf-sync] write-back could not be prepared; the file is untouched', err)
          writeStatus = 'failed'
          typewriterStatus = twRows.map((w) => ({ id: w.noteId, code: 'file_not_writable' as const }))
        }
        if (session.disposed) return
        if (written) {
          // The file must still be exactly the version the plan was made from.
          let current: Uint8Array | null = null
          try {
            current = new Uint8Array(await fsp.readFile(filePath))
          } catch {
            current = null
          }
          if (!current || sha256Hex(current) !== sha) {
            log('[pdf-sync] the file changed before the write-back; starting over')
            request(session, reason, firstEventAt, true)
            return
          }
          try {
            await twoWay.writeFile(filePath, written.output)
            after = written.after.items
            newSha = sha256Hex(written.output)
            newSize = written.output.length
            writeStatus = 'written'
            // A Typewriter note that cannot be drawn was left out of the update (the rest was written): it stays in the app, pending, and says why.
            const skipped = written.skipped ?? []
            typewriterStatus = twRows.map((w) => {
              const miss = skipped.find((k) => w.names.includes(k.nm))
              return miss ? { id: w.noteId, code: miss.code, ...(miss.characters ? { characters: miss.characters } : {}) } : { id: w.noteId, code: 'in_file' as const }
            })
            const skippedRows = new Set(typewriterStatus.filter((t) => t.code !== 'in_file').map((t) => t.id))
            if (skippedRows.size > 0) plan.writtenRows = plan.writtenRows.filter((w) => !skippedRows.has(w.noteId))
          } catch (err) {
            const code = errnoCode(err)
            // EBUSY / EPERM: another app holds the file — retried a bounded number of times.
            // EACCES and the rest: retrying can't help; the next trigger tries again.
            const locked = code === 'EBUSY' || code === 'EPERM'
            writeStatus = locked ? 'locked' : code === 'EACCES' || code === 'EROFS' ? 'read_only' : 'failed'
            typewriterStatus = twRows.map((w) => ({ id: w.noteId, code: 'file_not_writable' as const }))
            log(`[pdf-sync] write-back failed (${code || 'error'}); Readmate's changes stay pending`, err)
            if (locked) scheduleRetry(session, reason, firstEventAt, true)
          }
        }
      }
    }
    if (session.disposed) return

    let outcome: TwoWaySyncOutcome | null
    try {
      outcome = twoWay.apply(session.bookId, plan, scanned.items, after)
    } catch (err) {
      // Rolled back. If the file was written, its Readmate-named annotations are linked next cycle.
      log('[pdf-sync] two-way transaction failed; rolled back', err)
      scheduleRetry(session, reason, firstEventAt)
      return
    }
    if (!outcome || session.disposed) return
    session.lastSyncedSha = newSha
    if (writeStatus === 'written' || !hasFileWrites(plan)) session.retries = 0
    if (twoWay.recordFileVersion && session.recordedSha !== newSha) {
      try {
        twoWay.recordFileVersion(session.bookId, newSha, newSize)
        session.recordedSha = newSha
      } catch (err) {
        log('[pdf-sync] could not record the file version', err)
      }
    }

    // A blocked / failed status is announced once per reason until something else happens.
    const blocked = writeStatus !== undefined && writeStatus !== 'written'
    const repeated = blocked && session.lastStatus === writeStatus
    session.lastStatus = blocked ? writeStatus : undefined

    const changed = outcome.inserted.length + outcome.updated.length + outcome.deleted.length + outcome.conflicts.length > 0
    if (!changed && reason !== 'open' && (!writeStatus || repeated)) return
    if (session.target.isDestroyed()) return
    deps.emit(session.target, {
      bookId: session.bookId,
      reason,
      outcome: { ...outcome, managedIndices: scanned.items.map((_, i) => i) },
      writeStatus,
      signerName,
      typewriterStatus,
      items: scanned.items,
      matchesDisplayedFile: reason === 'open' && deps.servedSha256(session.bookId) === sha,
      complete: scanned.complete,
      timing: { firstEventAt, scanMs, totalMs: Date.now() - (firstEventAt ?? startedAt) },
    })
  }

  async function runOnce(session: Session, reason: SyncReason, firstEventAt: number | null): Promise<void> {
    const startedAt = Date.now()
    // Without two-way deps (test harness only) Readmate's own edits never touch the file.
    if (reason === 'app-change' && !deps.twoWay) return
    // Re-resolve every time: the guard on the registered path is the same as for opening the book.
    const filePath = await deps.resolvePdfPath(session.bookId)
    if (session.disposed || !filePath) return
    session.filePath = filePath

    const before = await statSignature(filePath)
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await fsp.readFile(filePath))
    } catch {
      return // Mid-replace / locked: the watcher reports the settled state later.
    }
    const after = await statSignature(filePath)
    if (session.disposed) return
    if (!before || !after || !sameSignature(before, after)) {
      log('[pdf-sync] file changed while being read; waiting for it to settle')
      return // The write that changed it produces its own event.
    }

    const sha = sha256Hex(bytes)
    const twoWay = !!deps.twoWay
    // Content-identical save / touch / Readmate's own write. An app change still needs a cycle.
    if (sha === session.lastSyncedSha && reason === 'file-change') return
    if (!hasEofMarker(bytes)) {
      log('[pdf-sync] file has no %%EOF (partially written or truncated); not scanned')
      return
    }

    let scanned: PdfAnnotationScanResult
    const scanStart = Date.now()
    try {
      scanned = await deps.scan(bytes)
    } catch (err) {
      log('[pdf-sync] scan failed; nothing changed', err)
      scheduleRetry(session, reason, firstEventAt)
      return
    }
    const scanMs = Date.now() - scanStart
    if (session.disposed) return
    if (twoWay) {
      await runTwoWay(session, reason, firstEventAt, startedAt, filePath, bytes, sha, scanned, scanMs)
      return
    }
    let outcome: EmbeddedPdfSyncOutcome | null
    try {
      outcome = deps.sync(session.bookId, scanned.items, { complete: scanned.complete })
    } catch (err) {
      // The transaction rolled back: SQLite is as before, and lastSyncedSha is not advanced.
      log('[pdf-sync] sync transaction failed; rolled back', err)
      scheduleRetry(session, reason, firstEventAt)
      return
    }
    if (!outcome || session.disposed) return
    session.lastSyncedSha = sha
    session.retries = 0

    const changed = outcome.inserted.length + outcome.updated.length + outcome.deleted.length > 0
    if (!changed && reason !== 'open') return
    if (session.target.isDestroyed()) return
    deps.emit(session.target, {
      bookId: session.bookId,
      reason,
      outcome: { ...outcome, conflicts: [] },
      items: scanned.items,
      matchesDisplayedFile: reason === 'open' && deps.servedSha256(session.bookId) === sha,
      complete: scanned.complete,
      timing: { firstEventAt, scanMs, totalMs: Date.now() - (firstEventAt ?? startedAt) },
    })
  }

  return {
    /** Start (or restart) the session of `target` on `bookId` and sync it right away. */
    async watch(target: SyncTarget, bookId: string): Promise<WatchResult> {
      const existing = sessions.get(target.id)
      if (existing) dispose(existing)
      const filePath = await deps.resolvePdfPath(bookId)
      if (!filePath) return { ok: false, errorCode: 'not_found' }
      // Another watch call may have won while the path resolved.
      if (sessions.has(target.id)) dispose(sessions.get(target.id)!)
      const session: Session = {
        target,
        bookId,
        filePath,
        watcher: null,
        running: false,
        pending: null,
        lastSyncedSha: null,
        retries: 0,
        retryTimer: null,
        appChangeTimer: null,
        allowSigned: false,
        lastStatus: undefined,
        recordedSha: null,
        disposed: false,
        idle: Promise.resolve(),
        resolveIdle: null,
      }
      sessions.set(target.id, session)
      target.once('destroyed', () => dispose(session))

      let initial: FileSignature | null = null
      try {
        initial = await statSignature(filePath)
      } catch {
        initial = null
      }
      if (session.disposed) return { ok: true }
      session.watcher = new StableFileWatcher(filePath, {
        ...deps.watcherOptions,
        initialSignature: initial,
        onStable: (_signature, firstEventAt) => request(session, 'file-change', firstEventAt),
      })
      session.watcher.start()
      request(session, 'open', null)
      return { ok: true }
    },

    /** End `target`'s session, if it is on `bookId` (a stale unwatch for an older book is ignored). */
    unwatch(target: SyncTarget, bookId: string): void {
      const session = sessions.get(target.id)
      if (session && session.bookId === bookId) dispose(session)
    },

    /**
     * A row of `bookId` was saved or deleted in Readmate: the sessions on
     * that book reconcile shortly after (edits within the debounce window are written together).
     */
    notifyAppChange(bookId: string): void {
      for (const session of sessions.values()) {
        if (session.bookId !== bookId || session.disposed || !deps.twoWay) continue
        if (session.appChangeTimer) clearTimeout(session.appChangeTimer)
        session.appChangeTimer = setTimeout(() => {
          session.appChangeTimer = null
          request(session, 'app-change', Date.now())
        }, APP_CHANGE_DEBOUNCE_MS)
        session.appChangeTimer.unref?.()
      }
    },

    /**
     * The user confirmed writing annotations into this signed PDF. Valid for the rest of the session
     * (the signature is already reported as modified after the first write); then reconcile now.
     */
    allowSignedWrite(target: SyncTarget, bookId: string): boolean {
      const session = sessions.get(target.id)
      if (!session || session.bookId !== bookId || session.disposed) return false
      session.allowSigned = true
      session.lastStatus = undefined
      request(session, 'app-change', Date.now())
      return true
    },

    disposeAll(): void {
      for (const session of [...sessions.values()]) dispose(session)
    },

    /** Test hooks. */
    activeSessions(): { targetId: number; bookId: string }[] {
      return [...sessions.values()].map((s) => ({ targetId: s.target.id, bookId: s.bookId }))
    },
    whenIdle(target: SyncTarget): Promise<void> {
      return sessions.get(target.id)?.idle ?? Promise.resolve()
    },
  }
}

export type PdfAnnotationSyncService = ReturnType<typeof createPdfAnnotationSyncService>

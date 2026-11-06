/**
 * Watch ONE file and report it only once a write has settled — for the PDF open in the reader
 * (docs/implementation_plan/pdf_embedded_annotation_live_sync.md §2). Must not import `electron`.
 *
 *  - `fs.watch` on the file's **directory**, filtered to its name: catches in-place writes and also
 *    "write a temp file, rename it over the original" saves (new inode), which a watch on the file
 *    itself loses track of.
 *  - A `stat` poll as a safety net (`fs.watch` events are not reliable everywhere).
 *  - Debounce, then a stability check: two `stat`s `stableMs` apart must agree on size, mtime and
 *    inode. A missing file (mid-replace) is waited out, never reported.
 *  - A settled signature equal to the last one reported is dropped (duplicate events, neighbours in
 *    the folder, reads by the app itself).
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export type FileSignature = { size: number; mtimeMs: number; ino: number }

export type StableFileWatcherOptions = {
  /** Quiet time after the last event before checking stability. */
  debounceMs?: number
  /** Gap between the two `stat`s of a stability check. */
  stableMs?: number
  /** `stat` poll interval (safety net for missed `fs.watch` events). */
  pollMs?: number
  /** Give up waiting for a file that keeps changing / stays missing after this long (until the next event). */
  maxWaitMs?: number
  /** Signature to treat as "already reported" (the state the caller has just handled itself). */
  initialSignature?: FileSignature | null
  /** Called with the settled signature and when the first event of this change was seen. */
  onStable: (signature: FileSignature, firstEventAt: number) => void
}

export function sameSignature(a: FileSignature | null | undefined, b: FileSignature | null | undefined): boolean {
  return !!a && !!b && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino
}

export async function statSignature(filePath: string): Promise<FileSignature | null> {
  try {
    const st = await fsp.stat(filePath)
    if (!st.isFile()) return null
    return { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino }
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class StableFileWatcher {
  private readonly dir: string
  private readonly base: string
  private readonly debounceMs: number
  private readonly stableMs: number
  private readonly pollMs: number
  private readonly maxWaitMs: number
  private readonly onStable: StableFileWatcherOptions['onStable']
  private lastReported: FileSignature | null
  private dirWatcher: fs.FSWatcher | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  /** Bumped by every event; a stability check in flight for an older generation stops. */
  private generation = 0
  private firstEventAt: number | null = null
  private polling = false
  private disposed = false

  constructor(
    private readonly filePath: string,
    options: StableFileWatcherOptions,
  ) {
    this.dir = path.dirname(filePath)
    this.base = path.basename(filePath)
    this.debounceMs = options.debounceMs ?? 250
    this.stableMs = options.stableMs ?? 400
    this.pollMs = options.pollMs ?? 2000
    this.maxWaitMs = options.maxWaitMs ?? 30_000
    this.lastReported = options.initialSignature ?? null
    this.onStable = options.onStable
  }

  start(): void {
    if (this.disposed) return
    try {
      this.dirWatcher = fs.watch(this.dir, { persistent: false }, (_event, filename) => {
        if (filename == null || this.matches(String(filename))) this.notify()
      })
      // A watch that dies (folder removed, permissions) leaves the poll in charge.
      this.dirWatcher.on('error', () => {
        this.dirWatcher?.close()
        this.dirWatcher = null
      })
    } catch {
      this.dirWatcher = null
    }
    this.pollTimer = setInterval(() => void this.poll(), this.pollMs)
    this.pollTimer.unref?.()
  }

  dispose(): void {
    this.disposed = true
    this.generation++
    this.dirWatcher?.close()
    this.dirWatcher = null
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.pollTimer = null
    this.debounceTimer = null
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  /** Something may have changed (also what the directory watch and the poll call). */
  notify(): void {
    if (this.disposed) return
    this.firstEventAt ??= Date.now()
    const generation = ++this.generation
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.settle(generation)
    }, this.debounceMs)
  }

  private matches(filename: string): boolean {
    return process.platform === 'win32' ? filename.toLowerCase() === this.base.toLowerCase() : filename === this.base
  }

  private async poll(): Promise<void> {
    if (this.disposed || this.polling || this.debounceTimer) return
    this.polling = true
    try {
      const current = await statSignature(this.filePath)
      if (!this.disposed && current && !sameSignature(current, this.lastReported)) this.notify()
    } finally {
      this.polling = false
    }
  }

  private async settle(generation: number): Promise<void> {
    const startedAt = this.firstEventAt ?? Date.now()
    while (!this.disposed && generation === this.generation) {
      const a = await statSignature(this.filePath)
      await sleep(this.stableMs)
      if (this.disposed || generation !== this.generation) return
      const b = await statSignature(this.filePath)
      if (a && b && sameSignature(a, b)) {
        this.firstEventAt = null
        if (sameSignature(b, this.lastReported)) return
        this.lastReported = b
        this.onStable(b, startedAt)
        return
      }
      if (Date.now() - startedAt > this.maxWaitMs) {
        // Still changing / still missing: stop until the next event or poll hit.
        this.firstEventAt = null
        return
      }
    }
  }
}

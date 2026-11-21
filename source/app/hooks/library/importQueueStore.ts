/**
 * Spec 016 (US3, research R6): the background import queue — one store for Desktop and the phone.
 *
 * Pure rules live in core `app-models/import-queue.ts`; this store holds the queue and runs it: ONE job at a time,
 * the oldest waiting first, through the host (`import:runJob` for a picked file, `import:fromUrl` for a link, the ZIP
 * importer for an audiobook archive). Progress events update the running job; a finished import adds that one book to
 * `libraryBooksStore` (no list reload). The host is told the queue size (Desktop quit confirmation) and, on the phone,
 * the snapshot is saved after each change (FR-013b). Module-level, so leaving the Library keeps it.
 */
import { create } from 'zustand'
import {
  activityOf,
  clearFinished as clearFinishedJobs,
  dismissJob as dismissQueueJob,
  emptyImportQueue,
  enqueueJobs,
  finishJob,
  fromQueueSnapshot,
  interruptJob,
  mapBookSummary,
  nextToRun,
  progressJob,
  requestCancel,
  retryJob,
  startJob,
  toQueueSnapshot,
  type ImportJob,
  type ImportJobOutcome,
  type ImportQueue,
  type ImportStep,
  type NewImportJob,
} from '@core'
import { importApi } from '../../bridge/import'
import { libraryApi } from '../../bridge/library'
import { api } from '../../platforms/api'
import { useLibraryBooksStore } from './libraryBooksStore.js'

/** Result shape of the host import calls (`ImportResult`). */
type HostImportResult = { ok: boolean; bookId: string | null; errorCode?: string; errorMessage?: string }

/** A ZIP job is run by the ZIP importer, which reports its own progress (T059). */
export type ZipJobRunner = (
  selection: unknown,
  onProgress: (update: { step: ImportStep; done: number; total: number | null }) => void,
) => Promise<ImportJobOutcome>

/** The last finished job / batch, for the result pill and the single-file message (contracts/import-ui.md). */
export type ImportResultNotice =
  | { kind: 'single'; jobId: string; at: number }
  | { kind: 'batch'; batchId: string; at: number }

type ImportQueueState = {
  queue: ImportQueue
  /** The card is open (otherwise the pill shows). */
  expanded: boolean
  /** The newest finished job or batch whose result the pill shows (null: no result pill). */
  notice: ImportResultNotice | null
  addPicked: (
    items: { pickId: string; name: string; sizeBytes: number; kind: 'book' | 'zip' | 'unsupported' }[],
    notAdded: number,
    unsupportedMessage: string,
  ) => void
  addUrl: (url: string, name: string) => void
  addZip: (selection: unknown, name: string, sizeBytes: number | null) => void
  cancel: (jobId: string) => void
  cancelAll: () => void
  retry: (jobId: string) => void
  dismiss: (jobId: string) => void
  clearFinished: () => void
  dismissNotice: () => void
  setExpanded: (open: boolean) => void
}

let zipRunner: ZipJobRunner | null = null
/** Registered by `zipImportStore` (avoids an import cycle). */
export function registerZipJobRunner(runner: ZipJobRunner): void {
  zipRunner = runner
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `job-${Date.now()}-${Math.random().toString(36).slice(2)}`)

/** Jobs restored from the phone snapshot: an unreadable pick there means "Interrupted", not "failed" (FR-013b). */
const restored = new Set<string>()
let running: string | null = null

function outcomeOf(result: HostImportResult, jobId: string): ImportJobOutcome {
  if (result.ok && result.bookId) return { kind: 'done', bookId: result.bookId }
  if (result.errorCode === 'duplicate' && result.bookId) return { kind: 'duplicate', bookId: result.bookId }
  if (result.errorCode === 'cancelled') return { kind: 'cancelled' }
  if (restored.has(jobId) && (result.errorCode === 'missing_file' || result.errorCode === 'access_denied')) {
    return { kind: 'interrupted', error: { code: 'interrupted', message: { key: 'import.queue.interrupted' } } }
  }
  return {
    kind: 'failed',
    error: { code: result.errorCode ?? 'save_failed', message: result.errorMessage ?? { key: 'library.toast.importFailed' } },
  }
}

async function runOne(job: ImportJob): Promise<ImportJobOutcome> {
  const source = job.source
  try {
    if (source.kind === 'pick') return outcomeOf(await importApi.runJob(job.id, source.pickId), job.id)
    if (source.kind === 'url') return outcomeOf(await importApi.fromUrl(source.url), job.id)
    if (source.kind === 'zip') {
      if (!zipRunner) return { kind: 'failed', error: { code: 'save_failed', message: { key: 'library.toast.zipImportFailed' } } }
      return await zipRunner(source.selection, (update) => {
        useImportQueueStore.setState((s) => ({ queue: progressJob(s.queue, job.id, update, Date.now()) }))
      })
    }
    return { kind: 'failed', error: { code: 'unsupported_format', message: { key: 'import.queue.unsupported' } } }
  } catch {
    return { kind: 'failed', error: { code: 'save_failed', message: { key: 'library.toast.importFailed' } } }
  }
}

/** A finished import adds that one book to the Library list (FR-006 / R8: no whole-list reload). */
async function addFinishedBook(bookId: string): Promise<void> {
  try {
    const dto = await libraryApi.getBook(bookId)
    if (dto) useLibraryBooksStore.getState().upsertBook(mapBookSummary(dto))
  } catch {
    // The next full load shows it.
  }
}

function afterChange(queue: ImportQueue): void {
  const { running: r, waiting } = activityOf(queue)
  void importApi.reportActivity(r, waiting)
  if (api.importQueue) void api.importQueue.save(toQueueSnapshot(queue)).catch(() => {})
}

async function pump(): Promise<void> {
  if (running) return
  const next = nextToRun(useImportQueueStore.getState().queue)
  if (!next) return
  running = next.id
  useImportQueueStore.setState((s) => ({ queue: startJob(s.queue, next.id, Date.now()) }))
  afterChange(useImportQueueStore.getState().queue)
  const outcome = await runOne(next)
  if (outcome.kind === 'done') await addFinishedBook(outcome.bookId)
  useImportQueueStore.setState((s) => {
    const queue = finishJob(s.queue, next.id, outcome, Date.now())
    const job = queue.jobs.find((j) => j.id === next.id)
    const notice: ImportResultNotice | null = job?.batchId
      ? queue.batches[job.batchId]?.members.every((m) => queue.batches[job.batchId!]!.outcomes[m])
        ? { kind: 'batch', batchId: job.batchId, at: Date.now() }
        : s.notice
      : { kind: 'single', jobId: next.id, at: Date.now() }
    return { queue, notice }
  })
  restored.delete(next.id)
  running = null
  afterChange(useImportQueueStore.getState().queue)
  void pump()
}

function enqueue(items: NewImportJob[], batch?: { batchId: string; notAdded: number }): void {
  useImportQueueStore.setState((s) => ({
    queue: enqueueJobs(s.queue, items, { now: Date.now(), batchId: batch?.batchId, notAdded: batch?.notAdded }),
  }))
  afterChange(useImportQueueStore.getState().queue)
  void pump()
}

export const useImportQueueStore = create<ImportQueueState>((set, get) => ({
  queue: emptyImportQueue(),
  expanded: false,
  notice: null,

  addPicked: (items, notAdded, unsupportedMessage) => {
    const jobs: NewImportJob[] = items
      .filter((item) => item.kind !== 'zip')
      .map((item) =>
        item.kind === 'book'
          ? { id: newId(), name: item.name, sizeBytes: item.sizeBytes, source: { kind: 'pick', pickId: item.pickId } }
          : {
              id: newId(),
              name: item.name,
              sizeBytes: item.sizeBytes,
              source: { kind: 'pick', pickId: '' },
              failed: { code: 'unsupported_format', message: unsupportedMessage },
            },
      )
    if (jobs.length === 0) return
    enqueue(jobs, jobs.length > 1 || notAdded > 0 ? { batchId: newId(), notAdded } : undefined)
  },

  addUrl: (url, name) => enqueue([{ id: newId(), name, sizeBytes: null, source: { kind: 'url', url } }]),

  addZip: (selection, name, sizeBytes) => enqueue([{ id: newId(), name, sizeBytes, source: { kind: 'zip', selection } }]),

  cancel: (jobId) => {
    const job = get().queue.jobs.find((j) => j.id === jobId)
    const { queue, accepted } = requestCancel(get().queue, jobId)
    if (!accepted || !job) return
    set({ queue })
    if (job.state === 'running') {
      if (job.source.kind === 'pick') void importApi.cancelJob(jobId).catch(() => {})
      else if (job.source.kind === 'url') void importApi.cancel().catch(() => {})
      else if (job.source.kind === 'zip') void cancelZip()
    }
    afterChange(get().queue)
  },

  cancelAll: () => {
    for (const job of get().queue.jobs) if (job.state === 'waiting' || job.state === 'running') get().cancel(job.id)
  },

  retry: (jobId) => {
    const job = get().queue.jobs.find((j) => j.id === jobId)
    if (!job) return
    if (job.source.kind === 'pick' && (job.state === 'interrupted' || !job.source.pickId)) {
      // A lost pick cannot be read again: Try again opens the picker (FR-013b); the old entry goes.
      set((s) => ({ queue: dismissQueueJob(s.queue, jobId) }))
      void pickAndQueue()
      return
    }
    set((s) => ({ queue: retryJob(s.queue, jobId, newId(), Date.now()) }))
    afterChange(get().queue)
    void pump()
  },

  dismiss: (jobId) => {
    set((s) => ({ queue: dismissQueueJob(s.queue, jobId) }))
    afterChange(get().queue)
  },

  clearFinished: () => {
    set((s) => ({ queue: clearFinishedJobs(s.queue), notice: null }))
    afterChange(get().queue)
  },

  dismissNotice: () => set({ notice: null }),
  setExpanded: (open) => set({ expanded: open }),
}))

/** Set by `zipImportStore` so a ZIP job's Cancel reaches the ZIP importer. */
let cancelZip: () => Promise<void> = async () => {}
export function registerZipJobCancel(fn: () => Promise<void>): void {
  cancelZip = fn
}

/** What the Library's "Add file" does (set by `useLibraryImport`, reused by Try again on a lost pick). */
let pickAndQueue: () => Promise<void> = async () => {}
export function registerPickAndQueue(fn: () => Promise<void>): void {
  pickAndQueue = fn
}

let started = false
/**
 * Starts the queue once per app run: progress / cancel-all subscriptions and, on the phone, the saved queue of the
 * last launch (a job that was running → "Interrupted"; waiting jobs continue; a lost pick → "Interrupted").
 */
export async function startImportQueue(): Promise<void> {
  if (started) return
  started = true
  importApi.onProgress((p) => {
    const id = running
    if (!id) return
    const job = useImportQueueStore.getState().queue.jobs.find((j) => j.id === id)
    if (!job || (p.jobId && p.jobId !== id)) return
    const step: ImportStep = p.step ?? (p.stage === 'downloading' ? 'downloading' : 'checking')
    const done = p.doneBytes ?? p.receivedBytes ?? 0
    const total = p.totalBytes ?? null
    useImportQueueStore.setState((s) => ({ queue: progressJob(s.queue, id, { step, done, total }, Date.now()) }))
  })
  importApi.onCancelAll(() => useImportQueueStore.getState().cancelAll())
  if (api.importQueue) {
    const snapshot = await api.importQueue.load().catch(() => null)
    if (snapshot && snapshot.jobs.length > 0) {
      let queue = fromQueueSnapshot(snapshot)
      for (const job of queue.jobs) {
        if (job.state !== 'waiting') continue
        restored.add(job.id)
        if (job.source.kind === 'pick' && !job.source.pickId) queue = interruptJob(queue, job.id)
      }
      useImportQueueStore.setState({ queue })
      afterChange(queue)
    }
  }
  void pump()
}

/** For checks: resets module state (spikes / tests only). */
export function resetImportQueueForTests(): void {
  started = false
  running = null
  restored.clear()
  useImportQueueStore.setState({ queue: emptyImportQueue(), expanded: false, notice: null })
}

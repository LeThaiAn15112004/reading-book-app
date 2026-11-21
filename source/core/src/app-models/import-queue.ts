/**
 * Spec 016 (US3, data-model.md): the import queue shared by Desktop and the phone, as pure state transitions.
 *
 * One job runs at a time, the oldest waiting first (FR-011); a job cannot be cancelled while it is "Saving" (FR-009);
 * a multi-file pick forms a batch whose summary has five groups that always add up to the files queued (FR-011a);
 * the Library shows waiting / running jobs as placeholders (FR-010); the phone keeps a snapshot of unfinished jobs
 * across launches, a job that was running coming back as "Interrupted" (FR-013b).
 *
 * Every function returns a NEW queue (or the same object when nothing changes). No I/O, no clock: `now` is passed.
 */
import type { MessageRef } from '../i18n/translate.js'

export type ImportStep = 'downloading' | 'copying' | 'checking' | 'reading' | 'saving'

export type ImportJobState = 'waiting' | 'running' | 'done' | 'duplicate' | 'failed' | 'cancelled' | 'interrupted'

/** Where a job's file comes from — never a filesystem path. `zip` carries the confirmed ZIP preview selection. */
export type ImportJobSource =
  | { kind: 'pick'; pickId: string }
  | { kind: 'url'; url: string }
  | { kind: 'cloud'; provider: string; externalId: string }
  | { kind: 'zip'; selection: unknown }

/** A message from a host (already in the interface language) or a catalogue reference. */
export type ImportMessage = string | MessageRef

export type ImportJobError = { code: string; message: ImportMessage; retryable: boolean }

export type ImportJob = {
  id: string
  batchId: string | null
  source: ImportJobSource
  /** Shown name (file / URL basename / archive) — user data, never translated. */
  name: string
  sizeBytes: number | null
  state: ImportJobState
  step: ImportStep | null
  /** When the current step began (elapsed-seconds counter, SC-004); null unless running. */
  stepStartedAt: number | null
  progress: { done: number; total: number | null } | null
  cancelRequested: boolean
  /** `done`: the new book; `duplicate`: the existing one. */
  bookId: string | null
  error: ImportJobError | null
  queuedAt: number
}

type BatchOutcome = { state: ImportJobState; name: string; bookId: string | null; message: ImportMessage | null }

export type ImportBatch = {
  /** Files queued in this batch (picked minus the ones left out). */
  total: number
  /** Files beyond the 50-per-pick limit (FR-011a). */
  notAdded: number
  /** The batch's current job ids, in order (a retried job replaces its predecessor). */
  members: string[]
  /** Final outcome per member job id; kept when a job is dismissed. */
  outcomes: Record<string, BatchOutcome>
}

export type ImportQueue = {
  jobs: ImportJob[]
  batches: Record<string, ImportBatch>
}

export type NewImportJob = {
  id: string
  name: string
  sizeBytes: number | null
  source: ImportJobSource
  /** Created already failed (an unsupported file in a multi-pick): counted in the batch summary (FR-011a). */
  failed?: { code: string; message: ImportMessage }
}

export type ImportJobOutcome =
  | { kind: 'done'; bookId: string }
  | { kind: 'duplicate'; bookId: string }
  | { kind: 'failed'; error: { code: string; message: ImportMessage } }
  | { kind: 'cancelled' }
  | { kind: 'interrupted'; error: { code: string; message: ImportMessage } }

/** data-model.md: retryable — network, timeout, http, interrupted, file_changed, save_failed, no_space. */
const RETRYABLE = new Set(['network', 'timeout', 'http', 'http_status', 'interrupted', 'file_changed', 'save_failed', 'no_space'])

export function isRetryableImportError(code: string): boolean {
  return RETRYABLE.has(code)
}

const FINISHED: ReadonlySet<ImportJobState> = new Set(['done', 'duplicate', 'failed', 'cancelled', 'interrupted'])

export function isFinishedJob(job: Pick<ImportJob, 'state'>): boolean {
  return FINISHED.has(job.state)
}

export function emptyImportQueue(): ImportQueue {
  return { jobs: [], batches: {} }
}

function replaceJob(queue: ImportQueue, id: string, change: (job: ImportJob) => ImportJob | null): ImportQueue {
  const i = queue.jobs.findIndex((j) => j.id === id)
  if (i < 0) return queue
  const next = change(queue.jobs[i]!)
  if (next === queue.jobs[i]) return queue
  const jobs = queue.jobs.slice()
  if (next === null) jobs.splice(i, 1)
  else jobs[i] = next
  return { ...queue, jobs }
}

function recordOutcome(queue: ImportQueue, job: ImportJob): ImportQueue {
  if (!job.batchId || !isFinishedJob(job)) return queue
  const batch = queue.batches[job.batchId]
  if (!batch || !batch.members.includes(job.id)) return queue
  const message = job.error?.message ?? null
  return {
    ...queue,
    batches: {
      ...queue.batches,
      [job.batchId]: { ...batch, outcomes: { ...batch.outcomes, [job.id]: { state: job.state, name: job.name, bookId: job.bookId, message } } },
    },
  }
}

/** Adds jobs at the end of the queue; with `batchId`, they form one batch (a multi-file pick). */
export function enqueueJobs(
  queue: ImportQueue,
  items: readonly NewImportJob[],
  options: { now: number; batchId?: string; notAdded?: number },
): ImportQueue {
  const batchId = options.batchId ?? null
  const added: ImportJob[] = items.map((item) => ({
    id: item.id,
    batchId,
    source: item.source,
    name: item.name,
    sizeBytes: item.sizeBytes,
    state: item.failed ? 'failed' : 'waiting',
    step: null,
    stepStartedAt: null,
    progress: null,
    cancelRequested: false,
    bookId: null,
    error: item.failed ? { ...item.failed, retryable: isRetryableImportError(item.failed.code) } : null,
    queuedAt: options.now,
  }))
  let next: ImportQueue = { ...queue, jobs: [...queue.jobs, ...added] }
  if (batchId) {
    next = {
      ...next,
      batches: {
        ...next.batches,
        [batchId]: { total: added.length, notAdded: options.notAdded ?? 0, members: added.map((j) => j.id), outcomes: {} },
      },
    }
    for (const job of added) next = recordOutcome(next, job)
  }
  return next
}

/** The job to run now: the oldest waiting one, and none while a job runs. */
export function nextToRun(queue: ImportQueue): ImportJob | undefined {
  if (queue.jobs.some((j) => j.state === 'running')) return undefined
  return queue.jobs.find((j) => j.state === 'waiting')
}

function firstStep(source: ImportJobSource): ImportStep {
  if (source.kind === 'url' || source.kind === 'cloud') return 'downloading'
  if (source.kind === 'zip') return 'copying'
  return 'checking'
}

export function startJob(queue: ImportQueue, id: string, now: number): ImportQueue {
  return replaceJob(queue, id, (job) =>
    job.state !== 'waiting'
      ? job
      : { ...job, state: 'running', step: firstStep(job.source), stepStartedAt: now, progress: null, cancelRequested: false },
  )
}

export function progressJob(
  queue: ImportQueue,
  id: string,
  update: { step: ImportStep; done: number; total: number | null },
  now: number,
): ImportQueue {
  return replaceJob(queue, id, (job) => {
    if (job.state !== 'running') return job
    const stepChanged = job.step !== update.step
    return {
      ...job,
      step: update.step,
      stepStartedAt: stepChanged ? now : job.stepStartedAt,
      progress: { done: Math.max(0, update.done), total: update.total },
    }
  })
}

export function finishJob(queue: ImportQueue, id: string, outcome: ImportJobOutcome, _now: number): ImportQueue {
  let finished: ImportJob | null = null
  const next = replaceJob(queue, id, (job) => {
    if (isFinishedJob(job)) return job
    const base = { ...job, step: null, stepStartedAt: null, cancelRequested: false }
    switch (outcome.kind) {
      case 'done':
        finished = { ...base, state: 'done', bookId: outcome.bookId, error: null }
        break
      case 'duplicate':
        finished = { ...base, state: 'duplicate', bookId: outcome.bookId, error: null }
        break
      case 'cancelled':
        finished = { ...base, state: 'cancelled', error: null }
        break
      case 'failed':
        finished = { ...base, state: 'failed', error: { ...outcome.error, retryable: isRetryableImportError(outcome.error.code) } }
        break
      case 'interrupted':
        finished = { ...base, state: 'interrupted', error: { ...outcome.error, retryable: true } }
        break
    }
    return finished
  })
  return finished ? recordOutcome(next, finished) : next
}

export type CancelResult = { queue: ImportQueue; accepted: boolean; reason?: 'saving' | 'finished' | 'unknown' }

/**
 * Cancel (FR-009): a waiting job is cancelled at once; a running one is flagged (the runner asks the host to stop and
 * then finishes it as `cancelled`); refused while "Saving" — the import completes ("Finishing…").
 */
export function requestCancel(queue: ImportQueue, id: string): CancelResult {
  const job = queue.jobs.find((j) => j.id === id)
  if (!job) return { queue, accepted: false, reason: 'unknown' }
  if (isFinishedJob(job)) return { queue, accepted: false, reason: 'finished' }
  if (job.state === 'waiting') return { queue: finishJob(queue, id, { kind: 'cancelled' }, 0), accepted: true }
  if (job.step === 'saving') return { queue, accepted: false, reason: 'saving' }
  return { queue: replaceJob(queue, id, (j) => ({ ...j, cancelRequested: true })), accepted: true }
}

/** Try again: a new waiting job with the same source at the end (same batch); the old entry goes. */
export function retryJob(queue: ImportQueue, id: string, newId: string, now: number): ImportQueue {
  const job = queue.jobs.find((j) => j.id === id)
  if (!job || !(job.state === 'interrupted' || (job.state === 'failed' && job.error?.retryable))) return queue
  const fresh: ImportJob = {
    ...job,
    id: newId,
    state: 'waiting',
    step: null,
    stepStartedAt: null,
    progress: null,
    cancelRequested: false,
    bookId: null,
    error: null,
    queuedAt: now,
  }
  let batches = queue.batches
  if (job.batchId && batches[job.batchId]) {
    const batch = batches[job.batchId]!
    const outcomes = { ...batch.outcomes }
    delete outcomes[id]
    batches = { ...batches, [job.batchId]: { ...batch, members: batch.members.map((m) => (m === id ? newId : m)), outcomes } }
  }
  return { jobs: [...queue.jobs.filter((j) => j.id !== id), fresh], batches }
}

/** Removes a finished job from the list (its batch outcome stays). Waiting / running jobs are not dismissable. */
export function dismissJob(queue: ImportQueue, id: string): ImportQueue {
  return replaceJob(queue, id, (job) => (isFinishedJob(job) ? null : job))
}

export function clearFinished(queue: ImportQueue): ImportQueue {
  const jobs = queue.jobs.filter((j) => !isFinishedJob(j))
  return jobs.length === queue.jobs.length ? queue : { ...queue, jobs }
}

export function progressPercent(job: Pick<ImportJob, 'progress'>): number | null {
  const p = job.progress
  if (!p || p.total === null || p.total <= 0) return null
  return Math.max(0, Math.min(100, Math.round((p.done / p.total) * 100)))
}

export type BatchSummaryGroup = 'added' | 'already' | 'failed' | 'cancelled' | 'interrupted'

export type ImportBatchSummary = {
  total: number
  notAdded: number
  finished: boolean
  added: number
  alreadyInLibrary: number
  failed: { jobId: string; name: string; message: ImportMessage }[]
  cancelled: number
  interrupted: { jobId: string; name: string }[]
  /** The groups to show (zero groups hidden), in display order. */
  groups: BatchSummaryGroup[]
  /** "Open" when exactly one book was added. */
  openBookId: string | null
}

export function summarizeBatch(queue: ImportQueue, batchId: string): ImportBatchSummary | null {
  const batch = queue.batches[batchId]
  if (!batch) return null
  const s: ImportBatchSummary = {
    total: batch.total,
    notAdded: batch.notAdded,
    finished: batch.members.every((id) => batch.outcomes[id] !== undefined),
    added: 0,
    alreadyInLibrary: 0,
    failed: [],
    cancelled: 0,
    interrupted: [],
    groups: [],
    openBookId: null,
  }
  let addedBook: string | null = null
  for (const id of batch.members) {
    const o = batch.outcomes[id]
    if (!o) continue
    if (o.state === 'done') {
      s.added += 1
      addedBook = o.bookId
    } else if (o.state === 'duplicate') s.alreadyInLibrary += 1
    else if (o.state === 'failed') s.failed.push({ jobId: id, name: o.name, message: o.message ?? '' })
    else if (o.state === 'cancelled') s.cancelled += 1
    else if (o.state === 'interrupted') s.interrupted.push({ jobId: id, name: o.name })
  }
  if (s.added) s.groups.push('added')
  if (s.alreadyInLibrary) s.groups.push('already')
  if (s.failed.length) s.groups.push('failed')
  if (s.cancelled) s.groups.push('cancelled')
  if (s.interrupted.length) s.groups.push('interrupted')
  s.openBookId = s.added === 1 ? addedBook : null
  return s
}

export type ImportPlaceholder = {
  jobId: string
  name: string
  state: 'waiting' | 'running'
  step: ImportStep | null
  percent: number | null
}

/** FR-010: what the Library shows for jobs still to finish (running first, then waiting in order). */
export function placeholdersOf(queue: ImportQueue): ImportPlaceholder[] {
  const live = queue.jobs.filter((j) => j.state === 'running' || j.state === 'waiting')
  live.sort((a, b) => (a.state === b.state ? 0 : a.state === 'running' ? -1 : 1))
  return live.map((j) => ({
    jobId: j.id,
    name: j.name,
    state: j.state as 'waiting' | 'running',
    step: j.state === 'running' ? j.step : null,
    percent: j.state === 'running' ? progressPercent(j) : null,
  }))
}

/**
 * Books added by the imports still on screen (finished jobs, and batch outcomes kept after a job was dismissed).
 * The Library shows them before the placeholders so each book appears as soon as its import ends.
 */
export function importedBookIdsOf(queue: ImportQueue): Set<string> {
  const ids = new Set<string>()
  for (const j of queue.jobs) if (j.state === 'done' && j.bookId) ids.add(j.bookId)
  for (const batch of Object.values(queue.batches)) {
    for (const o of Object.values(batch.outcomes)) if (o.state === 'done' && o.bookId) ids.add(o.bookId)
  }
  return ids
}

/**
 * How many of the first visible books go BEFORE the placeholders: the run's imported books at the top of a
 * "recently added" list (newest first), so the order is already the final one when the queue drains. Any other
 * sort puts those books where they belong and the placeholders stay first (0).
 */
export function importedLeadCount(visibleBookIds: readonly string[], imported: ReadonlySet<string>, sort: string): number {
  if (sort !== 'recently-added' || imported.size === 0) return 0
  let n = 0
  while (n < visibleBookIds.length && imported.has(visibleBookIds[n]!)) n += 1
  return n
}

/** FR-013a: what the quit guard asks about. */
export function activityOf(queue: ImportQueue): { running: number; waiting: number } {
  let running = 0
  let waiting = 0
  for (const j of queue.jobs) {
    if (j.state === 'running') running += 1
    else if (j.state === 'waiting') waiting += 1
  }
  return { running, waiting }
}

export type QueueSnapshotJob = Pick<ImportJob, 'id' | 'batchId' | 'source' | 'name' | 'sizeBytes' | 'state' | 'queuedAt'>

export type QueueSnapshot = { version: 1; jobs: QueueSnapshotJob[] }

const KEPT_IN_SNAPSHOT: ReadonlySet<ImportJobState> = new Set(['waiting', 'running', 'failed', 'interrupted'])

/** FR-013b: the small list the phone keeps across launches (no bytes, no path, no progress). */
export function toQueueSnapshot(queue: ImportQueue): QueueSnapshot {
  return {
    version: 1,
    jobs: queue.jobs
      .filter((j) => KEPT_IN_SNAPSHOT.has(j.state))
      .map(({ id, batchId, source, name, sizeBytes, state, queuedAt }) => ({ id, batchId, source, name, sizeBytes, state, queuedAt })),
  }
}

/** The interrupted message every restored running job gets (`import.queue.interrupted`). */
export const INTERRUPTED_MESSAGE: MessageRef = { key: 'import.queue.interrupted' }

/** After a relaunch: a job that was running is "Interrupted" (Try again); waiting jobs continue in order. */
export function fromQueueSnapshot(snapshot: QueueSnapshot | null | undefined): ImportQueue {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.jobs)) return emptyImportQueue()
  const jobs: ImportJob[] = snapshot.jobs.map((s) => {
    const wasRunning = s.state === 'running' || s.state === 'interrupted'
    return {
      ...s,
      batchId: null, // batches are session-only: a relaunch starts a fresh summary
      state: wasRunning ? 'interrupted' : s.state === 'failed' ? 'failed' : 'waiting',
      step: null,
      stepStartedAt: null,
      progress: null,
      cancelRequested: false,
      bookId: null,
      error: wasRunning
        ? { code: 'interrupted', message: INTERRUPTED_MESSAGE, retryable: true }
        : s.state === 'failed'
          ? { code: 'save_failed', message: INTERRUPTED_MESSAGE, retryable: true }
          : null,
    }
  })
  return { jobs, batches: {} }
}

/** Marks a waiting job whose picked file can no longer be read after a relaunch as "Interrupted" (FR-013b). */
export function interruptJob(queue: ImportQueue, id: string): ImportQueue {
  return finishJob(queue, id, { kind: 'interrupted', error: { code: 'interrupted', message: INTERRUPTED_MESSAGE } }, 0)
}

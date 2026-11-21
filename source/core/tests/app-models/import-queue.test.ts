import { describe, expect, it } from 'vitest'
import {
  activityOf,
  clearFinished,
  dismissJob,
  emptyImportQueue,
  enqueueJobs,
  finishJob,
  fromQueueSnapshot,
  isRetryableImportError,
  nextToRun,
  placeholdersOf,
  progressJob,
  progressPercent,
  requestCancel,
  retryJob,
  startJob,
  summarizeBatch,
  toQueueSnapshot,
  type ImportQueue,
  type NewImportJob,
} from '../../src/app-models/import-queue'

const pick = (id: string, name = `${id}.pdf`, sizeBytes = 1000): NewImportJob => ({
  id,
  name,
  sizeBytes,
  source: { kind: 'pick', pickId: `p-${id}` },
})

function queued(...ids: string[]): ImportQueue {
  return enqueueJobs(emptyImportQueue(), ids.map((id) => pick(id)), { now: 1 })
}

const job = (q: ImportQueue, id: string) => q.jobs.find((j) => j.id === id)!

describe('import queue: order and transitions (FR-011)', () => {
  it('runs the oldest waiting job, one at a time', () => {
    let q = queued('a', 'b', 'c')
    expect(nextToRun(q)?.id).toBe('a')
    q = startJob(q, 'a', 10)
    expect(nextToRun(q)).toBeUndefined()
    expect(job(q, 'a')).toMatchObject({ state: 'running', step: 'checking', stepStartedAt: 10 })
    q = finishJob(q, 'a', { kind: 'done', bookId: 'book-a' }, 20)
    expect(nextToRun(q)?.id).toBe('b')
    expect(job(q, 'a')).toMatchObject({ state: 'done', bookId: 'book-a', step: null, stepStartedAt: null })
  })

  it('starts a URL / cloud job at "downloading" and a ZIP job at "copying"', () => {
    let q = enqueueJobs(
      emptyImportQueue(),
      [
        { id: 'u', name: 'x.epub', sizeBytes: null, source: { kind: 'url', url: 'https://example.org/x.epub' } },
        { id: 'z', name: 'book.zip', sizeBytes: 9, source: { kind: 'zip', selection: { any: 'value' } } },
      ],
      { now: 1 },
    )
    q = startJob(q, 'u', 2)
    expect(job(q, 'u').step).toBe('downloading')
    q = finishJob(q, 'u', { kind: 'failed', error: { code: 'network', message: 'Network error' } }, 3)
    q = startJob(q, 'z', 4)
    expect(job(q, 'z').step).toBe('copying')
  })

  it('progress updates bytes; a step change restarts the step clock (elapsed counter)', () => {
    let q = startJob(queued('a'), 'a', 100)
    q = progressJob(q, 'a', { step: 'checking', done: 50, total: 200 }, 150)
    expect(job(q, 'a')).toMatchObject({ progress: { done: 50, total: 200 }, stepStartedAt: 100 })
    expect(progressPercent(job(q, 'a'))).toBe(25)
    q = progressJob(q, 'a', { step: 'reading', done: 0, total: null }, 300)
    expect(job(q, 'a')).toMatchObject({ step: 'reading', stepStartedAt: 300 })
    expect(progressPercent(job(q, 'a'))).toBeNull()
  })

  it('ignores progress and finishes for jobs that are not running', () => {
    const q = queued('a')
    expect(progressJob(q, 'a', { step: 'checking', done: 1, total: 2 }, 5)).toBe(q)
    expect(finishJob(q, 'missing', { kind: 'done', bookId: 'x' }, 5)).toBe(q)
  })
})

describe('cancel (FR-009)', () => {
  it('cancels a waiting job at once', () => {
    const { queue, accepted } = requestCancel(queued('a', 'b'), 'b')
    expect(accepted).toBe(true)
    expect(job(queue, 'b').state).toBe('cancelled')
  })

  it('flags a running job (the runner stops the host) before "Saving"', () => {
    const r = requestCancel(startJob(queued('a'), 'a', 1), 'a')
    expect(r.accepted).toBe(true)
    expect(job(r.queue, 'a')).toMatchObject({ state: 'running', cancelRequested: true })
  })

  it('refuses while saving ("Finishing…") and for finished jobs', () => {
    let q = startJob(queued('a'), 'a', 1)
    q = progressJob(q, 'a', { step: 'saving', done: 0, total: null }, 2)
    expect(requestCancel(q, 'a')).toMatchObject({ accepted: false, reason: 'saving' })
    q = finishJob(q, 'a', { kind: 'done', bookId: 'x' }, 3)
    expect(requestCancel(q, 'a')).toMatchObject({ accepted: false, reason: 'finished' })
  })
})

describe('retry, dismiss, clear', () => {
  it('Try again queues a new job with the same source at the end; dismiss removes a finished job', () => {
    let q = startJob(queued('a', 'b'), 'a', 1)
    q = finishJob(q, 'a', { kind: 'failed', error: { code: 'save_failed', message: 'Could not save' } }, 2)
    const retried = retryJob(q, 'a', 'a2', 3)
    expect(retried.jobs.map((j) => j.id)).toEqual(['b', 'a2'])
    expect(job(retried, 'a2')).toMatchObject({ state: 'waiting', source: { kind: 'pick', pickId: 'p-a' }, queuedAt: 3 })
    expect(dismissJob(retried, 'b')).toBe(retried) // still waiting: not dismissable
  })

  it('does not retry a failure retrying cannot fix', () => {
    let q = startJob(queued('a'), 'a', 1)
    q = finishJob(q, 'a', { kind: 'failed', error: { code: 'corrupted', message: 'Damaged' } }, 2)
    expect(job(q, 'a').error?.retryable).toBe(false)
    expect(retryJob(q, 'a', 'a2', 3)).toBe(q)
  })

  it('clearFinished keeps only waiting and running jobs', () => {
    let q = startJob(queued('a', 'b', 'c'), 'a', 1)
    q = finishJob(q, 'a', { kind: 'done', bookId: 'x' }, 2)
    q = startJob(q, 'b', 3)
    expect(clearFinished(q).jobs.map((j) => j.id)).toEqual(['b', 'c'])
  })
})

describe('retryable codes (data-model)', () => {
  it('matches the data-model lists', () => {
    for (const code of ['network', 'timeout', 'http', 'http_status', 'interrupted', 'file_changed', 'save_failed', 'no_space']) {
      expect(isRetryableImportError(code)).toBe(true)
    }
    for (const code of ['unsupported_format', 'corrupted', 'inside_app_data', 'duplicate', 'access_denied', 'cancelled']) {
      expect(isRetryableImportError(code)).toBe(false)
    }
  })
})

describe('batch summary (FR-011a)', () => {
  it('five groups whose counts add up to the files queued; zero groups hidden; Open when one was added', () => {
    let q = enqueueJobs(emptyImportQueue(), ['a', 'b', 'c', 'd', 'e'].map((id) => pick(id)), { now: 1, batchId: 'B', notAdded: 2 })
    expect(summarizeBatch(q, 'B')).toMatchObject({ total: 5, finished: false, notAdded: 2 })
    const outcomes = [
      ['a', { kind: 'done', bookId: 'book-a' }],
      ['b', { kind: 'duplicate', bookId: 'book-x' }],
      ['c', { kind: 'failed', error: { code: 'corrupted', message: 'Damaged' } }],
      ['d', { kind: 'cancelled' }],
      ['e', { kind: 'interrupted', error: { code: 'interrupted', message: 'Interrupted' } }],
    ] as const
    for (const [id, outcome] of outcomes) {
      q = startJob(q, id, 2)
      q = finishJob(q, id, outcome, 3)
    }
    const s = summarizeBatch(q, 'B')!
    expect(s).toMatchObject({ total: 5, finished: true, added: 1, alreadyInLibrary: 1, cancelled: 1, openBookId: 'book-a' })
    expect(s.failed).toEqual([{ jobId: 'c', name: 'c.pdf', message: 'Damaged' }])
    expect(s.interrupted).toEqual([{ jobId: 'e', name: 'e.pdf' }])
    expect(s.added + s.alreadyInLibrary + s.failed.length + s.cancelled + s.interrupted.length).toBe(s.total)
    expect(s.groups).toEqual(['added', 'already', 'failed', 'cancelled', 'interrupted'])
  })

  it('a dismissed job still counts; a retried one is counted once, by its last outcome', () => {
    let q = enqueueJobs(emptyImportQueue(), [pick('a'), pick('b')], { now: 1, batchId: 'B' })
    q = finishJob(startJob(q, 'a', 2), 'a', { kind: 'failed', error: { code: 'network', message: 'Net' } }, 3)
    q = finishJob(startJob(q, 'b', 4), 'b', { kind: 'done', bookId: 'book-b' }, 5)
    q = dismissJob(q, 'b')
    q = retryJob(q, 'a', 'a2', 6)
    expect(summarizeBatch(q, 'B')).toMatchObject({ finished: false })
    q = finishJob(startJob(q, 'a2', 7), 'a2', { kind: 'done', bookId: 'book-a' }, 8)
    const s = summarizeBatch(q, 'B')!
    expect(s).toMatchObject({ finished: true, added: 2, total: 2, openBookId: null })
    expect(s.groups).toEqual(['added'])
  })

  it('a job created failed (unsupported file in a multi-pick) counts as failed', () => {
    const q = enqueueJobs(
      emptyImportQueue(),
      [pick('a'), { ...pick('x', 'notes.docx'), failed: { code: 'unsupported_format', message: 'Not a book format' } }],
      { now: 1, batchId: 'B' },
    )
    expect(job(q, 'x')).toMatchObject({ state: 'failed', error: { retryable: false } })
    expect(nextToRun(q)?.id).toBe('a')
    expect(summarizeBatch(q, 'B')!.failed).toHaveLength(1)
  })
})

describe('placeholders and activity (FR-010, FR-013a)', () => {
  it('waiting and running jobs only, running first carries its percent', () => {
    let q = startJob(queued('a', 'b'), 'a', 1)
    q = progressJob(q, 'a', { step: 'checking', done: 1, total: 4 }, 2)
    expect(placeholdersOf(q)).toEqual([
      { jobId: 'a', name: 'a.pdf', state: 'running', step: 'checking', percent: 25 },
      { jobId: 'b', name: 'b.pdf', state: 'waiting', step: null, percent: null },
    ])
    expect(activityOf(q)).toEqual({ running: 1, waiting: 1 })
    q = finishJob(q, 'a', { kind: 'done', bookId: 'x' }, 3)
    expect(placeholdersOf(q).map((p) => p.jobId)).toEqual(['b'])
  })
})

describe('phone snapshot (FR-013b)', () => {
  it('keeps waiting / running / failed / interrupted jobs only, no bytes or paths', () => {
    let q = startJob(queued('a', 'b', 'c'), 'a', 1)
    q = finishJob(q, 'a', { kind: 'done', bookId: 'x' }, 2)
    q = startJob(q, 'b', 3)
    const snap = toQueueSnapshot(q)
    expect(snap.version).toBe(1)
    expect(snap.jobs.map((j) => [j.id, j.state])).toEqual([
      ['b', 'running'],
      ['c', 'waiting'],
    ])
    expect(Object.keys(snap.jobs[0]!).sort()).toEqual(['batchId', 'id', 'name', 'queuedAt', 'sizeBytes', 'source', 'state'])
  })

  it('restores a running job as "Interrupted" (Try again) and keeps the waiting ones in order', () => {
    let q = startJob(queued('a', 'b'), 'a', 1)
    const restored = fromQueueSnapshot(toQueueSnapshot(q))
    expect(job(restored, 'a')).toMatchObject({ state: 'interrupted', error: { code: 'interrupted', retryable: true } })
    expect(nextToRun(restored)?.id).toBe('b')
    q = fromQueueSnapshot({ version: 2, jobs: [] } as never)
    expect(q.jobs).toEqual([])
  })
})

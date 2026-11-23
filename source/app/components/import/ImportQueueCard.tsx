/**
 * Spec 016 (US3, contracts/import-ui.md): the background import indicator, mounted once above every route.
 *
 * - Collapsed: a 44 px pill — "Importing 2 of 5 · 42 %", or the elapsed time of a step without a percentage; after
 *   everything finished, the result ("4 added · 1 failed", or "{title} was added" for one file). One click / tap opens
 *   the card (FR-009 "reachable in one action").
 * - Expanded: the running job (name, step, bar, Cancel → "Finishing…" while saving), the waiting count, the batch
 *   summary and the session's list. Esc collapses it; on the phone the system Back closes it and never cancels.
 * - Result pill: hides by itself after 10 s when nothing failed or was interrupted — counting only while the window
 *   is shown and focused, paused while the pill has focus or the pointer is over it; kept otherwise.
 * - Screen readers: one polite live region announces step changes and results as full sentences; the elapsed
 *   counter is outside it and never read out.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { activityOf, progressPercent, type ImportJob } from '@core'
import { useFormat, useT } from '../../i18n'
import { useOpenReading } from '../../hooks/app/OpenReadingContext'
import { useBackClose } from '../../hooks/app/useBackClose'
import { useAutoHide } from '../../hooks/app/useAutoHide'
import { useImportQueueStore } from '../../hooks/library/importQueueStore'
import { useLibraryBooksStore } from '../../hooks/library/libraryBooksStore'
import { libraryApi } from '../../bridge/library'
import { ImportBatchSummary } from './ImportBatchSummary'
import { ImportQueueList } from './ImportQueueList'
import { batchSummaryLine, messageText, stepLabel } from './importQueueText'

/** Result pill without failures hides after this long (contracts/import-ui.md). */
export const RESULT_PILL_MS = 10_000

/** One countdown per result shown (a new result starts a fresh 10 s). */
function noticeKey(notice: { kind: 'single'; jobId: string; at: number } | { kind: 'batch'; batchId: string; at: number } | null): string {
  if (!notice) return 'none'
  return `${notice.kind === 'single' ? notice.jobId : notice.batchId}:${notice.at}`
}
/** The elapsed counter appears from the 2nd second of a step (no flash on short steps). */
const ELAPSED_FROM_MS = 2000

/** Seconds since `startedAt`, re-rendered every second, or null in the first 2 s (SC-004 counter). */
function useElapsed(startedAt: number | null, active: boolean): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active || startedAt === null) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active, startedAt])
  if (!active || startedAt === null) return null
  const ms = now - startedAt
  return ms < ELAPSED_FROM_MS ? null : Math.floor(ms / 1000)
}

function ProgressBar({ percent, label }: { percent: number | null; label: string }) {
  return (
    <div
      className="import-queue-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      data-indeterminate={percent === null ? '' : undefined}
    >
      <div className="import-queue-bar-fill" style={percent !== null ? { width: `${percent}%` } : undefined} />
    </div>
  )
}

export function ImportQueueCard() {
  const t = useT()
  const format = useFormat()
  const { openBook } = useOpenReading()
  const queue = useImportQueueStore((s) => s.queue)
  const expanded = useImportQueueStore((s) => s.expanded)
  const notice = useImportQueueStore((s) => s.notice)
  const store = useImportQueueStore.getState
  const books = useLibraryBooksStore((s) => s.books)

  const activity = activityOf(queue)
  const live = activity.running + activity.waiting
  const runningJob = queue.jobs.find((j) => j.state === 'running') ?? null
  const percent = runningJob ? progressPercent(runningJob) : null
  const elapsed = useElapsed(runningJob?.stepStartedAt ?? null, Boolean(runningJob) && percent === null)
  const elapsedText = elapsed !== null ? format.duration(elapsed, 'clock') : null

  // "Importing {current} of {total}": jobs of the current run that are finished or running, out of everything live.
  const position = useMemo(() => {
    const liveJobs = queue.jobs.filter((j) => j.state === 'running' || j.state === 'waiting')
    const firstLive = queue.jobs.findIndex((j) => j.state === 'running' || j.state === 'waiting')
    const doneBefore = firstLive < 0 ? 0 : queue.jobs.slice(0, firstLive).filter((j) => j.batchId && j.batchId === runningJob?.batchId).length
    return { current: doneBefore + 1, total: doneBefore + liveJobs.length }
  }, [queue.jobs, runningJob?.batchId])

  const noticeJob = notice?.kind === 'single' ? queue.jobs.find((j) => j.id === notice.jobId) ?? null : null
  const noticeHasProblem =
    notice?.kind === 'batch'
      ? Object.values(queue.batches[notice.batchId]?.outcomes ?? {}).some((o) => o.state === 'failed' || o.state === 'interrupted')
      : noticeJob?.state === 'failed' || noticeJob?.state === 'interrupted'
  const showResult = live === 0 && notice !== null && (notice.kind === 'batch' || noticeJob !== null)

  // ---- result auto-hide (10 s without interaction, only while the window is shown + focused, paused on hover /
  // focus). A success result hides even when the summary is open (it collapses too); a result with a failed /
  // interrupted job stays until the reader acts on it, so "Try again" is never missed (spec 016).
  const hideResult = useCallback(() => {
    store().setExpanded(false)
    store().dismissNotice()
  }, [store])
  const holdHandlers = useAutoHide(`import-queue:${noticeKey(notice)}`, showResult && !noticeHasProblem, hideResult, RESULT_PILL_MS)

  // ---- screen-reader announcements (one polite region; full sentences; never the counter) ---------------------
  const [announcement, setAnnouncement] = useState('')
  const lastStep = useRef<string>('')
  useEffect(() => {
    if (!runningJob) return
    const key = `${runningJob.id}:${runningJob.step}`
    if (key === lastStep.current) return
    lastStep.current = key
    setAnnouncement(t('import.queue.announce.step', { step: stepLabel(t, runningJob.step), name: runningJob.name }))
  }, [runningJob, t])
  const lastNotice = useRef<unknown>(null)
  useEffect(() => {
    if (!notice || notice === lastNotice.current) return
    lastNotice.current = notice
    if (notice.kind === 'batch') {
      setAnnouncement(batchSummaryLine(t, queue, notice.batchId))
      return
    }
    const job = queue.jobs.find((j) => j.id === notice.jobId)
    if (!job) return
    if (job.state === 'done') setAnnouncement(t('import.queue.announce.added', { title: titleOf(job) }))
    else if (job.state === 'duplicate') setAnnouncement(t('import.queue.announce.duplicate', { name: job.name }))
    else if (job.state === 'failed' && job.error) setAnnouncement(t('import.queue.announce.failed', { name: job.name, cause: messageText(t, job.error.message) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- announce once per notice
  }, [notice])

  // Phone: system Back closes the open card, never cancels an import (US3 AS10).
  useBackClose(expanded, () => store().setExpanded(false))

  function titleOf(job: ImportJob): string {
    return books?.find((b) => b.id === job.bookId)?.title ?? job.name
  }

  async function openExisting(job: ImportJob) {
    if (!job.bookId) return
    // The existing book may have been removed since the duplicate check (contracts: "Import again").
    const stillThere = await libraryApi.getBook(job.bookId).catch(() => null)
    if (stillThere) openBook(job.bookId, stillThere.title)
    else store().retry(job.id)
  }

  const open = (bookId: string) => {
    store().setExpanded(false)
    openBook(bookId)
  }

  if (live === 0 && !showResult && !expanded) {
    return (
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    )
  }

  let pillText = ''
  if (live > 0) {
    pillText =
      percent !== null
        ? t('import.queue.pill', { current: position.current, total: position.total, percent })
        : t('import.queue.pillElapsed', { current: position.current, total: position.total, elapsed: elapsedText ?? '…' })
  } else if (notice?.kind === 'batch') {
    pillText = t('import.queue.pillDone', { summary: batchSummaryLine(t, queue, notice.batchId) })
  } else if (noticeJob) {
    pillText =
      noticeJob.state === 'done'
        ? t('import.queue.added', { title: titleOf(noticeJob) })
        : noticeJob.state === 'duplicate'
          ? t('import.queue.announce.duplicate', { name: noticeJob.name })
          : `${noticeJob.name} — ${t(`import.queue.state.${noticeJob.state}`)}`
  }

  return (
    <div
      className="import-queue"
      {...holdHandlers}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && expanded) {
          e.stopPropagation()
          store().setExpanded(false)
        }
      }}
    >
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      {expanded ? (
        <section className="import-queue-card" aria-label={t('import.queue.title')}>
          <header className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-sm font-semibold text-lib-text-strong">{t('import.queue.title')}</h2>
            <button type="button" className="import-queue-action" data-tone="quiet" onClick={() => store().setExpanded(false)}>
              {t('import.queue.collapse')}
            </button>
          </header>
          {runningJob ? (
            <div className="flex flex-col gap-1.5">
              <span className="truncate font-mono text-xs text-lib-text-strong">{runningJob.name}</span>
              <div className="flex items-center justify-between gap-2 text-xs text-lib-muted">
                <span>{stepLabel(t, runningJob.step)}</span>
                <span className="import-queue-figure">{percent !== null ? `${percent} %` : elapsedText ?? ''}</span>
              </div>
              <ProgressBar percent={percent} label={stepLabel(t, runningJob.step)} />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-lib-muted">
                  {activity.waiting > 0 ? t('import.queue.waiting', { count: activity.waiting }) : ''}
                </span>
                <button
                  type="button"
                  className="import-queue-action"
                  disabled={runningJob.step === 'saving' || runningJob.cancelRequested}
                  onClick={() => store().cancel(runningJob.id)}
                >
                  {runningJob.step === 'saving' ? t('import.queue.finishing') : t('import.queue.cancel')}
                </button>
              </div>
            </div>
          ) : null}
          {notice?.kind === 'batch' && live === 0 ? (
            <ImportBatchSummary queue={queue} batchId={notice.batchId} onOpen={open} onTryAgain={(id) => store().retry(id)} />
          ) : null}
          <ImportQueueList
            jobs={queue.jobs}
            onCancel={(id) => store().cancel(id)}
            onTryAgain={(id) => store().retry(id)}
            onDismiss={(id) => store().dismiss(id)}
            onOpen={open}
            onOpenExisting={(job) => void openExisting(job)}
            onClearFinished={() => store().clearFinished()}
          />
        </section>
      ) : null}
      <div className="import-queue-pill-row">
        <button
          type="button"
          className="import-queue-pill"
          aria-expanded={expanded}
          aria-label={`${pillText} — ${expanded ? t('import.queue.collapse') : t('import.queue.expand')}`}
          onClick={() => store().setExpanded(!expanded)}
        >
          {live > 0 ? <span className="import-queue-spinner" aria-hidden /> : null}
          <span className="import-queue-figure truncate" aria-hidden>
            {pillText}
          </span>
        </button>
        {showResult && noticeJob?.state === 'done' && noticeJob.bookId ? (
          <button type="button" className="import-queue-action" data-tone="primary" onClick={() => open(noticeJob.bookId!)}>
            {t('import.queue.open')}
          </button>
        ) : null}
        {showResult && noticeJob?.state === 'duplicate' && noticeJob.bookId ? (
          <button type="button" className="import-queue-action" onClick={() => void openExisting(noticeJob)}>
            {t('import.queue.openExisting')}
          </button>
        ) : null}
        {showResult ? (
          <button type="button" className="import-queue-action" data-tone="quiet" onClick={() => store().dismissNotice()}>
            {t('import.queue.dismiss')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

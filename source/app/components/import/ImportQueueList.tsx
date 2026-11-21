import { isFinishedJob, progressPercent, type ImportJob } from '@core'
import { useT } from '../../i18n'
import { messageText, stepLabel } from './importQueueText'

export type ImportQueueListProps = {
  jobs: readonly ImportJob[]
  onCancel: (jobId: string) => void
  onTryAgain: (jobId: string) => void
  onDismiss: (jobId: string) => void
  onOpen: (bookId: string) => void
  onOpenExisting: (job: ImportJob) => void
  onClearFinished: () => void
}

/**
 * Spec 016 (contracts/import-ui.md): every job of the session — waiting (Cancel), running, done (Open), duplicate
 * (Open existing), failed (cause + Try again when it can help + Dismiss), cancelled, interrupted (Try again).
 */
export function ImportQueueList({ jobs, onCancel, onTryAgain, onDismiss, onOpen, onOpenExisting, onClearFinished }: ImportQueueListProps) {
  const t = useT()
  if (jobs.length === 0) return null
  const anyFinished = jobs.some(isFinishedJob)
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 flex max-h-[45vh] list-none flex-col gap-1.5 overflow-y-auto p-0">
        {jobs.map((job) => {
          const percent = progressPercent(job)
          return (
            <li key={job.id} className="import-queue-row">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-mono text-xs text-lib-text-strong">{job.name}</span>
                <span className="text-xs text-lib-muted">
                  {job.state === 'running'
                    ? `${stepLabel(t, job.step)}${percent !== null ? ` · ${percent} %` : ''}`
                    : t(`import.queue.state.${job.state}`)}
                  {job.state === 'failed' && job.error ? ` — ${messageText(t, job.error.message)}` : ''}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {job.state === 'waiting' ? (
                  <button type="button" className="import-queue-action" aria-label={t('import.queue.cancelNamed', { name: job.name })} onClick={() => onCancel(job.id)}>
                    {t('import.queue.cancel')}
                  </button>
                ) : null}
                {job.state === 'running' ? (
                  <button
                    type="button"
                    className="import-queue-action"
                    disabled={job.step === 'saving' || job.cancelRequested}
                    aria-label={t('import.queue.cancelNamed', { name: job.name })}
                    onClick={() => onCancel(job.id)}
                  >
                    {job.step === 'saving' ? t('import.queue.finishing') : t('import.queue.cancel')}
                  </button>
                ) : null}
                {job.state === 'done' && job.bookId ? (
                  <button type="button" className="import-queue-action" data-tone="primary" onClick={() => onOpen(job.bookId!)}>
                    {t('import.queue.open')}
                  </button>
                ) : null}
                {job.state === 'duplicate' && job.bookId ? (
                  <button type="button" className="import-queue-action" onClick={() => onOpenExisting(job)}>
                    {t('import.queue.openExisting')}
                  </button>
                ) : null}
                {(job.state === 'failed' && job.error?.retryable) || job.state === 'interrupted' ? (
                  <button type="button" className="import-queue-action" onClick={() => onTryAgain(job.id)}>
                    {t('import.queue.tryAgain')}
                  </button>
                ) : null}
                {isFinishedJob(job) ? (
                  <button type="button" className="import-queue-action" data-tone="quiet" onClick={() => onDismiss(job.id)}>
                    {t('import.queue.dismiss')}
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
      {anyFinished ? (
        <div className="flex justify-end">
          <button type="button" className="import-queue-action" data-tone="quiet" onClick={onClearFinished}>
            {t('import.queue.clearFinished')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

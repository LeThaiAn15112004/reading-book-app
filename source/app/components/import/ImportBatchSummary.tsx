import { summarizeBatch, type ImportQueue } from '@core'
import { useT } from '../../i18n'
import { messageText } from './importQueueText'

export type ImportBatchSummaryProps = {
  queue: ImportQueue
  batchId: string
  onOpen: (bookId: string) => void
  onTryAgain: (jobId: string) => void
}

/** Spec 016 (FR-011a): one summary per batch — five groups (zero groups hidden), failure causes, Open when one added. */
export function ImportBatchSummary({ queue, batchId, onOpen, onTryAgain }: ImportBatchSummaryProps) {
  const t = useT()
  const summary = summarizeBatch(queue, batchId)
  if (!summary) return null
  return (
    <div className="flex flex-col gap-2 text-sm text-lib-text">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {summary.groups.map((group) => {
          const count =
            group === 'added'
              ? summary.added
              : group === 'already'
                ? summary.alreadyInLibrary
                : group === 'failed'
                  ? summary.failed.length
                  : group === 'cancelled'
                    ? summary.cancelled
                    : summary.interrupted.length
          return (
            <li key={group} className="font-medium text-lib-text-strong">
              {t(`import.queue.summary.${group}`, { count })}
            </li>
          )
        })}
      </ul>
      {summary.failed.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {summary.failed.map((f) => (
            <li key={f.jobId} className="text-xs text-lib-muted">
              <span className="font-mono text-lib-text">{f.name}</span> — {messageText(t, f.message)}
            </li>
          ))}
        </ul>
      ) : null}
      {summary.interrupted.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {summary.interrupted.map((f) => (
            <li key={f.jobId} className="flex items-center justify-between gap-2 text-xs text-lib-muted">
              <span className="truncate font-mono text-lib-text">{f.name}</span>
              <button type="button" className="import-queue-action" onClick={() => onTryAgain(f.jobId)}>
                {t('import.queue.tryAgain')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {summary.openBookId ? (
        <div>
          <button type="button" className="import-queue-action" data-tone="primary" onClick={() => onOpen(summary.openBookId!)}>
            {t('import.queue.open')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

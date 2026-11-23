import { useId } from 'react'
import { trackDurationLabel } from '@core'
import { uiText, useT } from '../../i18n'
import { useZipImportStore, zipJobDetail, type ZipImportJob } from '../../hooks/library'
import { SpinnerIcon } from './SpinnerIcon'
import { useAutoHide } from '../../hooks/app/useAutoHide'

const GHOST_BTN =
  'inline-flex h-8 cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-3 text-[13px] font-medium text-lib-muted transition-colors hover:text-lib-text-strong disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY_BTN =
  'inline-flex h-8 cursor-pointer items-center rounded-lg border-none bg-lib-accent px-3.5 text-[13px] font-semibold text-lib-on-accent transition-colors hover:bg-lib-accent-hover disabled:cursor-not-allowed disabled:opacity-50'

function Progress({ job }: { job: ZipImportJob }) {
  const saving = job.progress?.stage === 'saving'
  const fraction = saving ? 1 : job.total > 0 ? Math.min(1, (job.progress?.done ?? 0) / job.total) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
      <div className="h-full rounded-full bg-lib-accent transition-[width] duration-300" style={{ width: `${Math.max(4, fraction * 100)}%` }} />
    </div>
  )
}

/**
 * The audiobook ZIP import after "Import" was pressed. The preview dialog is already gone, so the app stays usable while this
 * runs: the "Audiobook ZIP" entry shows a spinner with the count, and this card (opened from that entry) shows the details and
 * a Cancel. When the import finishes the card opens by itself and lists the audio files that were imported; a failure explains
 * itself and offers "Review & retry". It lives in a store, so it is still there after reading another book and coming back.
 */
export function AudiobookZipJobPanel({ onOpenBook }: { onOpenBook: (bookId: string) => void }) {
  const t = useT()
  const job = useZipImportStore((s) => s.job)
  const open = useZipImportStore((s) => s.panelOpen)
  const inspecting = useZipImportStore((s) => s.phase === 'inspecting')
  const archiveName = useZipImportStore((s) => s.archiveName)
  const labelId = useId()
  // A finished import's list hides by itself after 10 s without interaction (a failure stays: it offers Retry).
  const dismissJob = useZipImportStore((s) => s.dismissJob)
  const holdHandlers = useAutoHide('zip-import-job', job !== null && open && job.status === 'done', dismissJob)
  const store = useZipImportStore.getState

  // Reading the archive (before the selection dialog opens): the card behind the spinner, with a way to stop.
  if (inspecting && open) {
    return (
      <section
        role="dialog"
        aria-labelledby={labelId}
        aria-live="polite"
        className="app-no-drag fixed right-4 bottom-4 z-[300] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3 rounded-xl border border-lib-border bg-lib-surface-strong px-4 py-4 shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={labelId} className="m-0 flex items-center gap-2 text-[15px] font-semibold text-lib-text-strong">
            <SpinnerIcon className="size-4 text-lib-accent" />
            {t('import.job.readingArchive')}
          </h2>
          <button
            type="button"
            aria-label={t('import.job.hide')}
            title={t('import.job.hideReading')}
            className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-lib-faint hover:bg-white/5 hover:text-lib-text-strong"
            onClick={() => store().setPanelOpen(false)}
          >
            ✕
          </button>
        </div>
        <p className="m-0 truncate text-xs text-lib-muted" title={archiveName}>
          {archiveName}
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-lib-accent" />
        </div>
        <p className="m-0 text-xs text-lib-faint">{t('import.job.readingHint')}</p>
        <div className="flex justify-end">
          <button type="button" className={GHOST_BTN} onClick={() => void store().cancel()}>
            {t('common.actions.cancel')}
          </button>
        </div>
      </section>
    )
  }
  if (!job || !open) return null

  const close = () => (job.status === 'running' ? store().setPanelOpen(false) : store().dismissJob())

  return (
    <section
      {...holdHandlers}
      role="dialog"
      aria-labelledby={labelId}
      aria-live="polite"
      className="app-no-drag fixed right-4 bottom-4 z-[300] flex max-h-[min(70vh,520px)] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-lib-border bg-lib-surface-strong shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-lib-border-soft px-4 py-3">
        <div className="min-w-0">
          <h2 id={labelId} className="m-0 flex items-center gap-2 text-[15px] font-semibold text-lib-text-strong">
            {job.status === 'running' ? <SpinnerIcon className="size-4 text-lib-accent" /> : null}
            {job.status === 'running'
              ? t('import.job.importing')
              : job.status === 'done'
                ? t('import.job.added')
                : t('import.job.failed')}
          </h2>
          <p className="m-0 mt-0.5 truncate text-xs text-lib-muted" title={job.archiveName}>
            {job.archiveName}
          </p>
        </div>
        <button
          type="button"
          aria-label={job.status === 'running' ? t('import.job.hide') : t('common.actions.close')}
          title={job.status === 'running' ? t('import.job.hideRunning') : t('common.actions.close')}
          className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-lib-faint hover:bg-white/5 hover:text-lib-text-strong"
          onClick={close}
        >
          ✕
        </button>
      </header>

      {job.status === 'running' ? (
        <div className="flex flex-col gap-3 px-4 py-4">
          <Progress job={job} />
          <p className="m-0 truncate text-[13px] text-lib-muted">{zipJobDetail(t, job)}</p>
          <p className="m-0 text-xs text-lib-faint">{t('import.job.backgroundHint')}</p>
          <div className="flex justify-end">
            <button type="button" className={GHOST_BTN} disabled={job.cancelling} onClick={() => void store().cancelJob()}>
              {job.cancelling ? t('import.job.cancelling') : t('import.job.cancelImport')}
            </button>
          </div>
        </div>
      ) : null}

      {job.status === 'done' ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="m-0 mb-2 text-xs font-semibold tracking-[0.08em] text-lib-faint uppercase">
              {job.tracks?.length === 1
                ? t('import.job.importedOne')
                : t('import.job.importedMany', { count: job.tracks?.length ?? 0 })}
            </p>
            <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
              {(job.tracks ?? []).map((track, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[13px] text-lib-text" title={track.title}>
                  <span className="w-6 shrink-0 text-right text-xs text-lib-faint tabular-nums">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate">{track.title}</span>
                  <span className="shrink-0 text-xs text-lib-muted tabular-nums">{trackDurationLabel(track.durationSeconds)}</span>
                </li>
              ))}
            </ol>
          </div>
          <footer className="flex justify-end gap-2 border-t border-lib-border-soft px-4 py-3">
            <button type="button" className={GHOST_BTN} onClick={() => store().dismissJob()}>
              {t('common.actions.close')}
            </button>
            <button
              type="button"
              className={PRIMARY_BTN}
              onClick={() => {
                if (job.bookId) onOpenBook(job.bookId)
                store().dismissJob()
              }}
            >
              {t('import.job.openAudiobook')}
            </button>
          </footer>
        </>
      ) : null}

      {job.status === 'failed' ? (
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="m-0 text-[13px] text-red-400" role="alert">
            {job.error ? uiText(t, job.error.message) : t('import.job.failedFallback')}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={GHOST_BTN} onClick={() => store().dismissJob()}>
              {t('import.job.dismiss')}
            </button>
            {job.retry ? (
              <button type="button" className={PRIMARY_BTN} onClick={() => store().reviewAndRetry()}>
                {t('import.job.reviewRetry')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

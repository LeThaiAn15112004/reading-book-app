import { useEffect, useRef } from 'react'
import { bookOpening, type Opening, type OpeningAction, type OpeningCause, type OpeningStep } from '@core'
import { useT } from '../../../../i18n'
import { isMobileHost } from '../../../../platforms/host'

type T = ReturnType<typeof useT>

/** Spec 017: the cause line of an opening error (keys are listed so the i18n checker sees each one). */
function causeText(t: T, cause: OpeningCause, step: OpeningStep): string {
  const stepText = {
    content: t('reader.chrome.opening.errorStep.content'),
    prepare: t('reader.chrome.opening.errorStep.prepare'),
    position: t('reader.chrome.opening.errorStep.position'),
    firstPage: t('reader.chrome.opening.errorStep.firstPage'),
  }[step]
  switch (cause) {
    case 'missing_file':
      return t('reader.chrome.opening.error.missing_file')
    case 'unreadable':
      return t('reader.chrome.opening.error.unreadable')
    case 'damaged':
      return t('reader.chrome.opening.error.damaged')
    case 'protected':
      return t('reader.chrome.opening.error.protected')
    case 'too_large':
      return t('reader.chrome.opening.error.too_large')
    case 'took_too_long':
      return t('reader.chrome.opening.error.took_too_long', { step: stepText })
    case 'not_available_offline':
      return t('reader.chrome.opening.error.not_available_offline')
    case 'file_changed':
      return t('reader.chrome.opening.error.file_changed')
  }
}

/** Spec 017 (FR-011): the line that names the current step (never "loading the file" for a book on the device). */
function stepText(t: T, step: OpeningStep): string {
  switch (bookOpening.stepLineKey(step)) {
    case 'step.content':
      return t('reader.chrome.opening.step.content')
    case 'step.position':
      return t('reader.chrome.opening.step.position')
    default:
      return t('reader.chrome.opening.step.prepare')
  }
}

const PRIMARY =
  'h-10 cursor-pointer rounded-lg border border-lib-accent-ring bg-lib-accent-soft px-4 text-sm font-semibold text-lib-accent disabled:cursor-default disabled:opacity-60'
const SECONDARY =
  'h-10 cursor-pointer rounded-lg border border-lib-border bg-lib-surface px-4 text-sm font-semibold text-lib-text'

/**
 * Loading / error surface while opening a book from the library.
 *
 * Spec 017 (US1): Back is offered at every moment (button, and Esc on the computer); with `opening` given, the error
 * names its cause and offers only the actions that can help (`bookOpening.actionsFor`). US2 replaces this with the
 * shared opening screen.
 */
export function ReaderOpenStatus({
  status,
  message,
  onRetry,
  onBack,
  onLocate,
  locating = false,
  locateMessage,
  opening,
  onFromBeginning,
}: {
  status: 'idle' | 'loading' | 'error'
  message?: string | null
  onRetry: () => void
  onBack: () => void
  /** Offered when the book's file was moved or deleted: pick it again (verified by SHA-256). */
  onLocate?: () => void
  locating?: boolean
  /** Why the last "Locate file" attempt did not link. */
  locateMessage?: string | null
  /** Spec 017: the failed opening — its cause and actions replace `message` and the fixed buttons. */
  opening?: Opening | null
  /** Spec 017: "Open from the beginning" (offered when a saved position was used). */
  onFromBeginning?: () => void
}) {
  const t = useT()
  const isError = status === 'error'
  const firstActionRef = useRef<HTMLButtonElement | null>(null)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  // FR-001: Esc leaves while the book is opening (the error state has its own focused actions).
  useEffect(() => {
    if (isError) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onBackRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isError])

  const error = isError && opening?.outcome === 'failed' ? opening.error : null
  const actions: OpeningAction[] = error
    ? bookOpening.actionsFor(error, { host: isMobileHost() ? 'phone' : 'desktop', usesSavedPosition: opening?.usesSavedPosition ?? false })
    : []

  // FR-013: focus goes to the error's first action.
  useEffect(() => {
    if (isError) firstActionRef.current?.focus()
  }, [isError, error?.cause])

  const button = (action: OpeningAction, index: number) => {
    const ref = index === 0 ? firstActionRef : undefined
    const cls = index === 0 ? PRIMARY : SECONDARY
    switch (action) {
      case 'locateFile':
        return onLocate ? (
          <button key={action} ref={ref} className={cls} type="button" disabled={locating} onClick={onLocate}>
            {locating ? t('reader.chrome.opening.action.checkingFile') : t('reader.chrome.opening.action.locateFile')}
          </button>
        ) : null
      case 'importAgain':
        return null
      case 'tryAgain':
        return (
          <button key={action} ref={ref} className={cls} type="button" onClick={onRetry}>
            {t('reader.chrome.opening.action.tryAgain')}
          </button>
        )
      case 'fromBeginning':
        return onFromBeginning ? (
          <button key={action} ref={ref} className={cls} type="button" onClick={onFromBeginning}>
            {t('reader.chrome.opening.action.fromBeginning')}
          </button>
        ) : null
      case 'back':
        return (
          <button key={action} ref={ref} className={cls} type="button" onClick={onBack}>
            {t('reader.chrome.opening.action.back')}
          </button>
        )
    }
  }

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        {!isError ? (
          <div
            className="size-10 shrink-0 rounded-full border-[3px] border-current/20 border-t-current text-lib-accent motion-safe:animate-spin"
            aria-hidden
          />
        ) : (
          <div
            className="flex size-11 items-center justify-center rounded-full border border-rose-400/35 bg-rose-500/10 text-lg font-bold text-rose-300"
            aria-hidden
          >
            !
          </div>
        )}
        <div>
          <h2 className="m-0 text-base font-semibold text-lib-text-strong">
            {isError ? t('reader.chrome.opening.error.title') : t('reader.chrome.openStatus.opening')}
          </h2>
          <p className="mt-2 mb-0 text-sm leading-relaxed text-lib-muted" role={isError ? 'alert' : undefined}>
            {error
              ? causeText(t, error.cause, error.step)
              : isError
                ? (message ?? t('reader.chrome.openStatus.failedBody'))
                : stepText(t, opening?.step ?? 'content')}
          </p>
          {error?.cause === 'missing_file' && actions.includes('importAgain') ? (
            <p className="mt-2 mb-0 text-sm leading-relaxed text-lib-muted">{t('reader.chrome.opening.importAgain')}</p>
          ) : null}
          {isError && locateMessage ? (
            <p className="mt-2 mb-0 text-sm leading-relaxed text-rose-300" role="alert">
              {locateMessage}
            </p>
          ) : null}
        </div>
        {error ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {actions.filter((a) => a !== 'importAgain').map((a, i) => button(a, i))}
          </div>
        ) : isError ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {onLocate ? (
              <button ref={firstActionRef} className={PRIMARY} type="button" disabled={locating} onClick={onLocate}>
                {locating ? t('reader.chrome.openStatus.checkingFile') : t('reader.chrome.openStatus.locateFile')}
              </button>
            ) : null}
            <button
              ref={onLocate ? undefined : firstActionRef}
              className={onLocate ? SECONDARY : PRIMARY}
              type="button"
              onClick={onRetry}
            >
              {t('reader.chrome.openStatus.tryAgain')}
            </button>
            <button className={SECONDARY} type="button" onClick={onBack}>
              {t('reader.chrome.openStatus.backToLibrary')}
            </button>
          </div>
        ) : (
          // FR-001: the way out is there while the book is opening, not only once it has failed.
          <button className={SECONDARY} type="button" onClick={onBack}>
            {t('reader.chrome.opening.back')}
          </button>
        )}
      </div>
    </main>
  )
}

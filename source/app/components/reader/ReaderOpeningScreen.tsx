import { useEffect, useRef, useState } from 'react'
import { bookOpening, type Opening, type OpeningAction, type OpeningCause, type OpeningStep } from '@core'
import { useT } from '../../i18n'
import { isMobileHost } from '../../platforms/host'
import { useReaderOpeningStore } from '../../hooks/reader/readerOpeningStore'
import { BookCover } from '../../screens/Library/components/book/BookCover'

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

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Foreground-free fallback for waits that have no store opening (the audiobook preflight): ms since `active` began. */
function useLocalElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    setElapsed(0)
    if (!active) return
    const started = Date.now()
    const id = setInterval(() => setElapsed(Date.now() - started), 100)
    return () => clearInterval(id)
  }, [active])
  return elapsed
}

const FADE_MS = 150

const PRIMARY =
  'h-10 cursor-pointer rounded-lg border border-lib-accent-ring bg-lib-accent-soft px-4 text-sm font-semibold text-lib-accent disabled:cursor-default disabled:opacity-60'
const SECONDARY =
  'h-10 cursor-pointer rounded-lg border border-lib-border bg-lib-surface px-4 text-sm font-semibold text-lib-text'

export type ReaderOpeningScreenProps = {
  /** Shown while the book opens or once it failed; hiding it fades it out (150 ms, none under reduced motion). */
  visible: boolean
  status: 'loading' | 'error'
  bookId: string
  /** Title known before the opening store has it (file name / "Untitled" when none). */
  title?: string | null
  coverUrl?: string | null
  /** The store's opening of this screen (null for waits outside it, e.g. the audiobook preflight). */
  opening?: Opening | null
  /** Error text when there is no opening error (TXT text load, audiobook preflight). */
  message?: string | null
  onBack: () => void
  onRetry: () => void
  onFromBeginning?: () => void
  /** Offered when the book's file was moved or deleted (Desktop): pick it again, verified by SHA-256. */
  onLocate?: () => void
  locating?: boolean
  locateMessage?: string | null
}

/**
 * Spec 017 (US2, contracts/opening-ui.md): the ONE opening screen — every format, both hosts. Covers the renderer host
 * (`absolute inset-0`, opaque) while the renderer mounts underneath: cover + title at once, indicator + step line after
 * 300 ms, the slow note after 5 s, Back at every moment (button, Esc on the computer), and the error with its cause and
 * the actions `bookOpening.actionsFor` allows. The parent must be `position: relative`.
 */
export function ReaderOpeningScreen({
  visible,
  status,
  bookId,
  title,
  coverUrl,
  opening,
  message,
  onBack,
  onRetry,
  onFromBeginning,
  onLocate,
  locating = false,
  locateMessage,
}: ReaderOpeningScreenProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const firstActionRef = useRef<HTMLButtonElement | null>(null)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  // Fade-out: stays rendered (opacity 0) for 150 ms once hidden, then unmounts.
  const [rendered, setRendered] = useState(visible)
  const [fading, setFading] = useState(false)
  useEffect(() => {
    if (visible) {
      setRendered(true)
      setFading(false)
      return
    }
    if (!rendered) return
    // FR-013: focus leaves the screen for the reading surface (the Reader's shortcuts listen on the window).
    const root = rootRef.current
    if (root && document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) {
      document.activeElement.blur()
    }
    setFading(true)
    const id = setTimeout(() => {
      setRendered(false)
      setFading(false)
    }, prefersReducedMotion() ? 0 : FADE_MS)
    return () => clearTimeout(id)
  }, [visible, rendered])

  const isError = status === 'error'

  // FR-001: Esc leaves while the book is opening (the error state has its own focused actions).
  useEffect(() => {
    if (!visible || isError) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onBackRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, isError])

  const error = isError && opening?.outcome === 'failed' ? opening.error : null
  const actions: OpeningAction[] = error
    ? bookOpening.actionsFor(error, {
        host: isMobileHost() ? 'phone' : 'desktop',
        usesSavedPosition: opening?.usesSavedPosition ?? false,
      })
    : []

  // FR-013: focus goes to the error's first action.
  useEffect(() => {
    if (visible && isError) firstActionRef.current?.focus()
  }, [visible, isError, error?.cause])

  // FR-010 / FR-011: indicator + step line after 300 ms, slow note after 5 s (foreground time from the store).
  const storeElapsed = useReaderOpeningStore((s) => s.elapsedMs)
  const pending = !isError && visible
  const localElapsed = useLocalElapsed(pending && !opening)
  const elapsed = opening ? storeElapsed : localElapsed
  const showIndicator = pending && elapsed >= bookOpening.INDICATOR_DELAY_MS
  const showSlow = pending && elapsed >= bookOpening.SLOW_NOTE_MS

  if (!rendered) return null

  const shownTitle = opening?.title?.trim() || title?.trim() || t('common.untitled')
  const shownCover = opening?.coverUrl ?? coverUrl ?? undefined

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

  // Without an opening error (TXT text load, audiobook preflight): Locate file (when offered), Try again, Back.
  const legacyActions = (
    <>
      {onLocate ? (
        <button ref={firstActionRef} className={PRIMARY} type="button" disabled={locating} onClick={onLocate}>
          {locating ? t('reader.chrome.opening.action.checkingFile') : t('reader.chrome.opening.action.locateFile')}
        </button>
      ) : null}
      <button
        ref={onLocate ? undefined : firstActionRef}
        className={onLocate ? SECONDARY : PRIMARY}
        type="button"
        onClick={onRetry}
      >
        {t('reader.chrome.opening.action.tryAgain')}
      </button>
      <button className={SECONDARY} type="button" onClick={onBack}>
        {t('reader.chrome.opening.action.back')}
      </button>
    </>
  )

  return (
    <div
      ref={rootRef}
      className={`reader-opening-screen absolute inset-0 z-[30] flex flex-col bg-lib-bg-deep text-lib-text transition-opacity duration-150 motion-reduce:transition-none ${
        fading ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      data-reader-opening={isError ? 'error' : 'loading'}
      role={isError ? undefined : 'status'}
      aria-busy={isError ? undefined : true}
      aria-label={isError ? undefined : t('reader.chrome.opening.announce', { title: shownTitle })}
    >
      {!isError ? (
        <div className="flex shrink-0 items-center px-3 pt-3">
          {/* FR-001: the way out is there at every moment, not only once the opening has failed. */}
          <button
            type="button"
            className="reader-opening-back inline-flex min-h-11 min-w-11 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-sm font-semibold text-lib-text hover:bg-lib-surface-hover focus-visible:outline-2 focus-visible:outline-lib-accent"
            onClick={onBack}
          >
            <span aria-hidden>←</span>
            {t('reader.chrome.opening.back')}
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-6 py-8">
        <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
          <BookCover
            bookId={bookId}
            title={shownTitle}
            coverUrl={shownCover}
            className="h-44 w-[132px] shrink-0 rounded-lg shadow-xl"
            titleClassName="line-clamp-5 text-sm leading-snug font-semibold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]"
          />
          <h2 className="m-0 line-clamp-2 text-base font-semibold break-words text-lib-text-strong">{shownTitle}</h2>

          {!isError ? (
            <div className="flex min-h-16 w-56 flex-col items-center gap-2.5">
              {showIndicator ? (
                <>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-lib-border-soft" aria-hidden>
                    <div className="h-full w-full rounded-full bg-lib-accent/60 motion-safe:w-1/3 motion-safe:animate-import-indeterminate motion-safe:bg-lib-accent" />
                  </div>
                  <p className="m-0 text-sm text-lib-muted" aria-live="off">
                    {stepText(t, opening?.step ?? 'content')}
                  </p>
                </>
              ) : null}
              {showSlow ? (
                <p className="m-0 text-xs leading-relaxed text-lib-muted" aria-live="off">
                  {t('reader.chrome.opening.slow')}
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <div
                className="flex size-11 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--lib-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--lib-danger)_10%,transparent)] text-lg font-bold text-[var(--lib-danger)]"
                aria-hidden
              >
                !
              </div>
              <div>
                <h3 className="m-0 text-base font-semibold text-lib-text-strong">{t('reader.chrome.opening.error.title')}</h3>
                <p className="mt-2 mb-0 text-sm leading-relaxed text-lib-muted" role="alert">
                  {error ? causeText(t, error.cause, error.step) : (message ?? t('reader.chrome.openStatus.failedBody'))}
                </p>
                {error?.cause === 'missing_file' && actions.includes('importAgain') ? (
                  <p className="mt-2 mb-0 text-sm leading-relaxed text-lib-muted">{t('reader.chrome.opening.importAgain')}</p>
                ) : null}
                {locateMessage ? (
                  <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--lib-danger)]" role="alert">
                    {locateMessage}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {error ? actions.filter((a) => a !== 'importAgain').map((a, i) => button(a, i)) : legacyActions}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

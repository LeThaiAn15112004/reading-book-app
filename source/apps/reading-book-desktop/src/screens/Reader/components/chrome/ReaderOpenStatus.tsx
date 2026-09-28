/** Loading / error surface while opening a book from the library. */
export function ReaderOpenStatus({
  status,
  message,
  onRetry,
  onBack,
  onLocate,
  locating = false,
  locateMessage,
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
}) {
  const isError = status === 'error'
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        {!isError ? (
          <div
            className="size-10 shrink-0 animate-spin rounded-full border-[3px] border-current/20 border-t-current text-lib-accent"
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
            {isError ? 'Could not open this book' : 'Opening book...'}
          </h2>
          <p className="mt-2 mb-0 text-sm leading-relaxed text-lib-muted">
            {isError
              ? (message ??
                'The file may be missing, damaged, or not readable. Try again or re-import the book.')
              : 'Preparing the reader and loading the local file.'}
          </p>
          {isError && locateMessage ? (
            <p className="mt-2 mb-0 text-sm leading-relaxed text-rose-300" role="alert">
              {locateMessage}
            </p>
          ) : null}
        </div>
        {isError ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {onLocate ? (
              <button
                className="h-10 cursor-pointer rounded-lg border border-lib-accent-ring bg-lib-accent-soft px-4 text-sm font-semibold text-lib-accent disabled:cursor-default disabled:opacity-60"
                type="button"
                disabled={locating}
                onClick={onLocate}
              >
                {locating ? 'Checking file…' : 'Locate file…'}
              </button>
            ) : null}
            <button
              className={
                onLocate
                  ? 'h-10 cursor-pointer rounded-lg border border-lib-border bg-lib-surface px-4 text-sm font-semibold text-lib-text'
                  : 'h-10 cursor-pointer rounded-lg border border-lib-accent-ring bg-lib-accent-soft px-4 text-sm font-semibold text-lib-accent'
              }
              type="button"
              onClick={onRetry}
            >
              Try again
            </button>
            <button
              className="h-10 cursor-pointer rounded-lg border border-lib-border bg-lib-surface px-4 text-sm font-semibold text-lib-text"
              type="button"
              onClick={onBack}
            >
              Back to Library
            </button>
          </div>
        ) : null}
      </div>
    </main>
  )
}

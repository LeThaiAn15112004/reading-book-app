import type { TxtSaveStatus as SaveStatus } from '../../logic/txtDocument/txtDocumentStore'

type TxtSaveStatusProps = {
  status: SaveStatus
  error: string | null
  /** False when the file is too large to edit: nothing to save, nothing to show. */
  editable: boolean
  onRetry: () => void
}

const LABEL: Record<Exclude<SaveStatus, 'error'>, string> = {
  saved: 'Saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
}

/**
 * Small pill in the corner of the TXT page. "Saved" appears only once `txt:commit` has succeeded
 * for everything on screen (see the store); until then it says what is going on — never an optimistic
 * "saved". Errors keep the text in memory and offer a retry.
 */
export function TxtSaveStatus({ status, error, editable, onRetry }: TxtSaveStatusProps) {
  if (!editable) return null
  const isError = status === 'error'
  return (
    <div
      className="txt-save-status absolute top-3 right-4 z-[5] flex max-w-[min(420px,70vw)] items-center gap-2 rounded-full border border-lib-border bg-lib-surface-strong/90 px-3 py-1 text-[12px] font-semibold text-lib-text shadow-md backdrop-blur"
      data-txt-save-status={status}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden
        className={`size-2 shrink-0 rounded-full ${
          isError ? 'bg-rose-400' : status === 'saved' ? 'bg-emerald-400' : 'animate-pulse bg-amber-400'
        }`}
      />
      <span className="truncate" title={isError ? (error ?? undefined) : undefined}>
        {isError ? `Couldn’t save${error ? ` — ${error}` : ''}` : LABEL[status]}
      </span>
      {isError ? (
        <button
          type="button"
          className="shrink-0 rounded border-none bg-lib-accent-soft px-2 py-0.5 text-[11px] font-bold text-lib-text-strong hover:bg-lib-accent-ring"
          onClick={onRetry}
        >
          Retry
        </button>
      ) : null}
    </div>
  )
}

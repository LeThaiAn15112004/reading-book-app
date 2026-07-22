export type ImportProgressDialogProps = {
  open: boolean
  /** e.g. "Importing…" / "Downloading…" */
  status: string
  filename?: string
}

/**
 * UX-IMP progress — indeterminate Importing / Downloading overlay (T2.10).
 * No Cancel: Main does not support abort in G2.
 */
export function ImportProgressDialog({
  open,
  status,
  filename,
}: ImportProgressDialogProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-busy="true"
        aria-live="polite"
        aria-label={status}
        className="w-full max-w-[420px] overflow-hidden rounded-xl border border-lib-border bg-lib-surface-strong shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
      >
        <div className="flex items-center gap-4 px-6 py-6">
          <div
            className="size-9 shrink-0 rounded-full border-[3px] border-lib-border-soft border-t-lib-accent animate-spin"
            aria-hidden
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="m-0 text-sm font-semibold text-lib-text-strong">
              {status}
            </p>
            {filename ? (
              <p className="m-0 truncate font-mono text-[11px] text-lib-faint">
                {filename}
              </p>
            ) : null}
            <div className="mt-1 h-1 w-full overflow-hidden rounded-sm bg-[rgba(51,65,85,0.3)]">
              <div className="h-full w-1/3 rounded-sm bg-lib-accent shadow-[0_0_8px_rgba(245,158,11,0.45)] animate-import-indeterminate" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

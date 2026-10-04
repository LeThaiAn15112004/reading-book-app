export type ImportProgressDialogProps = {
  open: boolean
  /** e.g. "Importing…" / "Downloading…" */
  status: string
  filename?: string
  /** Bytes downloaded so far (downloading stage). */
  receivedBytes?: number
  /** Download size when known — makes the bar determinate. */
  totalBytes?: number | null
  /** Shown as a Cancel button while the download can still be aborted. */
  onCancel?: () => void
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * UX-IMP progress — Importing / Downloading overlay (T2.10). Shown only after a file was picked
 * or a URL submitted; determinate when the download size is known; cancellable while downloading.
 */
export function ImportProgressDialog({
  open,
  status,
  filename,
  receivedBytes,
  totalBytes,
  onCancel,
}: ImportProgressDialogProps) {
  if (!open) return null

  const percent =
    totalBytes && totalBytes > 0 && receivedBytes != null
      ? Math.min(100, (receivedBytes / totalBytes) * 100)
      : null
  const bytesLabel =
    receivedBytes != null && receivedBytes > 0
      ? totalBytes && totalBytes > 0
        ? `${formatMb(receivedBytes)} / ${formatMb(totalBytes)}`
        : formatMb(receivedBytes)
      : null

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
            <div
              className="mt-1 h-1 w-full overflow-hidden rounded-sm bg-[rgba(51,65,85,0.3)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent != null ? Math.round(percent) : undefined}
            >
              {percent != null ? (
                <div
                  className="h-full rounded-sm bg-lib-accent shadow-[0_0_8px_rgba(245,158,11,0.45)] transition-[width] duration-150"
                  style={{ width: `${percent}%` }}
                />
              ) : (
                <div className="h-full w-1/3 rounded-sm bg-lib-accent shadow-[0_0_8px_rgba(245,158,11,0.45)] animate-import-indeterminate" />
              )}
            </div>
            {bytesLabel ? (
              <p className="m-0 text-[11px] text-lib-faint">{bytesLabel}</p>
            ) : null}
          </div>
        </div>
        {onCancel ? (
          <div className="flex justify-end border-t border-lib-border-soft px-6 py-3">
            <button
              type="button"
              className="inline-flex h-[34px] cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-medium text-lib-muted transition-colors hover:text-lib-text-strong"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

import { useEffect } from 'react'

export type ConfirmBookActionDialogProps = {
  title: string
  message: string
  confirmLabel: string
  destructive?: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

export function ConfirmBookActionDialog({
  title,
  message,
  confirmLabel,
  destructive = false,
  onCancel,
  onConfirm,
}: ConfirmBookActionDialogProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[310] flex items-center justify-center bg-lib-bg-deep/65 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[420px] rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-book-action-title"
        aria-describedby="confirm-book-action-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-book-action-title" className="m-0 text-base font-semibold text-lib-text-strong">
          {title}
        </h2>
        <p id="confirm-book-action-message" className="mt-2 mb-5 text-[13px] leading-relaxed text-lib-muted">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="h-10 cursor-pointer rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-muted" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`h-10 cursor-pointer rounded-lg border px-4 text-[13px] font-semibold ${
              destructive
                ? 'border-red-500 bg-red-500 text-white hover:bg-red-400'
                : 'border-lib-accent bg-lib-accent text-lib-on-accent'
            }`}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

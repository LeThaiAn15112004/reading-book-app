import { useEffect, useRef } from 'react'
import { useBackClose } from '../../../../hooks/app/useBackClose'
import { useDialogFocus } from '../../../../hooks/app/useDialogFocus'
import { isMobileHost } from '../../../../platforms/host'
import { useT } from '../../../../i18n'

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
  const t = useT()
  // Phone: system Back closes the dialog first (spec 014 FR-005).
  useBackClose(true, onCancel)
  // Focus stays in the dialog and returns to the opener on close (spec 015 FR-016).
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(true, dialogRef)
  const height = isMobileHost() ? 'h-11' : 'h-10'
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
        ref={dialogRef}
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
          <button type="button" className={`settings-action ${height} cursor-pointer rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-muted hover:bg-lib-surface-hover hover:text-lib-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent`} onClick={onCancel}>
            {t('common.actions.cancel')}
          </button>
          <button
            type="button"
            data-tone={destructive ? 'danger-filled' : undefined}
            className={`settings-action ${height} cursor-pointer rounded-lg border px-4 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent ${
              destructive
                ? // white on #dc2626 is 4.83:1 whatever the theme (the old red-500 was 3.76:1)
                  'border-[#dc2626] bg-[#dc2626] text-white hover:border-[#b91c1c] hover:bg-[#b91c1c]'
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

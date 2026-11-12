import { useT } from '../../../../i18n'
type TrashConfirmDialogProps = {
  open: boolean
  bookTitle: string
  onCancel: () => void
  onConfirm: () => void
}

export function TrashConfirmDialog({
  open,
  bookTitle,
  onCancel,
  onConfirm,
}: TrashConfirmDialogProps) {
  const t = useT()
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-lib-bg-deep/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="flex w-full max-w-[450px] flex-col gap-4 rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl"
        role="alertdialog"
        aria-labelledby="trash-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-semibold text-lib-text-strong" id="trash-title">
          {t('reader.annotations.trash.title')}
        </div>
        <p className="m-0 border-l-[3px] border-lib-accent pl-2.5 text-sm leading-snug text-lib-muted">
          {t('reader.annotations.trash.body', { title: bookTitle })}
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="h-10 cursor-pointer rounded-lg border border-lib-border bg-lib-bg-mid/50 px-4 text-[13px] font-semibold text-lib-text"
            type="button"
            onClick={onCancel}
          >
            {t('common.actions.cancel')}
          </button>
          <button
            className="h-10 cursor-pointer rounded-lg border border-red-400/45 bg-red-400/15 px-4 text-[13px] font-semibold text-red-400"
            type="button"
            onClick={onConfirm}
          >
            {t('reader.annotations.trash.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

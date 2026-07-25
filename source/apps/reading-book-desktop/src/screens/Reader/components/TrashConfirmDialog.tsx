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
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="flex w-full max-w-[450px] flex-col gap-4 rounded-xl border border-slate-600/45 bg-slate-900/95 p-5 shadow-xl"
        role="alertdialog"
        aria-labelledby="trash-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-semibold text-slate-100" id="trash-title">
          Move to trash?
        </div>
        <p className="m-0 border-l-[3px] border-amber-500 pl-2.5 text-sm leading-snug text-slate-400">
          “{bookTitle}” and its local annotations will be removed in a later
          phase. This is a UI confirm only.
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="h-10 cursor-pointer rounded-lg border border-slate-600/45 bg-slate-800/50 px-4 text-[13px] font-semibold text-slate-300"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="h-10 cursor-pointer rounded-lg border border-red-400/45 bg-red-400/15 px-4 text-[13px] font-semibold text-red-400"
            type="button"
            onClick={onConfirm}
          >
            Move to trash
          </button>
        </div>
      </div>
    </div>
  )
}

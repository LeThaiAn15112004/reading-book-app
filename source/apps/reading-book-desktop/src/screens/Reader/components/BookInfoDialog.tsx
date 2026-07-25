type BookInfoDialogProps = {
  open: boolean
  title: string
  chapterLabel: string
  formatLabel?: string
  isSigned?: boolean
  onClose: () => void
}

export function BookInfoDialog({
  open,
  title,
  chapterLabel,
  formatLabel = 'EPUB (preview)',
  isSigned = false,
  onClose,
}: BookInfoDialogProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[450px] flex-col gap-4 rounded-xl border border-slate-600/45 bg-slate-900/95 p-5 shadow-xl"
        role="dialog"
        aria-labelledby="book-info-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="text-base font-semibold text-slate-100"
          id="book-info-title"
        >
          Book info
        </div>
        <dl className="m-0 flex flex-col gap-2.5">
          {(
            [
              ['Title', title],
              ['Location', chapterLabel],
              ['Format', formatLabel],
              ['Signed', isSigned ? 'Yes' : 'No'],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="grid grid-cols-[88px_1fr] gap-2 text-[13px]">
              <dt className="m-0 font-semibold text-slate-500">{k}</dt>
              <dd className="m-0 text-slate-100">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end">
          <button
            className="h-10 cursor-pointer rounded-lg border border-amber-500 bg-amber-500 px-4 text-[13px] font-semibold text-slate-950"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

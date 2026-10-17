type PdfWriteBackDialogProps = {
  open: boolean
  signed?: boolean
  signerName?: string
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Confirm before Readmate starts writing annotations into the book's own PDF file (two-way sync,
 * docs/implementation_plan/pdf_annotation_two_way_sync.md §2). Off by default; this is the only way on.
 */
export function PdfWriteBackDialog({ open, signed, signerName, onCancel, onConfirm }: PdfWriteBackDialogProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-lib-bg-deep/60 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="flex w-full max-w-[480px] flex-col gap-4 rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl"
        role="alertdialog"
        aria-labelledby="write-back-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-semibold text-lib-text-strong" id="write-back-title">
          Sync annotations into this PDF file?
        </div>
        <div className="flex flex-col gap-2 border-l-[3px] border-lib-accent pl-2.5 text-sm leading-snug text-lib-muted">
          <p className="m-0">
            Readmate will write your highlights, underlines, strikethroughs and notes into the PDF file itself, as standard PDF
            annotations, so other PDF readers can show them. Changes made in those readers keep coming back into Readmate.
          </p>
          <p className="m-0">
            The file on your disk will be modified. Another reader that has the file open may need to reload it to see Readmate’s
            changes, and a reader that saves an older copy can overwrite them.
          </p>
          {signed ? (
            <p className="m-0 font-semibold text-amber-300">
              This PDF is digitally signed{signerName ? ` by ${signerName}` : ''}. Writing annotations adds a change after signing —
              readers may then show the signature as modified or invalid.
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="h-10 cursor-pointer rounded-lg border border-lib-border bg-lib-bg-mid/50 px-4 text-[13px] font-semibold text-lib-text"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="h-10 cursor-pointer rounded-lg border border-lib-accent bg-lib-accent-soft px-4 text-[13px] font-semibold text-lib-text-strong"
            type="button"
            onClick={onConfirm}
          >
            Write into the PDF
          </button>
        </div>
      </div>
    </div>
  )
}

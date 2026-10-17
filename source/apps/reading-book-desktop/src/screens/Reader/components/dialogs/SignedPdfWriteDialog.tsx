type SignedPdfWriteDialogProps = {
  open: boolean
  /** "Export" (a new file) or "Write" (the book's own file, two-way sync). */
  action: 'export' | 'write'
  signerName?: string
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Warn before annotations are written into a digitally signed PDF: the signed revision stays in the
 * file, but validators will report the document as modified after signing (or the signature as
 * invalid). Signature validity is never claimed to survive.
 */
export function SignedPdfWriteDialog({ open, action, signerName, onCancel, onConfirm }: SignedPdfWriteDialogProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-lib-bg-deep/60 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="flex w-full max-w-[480px] flex-col gap-4 rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl"
        role="alertdialog"
        aria-labelledby="signed-pdf-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-semibold text-lib-text-strong" id="signed-pdf-title">
          This PDF is digitally signed
        </div>
        <p className="m-0 border-l-[3px] border-lib-accent pl-2.5 text-sm leading-snug text-lib-muted">
          {signerName ? `Signed by ${signerName}. ` : ''}
          {action === 'export'
            ? 'The exported copy will contain your annotations as a change made after signing. PDF readers may show the signature as modified or invalid in that copy. The book file itself is not changed.'
            : 'Writing your annotations into this file adds a change after signing. PDF readers may then show the signature as modified or invalid.'}
        </p>
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
            {action === 'export' ? 'Export anyway' : 'Write anyway'}
          </button>
        </div>
      </div>
    </div>
  )
}

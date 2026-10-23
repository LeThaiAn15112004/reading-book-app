const OVERLAY =
  'fixed inset-0 z-[250] flex items-center justify-center bg-lib-bg-deep/60 p-4 backdrop-blur-sm'
const CARD =
  'flex w-full max-w-[480px] flex-col gap-4 rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl'
const SECONDARY =
  'h-10 cursor-pointer rounded-lg border border-lib-border bg-lib-bg-mid/50 px-4 text-[13px] font-semibold text-lib-text disabled:cursor-default disabled:opacity-50'
const PRIMARY =
  'h-10 cursor-pointer rounded-lg border border-lib-accent bg-lib-accent-soft px-4 text-[13px] font-semibold text-lib-text-strong disabled:cursor-default disabled:opacity-50'

type AttachmentOpenDialogProps = {
  fileName: string | null
  onCancel: () => void
  onContinue: () => void
}

/**
 * Shown on double-click, before anything is extracted. Cancel does nothing else; Continue asks Main
 * to extract and open the file (and Main may still refuse it by policy).
 */
export function AttachmentOpenDialog({ fileName, onCancel, onContinue }: AttachmentOpenDialogProps) {
  if (fileName === null) return null
  return (
    <div className={OVERLAY} onClick={onCancel}>
      <div
        className={CARD}
        role="alertdialog"
        aria-labelledby="attachment-open-title"
        aria-describedby="attachment-open-body"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-semibold text-lib-text-strong" id="attachment-open-title">
          Open attachment?
        </div>
        <p className="m-0 break-all text-sm font-semibold text-lib-text">{fileName}</p>
        <p
          className="m-0 border-l-[3px] border-lib-accent pl-2.5 text-sm leading-snug text-lib-muted"
          id="attachment-open-body"
        >
          Files embedded in a document can contain unsafe content. Only continue if you trust where this
          document came from. The file will open in the application your system uses for this file type.
        </p>
        <div className="flex justify-end gap-2">
          <button className={SECONDARY} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className={PRIMARY} type="button" autoFocus onClick={onContinue}>
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}

type AttachmentBlockedDialogProps = {
  fileName: string | null
  reason: string
  busy: boolean
  onSaveAs: () => void
  onClose: () => void
}

/** The file's type is on the do-not-launch list: the only way forward is an explicit Save As. */
export function AttachmentBlockedDialog({ fileName, reason, busy, onSaveAs, onClose }: AttachmentBlockedDialogProps) {
  if (fileName === null) return null
  return (
    <div className={OVERLAY} onClick={onClose}>
      <div
        className={CARD}
        role="alertdialog"
        aria-labelledby="attachment-blocked-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-semibold text-lib-text-strong" id="attachment-blocked-title">
          Readmate can’t open this file
        </div>
        <p className="m-0 break-all text-sm font-semibold text-lib-text">{fileName}</p>
        <p className="m-0 border-l-[3px] border-lib-accent pl-2.5 text-sm leading-snug text-lib-muted">
          {reason} You can save a copy and decide what to do with it yourself.
        </p>
        <div className="flex justify-end gap-2">
          <button className={SECONDARY} type="button" autoFocus onClick={onClose}>
            Close
          </button>
          <button className={SECONDARY} type="button" disabled={busy} onClick={onSaveAs}>
            Save As…
          </button>
        </div>
      </div>
    </div>
  )
}

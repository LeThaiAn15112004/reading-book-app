import type { PdfAttachmentPin } from '../../../../reader/renderers/pdf'

const OVERLAY =
  'fixed inset-0 z-[250] flex items-center justify-center bg-lib-bg-deep/60 p-4 backdrop-blur-sm'
const CARD =
  'flex w-full max-w-[480px] flex-col gap-4 rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl'
const SECONDARY =
  'h-10 cursor-pointer rounded-lg border border-lib-border bg-lib-bg-mid/50 px-4 text-[13px] font-semibold text-lib-text disabled:cursor-default disabled:opacity-50'
const DANGER =
  'h-10 cursor-pointer rounded-lg border border-red-500/70 bg-red-500/15 px-4 text-[13px] font-semibold text-lib-text-strong disabled:cursor-default disabled:opacity-50'

type DeleteAttachmentDialogProps = {
  pin: PdfAttachmentPin | null
  busy: boolean
  onCancel: () => void
  onDelete: () => void
}

/**
 * Delete a Readmate-made page attachment (specs/007 FR-019): says plainly that the file stays in the PDF's earlier
 * versions and the PDF does not get smaller. Cancel does nothing; Delete removes the icon from the page.
 */
export function DeleteAttachmentDialog({ pin, busy, onCancel, onDelete }: DeleteAttachmentDialogProps) {
  if (!pin) return null
  return (
    <div className={OVERLAY} onClick={onCancel}>
      <div
        className={CARD}
        role="alertdialog"
        aria-labelledby="attachment-delete-title"
        aria-describedby="attachment-delete-body"
        data-attachment-delete={pin.id}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
      >
        <div className="text-base font-semibold text-lib-text-strong" id="attachment-delete-title">
          Delete attachment?
        </div>
        <p className="m-0 break-all text-sm font-semibold text-lib-text">{pin.name}</p>
        <p className="m-0 border-l-[3px] border-lib-accent pl-2.5 text-sm leading-snug text-lib-muted" id="attachment-delete-body">
          The attachment is removed from page {pin.pageIndex + 1}, and other PDF readers will no longer show it. The file
          itself stays inside the PDF’s earlier versions, so the PDF does not get smaller.
        </p>
        <div className="flex justify-end gap-2">
          <button className={SECONDARY} type="button" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button className={DANGER} type="button" disabled={busy} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

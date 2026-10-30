import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { formatAttachmentSize } from '@reading-book/book-reader-sdk'
import type { PdfAttachmentPin } from '../../../../reader/renderers/pdf'
import { useDismissOnOutsideOrEscape } from '../../logic'

const OVERLAY =
  'fixed inset-0 z-[250] flex items-center justify-center bg-lib-bg-deep/60 p-4 backdrop-blur-sm'
const CARD =
  'flex w-full max-w-[480px] flex-col gap-4 rounded-xl border border-lib-border bg-lib-surface-strong p-5 shadow-xl'
const SECONDARY =
  'h-10 cursor-pointer rounded-lg border border-lib-border bg-lib-bg-mid/50 px-4 text-[13px] font-semibold text-lib-text disabled:cursor-default disabled:opacity-50'
const PRIMARY =
  'h-10 cursor-pointer rounded-lg border border-lib-accent bg-lib-accent-soft px-4 text-[13px] font-semibold text-lib-text-strong disabled:cursor-default disabled:opacity-50'

const sizeLabel = (sizeBytes: number | null) => (sizeBytes === null ? 'Size unknown' : formatAttachmentSize(sizeBytes))

type AttachmentDetailsPanelProps = {
  pin: PdfAttachmentPin | null
  /** Why Readmate will not hand this file to the OS (judged by its name), or null when Open is offered. */
  blockedReason: string | null
  busy: boolean
  onOpen: () => void
  onSaveAs: () => void
  onClose: () => void
}

/**
 * A page attachment's details (specs/007 FR-015/016): the sanitised name, the real size, the page, and the two
 * ways out — Open (through the "Open attachment?" confirmation and Main's policy) and Save As. A file Readmate
 * never launches shows the reason and Save As only. Nothing here writes the PDF.
 */
export function AttachmentDetailsPanel({ pin, blockedReason, busy, onOpen, onSaveAs, onClose }: AttachmentDetailsPanelProps) {
  if (!pin) return null
  return (
    <div className={OVERLAY} onClick={onClose}>
      <div
        className={CARD}
        role="dialog"
        aria-modal="true"
        aria-labelledby="attachment-details-title"
        data-attachment-details={pin.id}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="text-base font-semibold text-lib-text-strong" id="attachment-details-title">
          Attached file
        </div>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-lib-muted">Name</dt>
          <dd className="m-0 break-all font-semibold text-lib-text">{pin.name}</dd>
          <dt className="text-lib-muted">Size</dt>
          <dd className="m-0 text-lib-text">{sizeLabel(pin.sizeBytes)}</dd>
          <dt className="text-lib-muted">Page</dt>
          <dd className="m-0 text-lib-text">{pin.pageIndex + 1}</dd>
          {pin.editable ? null : (
            <>
              <dt className="text-lib-muted">Added by</dt>
              <dd className="m-0 text-lib-text">Another app</dd>
            </>
          )}
        </dl>
        {blockedReason ? (
          <p className="m-0 border-l-[3px] border-lib-accent pl-2.5 text-sm leading-snug text-lib-muted" data-attachment-blocked="">
            <span className="font-semibold text-lib-text">Readmate can’t open this file.</span> {blockedReason} You can save a
            copy and decide what to do with it yourself.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button className={SECONDARY} type="button" onClick={onClose}>
            Close
          </button>
          <button className={blockedReason ? PRIMARY : SECONDARY} type="button" disabled={busy} autoFocus={!!blockedReason} onClick={onSaveAs}>
            Save As…
          </button>
          {blockedReason ? null : (
            <button className={PRIMARY} type="button" disabled={busy} autoFocus onClick={onOpen}>
              Open
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

type AttachmentContextMenuProps = {
  menu: { pin: PdfAttachmentPin; x: number; y: number } | null
  /** Open is left out for a file Readmate never launches (Save As is the way out). */
  canOpen: boolean
  onOpen: () => void
  onSaveAs: () => void
  onDetails: () => void
  onDismiss: () => void
}

const MENU_WIDTH = 200
const MENU_HEIGHT = 120

/** Right-click on an attachment icon. Portaled: the reading surface is transformed (zoom / pan). */
export function AttachmentContextMenu({ menu, canOpen, onOpen, onSaveAs, onDetails, onDismiss }: AttachmentContextMenuProps) {
  if (!menu) return null
  return <AttachmentContextMenuBody menu={menu} canOpen={canOpen} onOpen={onOpen} onSaveAs={onSaveAs} onDetails={onDetails} onDismiss={onDismiss} />
}

function AttachmentContextMenuBody({ menu, canOpen, onOpen, onSaveAs, onDetails, onDismiss }: AttachmentContextMenuProps & { menu: NonNullable<AttachmentContextMenuProps['menu']> }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useDismissOnOutsideOrEscape(ref, onDismiss)
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - MENU_HEIGHT - 8))
  const item =
    'flex h-8 w-full cursor-pointer items-center rounded-md border-none bg-transparent px-2.5 text-left text-[13px] text-lib-text hover:bg-lib-hint/60'
  const run = (action: () => void) => () => {
    onDismiss()
    action()
  }
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={`Attachment ${menu.pin.name}`}
      className="fixed z-[240] flex flex-col rounded-lg border border-lib-border bg-lib-surface-strong p-1 shadow-xl"
      style={{ left, top, width: MENU_WIDTH }}
      data-attachment-menu={menu.pin.id}
    >
      {canOpen ? (
        <button role="menuitem" type="button" className={item} onClick={run(onOpen)}>
          Open
        </button>
      ) : null}
      <button role="menuitem" type="button" className={item} onClick={run(onSaveAs)}>
        Save As…
      </button>
      <button role="menuitem" type="button" className={item} onClick={run(onDetails)}>
        Details
      </button>
    </div>,
    document.body,
  )
}

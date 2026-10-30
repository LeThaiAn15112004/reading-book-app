import { useEffect } from 'react'
import type { PdfAttachmentPin } from '../../../../reader/renderers/pdf'
import { openBlockedByName, usePageAttachmentsStore } from '../../logic/attachments/pageAttachmentsStore'
import { AttachmentBlockedDialog, AttachmentOpenDialog } from './AttachmentDialogs'
import { AttachmentContextMenu, AttachmentDetailsPanel } from './AttachmentDetailsPanel'
import { DeleteAttachmentDialog } from './DeleteAttachmentDialog'

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))

/**
 * Everything a page attachment icon leads to (specs/007 US2, US3): the right-click menu, the details panel, the
 * "Open attachment?" confirmation, "Readmate can't open this file" and the delete confirmation. State lives in
 * `pageAttachmentsStore`; Enter on a selected icon opens its details, Delete asks to delete a Readmate-made one.
 * Mounted for PDFs only.
 */
export function PageAttachmentDialogs({ pins }: { pins: readonly PdfAttachmentPin[] }) {
  const selectedId = usePageAttachmentsStore((s) => s.selectedId)
  const details = usePageAttachmentsStore((s) => s.details)
  const menu = usePageAttachmentsStore((s) => s.menu)
  const confirming = usePageAttachmentsStore((s) => s.confirming)
  const blocked = usePageAttachmentsStore((s) => s.blocked)
  const busy = usePageAttachmentsStore((s) => s.busy)
  const deleting = usePageAttachmentsStore((s) => s.deleting)
  const changing = usePageAttachmentsStore((s) => s.changing)
  const store = usePageAttachmentsStore.getState

  // The selection is dropped when its icon is gone (deleted in another app, book switched).
  useEffect(() => {
    if (selectedId !== null && !pins.some((p) => p.id === selectedId)) store().select(null)
  }, [pins, selectedId, store])

  useEffect(() => {
    if (selectedId === null) return
    const onKey = (event: KeyboardEvent) => {
      const enter = event.key === 'Enter'
      const del = event.key === 'Delete' || event.key === 'Backspace'
      if ((!enter && !del) || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
      if (isTypingTarget(event.target)) return
      const s = store()
      if (s.details || s.menu || s.confirming || s.blocked || s.deleting) return
      const pin = pins.find((p) => p.id === s.selectedId)
      if (!pin || (del && !pin.editable)) return
      event.preventDefault()
      event.stopPropagation()
      if (enter) s.showDetails(pin)
      else s.requestDelete(pin)
    }
    // Capture: the Reader's own Delete (focused annotation) never sees a key meant for the selected icon.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pins, selectedId, store])

  return (
    <>
      <AttachmentContextMenu
        menu={menu}
        canOpen={menu ? openBlockedByName(menu.pin) === null : false}
        onOpen={() => menu && store().requestOpen(menu.pin)}
        onSaveAs={() => menu && void store().saveAs(menu.pin)}
        onDetails={() => menu && store().showDetails(menu.pin)}
        onDelete={menu?.pin.editable ? () => store().requestDelete(menu.pin) : undefined}
        onDismiss={() => store().closeMenu()}
      />
      <DeleteAttachmentDialog
        pin={deleting}
        busy={changing}
        onCancel={() => store().cancelDelete()}
        onDelete={() => void store().confirmDelete()}
      />
      <AttachmentDetailsPanel
        pin={details}
        blockedReason={details ? openBlockedByName(details) : null}
        busy={busy}
        onOpen={() => details && store().requestOpen(details)}
        onSaveAs={() => details && void store().saveAs(details)}
        onClose={() => store().closeDetails()}
      />
      <AttachmentOpenDialog
        fileName={confirming?.name ?? null}
        onCancel={() => store().cancelOpen()}
        onContinue={() => void store().confirmOpen()}
      />
      <AttachmentBlockedDialog
        fileName={blocked?.pin.name ?? null}
        reason={blocked?.message ?? ''}
        busy={busy}
        onSaveAs={() => blocked && void store().saveAs(blocked.pin)}
        onClose={() => store().dismissBlocked()}
      />
    </>
  )
}

import { useEffect } from 'react'
import type { PdfAttachmentPin } from '../../../../reader/renderers/pdf'
import { openBlockedByName, usePageAttachmentsStore } from '../../logic/attachments/pageAttachmentsStore'
import { AttachmentBlockedDialog, AttachmentOpenDialog } from './AttachmentDialogs'
import { AttachmentContextMenu, AttachmentDetailsPanel } from './AttachmentDetailsPanel'

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))

/**
 * Everything a page attachment icon leads to (specs/007 US2): the right-click menu, the details panel, the
 * "Open attachment?" confirmation and "Readmate can't open this file". State lives in `pageAttachmentsStore`;
 * Enter on a selected icon opens its details. Mounted for PDFs only.
 */
export function PageAttachmentDialogs({ pins }: { pins: readonly PdfAttachmentPin[] }) {
  const selectedId = usePageAttachmentsStore((s) => s.selectedId)
  const details = usePageAttachmentsStore((s) => s.details)
  const menu = usePageAttachmentsStore((s) => s.menu)
  const confirming = usePageAttachmentsStore((s) => s.confirming)
  const blocked = usePageAttachmentsStore((s) => s.blocked)
  const busy = usePageAttachmentsStore((s) => s.busy)
  const store = usePageAttachmentsStore.getState

  // The selection is dropped when its icon is gone (deleted in another app, book switched).
  useEffect(() => {
    if (selectedId !== null && !pins.some((p) => p.id === selectedId)) store().select(null)
  }, [pins, selectedId, store])

  useEffect(() => {
    if (selectedId === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
      if (isTypingTarget(event.target)) return
      const s = store()
      if (s.details || s.menu || s.confirming || s.blocked) return
      const pin = pins.find((p) => p.id === s.selectedId)
      if (!pin) return
      event.preventDefault()
      s.showDetails(pin)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pins, selectedId, store])

  return (
    <>
      <AttachmentContextMenu
        menu={menu}
        canOpen={menu ? openBlockedByName(menu.pin) === null : false}
        onOpen={() => menu && store().requestOpen(menu.pin)}
        onSaveAs={() => menu && void store().saveAs(menu.pin)}
        onDetails={() => menu && store().showDetails(menu.pin)}
        onDismiss={() => store().closeMenu()}
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

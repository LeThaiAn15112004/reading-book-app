import { create } from 'zustand'
import {
  classifyAttachment,
  describeAttachFailure,
  describeAttachmentBlock,
  formatAttachmentSize,
  pdfHighlightDtoToReaderHighlight,
  readmateAttachmentId,
} from '@reading-book/book-reader-sdk'
import { attachmentsApi } from '../../../../bridge/attachments'
import type { overlayApi } from '../../../../bridge/overlay'
import type { PdfAttachmentPin } from '../../../../reader/renderers/pdf'
import { usePdfHighlightsStore } from '../pdfHighlights/pdfHighlightsStore'

type SyncEvent = Parameters<Parameters<typeof overlayApi.onPdfEmbeddedAnnotationsChanged>[0]>[0]
export type ForeignPageAttachment = NonNullable<SyncEvent['pageAttachments']>[number]

/**
 * Page file attachments of the open PDF (specs/007-pdf-file-attachment): placing a new one with the File
 * Attachment tool, selecting an icon, its details panel and the open / Save As flow. Main owns the picker, the
 * file and the PDF; the renderer sends a book, a page and a point, or a book and an attachment id — never a path,
 * a name or bytes. A Readmate-made attachment is an ordinary row (style kind `attachment`) of `pdfHighlightsStore`
 * once the file holds it; attachments other readers made come with each sync event (`foreign`).
 */
type PageAttachmentsState = {
  bookId: string | null
  /** An attach is running (picker open or the PDF being written): one at a time. */
  creating: boolean
  /** Page attachments made by other readers (open / save only). */
  foreign: ForeignPageAttachment[]
  /** The selected icon (single click). */
  selectedId: string | null
  /** The details panel (double-click / Enter / context menu "Details"). */
  details: PdfAttachmentPin | null
  /** The right-click menu of an icon, at client coordinates. */
  menu: { pin: PdfAttachmentPin; x: number; y: number } | null
  /** The "Open attachment?" confirmation. */
  confirming: PdfAttachmentPin | null
  /** "Readmate can't open this file" with Save As. */
  blocked: { pin: PdfAttachmentPin; message: string } | null
  /** An open / save is in flight: at most one. */
  busy: boolean
  setBook: (bookId: string | null) => void
  applySync: (event: SyncEvent) => void
  create: (bookId: string, pageIndex: number, point: { x: number; y: number }) => Promise<void>
  select: (id: string | null) => void
  showDetails: (pin: PdfAttachmentPin) => void
  closeDetails: () => void
  openMenu: (pin: PdfAttachmentPin, x: number, y: number) => void
  closeMenu: () => void
  requestOpen: (pin: PdfAttachmentPin) => void
  cancelOpen: () => void
  confirmOpen: () => Promise<void>
  saveAs: (pin: PdfAttachmentPin) => Promise<void>
  dismissBlocked: () => void
}

/** The id attachments:open / saveAs take for a pin (contracts §4). */
export function attachmentIdOfPin(pin: PdfAttachmentPin): string {
  return pin.editable ? readmateAttachmentId(pin.id) : pin.id
}

/**
 * Can Readmate hand this file to the OS, judging by its name alone? (Main checks the name AND the content again;
 * this only decides whether Open is offered at all — FR-016.)
 */
export function openBlockedByName(pin: PdfAttachmentPin): string | null {
  const verdict = classifyAttachment(pin.name, new Uint8Array(0))
  return verdict.open ? null : describeAttachmentBlock(verdict.reason)
}

const toast = (message: string) => usePdfHighlightsStore.getState().onToast(message)

const IDLE = { creating: false, foreign: [], selectedId: null, details: null, menu: null, confirming: null, blocked: null, busy: false }

export const usePageAttachmentsStore = create<PageAttachmentsState>((set, get) => ({
  bookId: null,
  ...IDLE,

  setBook: (bookId) => {
    if (get().bookId !== bookId) set({ bookId, ...IDLE })
  },

  applySync: (event) => {
    if (!event || event.bookId !== get().bookId || !event.pageAttachments) return
    const foreign = event.pageAttachments
    set((s) => {
      const ids = new Set(foreign.map((a) => a.attachmentId))
      const gone = (id: string | null) => id !== null && !ids.has(id) && !usePdfHighlightsStore.getState().highlights.some((h) => h.id === id)
      return {
        foreign,
        selectedId: gone(s.selectedId) ? null : s.selectedId,
        details: s.details && gone(s.details.id) ? null : s.details,
        menu: s.menu && gone(s.menu.pin.id) ? null : s.menu,
      }
    })
  },

  create: async (bookId, pageIndex, point) => {
    if (get().creating) return
    set({ creating: true })
    try {
      const result = await attachmentsApi.create({ bookId, pageIndex, point }).catch(() => null)
      if (!result) {
        toast('The file could not be attached. Nothing was changed.')
        return
      }
      if (!result.ok) {
        const message = describeAttachFailure(result)
        if (message) toast(message)
        return
      }
      const row = pdfHighlightDtoToReaderHighlight(result.highlight)
      // The book may have changed while the picker was open: the row belongs to the other book then.
      if (!row || usePdfHighlightsStore.getState().bookId !== bookId) return
      usePdfHighlightsStore.setState((s) => ({ highlights: [...s.highlights.filter((h) => h.id !== row.id), row] }))
      set({ selectedId: row.id })
      const info = row.attachment
      toast(info ? `Attached ${info.name} (${formatAttachmentSize(info.sizeBytes)}).` : 'File attached.')
    } finally {
      set({ creating: false })
    }
  },

  select: (id) => set({ selectedId: id }),

  showDetails: (pin) => set({ selectedId: pin.id, details: pin, menu: null }),

  closeDetails: () => set({ details: null }),

  openMenu: (pin, x, y) => set({ selectedId: pin.id, menu: { pin, x, y } }),

  closeMenu: () => set({ menu: null }),

  requestOpen: (pin) => {
    const { busy, confirming, blocked } = get()
    if (busy || confirming || blocked) return
    const byName = openBlockedByName(pin)
    if (byName) {
      set({ blocked: { pin, message: byName }, details: null })
      return
    }
    set({ confirming: pin, selectedId: pin.id, details: null })
  },

  cancelOpen: () => set({ confirming: null }),

  confirmOpen: async () => {
    const { busy, confirming, bookId } = get()
    if (busy || !confirming || !bookId) return
    set({ busy: true, confirming: null })
    const result = await attachmentsApi.open({ bookId, attachmentId: attachmentIdOfPin(confirming) }).catch(() => null)
    if (get().bookId !== bookId) return set({ busy: false })
    if (result?.ok) {
      set({ busy: false })
      toast(`Opened “${result.fileName}”.`)
    } else if (result?.errorCode === 'blocked') {
      set({ busy: false, blocked: { pin: confirming, message: result.errorMessage } })
    } else {
      set({ busy: false })
      toast(result ? result.errorMessage : 'The attachment could not be opened.')
    }
  },

  saveAs: async (pin) => {
    const { busy, bookId } = get()
    if (busy || !bookId) return
    set({ busy: true })
    const result = await attachmentsApi.saveAs({ bookId, attachmentId: attachmentIdOfPin(pin) }).catch(() => null)
    if (get().bookId !== bookId) return set({ busy: false })
    if (result?.ok) {
      set({ busy: false, blocked: null, details: null })
      toast(`Saved as “${result.fileName}”.`)
    } else if (result?.errorCode === 'canceled') {
      // The dialog that started it stays: the user can try again or close it.
      set({ busy: false })
    } else {
      set({ busy: false, blocked: null })
      toast(result ? result.errorMessage : 'The attachment could not be saved.')
    }
  },

  dismissBlocked: () => set({ blocked: null }),
}))

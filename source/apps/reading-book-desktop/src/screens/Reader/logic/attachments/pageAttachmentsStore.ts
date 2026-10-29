import { create } from 'zustand'
import { describeAttachFailure, formatAttachmentSize, pdfHighlightDtoToReaderHighlight } from '@reading-book/book-reader-sdk'
import { attachmentsApi } from '../../../../bridge/attachments'
import { usePdfHighlightsStore } from '../pdfHighlights/pdfHighlightsStore'

/**
 * Page file attachments of the open PDF (specs/007-pdf-file-attachment): placing a new one with the File
 * Attachment tool. Main owns the picker, the file and the PDF; the renderer sends a book, a page and a point
 * only. A Readmate-made attachment is an ordinary row (style kind `attachment`) of `pdfHighlightsStore` once the
 * file holds it — there is no pending state, so nothing is added to the list before Main says it is written.
 */
type PageAttachmentsState = {
  /** An attach is running (picker open or the PDF being written): one at a time. */
  creating: boolean
  create: (bookId: string, pageIndex: number, point: { x: number; y: number }) => Promise<void>
  reset: () => void
}

export const usePageAttachmentsStore = create<PageAttachmentsState>((set, get) => ({
  creating: false,

  create: async (bookId, pageIndex, point) => {
    if (get().creating) return
    set({ creating: true })
    const toast = (message: string) => usePdfHighlightsStore.getState().onToast(message)
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
      const info = row.attachment
      toast(info ? `Attached ${info.name} (${formatAttachmentSize(info.sizeBytes)}).` : 'File attached.')
    } finally {
      set({ creating: false })
    }
  },

  reset: () => set({ creating: false }),
}))

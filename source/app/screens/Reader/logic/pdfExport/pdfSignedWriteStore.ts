import { create } from 'zustand'
import { overlayApi } from '../../../../bridge'

export type PendingSignedWrite = { bookId: string; signerName?: string }

type PdfSignedWriteState = {
  /** A write into a digitally signed PDF is waiting for the user's confirmation. */
  pending: PendingSignedWrite | null
  request: (bookId: string, signerName?: string) => void
  confirm: (onToast: (message: string | null) => void) => Promise<void>
  /** Declined: Readmate keeps the annotations pending, unwritten. */
  decline: (onToast: (message: string | null) => void) => void
  reset: () => void
}

/**
 * Annotations are always written into the book's PDF — except into a digitally signed one, where the
 * write makes readers report the signature as modified. Main reports `writeStatus: 'signed'`; this
 * store holds the confirmation (docs/implementation_plan/pdf_annotation_two_way_sync.md §2).
 */
export const usePdfSignedWriteStore = create<PdfSignedWriteState>()((set, get) => ({
  pending: null,

  request: (bookId, signerName) => set({ pending: { bookId, signerName } }),

  confirm: async (onToast) => {
    const pending = get().pending
    if (!pending) return
    set({ pending: null })
    try {
      const result = await overlayApi.confirmSignedPdfWrite(pending.bookId)
      if (!result.ok) onToast('Could not write into the signed PDF.')
    } catch {
      onToast('Could not write into the signed PDF.')
    }
  },

  decline: (onToast) => {
    set({ pending: null })
    onToast('Your annotations are kept in Readmate but not written into the signed PDF.')
  },

  reset: () => set({ pending: null }),
}))

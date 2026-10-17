import { create } from 'zustand'
import { overlayApi } from '../../../../bridge'

/** Derived from the bridge: the renderer never imports from electron/. */
type ExportResult = Awaited<ReturnType<typeof overlayApi.exportAnnotatedPdf>>

export type PendingSignedExport = { bookId: string; signerName?: string; signatureStatus?: string }

type PdfExportState = {
  busy: boolean
  /** A signed source is waiting for the user to confirm (the export would show the signature as modified). */
  pendingSigned: PendingSignedExport | null
  exportAnnotatedPdf: (bookId: string, onToast: (message: string | null) => void) => Promise<void>
  confirmSigned: (onToast: (message: string | null) => void) => Promise<void>
  cancelSigned: () => void
}

function messageFor(result: ExportResult): string | null {
  if (result.ok) {
    const s = result.summary
    const parts = s ? [`${s.added} added`, s.replaced ? `${s.replaced} updated` : '', s.removed ? `${s.removed} removed` : ''].filter(Boolean) : []
    return `Exported “${result.fileName}”${parts.length ? ` — ${parts.join(', ')}` : ''}.`
  }
  switch (result.errorCode) {
    case 'cancelled':
      return null
    case 'encrypted':
      return 'This PDF is encrypted — exporting annotations into it is not supported.'
    case 'unsupported_pdf':
      return 'This PDF’s structure is not supported for writing annotations.'
    case 'verify_failed':
      return 'The exported file did not pass verification, so it was not saved.'
    case 'same_as_source':
      return 'Choose a different file than the book itself.'
    case 'source_changed':
      return 'The book file changed during the export. Try again.'
    case 'no_space':
      return 'Not enough disk space to save the exported PDF.'
    case 'permission_denied':
      return result.message || 'No permission to write there. Choose another folder.'
    case 'busy':
      return 'That file is open in another app. Close it or choose another name.'
    case 'not_found':
      return 'The book file could not be found.'
    default:
      return 'Could not export the PDF.'
  }
}

/**
 * "Export PDF with annotations…" (docs/implementation_plan/pdf_annotation_export.md). All the PDF
 * work happens in Main; this only drives the IPC, the signed-file confirmation and the toast.
 */
export const usePdfExportStore = create<PdfExportState>()((set, get) => ({
  busy: false,
  pendingSigned: null,

  exportAnnotatedPdf: async (bookId, onToast) => {
    if (get().busy) return
    set({ busy: true })
    try {
      const result = await overlayApi.exportAnnotatedPdf(bookId)
      if (!result.ok && result.errorCode === 'signed_needs_confirmation') {
        set({ pendingSigned: { bookId, signerName: result.signerName, signatureStatus: result.signatureStatus } })
        return
      }
      onToast(messageFor(result))
    } catch {
      onToast('Could not export the PDF.')
    } finally {
      set({ busy: false })
    }
  },

  confirmSigned: async (onToast) => {
    const pending = get().pendingSigned
    if (!pending || get().busy) return
    set({ pendingSigned: null, busy: true })
    try {
      onToast(messageFor(await overlayApi.exportAnnotatedPdf(pending.bookId, { acknowledgeSignature: true })))
    } catch {
      onToast('Could not export the PDF.')
    } finally {
      set({ busy: false })
    }
  },

  cancelSigned: () => set({ pendingSigned: null }),
}))

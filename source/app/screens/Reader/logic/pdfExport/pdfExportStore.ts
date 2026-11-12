import { create } from 'zustand'
import { overlayApi } from '../../../../bridge'
import { getT } from '../../../../i18n'

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
  // Shown at once in a short toast, so it is translated now (spec 012).
  const t = getT()
  if (result.ok) {
    const s = result.summary
    const parts = s
      ? [
          t('reader.annotations.pdfExport.added', { count: s.added }),
          s.replaced ? t('reader.annotations.pdfExport.updated', { count: s.replaced }) : '',
          s.removed ? t('reader.annotations.pdfExport.removed', { count: s.removed }) : '',
        ].filter(Boolean)
      : []
    const skipped = result.skippedTypewriter
      ? t('reader.annotations.pdfExport.skippedTypewriter', { count: result.skippedTypewriter })
      : ''
    const head = parts.length
      ? t('reader.annotations.pdfExport.exportedWithSummary', { file: result.fileName ?? '', summary: parts.join(', ') })
      : t('reader.annotations.pdfExport.exported', { file: result.fileName ?? '' })
    return head + skipped
  }
  switch (result.errorCode) {
    case 'cancelled':
      return null
    case 'encrypted':
      return t('reader.annotations.pdfExport.encrypted')
    case 'unsupported_pdf':
      return t('reader.annotations.pdfExport.unsupported')
    case 'verify_failed':
      return t('reader.annotations.pdfExport.verifyFailed')
    case 'same_as_source':
      return t('reader.annotations.pdfExport.sameFile')
    case 'source_changed':
      return t('reader.annotations.pdfExport.changed')
    case 'no_space':
      return t('reader.annotations.pdfExport.noSpace')
    case 'permission_denied':
      return result.message || t('reader.annotations.pdfExport.noPermission')
    case 'busy':
      return t('reader.annotations.pdfExport.busy')
    case 'not_found':
      return t('reader.annotations.pdfExport.missing')
    default:
      return t('reader.annotations.pdfExport.failed')
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
      onToast(getT()('reader.annotations.pdfExport.failed'))
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
      onToast(getT()('reader.annotations.pdfExport.failed'))
    } finally {
      set({ busy: false })
    }
  },

  cancelSigned: () => set({ pendingSigned: null }),
}))

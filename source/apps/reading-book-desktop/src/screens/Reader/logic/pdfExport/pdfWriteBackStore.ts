import { create } from 'zustand'
import { overlayApi } from '../../../../bridge'

/** Derived from the bridge: the renderer never imports from electron/. */
type WriteBackState = Awaited<ReturnType<typeof overlayApi.getPdfWriteBack>>

type PdfWriteBackStoreState = {
  bookId: string | null
  state: WriteBackState | null
  /** The enable confirmation is open. */
  confirming: boolean
  busy: boolean
  load: (bookId: string) => Promise<void>
  reset: () => void
  /** Menu toggle: disables right away; enabling opens the confirmation first. */
  toggle: (onToast: (message: string | null) => void) => Promise<void>
  confirm: (onToast: (message: string | null) => void) => Promise<void>
  cancel: () => void
}

const UNAVAILABLE: Record<string, string> = {
  managed_copy: 'This book is a copy kept by Readmate (from a URL or the cloud), so there is no file of yours to write into.',
  encrypted: 'This PDF is encrypted — Readmate can’t write annotations into it.',
  unsupported_pdf: 'This PDF’s structure isn’t supported for writing annotations.',
  not_found: 'The book file could not be found.',
}

export function writeBackUnavailableReason(reason: string | undefined): string {
  return (reason && UNAVAILABLE[reason]) || 'Writing annotations into this PDF is not available.'
}

/**
 * "Sync annotations into this PDF file" (two-way sync, docs/implementation_plan/pdf_annotation_two_way_sync.md):
 * per book, off by default, enabled only after a confirmation. All the file work happens in Main.
 */
export const usePdfWriteBackStore = create<PdfWriteBackStoreState>()((set, get) => ({
  bookId: null,
  state: null,
  confirming: false,
  busy: false,

  load: async (bookId) => {
    set({ bookId, state: null, confirming: false })
    try {
      const state = await overlayApi.getPdfWriteBack(bookId)
      if (get().bookId === bookId) set({ state })
    } catch {
      if (get().bookId === bookId) set({ state: { enabled: false, available: false, reason: 'not_found' } })
    }
  },

  reset: () => set({ bookId: null, state: null, confirming: false, busy: false }),

  toggle: async (onToast) => {
    const { bookId, state, busy } = get()
    if (!bookId || !state || busy) return
    if (!state.available) {
      onToast(writeBackUnavailableReason(state.reason))
      return
    }
    if (!state.enabled) {
      set({ confirming: true })
      return
    }
    set({ busy: true })
    try {
      const result = await overlayApi.setPdfWriteBack(bookId, false)
      if (get().bookId === bookId) set({ state: { ...state, enabled: result.enabled } })
      onToast('Readmate no longer writes annotations into this PDF.')
    } finally {
      set({ busy: false })
    }
  },

  confirm: async (onToast) => {
    const { bookId, state } = get()
    if (!bookId || !state) return
    set({ confirming: false, busy: true })
    try {
      const result = await overlayApi.setPdfWriteBack(bookId, true, { acknowledgeSignature: !!state.signed })
      if (get().bookId !== bookId) return
      set({ state: { ...state, enabled: result.enabled } })
      onToast(result.ok ? 'Annotations will be written into this PDF file.' : writeBackUnavailableReason(result.errorCode))
    } catch {
      onToast('Could not change the setting.')
    } finally {
      set({ busy: false })
    }
  },

  cancel: () => set({ confirming: false }),
}))

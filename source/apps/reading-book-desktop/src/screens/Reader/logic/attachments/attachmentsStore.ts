import { create } from 'zustand'
import { attachmentsApi, type AttachmentItem as AttachmentDto } from '../../../../bridge'

/**
 * State of the PDF Attachment panel and of the double-click → confirm → open workflow
 * (docs/implementation_plan/pdf_attachments.md). The renderer only ever names a book and an
 * attachment id; Main extracts, applies the security policy and opens the file.
 *
 * `confirming` is the security dialog (set only by an explicit double-click, cleared by Cancel
 * without any IPC call); `blocked` is the "will not open directly" dialog that offers Save As as its
 * own, separate action. `busy` serialises everything so a double-click or a repeated Continue can
 * start at most one operation.
 */
type ListStatus = 'idle' | 'loading' | 'ready' | 'error'

type AttachmentsState = {
  bookId: string | null
  status: ListStatus
  items: AttachmentDto[]
  truncated: boolean
  loadError: string | null
  selectedId: string | null
  confirming: AttachmentDto | null
  blocked: { attachment: AttachmentDto; message: string } | null
  busy: boolean
  /** Result of the last open / save: an error to show in the panel, or a short confirmation. */
  notice: { kind: 'error' | 'info'; message: string } | null
  load: (bookId: string) => Promise<void>
  select: (id: string | null) => void
  requestOpen: (attachment: AttachmentDto) => void
  cancelOpen: () => void
  confirmOpen: () => Promise<void>
  saveBlocked: () => Promise<void>
  dismissBlocked: () => void
  clearNotice: () => void
  reset: () => void
}

const INITIAL = {
  bookId: null,
  status: 'idle' as ListStatus,
  items: [] as AttachmentDto[],
  truncated: false,
  loadError: null,
  selectedId: null,
  confirming: null,
  blocked: null,
  busy: false,
  notice: null,
}

export const useAttachmentsStore = create<AttachmentsState>((set, get) => ({
  ...INITIAL,

  load: async (bookId) => {
    const switching = get().bookId !== bookId
    if (switching) set({ ...INITIAL, bookId, status: 'loading' })
    else if (get().status !== 'ready') set({ status: 'loading', loadError: null })
    const result = await attachmentsApi.list(bookId).catch(() => null)
    // A newer load (another book) won the race: drop this result.
    if (get().bookId !== bookId) return
    if (result?.ok) {
      set({ status: 'ready', items: result.items, truncated: result.truncated, loadError: null })
    } else {
      set({
        status: 'error',
        items: [],
        loadError: result ? result.errorMessage : 'The attachments could not be loaded.',
      })
    }
  },

  select: (id) => set({ selectedId: id }),

  requestOpen: (attachment) => {
    const { busy, confirming, blocked } = get()
    if (busy || confirming || blocked) return
    set({ confirming: attachment, selectedId: attachment.id, notice: null })
  },

  cancelOpen: () => set({ confirming: null }),

  confirmOpen: async () => {
    const { busy, confirming, bookId } = get()
    if (busy || !confirming || !bookId) return
    set({ busy: true, confirming: null, notice: null })
    const result = await attachmentsApi
      .open({ bookId, attachmentId: confirming.id })
      .catch(() => null)
    if (get().bookId !== bookId) {
      set({ busy: false })
      return
    }
    if (result?.ok) {
      set({ busy: false, notice: { kind: 'info', message: `Opened “${result.fileName}”.` } })
    } else if (result?.errorCode === 'blocked') {
      set({ busy: false, blocked: { attachment: confirming, message: result.errorMessage } })
    } else {
      set({
        busy: false,
        notice: { kind: 'error', message: result ? result.errorMessage : 'The attachment could not be opened.' },
      })
    }
  },

  saveBlocked: async () => {
    const { busy, blocked, bookId } = get()
    if (busy || !blocked || !bookId) return
    set({ busy: true })
    const result = await attachmentsApi
      .saveAs({ bookId, attachmentId: blocked.attachment.id })
      .catch(() => null)
    if (get().bookId !== bookId) {
      set({ busy: false })
      return
    }
    if (result?.ok) {
      set({ busy: false, blocked: null, notice: { kind: 'info', message: `Saved as “${result.fileName}”.` } })
    } else if (result?.errorCode === 'canceled') {
      // The dialog stays: the user can try again or close it.
      set({ busy: false })
    } else {
      set({
        busy: false,
        blocked: null,
        notice: { kind: 'error', message: result ? result.errorMessage : 'The attachment could not be saved.' },
      })
    }
  },

  dismissBlocked: () => set({ blocked: null }),

  clearNotice: () => set({ notice: null }),

  reset: () => set({ ...INITIAL }),
}))

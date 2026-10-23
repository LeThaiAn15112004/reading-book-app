import { create } from 'zustand'
import { pdfGraphicAllows, type PdfGraphicObject, type PdfGraphicOp } from '@reading-book/book-reader-sdk'
import { graphicsApi } from '../../../../bridge'

type GraphicsContext = {
  bookId: string | undefined
  onToast: (message: string | null) => void
  /** The file changed on disk: re-read it so the canvas shows the new appearance. */
  onFileChanged: () => void
}

type PdfGraphicsStoreState = GraphicsContext & {
  /** Graphic objects inside the open PDF (not made by this app), in page / paint order. */
  objects: PdfGraphicObject[]
  selectedId: string | null
  /** An edit is being written (one at a time). */
  busy: boolean

  setContext: (patch: Partial<GraphicsContext>) => void
  resetForNewBook: () => void
  load: () => Promise<void>
  select: (id: string | null) => void
  /** Resize / recolour / delete one object in the PDF file. Refused locally when its type does not allow `op`. */
  apply: (objectId: string, op: PdfGraphicOp) => Promise<boolean>
  deleteSelected: () => void
}

const FAILURE_MESSAGE: Record<string, string> = {
  not_found: 'That object is no longer in the PDF.',
  not_allowed: 'That change is not available for this object.',
  managed_copy: 'This is an app-owned copy of the PDF, so it is not edited.',
  read_only: 'The PDF file is read-only, so it was not changed.',
  encrypted: 'The PDF is encrypted, so it was not changed.',
  unsupported_pdf: 'This PDF’s structure can’t be edited safely, so it was not changed.',
  signed: 'The PDF is digitally signed — editing it would invalidate the signature, so it was not changed.',
  locked: 'The PDF is open in another program, so it was not changed.',
  changed: 'The PDF changed on disk meanwhile — nothing was written. Try again.',
  verify_failed: 'The edit could not be verified, so the PDF was left as it was.',
  failed: 'Could not change the PDF.',
}

/**
 * Graphic objects that live inside the open PDF but were not made by this app (shapes, lines, text boxes
 * from another reader). Unlike freehand Ink they are the FILE's own content: every edit is an incremental
 * update written into the PDF by Main (`graphics:apply`), so there is no app-side undo history — the
 * file is the source of truth and this store only mirrors Main's list.
 */
export const usePdfGraphicsStore = create<PdfGraphicsStoreState>()((set, get) => ({
  bookId: undefined,
  onToast: () => {},
  onFileChanged: () => {},
  objects: [],
  selectedId: null,
  busy: false,

  setContext: (patch) => set(patch),

  resetForNewBook: () => set({ objects: [], selectedId: null, busy: false }),

  load: async () => {
    const { bookId } = get()
    if (!bookId) return
    try {
      const result = await graphicsApi.list(bookId)
      // A newer book may have opened while this was in flight.
      if (get().bookId !== bookId) return
      set({ objects: result.ok ? result.objects : [] })
    } catch {
      if (get().bookId === bookId) set({ objects: [] })
    }
  },

  select: (id) => {
    if (get().selectedId !== id) set({ selectedId: id })
  },

  apply: async (objectId, op) => {
    const { bookId, onToast, busy } = get()
    const object = get().objects.find((o) => o.objectId === objectId)
    if (!bookId || !object || busy) return false
    if (!pdfGraphicAllows(object.caps, op)) {
      onToast(FAILURE_MESSAGE.not_allowed!)
      return false
    }
    set({ busy: true })
    try {
      const result = await graphicsApi.apply({ bookId, objectId, op })
      if (get().bookId !== bookId) return false
      if (!result.ok) {
        onToast(FAILURE_MESSAGE[result.errorCode] ?? FAILURE_MESSAGE.failed!)
        return false
      }
      set((s) => ({ objects: result.objects, selectedId: op.kind === 'delete' && s.selectedId === objectId ? null : s.selectedId }))
      get().onFileChanged()
      return true
    } catch {
      onToast(FAILURE_MESSAGE.failed!)
      return false
    } finally {
      set({ busy: false })
    }
  },

  deleteSelected: () => {
    const id = get().selectedId
    if (id) void get().apply(id, { kind: 'delete' })
  },
}))

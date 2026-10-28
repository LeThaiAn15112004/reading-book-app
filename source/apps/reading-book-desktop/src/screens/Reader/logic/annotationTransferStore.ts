import { create } from 'zustand'
import { annotationTransferApi } from '../../../bridge'
import { annotationExportMessage } from '../../../utils/annotationTransferMessages'

/** Formats whose books carry annotations that can be exported / imported (audiobooks and the rest never do). */
export const ANNOTATION_TRANSFER_FORMATS: readonly string[] = ['epub', 'pdf', 'txt', 'md']

export function supportsAnnotationTransfer(format: string | null | undefined): boolean {
  return !!format && ANNOTATION_TRANSFER_FORMATS.includes(format)
}

type AnnotationTransferState = {
  /** Annotation count of `countBookId` (what Export would write); 0 until known. */
  count: number
  countBookId: string | null
  exporting: boolean
  refreshCount: (bookId: string) => Promise<void>
  exportRestore: (bookId: string, onToast: (message: string | null) => void) => Promise<void>
}

/**
 * Annotation import / export state of the open Reader book (specs/006-annotation-import-export). All file work
 * happens in Main; this only asks Main for the count, starts the export and turns the result into a toast.
 */
export const useAnnotationTransferStore = create<AnnotationTransferState>()((set, get) => ({
  count: 0,
  countBookId: null,
  exporting: false,

  refreshCount: async (bookId) => {
    try {
      const { count } = await annotationTransferApi.count(bookId)
      set({ count, countBookId: bookId })
    } catch {
      set({ count: 0, countBookId: bookId })
    }
  },

  exportRestore: async (bookId, onToast) => {
    if (get().exporting) return
    set({ exporting: true })
    try {
      const shown = annotationExportMessage(await annotationTransferApi.exportRestore(bookId))
      if (shown) onToast(shown.message)
    } catch {
      onToast('Could not export the annotations.')
    } finally {
      set({ exporting: false })
    }
  },
}))

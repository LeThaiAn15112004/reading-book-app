import { useEffect } from 'react'
import { usePdfGraphicsStore } from '../pdfGraphics/pdfGraphicsStore'

type UseReaderPdfGraphicsOptions = {
  bookId: string | undefined
  isPdfSurface: boolean
  setToast: (message: string | null) => void
  /** Re-read the PDF's bytes after an edit was written into the file. */
  refreshFile: () => void
}

/**
 * React-lifecycle adapter over `usePdfGraphicsStore` (graphic objects inside the PDF): syncs the
 * ReaderScreen context into the store and lists the open PDF's objects. Inert for any other surface.
 */
export function useReaderPdfGraphics({ bookId, isPdfSurface, setToast, refreshFile }: UseReaderPdfGraphicsOptions) {
  const objects = usePdfGraphicsStore((s) => s.objects)
  const selectedId = usePdfGraphicsStore((s) => s.selectedId)
  const setContext = usePdfGraphicsStore((s) => s.setContext)
  const resetForNewBook = usePdfGraphicsStore((s) => s.resetForNewBook)
  const load = usePdfGraphicsStore((s) => s.load)

  useEffect(() => {
    setContext({ bookId: isPdfSurface ? bookId : undefined, onToast: setToast, onFileChanged: refreshFile })
  })

  useEffect(() => {
    resetForNewBook()
    if (!bookId || !isPdfSurface) return
    void load()
  }, [bookId, isPdfSurface, resetForNewBook, load])

  return {
    objects,
    selectedId,
    select: usePdfGraphicsStore((s) => s.select),
    apply: usePdfGraphicsStore((s) => s.apply),
    deleteSelected: usePdfGraphicsStore((s) => s.deleteSelected),
  }
}

import { useEffect } from 'react'
import { usePdfInkStore } from '../pdfInk/pdfInkStore'

type UseReaderPdfInkOptions = {
  bookId: string | undefined
  isPdfSurface: boolean
  setToast: (message: string | null) => void
}

/**
 * React-lifecycle adapter over `usePdfInkStore` (PDF freehand Ink): syncs the ReaderScreen context into
 * the store and loads the open PDF's strokes. Inert for any other surface.
 */
export function useReaderPdfInk({ bookId, isPdfSurface, setToast }: UseReaderPdfInkOptions) {
  const strokes = usePdfInkStore((s) => s.strokes)
  const selectedId = usePdfInkStore((s) => s.selectedId)
  const setContext = usePdfInkStore((s) => s.setContext)
  const resetForNewBook = usePdfInkStore((s) => s.resetForNewBook)
  const loadInk = usePdfInkStore((s) => s.loadInk)

  useEffect(() => {
    setContext({ bookId: isPdfSurface ? bookId : undefined, onToast: setToast })
  })

  // Fresh state per book; only a PDF surface loads. Runs after the context sync above.
  useEffect(() => {
    resetForNewBook()
    if (!bookId || !isPdfSurface) return
    void loadInk()
  }, [bookId, isPdfSurface, resetForNewBook, loadInk])

  return {
    strokes,
    selectedId,
    select: usePdfInkStore((s) => s.select),
    commitStroke: usePdfInkStore((s) => s.commitStroke),
    moveStroke: usePdfInkStore((s) => s.moveStroke),
    deleteSelected: usePdfInkStore((s) => s.deleteSelected),
  }
}

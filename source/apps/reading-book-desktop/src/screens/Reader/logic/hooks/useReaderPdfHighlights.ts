import { useEffect, type MutableRefObject } from 'react'
import type { PdfRendererApi } from '../../../../reader/renderers/pdf'
import { usePdfHighlightsStore } from '../pdfHighlights/pdfHighlightsStore'

type UseReaderPdfHighlightsOptions = {
  bookId: string | undefined
  isPdfSurface: boolean
  pdfApiRef: MutableRefObject<PdfRendererApi | null>
  /** Reader zoom — a change re-lays the marks out, so an open menu would point at the old spot. */
  zoom: number
  setToast: (message: string | null) => void
  setChromeHidden?: (hidden: boolean) => void
}

const noop = () => {}

/**
 * React-lifecycle adapter over `usePdfHighlightsStore` (PDF text annotations): syncs the
 * ReaderScreen context into the store, loads the open PDF's annotations, and closes the
 * annotation menu when the zoom changes. Inert for any other surface.
 */
export function useReaderPdfHighlights({
  bookId,
  isPdfSurface,
  pdfApiRef,
  zoom,
  setToast,
  setChromeHidden,
}: UseReaderPdfHighlightsOptions) {
  const highlights = usePdfHighlightsStore((s) => s.highlights)
  const activeHighlight = usePdfHighlightsStore((s) => s.activeHighlight)
  const focusedHighlightId = usePdfHighlightsStore((s) => s.focusedHighlightId)
  const lastUsedColorHex = usePdfHighlightsStore((s) => s.lastUsedColorHex)
  const setContext = usePdfHighlightsStore((s) => s.setContext)
  const resetForNewBook = usePdfHighlightsStore((s) => s.resetForNewBook)
  const loadHighlights = usePdfHighlightsStore((s) => s.loadHighlights)
  const closeEditPopup = usePdfHighlightsStore((s) => s.closeEditPopup)

  useEffect(() => {
    setContext({
      pdfApiRef,
      bookId: isPdfSurface ? bookId : undefined,
      onToast: setToast,
      onChromeHidden: setChromeHidden ?? noop,
    })
  })

  // Fresh state per book; only a PDF surface loads (EPUB rows would be dropped by the mapper anyway).
  // Runs after the context sync above, so the store already has this `bookId`.
  useEffect(() => {
    resetForNewBook()
    if (!bookId || !isPdfSurface) return
    void loadHighlights()
  }, [bookId, isPdfSurface, resetForNewBook, loadHighlights])

  useEffect(() => {
    closeEditPopup()
  }, [zoom, closeEditPopup])

  return {
    highlights,
    activeHighlight,
    focusedHighlightId,
    lastUsedColorHex,
    createFromSelection: usePdfHighlightsStore((s) => s.createFromSelection),
    commitMarkupSelection: usePdfHighlightsStore((s) => s.commitMarkupSelection),
    syncEmbeddedAnnotations: usePdfHighlightsStore((s) => s.syncEmbeddedAnnotations),
    openHighlight: usePdfHighlightsStore((s) => s.openHighlight),
    closeEditPopup,
    dismissAnnotationUi: usePdfHighlightsStore((s) => s.dismissAnnotationUi),
    updateHighlightColor: usePdfHighlightsStore((s) => s.updateHighlightColor),
    updateHighlightStyleKind: usePdfHighlightsStore((s) => s.updateHighlightStyleKind),
    updateHighlightNote: usePdfHighlightsStore((s) => s.updateHighlightNote),
    updateHighlightTags: usePdfHighlightsStore((s) => s.updateHighlightTags),
    deleteHighlight: usePdfHighlightsStore((s) => s.deleteHighlight),
    jumpToHighlight: usePdfHighlightsStore((s) => s.jumpToHighlight),
    undo: usePdfHighlightsStore((s) => s.undo),
    redo: usePdfHighlightsStore((s) => s.redo),
    deleteFocused: usePdfHighlightsStore((s) => s.deleteFocused),
    hasFocusedHighlight: usePdfHighlightsStore((s) => s.hasFocusedHighlight),
  }
}

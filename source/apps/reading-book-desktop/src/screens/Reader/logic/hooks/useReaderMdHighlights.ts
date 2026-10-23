import { useEffect, type MutableRefObject } from 'react'
import type { MdRendererApi } from '../../../../reader/renderers/md'
import { useMdHighlightsStore } from '../mdHighlights/mdHighlightsStore'

type UseReaderMdHighlightsOptions = {
  bookId: string | undefined
  isMdSurface: boolean
  mdApiRef: MutableRefObject<MdRendererApi | null>
  setToast: (message: string | null) => void
  setChromeHidden?: (hidden: boolean) => void
}

const noop = () => {}

/**
 * React-lifecycle adapter over `useMdHighlightsStore` (Markdown annotations): syncs the ReaderScreen
 * context into the store and loads the open book's annotations. Inert for any other surface.
 */
export function useReaderMdHighlights({
  bookId,
  isMdSurface,
  mdApiRef,
  setToast,
  setChromeHidden,
}: UseReaderMdHighlightsOptions) {
  const highlights = useMdHighlightsStore((s) => s.highlights)
  const activeHighlight = useMdHighlightsStore((s) => s.activeHighlight)
  const focusedHighlightId = useMdHighlightsStore((s) => s.focusedHighlightId)
  const lastUsedColorHex = useMdHighlightsStore((s) => s.lastUsedColorHex)
  const pendingInsert = useMdHighlightsStore((s) => s.pendingInsert)
  const setContext = useMdHighlightsStore((s) => s.setContext)
  const resetForNewBook = useMdHighlightsStore((s) => s.resetForNewBook)
  const loadHighlights = useMdHighlightsStore((s) => s.loadHighlights)

  useEffect(() => {
    setContext({
      mdApiRef,
      bookId: isMdSurface ? bookId : undefined,
      onToast: setToast,
      onChromeHidden: setChromeHidden ?? noop,
    })
  })

  // Fresh state per book; only a Markdown surface loads. Runs after the context sync above, so the
  // store already has this `bookId`.
  useEffect(() => {
    resetForNewBook()
    if (!bookId || !isMdSurface) return
    void loadHighlights()
  }, [bookId, isMdSurface, resetForNewBook, loadHighlights])

  return {
    highlights,
    activeHighlight,
    focusedHighlightId,
    lastUsedColorHex,
    pendingInsert,
    createFromSelection: useMdHighlightsStore((s) => s.createFromSelection),
    commitMarkupSelection: useMdHighlightsStore((s) => s.commitMarkupSelection),
    beginInsert: useMdHighlightsStore((s) => s.beginInsert),
    commitInsert: useMdHighlightsStore((s) => s.commitInsert),
    cancelInsert: useMdHighlightsStore((s) => s.cancelInsert),
    openHighlight: useMdHighlightsStore((s) => s.openHighlight),
    closeEditPopup: useMdHighlightsStore((s) => s.closeEditPopup),
    dismissAnnotationUi: useMdHighlightsStore((s) => s.dismissAnnotationUi),
    updateHighlightColor: useMdHighlightsStore((s) => s.updateHighlightColor),
    updateHighlightStyleKind: useMdHighlightsStore((s) => s.updateHighlightStyleKind),
    updateHighlightNote: useMdHighlightsStore((s) => s.updateHighlightNote),
    updateHighlightTags: useMdHighlightsStore((s) => s.updateHighlightTags),
    deleteHighlight: useMdHighlightsStore((s) => s.deleteHighlight),
    jumpToHighlight: useMdHighlightsStore((s) => s.jumpToHighlight),
    undo: useMdHighlightsStore((s) => s.undo),
    redo: useMdHighlightsStore((s) => s.redo),
    deleteFocused: useMdHighlightsStore((s) => s.deleteFocused),
    hasFocusedHighlight: useMdHighlightsStore((s) => s.hasFocusedHighlight),
  }
}

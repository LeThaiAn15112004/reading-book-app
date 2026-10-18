import { useEffect, useMemo, type MutableRefObject } from 'react'
import type { TxtReaderHighlight } from '@reading-book/book-reader-sdk'
import type { TxtRendererApi } from '../../../../reader/renderers/txt'
import { registerSessionFlushHandler } from '../session/sessionFlushRegistry'
import { useTxtDocumentStore } from '../txtDocument/txtDocumentStore'

type UseReaderTxtOptions = {
  bookId: string | undefined
  /** The open book is a TXT book whose file opened fine (the surface may load its text). */
  active: boolean
  txtApiRef: MutableRefObject<TxtRendererApi | null>
  setToast: (message: string | null) => void
  setChromeHidden: (hidden: boolean) => void
}

/** Stable empties: a zustand selector must not mint a new array on every call. */
const NO_HIGHLIGHTS: readonly TxtReaderHighlight[] = []

/**
 * React-lifecycle adapter over `useTxtDocumentStore`: loads the text when a TXT book opens, saves
 * what is pending when the book changes, the Reader unmounts, the window loses focus or Main asks
 * for a flush before closing — and hands the screen the slices and actions it renders. All state and
 * logic live in the store.
 */
export function useReaderTxt({ bookId, active, txtApiRef, setToast, setChromeHidden }: UseReaderTxtOptions) {
  const setContext = useTxtDocumentStore((s) => s.setContext)

  useEffect(() => {
    setContext({ bookId, txtApiRef, onToast: setToast, onChromeHidden: setChromeHidden })
  }, [bookId, txtApiRef, setToast, setChromeHidden, setContext])

  useEffect(() => {
    if (!active || !bookId) return
    void useTxtDocumentStore.getState().load(bookId)
    const unregister = registerSessionFlushHandler(async () => {
      await useTxtDocumentStore.getState().flush()
    })
    const flushSoon = () => void useTxtDocumentStore.getState().flush()
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushSoon()
    }
    window.addEventListener('blur', flushSoon)
    window.addEventListener('pagehide', flushSoon)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('blur', flushSoon)
      window.removeEventListener('pagehide', flushSoon)
      document.removeEventListener('visibilitychange', onHidden)
      unregister()
      void useTxtDocumentStore.getState().leave()
    }
  }, [active, bookId])

  const loadStatus = useTxtDocumentStore((s) => s.loadStatus)
  const errorCode = useTxtDocumentStore((s) => s.errorCode)
  const errorMessage = useTxtDocumentStore((s) => s.errorMessage)
  const text = useTxtDocumentStore((s) => s.doc?.text ?? '')
  const highlights = useTxtDocumentStore((s) => s.doc?.highlights ?? NO_HIGHLIGHTS)
  const editable = useTxtDocumentStore((s) => s.editable)
  const saveStatus = useTxtDocumentStore((s) => s.saveStatus)
  const saveError = useTxtDocumentStore((s) => s.saveError)
  const caretRequest = useTxtDocumentStore((s) => s.caretRequest)
  const focusedHighlightId = useTxtDocumentStore((s) => s.focusedHighlightId)
  const activeHighlight = useTxtDocumentStore((s) => s.activeHighlight)
  const selectionMenu = useTxtDocumentStore((s) => s.selectionMenu)

  const store = useTxtDocumentStore
  // The same shape `ReaderScreen` reads from the EPUB / PDF annotation stores, so the shared popups,
  // sidebar actions and Ctrl+Z / Delete shortcuts work unchanged.
  const markup = useMemo(
    () => ({
      highlights,
      activeHighlight,
      undo: () => store.getState().undo(),
      redo: () => store.getState().redo(),
      deleteFocused: () => store.getState().deleteFocused(),
      hasFocusedHighlight: () => store.getState().hasFocusedHighlight(),
      deleteHighlight: (id: string) => store.getState().deleteHighlight(id),
      updateHighlightColor: (id: string, colorHex: string) => store.getState().updateHighlightColor(id, colorHex),
      updateHighlightStyleKind: (id: string, styleKind: TxtReaderHighlight['styleKind']) =>
        store.getState().updateHighlightStyleKind(id, styleKind),
      updateHighlightNote: (id: string, note: string) => store.getState().updateHighlightNote(id, note),
      updateHighlightTags: (id: string, tags: string[]) => store.getState().updateHighlightTags(id, tags),
      closeEditPopup: () => store.getState().closeEditPopup(),
    }),
    [activeHighlight, highlights, store],
  )

  return {
    loadStatus,
    errorCode,
    errorMessage,
    text,
    highlights,
    editable,
    saveStatus,
    saveError,
    caretRequest,
    focusedHighlightId,
    selectionMenu,
    markup,
    // actions (stable store functions)
    applyEdit: useTxtDocumentStore.getState().applyEdit,
    undo: markup.undo,
    redo: markup.redo,
    saveNow: () => void store.getState().flush(),
    retrySave: () => store.getState().retrySave(),
    retryLoad: (id: string) => void store.getState().load(id),
    createFromSelection: store.getState().createFromSelection,
    commitMarkupSelection: store.getState().commitMarkupSelection,
    openHighlight: store.getState().openHighlight,
    dismissAnnotationUi: store.getState().dismissAnnotationUi,
    openSelectionMenu: store.getState().openSelectionMenu,
    closeSelectionMenu: store.getState().closeSelectionMenu,
    jumpToHighlight: store.getState().jumpToHighlight,
    setReadingOffset: store.getState().setReadingOffset,
    getTextLength: () => store.getState().doc?.text.length ?? 0,
  }
}

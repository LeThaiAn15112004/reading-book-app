import { useEffect, type MutableRefObject } from 'react'
import type {
  EpubNavState,
  EpubRendererApi,
  EpubSelectionInfo,
} from '../../../../reader/renderers/epub'
import { useHighlightsStore, type AnnotationMarkTool } from '../highlights/highlightsStore'

export type { AnnotationMarkTool }

/** The subset of this hook's surface `useReaderNavigation`'s keydown handler needs, handed
 *  through a ref populated fresh every render by `ReaderScreen` — a stable ref identity avoids
 *  re-binding the keydown/iframe-observer effect every render. */
export type HighlightShortcuts = {
  undo: () => void
  redo: () => void
  deleteFocused: () => void
  hasFocusedHighlight: () => boolean
  /** Escape while a Highlight/Underline tool is armed: disarm it. Returns whether it did (so the
   *  caller knows to swallow the keypress instead of letting it also close chrome/menus). */
  cancelAnnotationTool: () => boolean
}

type UseReaderHighlightsOptions = {
  bookId: string | undefined
  isEpubSurface: boolean
  epubApiRef: MutableRefObject<EpubRendererApi | null>
  /** Drives (re)applying highlights + (re)subscribing — non-null once the rendition is up. */
  epubNav: EpubNavState | null
  setToast: (message: string | null) => void
  /** Hide reader chrome after jumping to a highlight from the sidebar list. */
  setChromeHidden?: (hidden: boolean) => void
  /**
   * Toolbar's currently active Highlight/Underline/Strikethrough tool, or `null` when Hand/Select
   * is active. While set, a drag-to-select that ends on a non-collapsed selection is marked
   * immediately (last-used color, no context menu) instead of only opening the right-click menu.
   */
  activeAnnotationTool?: AnnotationMarkTool | null
  /** Called with a finished selection when no markup tool consumed it (translate mode). */
  onSelectionSettled?: (info: EpubSelectionInfo) => void
}

const noop = () => {}

/**
 * Highlights/underlines/strikethroughs for the open EPUB — select text, style it, edit or delete
 * it. All state and business logic (CRUD, undo/redo, persistence, driving epub.js's own
 * `rendition.annotations` API) lives in the zustand store `useHighlightsStore`
 * (`../highlights/highlightsStore.ts`); this hook is only the React-lifecycle adapter over it —
 * it syncs the props/refs `ReaderScreen` passes in as the store's "context" slice, and runs the
 * handful of effects that genuinely need React's lifecycle (resetting/loading on book open,
 * subscribing to epub.js's imperative `onTextSelected` event). No local `useState`/`useRef` of
 * its own.
 */
export function useReaderHighlights({
  bookId,
  isEpubSurface,
  epubApiRef,
  epubNav,
  setToast,
  setChromeHidden,
  activeAnnotationTool = null,
  onSelectionSettled = noop,
}: UseReaderHighlightsOptions) {
  const highlights = useHighlightsStore((s) => s.highlights)
  const pendingSelection = useHighlightsStore((s) => s.pendingSelection)
  const selectionMenu = useHighlightsStore((s) => s.selectionMenu)
  const activeHighlight = useHighlightsStore((s) => s.activeHighlight)
  const focusedHighlightId = useHighlightsStore((s) => s.focusedHighlightId)
  const lastUsedColorHex = useHighlightsStore((s) => s.lastUsedColorHex)
  const renditionReady = useHighlightsStore((s) => s.renditionReady)

  const setContext = useHighlightsStore((s) => s.setContext)
  const setRenditionReady = useHighlightsStore((s) => s.setRenditionReady)
  const resetForNewBook = useHighlightsStore((s) => s.resetForNewBook)
  const loadHighlights = useHighlightsStore((s) => s.loadHighlights)
  const applyAllHighlights = useHighlightsStore((s) => s.applyAllHighlights)
  const handleTextSelected = useHighlightsStore((s) => s.handleTextSelected)

  // Every store action reads `bookId`/`isEpubSurface`/`epubNav`/`activeAnnotationTool`/the
  // epub.js handle/the toast+chrome callbacks fresh via `get()` — syncing them here once per
  // render is what lets those actions stay plain, non-`useCallback`'d functions with no stale-
  // closure risk, instead of every one of them needing its own "read fresh via a ref" plumbing.
  useEffect(() => {
    setContext({
      epubApiRef,
      bookId,
      isEpubSurface,
      epubNav,
      activeAnnotationTool,
      onToast: setToast,
      onChromeHidden: setChromeHidden ?? noop,
      onSelectionSettled,
    })
  })

  // Resets when the book changes, since `EpubRenderer` fully remounts then.
  useEffect(() => {
    setRenditionReady(false)
  }, [bookId, setRenditionReady])
  // Flips true once the rendition + its imperative API exist, and stays true — unlike `epubNav`
  // (a fresh object on every page turn/relocation), so effects gated on it don't re-run on every
  // navigation.
  useEffect(() => {
    if (isEpubSurface && epubNav && epubApiRef.current) setRenditionReady(true)
  }, [isEpubSurface, epubNav, epubApiRef, setRenditionReady])

  // Load on book open.
  useEffect(() => {
    resetForNewBook()
    if (!bookId) return
    void loadHighlights()
  }, [bookId, resetForNewBook, loadHighlights])

  // Paint every stored highlight once the rendition exists; re-runs (harmlessly, idempotently)
  // whenever the highlight list changes. Gated on `renditionReady` rather than `epubNav` itself —
  // epub.js auto-reattaches a mark on every page/chapter render on its own, so re-running this
  // per navigation would only remove+re-add every highlight in the book on every page turn.
  useEffect(() => {
    if (!isEpubSurface || !renditionReady) return
    applyAllHighlights()
  }, [isEpubSurface, renditionReady, highlights, applyAllHighlights])

  // Track the live selection continuously — internal bookkeeping, not rendered directly (see
  // `pendingSelection`'s doc comment in highlightsStore.ts). Also invalidates a stale
  // `selectionMenu`: `openEpubjs.ts`'s selection-collapse watcher fires this callback with `null`
  // synchronously the instant a click collapses the current selection — including the very first
  // moment of starting a new selection elsewhere in the iframe — so this is the mechanism that
  // actually closes the menu when a fresh selection starts (`useDismissOnOutsideOrEscape`'s
  // outer-document listeners never see clicks that originate inside the iframe).
  useEffect(() => {
    if (!isEpubSurface || !renditionReady) return
    const api = epubApiRef.current
    if (!api) return
    return api.onTextSelected(handleTextSelected)
  }, [isEpubSurface, renditionReady, epubApiRef, handleTextSelected])

  return {
    highlights,
    pendingSelection,
    selectionMenu,
    activeHighlight,
    focusedHighlightId,
    lastUsedColorHex,
    createHighlight: useHighlightsStore((s) => s.createHighlight),
    commitDraggedMark: useHighlightsStore((s) => s.commitDraggedMark),
    updateHighlightColor: useHighlightsStore((s) => s.updateHighlightColor),
    updateHighlightStyleKind: useHighlightsStore((s) => s.updateHighlightStyleKind),
    updateHighlightNote: useHighlightsStore((s) => s.updateHighlightNote),
    updateHighlightTags: useHighlightsStore((s) => s.updateHighlightTags),
    deleteHighlight: useHighlightsStore((s) => s.deleteHighlight),
    jumpToHighlight: useHighlightsStore((s) => s.jumpToHighlight),
    closeSelectionMenu: useHighlightsStore((s) => s.closeSelectionMenu),
    openSelectionMenuAtPoint: useHighlightsStore((s) => s.openSelectionMenuAtPoint),
    focusHighlightFromClick: useHighlightsStore((s) => s.focusHighlightFromClick),
    openHighlightContextMenu: useHighlightsStore((s) => s.openHighlightContextMenu),
    closeEditPopup: useHighlightsStore((s) => s.closeEditPopup),
    dismissAnnotationUi: useHighlightsStore((s) => s.dismissAnnotationUi),
    undo: useHighlightsStore((s) => s.undo),
    redo: useHighlightsStore((s) => s.redo),
    deleteFocused: useHighlightsStore((s) => s.deleteFocused),
    hasFocusedHighlight: useHighlightsStore((s) => s.hasFocusedHighlight),
  }
}

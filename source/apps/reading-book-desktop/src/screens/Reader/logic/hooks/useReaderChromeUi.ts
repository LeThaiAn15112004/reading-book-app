import {
  useCallback,
  useEffect,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react'
import type { AnnotateTool } from '@reading-book/shared/models'
import type { EpubRendererApi } from '../../../../reader/renderers/epub'
import {
  clearStuckChromeHover,
  scheduleEpubResizeAfterChromeTransition,
} from '../../../../reader/readerChromeInteraction'
import type { HighlightEditTarget, SidebarTab } from '../../components'
import type { SelectionMenuState } from './useReaderAnnotations'

/** Callbacks owned by annotations / selection that chrome UI must invoke. */
export type ReaderChromeAnnotationBridge = {
  closeSelectionMenu: () => void
  dismissHighlightEditPanel: () => void
  /** Escape while an annotate tool is active: commit draft, reset tool, clear handles. */
  leaveAnnotateToolViaEscape: () => void
}

/** Live UI snapshot for Escape / center-tap (filled by ReaderScreen each render). */
export type ReaderChromeEscapeUi = {
  highlightEdit: HighlightEditTarget | null
  selectionMenu: SelectionMenuState | null
  activeTool: AnnotateTool
  isEpubSurface: boolean
  sidebarOpen: boolean
}

type UseReaderChromeUiOptions = {
  bookId: string | undefined
  registerReaderChrome: (api: {
    toolsOpen: boolean
    openTools: () => void
    closeTools: () => void
    toggleTools: () => void
  } | null) => void
  epubApiRef: RefObject<EpubRendererApi | null>
  annotationBridgeRef: MutableRefObject<ReaderChromeAnnotationBridge>
  escapeUiRef: MutableRefObject<ReaderChromeEscapeUi>
  readerSearchQuery: string
  readerSearchRequestId: number
}

export function useReaderChromeUi({
  bookId,
  registerReaderChrome,
  epubApiRef,
  annotationBridgeRef,
  escapeUiRef,
  readerSearchQuery,
  readerSearchRequestId,
}: UseReaderChromeUiOptions) {
  const [chromeHidden, setChromeHidden] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chapters')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [signOpen, setSignOpen] = useState(false)
  const [bookInfoOpen, setBookInfoOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)

  // Reset chrome UI when switching books.
  useEffect(() => {
    setSidebarOpen(false)
    setSidebarTab('chapters')
    setSettingsOpen(false)
    setMoreOpen(false)
    setSignOpen(false)
    setBookInfoOpen(false)
    setTrashOpen(false)
    setChromeHidden(true)
    setToast(null)
  }, [bookId])

  useEffect(() => {
    if (readerSearchRequestId === 0) return
    const q = readerSearchQuery.trim()
    if (!q) {
      setToast('Type something to search in this book.')
      return
    }
    setToast(`Search “${q}” — coming soon.`)
  }, [readerSearchRequestId, readerSearchQuery])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  const closeFloating = useCallback(() => {
    setMoreOpen(false)
    setSettingsOpen(false)
  }, [])

  const openSidebarTab = useCallback(
    (tab: SidebarTab) => {
      closeFloating()
      setSidebarTab(tab)
      setSidebarOpen(true)
    },
    [closeFloating],
  )

  const toggleSidebar = useCallback(() => {
    closeFloating()
    setSidebarOpen((open) => !open)
  }, [closeFloating])

  /**
   * Tap center clears transient reader UI without toggling the tools chrome.
   * The global menubar owns opening/closing tools via its Tools item.
   */
  function handleCenterTap() {
    const bridge = annotationBridgeRef.current
    const { isEpubSurface } = escapeUiRef.current
    closeFloating()
    bridge.closeSelectionMenu()
    bridge.dismissHighlightEditPanel()
    if (isEpubSurface) {
      epubApiRef.current?.clearSelection()
    } else {
      window.getSelection()?.removeAllRanges()
    }
  }

  const toggleChrome = useCallback(() => {
    closeFloating()
    setChromeHidden((v) => !v)
  }, [closeFloating])

  useEffect(() => {
    registerReaderChrome({
      toolsOpen: !chromeHidden,
      openTools: () => {
        closeFloating()
        setChromeHidden(false)
      },
      closeTools: () => {
        closeFloating()
        setChromeHidden(true)
      },
      toggleTools: toggleChrome,
    })
    return () => registerReaderChrome(null)
  }, [chromeHidden, closeFloating, registerReaderChrome, toggleChrome])

  // When chrome hides, drop Settings / More so panels cannot linger off-screen.
  useEffect(() => {
    if (!chromeHidden) return
    setMoreOpen(false)
    setSettingsOpen(false)
  }, [chromeHidden])

  // After tools/sidebar layout animates, refresh EPUB metrics and clear stuck hover.
  useEffect(() => {
    clearStuckChromeHover()
    return scheduleEpubResizeAfterChromeTransition(
      epubApiRef,
      escapeUiRef.current.isEpubSurface,
    )
  }, [chromeHidden, sidebarOpen, epubApiRef, escapeUiRef])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return
      }

      const bridge = annotationBridgeRef.current
      const {
        highlightEdit,
        selectionMenu,
        activeTool,
        isEpubSurface,
      } = escapeUiRef.current

      if (highlightEdit) {
        e.preventDefault()
        bridge.dismissHighlightEditPanel()
        return
      }
      if (selectionMenu) {
        e.preventDefault()
        if (isEpubSurface) {
          epubApiRef.current?.clearSelection()
        } else {
          window.getSelection()?.removeAllRanges()
        }
        bridge.closeSelectionMenu()
        return
      }
      if (
        activeTool === 'select' ||
        activeTool === 'highlight' ||
        activeTool === 'typewriter' ||
        activeTool === 'pencil' ||
        activeTool === 'shape' ||
        activeTool === 'eraser' ||
        activeTool === 'esign'
      ) {
        e.preventDefault()
        bridge.leaveAnnotateToolViaEscape()
        return
      }
      if (settingsOpen || moreOpen) {
        e.preventDefault()
        setMoreOpen(false)
        setSettingsOpen(false)
        return
      }
      if (!chromeHidden) {
        e.preventDefault()
        setChromeHidden(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    annotationBridgeRef,
    chromeHidden,
    epubApiRef,
    escapeUiRef,
    moreOpen,
    settingsOpen,
  ])

  return {
    chromeHidden,
    setChromeHidden,
    sidebarOpen,
    setSidebarOpen,
    sidebarTab,
    setSidebarTab,
    settingsOpen,
    setSettingsOpen,
    moreOpen,
    setMoreOpen,
    toast,
    setToast,
    signOpen,
    setSignOpen,
    bookInfoOpen,
    setBookInfoOpen,
    trashOpen,
    setTrashOpen,
    closeFloating,
    openSidebarTab,
    toggleSidebar,
    handleCenterTap,
    toggleChrome,
  }
}

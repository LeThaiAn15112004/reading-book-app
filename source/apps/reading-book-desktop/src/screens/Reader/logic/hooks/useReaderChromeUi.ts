import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react'
import type { EpubRendererApi } from '../../../../reader/renderers/epub'
import { useShortcutAction } from '../../../../shortcuts'
import {
  READER_CHROME_RESIZE_SETTLE_MS,
  blurReaderSidebarFocus,
  clearStuckChromeHover,
  scheduleEpubResizeAfterChromeTransition,
} from '../../../../reader/chrome'
import type { SidebarTab } from '../../components'
import { useReadAloudStore } from '../readAloud/readAloudStore'
import { useRightPanelStore } from '../rightPanel/rightPanelStore'

/** Live UI snapshot for Escape / center-tap (filled by ReaderScreen each render). */
export type ReaderChromeEscapeUi = {
  isEpubSurface: boolean
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
  escapeUiRef: MutableRefObject<ReaderChromeEscapeUi>
  /** OS fullscreen on Reader — collapse all chrome until edge-reveal. */
  immersive?: boolean
}

export function useReaderChromeUi({
  bookId,
  registerReaderChrome,
  epubApiRef,
  escapeUiRef,
  immersive = false,
}: UseReaderChromeUiOptions) {
  const [chromeHidden, setChromeHidden] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chapters')
  const [isChromeResizeSettling, setIsChromeResizeSettling] = useState(false)
  // Reading settings live in the docked right sidebar (shared store, one panel at a time).
  const rightPanel = useRightPanelStore((s) => s.panel)
  const settingsOpen = rightPanel === 'settings'
  const setSettingsOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    const store = useRightPanelStore.getState()
    const isOpen = store.panel === 'settings'
    const want = typeof next === 'function' ? next(isOpen) : next
    if (want) store.open('settings')
    else if (isOpen) store.close()
  }, [])
  const [moreOpen, setMoreOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [signOpen, setSignOpen] = useState(false)
  const [bookInfoOpen, setBookInfoOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [wordCountOpen, setWordCountOpen] = useState(false)

  // Reset chrome UI when switching books.
  useEffect(() => {
    setSidebarOpen(false)
    setSidebarTab('chapters')
    useRightPanelStore.getState().close()
    setMoreOpen(false)
    setSearchOpen(false)
    setSignOpen(false)
    setBookInfoOpen(false)
    setTrashOpen(false)
    setWordCountOpen(false)
    setChromeHidden(true)
    setToast(null)
  }, [bookId])

  // Entering immersive fullscreen: hide tools/sidebars so the page fills the screen.
  useEffect(() => {
    if (!immersive) return
    setChromeHidden(true)
    setSidebarOpen(false)
    setMoreOpen(false)
    useRightPanelStore.getState().close()
    setSearchOpen(false)
  }, [immersive])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  const closeFloating = useCallback(() => {
    setMoreOpen(false)
    setSearchOpen(false)
    useReadAloudStore.getState().closeMenu()
  }, [])

  const toggleSearch = useCallback(() => {
    if (immersive) return
    setMoreOpen(false)
    setSearchOpen((open) => !open)
  }, [immersive])

  const openSidebarTab = useCallback(
    (tab: SidebarTab) => {
      if (immersive) return
      closeFloating()
      setSidebarTab(tab)
      setSidebarOpen(true)
    },
    [closeFloating, immersive],
  )

  const toggleSidebar = useCallback(() => {
    if (immersive) return
    closeFloating()
    setSidebarOpen((open) => !open)
  }, [closeFloating, immersive])

  /**
   * Tap center clears transient reader UI without toggling the tools chrome.
   * The global menubar owns opening/closing tools via its Tools item.
   */
  function handleCenterTap() {
    const { isEpubSurface } = escapeUiRef.current
    closeFloating()
    blurReaderSidebarFocus()
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

  // When chrome hides, drop More / Search so popovers cannot linger off-screen. The docked right
  // sidebar stays (like the left sidebar) and just moves up to the top of the reader.
  useEffect(() => {
    if (!chromeHidden) return
    setMoreOpen(false)
    setSearchOpen(false)
    useReadAloudStore.getState().closeMenu()
  }, [chromeHidden])

  // After tools/sidebar/immersive layout animates, refresh EPUB metrics and clear stuck hover.
  useEffect(() => {
    clearStuckChromeHover()
    return scheduleEpubResizeAfterChromeTransition(
      epubApiRef,
      escapeUiRef.current.isEpubSurface,
    )
  }, [chromeHidden, sidebarOpen, rightPanel, immersive, epubApiRef, escapeUiRef])

  /**
   * Left/right sidebar and immersive toggles resize the EPUB host's *width*
   * (via contentInsetLeft), not just its top padding. The CSS padding
   * transition above animates instantly, but epub.js only re-paginates to
   * the new width once that transition settles — so for a window of a few
   * hundred ms the reading column paints at its old pixel width inside an
   * already-resized host, which looks like a broken/squeezed layout. Cover
   * the reading surface for that window (skipping the very first mount,
   * where nothing is animating) so the stale-width repaint is never visible
   * — same "hide the glitch" pattern used for CFI jumps.
   */
  const skipInitialResizeSettleRef = useRef(true)
  useEffect(() => {
    if (skipInitialResizeSettleRef.current) {
      skipInitialResizeSettleRef.current = false
      return
    }
    if (!escapeUiRef.current.isEpubSurface) return
    setIsChromeResizeSettling(true)
    const id = window.setTimeout(() => {
      setIsChromeResizeSettling(false)
    }, READER_CHROME_RESIZE_SETTLE_MS)
    return () => {
      window.clearTimeout(id)
      setIsChromeResizeSettling(false)
    }
  }, [sidebarOpen, rightPanel, immersive, escapeUiRef])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return
      }

      if (settingsOpen || moreOpen || searchOpen) {
        e.preventDefault()
        setMoreOpen(false)
        setSettingsOpen(false)
        setSearchOpen(false)
        return
      }
      if (!chromeHidden) {
        e.preventDefault()
        setChromeHidden(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chromeHidden, moreOpen, settingsOpen, setSettingsOpen, searchOpen])

  // "Search in Book" shortcut (Settings → Keyboard Shortcuts, Ctrl/Cmd+F by default): reveal chrome
  // if hidden and open the in-book search panel.
  useShortcutAction('general.searchBook', () => {
    if (immersive) return
    setChromeHidden(false)
    setMoreOpen(false)
    setSearchOpen(true)
  })

  return {
    chromeHidden,
    setChromeHidden,
    sidebarOpen,
    setSidebarOpen,
    sidebarTab,
    setSidebarTab,
    isChromeResizeSettling,
    settingsOpen,
    setSettingsOpen,
    moreOpen,
    setMoreOpen,
    searchOpen,
    setSearchOpen,
    toggleSearch,
    toast,
    setToast,
    signOpen,
    setSignOpen,
    bookInfoOpen,
    setBookInfoOpen,
    trashOpen,
    setTrashOpen,
    wordCountOpen,
    setWordCountOpen,
    closeFloating,
    openSidebarTab,
    toggleSidebar,
    handleCenterTap,
    toggleChrome,
  }
}

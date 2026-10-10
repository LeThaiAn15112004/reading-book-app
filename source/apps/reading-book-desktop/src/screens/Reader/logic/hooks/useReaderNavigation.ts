import {
  useCallback,
  useEffect,
  useState,
  type MutableRefObject,
} from 'react'
import type {
  EpubNavState,
  EpubRendererApi,
  EpubTocItem,
} from '../../../../reader/renderers/epub'
import type {
  PdfNavState,
  PdfOutlineItem,
  PdfRendererApi,
} from '../../../../reader/renderers/pdf'
import { blurReaderSidebarFocus } from '../../../../reader/chrome'
import {
  isTypingTarget,
  listenKeydownInIframes,
} from '../../../../shortcuts/iframeKeydown'
import { FAKE_CHAPTERS } from '../demo/fakeReaderContent'
import type { HighlightShortcuts } from './useReaderHighlights'

function navigateEpubByStep(api: EpubRendererApi, forward: boolean): void {
  void (forward ? api.nextPage() : api.prevPage())
}

/** PDF outline entries ride the shared TOC tree as `pdf-page:N` hrefs (no EPUB data involved). */
const PDF_PAGE_HREF = 'pdf-page:'

function pdfOutlineToTocItems(items: PdfOutlineItem[]): EpubTocItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    href: item.page ? `${PDF_PAGE_HREF}${item.page}` : '',
    level: item.level,
    children: pdfOutlineToTocItems(item.children),
  }))
}

type UseReaderNavigationOptions = {
  bookId: string | undefined
  contentStatus: 'idle' | 'loading' | 'ready' | 'error'
  bookBytes: ArrayBuffer | null
  bookFormat: string | null
  isEpubSurface: boolean
  epubApiRef: MutableRefObject<EpubRendererApi | null>
  isPdfSurface: boolean
  pdfApiRef: MutableRefObject<PdfRendererApi | null>
  closeFloating: () => void
  highlightShortcutsRef: MutableRefObject<HighlightShortcuts>
}

export function useReaderNavigation({
  bookId,
  contentStatus,
  bookBytes,
  bookFormat,
  isEpubSurface,
  epubApiRef,
  isPdfSurface,
  pdfApiRef,
  closeFloating,
  highlightShortcutsRef,
}: UseReaderNavigationOptions) {
  const [chapterIndex, setChapterIndex] = useState(0)
  const [epubNav, setEpubNav] = useState<EpubNavState | null>(null)
  const [epubToc, setEpubToc] = useState<EpubTocItem[]>([])
  const [epubSections, setEpubSections] = useState<string[]>([])
  const [pdfNav, setPdfNav] = useState<PdfNavState | null>(null)
  const [pdfToc, setPdfToc] = useState<EpubTocItem[]>([])

  const setPdfOutline = useCallback((items: PdfOutlineItem[]) => {
    setPdfToc(pdfOutlineToTocItems(items))
  }, [])

  // Reset navigation state when switching books.
  useEffect(() => {
    setChapterIndex(0)
    setEpubNav(null)
    setEpubToc([])
    setEpubSections([])
    setPdfNav(null)
    setPdfToc([])
    epubApiRef.current = null
    pdfApiRef.current = null
  }, [bookId, epubApiRef, pdfApiRef])

  function clearTransientNavUi() {
    blurReaderSidebarFocus()
  }

  function goChapter(index: number) {
    const next = Math.min(Math.max(index, 0), FAKE_CHAPTERS.length - 1)
    setChapterIndex(next)
    clearTransientNavUi()
  }

  function switchPage(forward: boolean) {
    if (isEpubSurface) {
      const api = epubApiRef.current
      if (!api) return
      navigateEpubByStep(api, forward)
      clearTransientNavUi()
      return
    }
    if (isPdfSurface) {
      const api = pdfApiRef.current
      if (!api) return
      if (forward) api.nextPage()
      else api.prevPage()
      clearTransientNavUi()
      return
    }

    setChapterIndex((index) =>
      forward
        ? Math.min(index + 1, FAKE_CHAPTERS.length - 1)
        : Math.max(index - 1, 0),
    )
    clearTransientNavUi()
  }

  function goToPage(page: number) {
    if (isEpubSurface) {
      const api = epubApiRef.current
      if (!api) return
      void api.goToLocationPage(page)
      clearTransientNavUi()
      return
    }
    if (isPdfSurface) {
      pdfApiRef.current?.goToPage(page)
      clearTransientNavUi()
      return
    }

    goChapter(page - 1)
  }

  /**
   * Start of the book (EPUB: first spine section, or its synthetic cover). False when the surface
   * can't navigate yet — the shortcut then leaves the key alone.
   */
  const goToStart = useCallback((): boolean => {
    if (isEpubSurface) {
      const api = epubApiRef.current
      if (!api) return false
      void api.goToSpineIndex(0)
    } else if (isPdfSurface) {
      const api = pdfApiRef.current
      if (!api) return false
      api.goToPage(1)
    } else {
      setChapterIndex(0)
    }
    clearTransientNavUi()
    return true
  }, [epubApiRef, isEpubSurface, isPdfSurface, pdfApiRef])

  /**
   * End of the book. EPUB resolves with whether the reader really reached the last page / bottom of
   * the last section (not just the start of that section); placeholder chapters jump to the last one.
   */
  const goToEnd = useCallback(async (): Promise<boolean> => {
    if (isEpubSurface) {
      const api = epubApiRef.current
      if (!api) return false
      const reached = await api.goToEnd()
      clearTransientNavUi()
      return reached
    }
    if (isPdfSurface) {
      const api = pdfApiRef.current
      if (!api) return false
      api.goToPage(api.getNavState().pageTotal)
      clearTransientNavUi()
      return true
    }
    setChapterIndex(FAKE_CHAPTERS.length - 1)
    clearTransientNavUi()
    return true
  }, [epubApiRef, isEpubSurface, isPdfSurface, pdfApiRef])

  /** Page layout thumbnails browse spine *sections* (EPUB) or pages (PDF). */
  const goToPageFromLayout = useCallback(
    (page: number) => {
      if (isEpubSurface) {
        const api = epubApiRef.current
        if (!api) return
        void api.goToSpineIndex(page - 1)
      } else if (isPdfSurface) {
        pdfApiRef.current?.goToPage(page)
      } else {
        setChapterIndex(
          Math.min(Math.max(page - 1, 0), FAKE_CHAPTERS.length - 1),
        )
      }
      clearTransientNavUi()
    },
    [epubApiRef, isEpubSurface, isPdfSurface, pdfApiRef],
  )

  /** Seek to a 0..1 fraction of book position (progress-bar click), by spine order. */
  const goToProgress = useCallback(
    (fraction: number) => {
      const clampedFraction = Math.min(Math.max(fraction, 0), 1)
      if (isEpubSurface) {
        const api = epubApiRef.current
        if (!api) return
        const spineLength = epubNav?.spineLength ?? 1
        const targetIndex = Math.min(
          Math.max(Math.floor(clampedFraction * spineLength), 0),
          Math.max(spineLength - 1, 0),
        )
        void api.goToSpineIndex(targetIndex)
      } else if (isPdfSurface) {
        const api = pdfApiRef.current
        if (!api) return
        const total = api.getNavState().pageTotal
        if (total <= 0) return
        api.goToPage(Math.min(Math.floor(clampedFraction * total) + 1, total))
      } else {
        setChapterIndex(
          Math.min(
            Math.max(Math.floor(clampedFraction * FAKE_CHAPTERS.length), 0),
            FAKE_CHAPTERS.length - 1,
          ),
        )
      }
      clearTransientNavUi()
    },
    [epubApiRef, epubNav, isEpubSurface, isPdfSurface, pdfApiRef],
  )

  function handleSelectTocItem(item: EpubTocItem) {
    if (!item.href) return
    closeFloating()
    clearTransientNavUi()
    if (item.href.startsWith(PDF_PAGE_HREF)) {
      const page = Number.parseInt(item.href.slice(PDF_PAGE_HREF.length), 10)
      if (Number.isFinite(page)) pdfApiRef.current?.goToPage(page)
      return
    }
    const api = epubApiRef.current
    if (!api) return
    void api.goToHref(item.href)
  }

  // Escape / highlight undo-redo / delete-highlight (window + EPUB iframes). Page turning, Home/End
  // and the rest of the reading keys are registry shortcuts now (see `useReaderShortcuts`).
  useEffect(() => {
    if (contentStatus !== 'ready') return

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      if (e.altKey) return

      // Highlight/Underline tool armed: Escape drops back to Select instead of leaving the
      // reader — checked first since it should win over any other Escape-driven UI.
      if (e.key === 'Escape') {
        // Already consumed by an open popover/menu (`consumeEscape`) — one level per keypress.
        if (e.defaultPrevented) return
        if (highlightShortcutsRef.current.cancelAnnotationTool()) {
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }

      // Highlight undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Y, Ctrl/Cmd+Shift+Z).
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase()
        if (key === 'z') {
          e.preventDefault()
          e.stopPropagation()
          if (e.shiftKey) highlightShortcutsRef.current.redo()
          else highlightShortcutsRef.current.undo()
          return
        }
        if (key === 'y') {
          e.preventDefault()
          e.stopPropagation()
          highlightShortcutsRef.current.redo()
          return
        }
      }

      // Delete the focused highlight (its edit popup is open).
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !e.ctrlKey &&
        !e.metaKey &&
        highlightShortcutsRef.current.hasFocusedHighlight()
      ) {
        e.preventDefault()
        e.stopPropagation()
        highlightShortcutsRef.current.deleteFocused()
        return
      }
    }

    // Capture so it wins over focused footer controls; EPUB pages live in iframes whose key events
    // never reach `window`, so the helper binds those documents too.
    return listenKeydownInIframes(onKeyDown)
  }, [bookBytes, bookFormat, contentStatus, highlightShortcutsRef])

  return {
    chapterIndex,
    setChapterIndex,
    epubNav,
    setEpubNav,
    epubToc,
    setEpubToc,
    epubSections,
    setEpubSections,
    pdfNav,
    setPdfNav,
    pdfToc,
    setPdfOutline,
    goChapter,
    switchPage,
    goToPage,
    goToStart,
    goToEnd,
    goToPageFromLayout,
    goToProgress,
    handleSelectTocItem,
  }
}

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
import { blurReaderSidebarFocus } from '../../../../reader/chrome'
import { FAKE_CHAPTERS } from '../demo/fakeReaderContent'
import type { HighlightShortcuts } from './useReaderHighlights'

function navigateEpubByArrow(api: EpubRendererApi, forward: boolean): void {
  void (forward ? api.nextPage() : api.prevPage())
}

type UseReaderNavigationOptions = {
  bookId: string | undefined
  contentStatus: 'idle' | 'loading' | 'ready' | 'error'
  bookBytes: ArrayBuffer | null
  bookFormat: string | null
  isEpubSurface: boolean
  epubApiRef: MutableRefObject<EpubRendererApi | null>
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
  closeFloating,
  highlightShortcutsRef,
}: UseReaderNavigationOptions) {
  const [chapterIndex, setChapterIndex] = useState(0)
  const [epubNav, setEpubNav] = useState<EpubNavState | null>(null)
  const [epubToc, setEpubToc] = useState<EpubTocItem[]>([])
  const [epubSections, setEpubSections] = useState<string[]>([])

  // Reset navigation state when switching books.
  useEffect(() => {
    setChapterIndex(0)
    setEpubNav(null)
    setEpubToc([])
    setEpubSections([])
    epubApiRef.current = null
  }, [bookId, epubApiRef])

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
      navigateEpubByArrow(api, forward)
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

    goChapter(page - 1)
  }

  /** Page layout thumbnails browse spine *sections*, not rendered pages. */
  const goToPageFromLayout = useCallback(
    (page: number) => {
      if (isEpubSurface) {
        const api = epubApiRef.current
        if (!api) return
        void api.goToSpineIndex(page - 1)
      } else {
        setChapterIndex(
          Math.min(Math.max(page - 1, 0), FAKE_CHAPTERS.length - 1),
        )
      }
      clearTransientNavUi()
    },
    [isEpubSurface],
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
    [epubApiRef, epubNav, isEpubSurface],
  )

  function handleSelectTocItem(item: EpubTocItem) {
    if (!item.href) return
    closeFloating()
    clearTransientNavUi()
    const api = epubApiRef.current
    if (!api) return
    void api.goToHref(item.href)
  }

  function isReaderTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      el.isContentEditable
    )
  }

  // Page navigation uses only ArrowLeft/ArrowRight (window + EPUB iframes).
  useEffect(() => {
    if (contentStatus !== 'ready') return

    function onKeyDown(e: KeyboardEvent) {
      if (isReaderTypingTarget(e.target)) return
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

      const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
      if (!isArrow) return

      const pageNav = isArrow && !e.ctrlKey && !e.metaKey
      if (!pageNav) return

      const forward = e.key === 'ArrowRight'

      if (isEpubSurface) {
        const api = epubApiRef.current
        // Bytes may be ready before epubjs finishes opening — don't swallow keys.
        if (!api) return
        e.preventDefault()
        e.stopPropagation()
        navigateEpubByArrow(api, forward)
        clearTransientNavUi()
        return
      }

      e.preventDefault()
      e.stopPropagation()
      setChapterIndex((i) => {
        const next = forward
          ? Math.min(i + 1, FAKE_CHAPTERS.length - 1)
          : Math.max(i - 1, 0)
        return next
      })
      clearTransientNavUi()
    }

    // Capture so it wins over focused footer controls; also works when body has focus.
    window.addEventListener('keydown', onKeyDown, true)

    // EPUB pages live in iframes — their key events never reach `window`.
    const boundDocs = new Set<Document>()
    function bindEpubIframes() {
      document.querySelectorAll('iframe').forEach((iframe) => {
        try {
          const doc = iframe.contentDocument
          if (!doc || boundDocs.has(doc)) return
          boundDocs.add(doc)
          doc.addEventListener('keydown', onKeyDown, true)
        } catch {
          // Ignore cross-origin frames.
        }
      })
    }

    bindEpubIframes()
    const mo = new MutationObserver(bindEpubIframes)
    mo.observe(document.body, { childList: true, subtree: true })
    // epubjs swaps iframe docs on page turn; poll briefly so new docs get bound.
    const pollId = window.setInterval(bindEpubIframes, 500)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      mo.disconnect()
      window.clearInterval(pollId)
      boundDocs.forEach((doc) => {
        doc.removeEventListener('keydown', onKeyDown, true)
      })
      boundDocs.clear()
    }
  }, [bookBytes, bookFormat, chapterIndex, contentStatus, isEpubSurface, highlightShortcutsRef])

  return {
    chapterIndex,
    setChapterIndex,
    epubNav,
    setEpubNav,
    epubToc,
    setEpubToc,
    epubSections,
    setEpubSections,
    goChapter,
    switchPage,
    goToPage,
    goToPageFromLayout,
    goToProgress,
    handleSelectTocItem,
  }
}

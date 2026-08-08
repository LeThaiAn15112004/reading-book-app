import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { PageMode } from '@reading-book/shared/models'
import type {
  EpubNavState,
  EpubRendererApi,
  EpubTocItem,
} from '../../../../reader/renderers/epub'
import { FAKE_CHAPTERS } from '../demo/fakeReaderContent'
import type { SelectionMenuState } from './useReaderAnnotations'

function navigateEpubByArrow(
  api: EpubRendererApi,
  forward: boolean,
  pageMode: PageMode,
): void {
  if (pageMode === 'scroll') {
    void (forward ? api.nextSection() : api.prevSection())
    return
  }
  void (forward ? api.nextPage() : api.prevPage())
}

type AnnotationShortcuts = {
  undo: () => void
  redo: () => void
  deleteFocused: () => void
}

type UseReaderNavigationOptions = {
  bookId: string | undefined
  contentStatus: 'idle' | 'loading' | 'ready' | 'error'
  bookBytes: ArrayBuffer | null
  bookFormat: string | null
  isEpubSurface: boolean
  pageMode: PageMode
  epubApiRef: MutableRefObject<EpubRendererApi | null>
  closeFloating: () => void
  setSelectionMenu: Dispatch<SetStateAction<SelectionMenuState | null>>
  clearHighlightHandles: () => void
  annotationShortcutsRef: MutableRefObject<AnnotationShortcuts>
  activeToolIsHighlight: () => boolean
  hasHighlightEdit: () => boolean
}

export function useReaderNavigation({
  bookId,
  contentStatus,
  bookBytes,
  bookFormat,
  isEpubSurface,
  pageMode,
  epubApiRef,
  closeFloating,
  setSelectionMenu,
  clearHighlightHandles,
  annotationShortcutsRef,
  activeToolIsHighlight,
  hasHighlightEdit,
}: UseReaderNavigationOptions) {
  const [chapterIndex, setChapterIndex] = useState(0)
  const [epubNav, setEpubNav] = useState<EpubNavState | null>(null)
  const [epubToc, setEpubToc] = useState<EpubTocItem[]>([])

  // Reset navigation state when switching books.
  useEffect(() => {
    setChapterIndex(0)
    setEpubNav(null)
    setEpubToc([])
    epubApiRef.current = null
  }, [bookId, epubApiRef])

  function goChapter(index: number) {
    const next = Math.min(Math.max(index, 0), FAKE_CHAPTERS.length - 1)
    setChapterIndex(next)
    setSelectionMenu(null)
    clearHighlightHandles()
  }

  function switchPage(forward: boolean) {
    if (isEpubSurface) {
      const api = epubApiRef.current
      if (!api) return
      navigateEpubByArrow(api, forward, pageMode)
      return
    }

    setChapterIndex((index) =>
      forward
        ? Math.min(index + 1, FAKE_CHAPTERS.length - 1)
        : Math.max(index - 1, 0),
    )
    setSelectionMenu(null)
    clearHighlightHandles()
  }

  function goToPage(page: number) {
    if (isEpubSurface) {
      const api = epubApiRef.current
      if (!api) return
      void api.goToSpineIndex(page - 1)
      return
    }

    goChapter(page - 1)
  }

  /** Page layout thumbnails — navigate without closing the sidebar. */
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
      setSelectionMenu(null)
      clearHighlightHandles()
    },
    [clearHighlightHandles, isEpubSurface, setSelectionMenu],
  )

  function handleSelectTocItem(item: EpubTocItem) {
    if (!item.href) return
    closeFloating()
    setSelectionMenu(null)
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
  // Also hosts annotation undo/redo shortcuts so one capture listener stays cohesive.
  useEffect(() => {
    if (contentStatus !== 'ready') return

    function onKeyDown(e: KeyboardEvent) {
      if (isReaderTypingTarget(e.target)) return
      if (e.altKey) return

      // Annotation undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Y, Ctrl/Cmd+Shift+Z).
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase()
        if (key === 'z') {
          e.preventDefault()
          e.stopPropagation()
          if (e.shiftKey) annotationShortcutsRef.current.redo()
          else annotationShortcutsRef.current.undo()
          return
        }
        if (key === 'y') {
          e.preventDefault()
          e.stopPropagation()
          annotationShortcutsRef.current.redo()
          return
        }
      }

      // Quick delete focused highlight while Highlight tool is active.
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !e.ctrlKey &&
        !e.metaKey &&
        activeToolIsHighlight() &&
        hasHighlightEdit()
      ) {
        e.preventDefault()
        e.stopPropagation()
        annotationShortcutsRef.current.deleteFocused()
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
        navigateEpubByArrow(api, forward, pageMode)
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
      setSelectionMenu(null)
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
  }, [
    activeToolIsHighlight,
    annotationShortcutsRef,
    bookBytes,
    bookFormat,
    chapterIndex,
    contentStatus,
    hasHighlightEdit,
    isEpubSurface,
    pageMode,
    setSelectionMenu,
  ])

  return {
    chapterIndex,
    setChapterIndex,
    epubNav,
    setEpubNav,
    epubToc,
    setEpubToc,
    goChapter,
    switchPage,
    goToPage,
    goToPageFromLayout,
    handleSelectTocItem,
  }
}

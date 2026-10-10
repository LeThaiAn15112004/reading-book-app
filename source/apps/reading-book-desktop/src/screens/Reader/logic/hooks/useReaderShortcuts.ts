import type { MutableRefObject } from 'react'
import type { EpubRendererApi } from '../../../../reader/renderers/epub'
import type { PdfRendererApi } from '../../../../reader/renderers/pdf'
import { useShortcutAction } from '../../../../shortcuts'
import type { SidebarTab } from '../../components'
import { useBookSearchStore } from '../search/bookSearchStore'

type UseReaderShortcutsOptions = {
  /** Book content is ready and no Reader dialog (Book Info, Sign, Trash) covers the page. */
  enabled: boolean
  /** OS fullscreen: chrome is collapsed, so panel-opening shortcuts are off. */
  immersive: boolean
  isEpubSurface: boolean
  epubApiRef: MutableRefObject<EpubRendererApi | null>
  isPdfSurface: boolean
  pdfApiRef: MutableRefObject<PdfRendererApi | null>
  switchPage: (forward: boolean) => void
  goToStart: () => boolean
  goToEnd: () => Promise<boolean>
  toggleBookmark: () => void
  searchOpen: boolean
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  openSidebarTab: (tab: SidebarTab) => void
  toggleSidebar: () => void
  setToast: (message: string | null) => void
}

/**
 * Registers the Reader's Navigation and Search shortcuts (Settings → Keyboard Shortcuts) with the
 * app-level bridge. Each handler states what this surface can really do: returning `false` leaves
 * the key press to the browser instead of swallowing it. The keys themselves (and their aliases)
 * live in `shortcuts/shortcutDefinitions.ts`.
 *
 * "Go to Page" is registered by `ReaderFooter`, which owns the page input.
 */
export function useReaderShortcuts({
  enabled,
  immersive,
  isEpubSurface,
  epubApiRef,
  isPdfSurface,
  pdfApiRef,
  switchPage,
  goToStart,
  goToEnd,
  toggleBookmark,
  searchOpen,
  sidebarOpen,
  sidebarTab,
  openSidebarTab,
  toggleSidebar,
  setToast,
}: UseReaderShortcutsOptions): void {
  // EPUB / PDF handlers need the renderer (it opens a moment after the bytes arrive).
  const surfaceReady = () =>
    (!isEpubSurface || epubApiRef.current !== null) &&
    (!isPdfSurface || pdfApiRef.current !== null)

  useShortcutAction(
    'navigation.nextPage',
    () => {
      if (!surfaceReady()) return false
      switchPage(true)
    },
    enabled,
  )
  useShortcutAction(
    'navigation.previousPage',
    () => {
      if (!surfaceReady()) return false
      switchPage(false)
    },
    enabled,
  )
  useShortcutAction('navigation.firstPage', () => goToStart(), enabled)
  useShortcutAction(
    'navigation.lastPage',
    () => {
      if (!surfaceReady()) return false
      void goToEnd().then((reached) => {
        if (!reached) setToast('Couldn’t reach the end of the book.')
      })
    },
    enabled,
  )

  // One call to the existing toggle per key press — the footer button uses the same function.
  useShortcutAction('navigation.addBookmark', () => toggleBookmark(), enabled)

  useShortcutAction(
    'navigation.toggleToc',
    () => {
      if (!sidebarOpen || sidebarTab !== 'chapters') openSidebarTab('chapters')
      else toggleSidebar()
    },
    enabled && !immersive,
  )

  // Outside the search box only: inside it Enter / Shift+Enter keep the input's own handling
  // (Enter submits the typed query, or steps when it hasn't changed).
  useShortcutAction(
    'search.nextResult',
    () => {
      const search = useBookSearchStore.getState()
      if (!search.inputQuery.trim()) return false
      search.submit()
    },
    enabled && searchOpen && !immersive,
  )
  useShortcutAction(
    'search.previousResult',
    () => {
      const search = useBookSearchStore.getState()
      if (search.status !== 'ready' || search.totalMatches === 0) return false
      search.previous()
    },
    enabled && searchOpen && !immersive,
  )
}

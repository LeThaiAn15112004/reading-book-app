/**
 * The Reader's core wiring (spec 008, T099, FR-012c step 3): book open, the surface flags, the reading session and
 * navigation, for EPUB, PDF, TXT and Markdown. Moved out of `ReaderScreen.tsx` so the Mobile Reader runs the SAME
 * hooks with the same arguments. Nothing inside a hook changes; only where they are called from.
 *
 * Arguments (R8): everything comes in as an option, nothing Desktop-only is imported here.
 *   - `bookId`, `globalPrefsRef`                               both Readers
 *   - `ensureTab`, `updateBookTitle`, `setDocumentSubtitle`    open-reading tabs and the window title (both Readers
 *                                                              have tabs; the Mobile Reader may pass no-ops)
 *   - `epubApiRef`, `pdfApiRef`, `txtApiRef`, `mdApiRef`       renderer handles. Made by the caller, because
 *                                                              Desktop's `useReaderChromeUi` needs the EPUB / PDF
 *                                                              ones before the book is open
 *   - `closeFloating`                                          close floating chrome on a page jump (Desktop chrome;
 *                                                              the Mobile Reader passes its own)
 *   - `highlightShortcutsRef`                                  undo / redo / delete shortcuts of the highlight stores
 *
 * Order inside is the order `ReaderScreen` had: book open, then session, then navigation. What `ReaderScreen` ran
 * between them (TXT store, relink, search indexing, read aloud, translation) now runs after them; R7 (effect order)
 * is checked by the Desktop E2E suite.
 */
import type { MutableRefObject } from 'react'
import type { GlobalReadingPrefs } from '@core'
import type { EpubRendererApi } from '../../../../components/reader/renderers/epub'
import type { MdRendererApi } from '../../../../components/reader/renderers/md'
import type { PdfRendererApi } from '../../../../components/reader/renderers/pdf'
import type { TextSurfaceApi } from '../../../../components/reader/renderers/textSurface'
import type { TxtRendererApi } from '../../../../components/reader/renderers/txt'
import { useReaderBookOpen } from '../hooks/useReaderBookOpen'
import { useReaderNavigation } from '../hooks/useReaderNavigation'
import { useReaderSessionBridge } from '../hooks/useReaderSessionBridge'

type NavigationOptions = Parameters<typeof useReaderNavigation>[0]

export interface UseReaderCoreOptions {
  bookId: string | undefined
  ensureTab: (bookId: string) => void
  updateBookTitle: (bookId: string, title: string) => void
  setDocumentSubtitle: (title: string) => void
  globalPrefsRef: MutableRefObject<GlobalReadingPrefs>
  epubApiRef: MutableRefObject<EpubRendererApi | null>
  pdfApiRef: MutableRefObject<PdfRendererApi | null>
  txtApiRef: MutableRefObject<TxtRendererApi | null>
  mdApiRef: MutableRefObject<MdRendererApi | null>
  closeFloating: NavigationOptions['closeFloating']
  highlightShortcutsRef: NavigationOptions['highlightShortcutsRef']
}

export function useReaderCore(options: UseReaderCoreOptions) {
  const { bookId, epubApiRef, pdfApiRef, txtApiRef, mdApiRef } = options

  const book = useReaderBookOpen({
    bookId,
    ensureTab: options.ensureTab,
    updateBookTitle: options.updateBookTitle,
    setDocumentSubtitle: options.setDocumentSubtitle,
    globalPrefsRef: options.globalPrefsRef,
  })

  const isPdfSurface = book.contentStatus === 'ready' && book.bookFormat === 'pdf' && !!book.bookBytes
  // TXT: the text itself comes from `txt:open` (edited-copy aware), not from the book bytes.
  const isTxtSurface = book.contentStatus === 'ready' && book.bookFormat === 'txt'
  // Markdown: read-only; the bytes come from `openBookContent` and are decoded by the caller.
  const isMdSurface = book.contentStatus === 'ready' && book.bookFormat === 'md' && !!book.bookBytes
  const isTextSurface = isTxtSurface || isMdSurface
  const textApiRef: MutableRefObject<TextSurfaceApi | null> = isMdSurface ? mdApiRef : txtApiRef

  const session = useReaderSessionBridge({
    bookId,
    epubApiRef,
    pdfApiRef,
    txtApiRef: textApiRef,
    prefsRef: book.prefsRef,
    prefsDirtyRef: book.prefsDirtyRef,
    prefs: book.prefs,
    sessionLoadStatus: book.sessionLoadStatus,
  })

  const nav = useReaderNavigation({
    bookId,
    contentStatus: book.contentStatus,
    bookBytes: book.bookBytes,
    bookFormat: book.bookFormat,
    isEpubSurface: book.isEpubSurface,
    epubApiRef,
    isPdfSurface,
    pdfApiRef,
    isTxtSurface: isTextSurface,
    txtApiRef: textApiRef,
    closeFloating: options.closeFloating,
    highlightShortcutsRef: options.highlightShortcutsRef,
  })

  return { book, session, nav, isPdfSurface, isTxtSurface, isMdSurface, isTextSurface, textApiRef }
}

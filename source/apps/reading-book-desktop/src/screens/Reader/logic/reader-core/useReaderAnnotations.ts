/**
 * Bookmarks and text highlights, the second core hook beside `useReaderCore` (spec 008, T100, FR-012c step 4):
 * EPUB highlights, PDF text markup, Markdown markup and bookmarks, for both Readers. Nothing inside a hook changes.
 *
 * Arguments (R8): values the caller computes from its own chrome come in as options.
 *   - `bookId`, the surface flags and renderer refs, `epubNav`, `chapterIndex`, `goChapter`   from `useReaderCore`
 *   - `pdfPage`, `chapterLabel`     the caller's current place (Desktop derives them from its PDF footer state)
 *   - `zoom`                        the reader zoom (a change re-lays PDF marks out)
 *   - `setToast`, `setChromeHidden` the caller's feedback and chrome
 *   - `activeAnnotationTool`        Desktop's toolbar tool (null on a Reader without markup tools)
 *
 * Order inside is the order `ReaderScreen` had: bookmarks, EPUB, PDF, Markdown. What `ReaderScreen` ran between them
 * (keyboard shortcuts, the PDF selection menu, PDF ink and graphics) now runs after them; R7 is checked by the
 * Desktop E2E suite.
 */
import type { MutableRefObject } from 'react'
import type { EpubRendererApi } from '../../../../reader/renderers/epub'
import type { MdRendererApi } from '../../../../reader/renderers/md'
import type { PdfRendererApi } from '../../../../reader/renderers/pdf'
import { useReaderBookmarks } from '../hooks/useReaderBookmarks'
import { useReaderHighlights } from '../hooks/useReaderHighlights'
import { useReaderMdHighlights } from '../hooks/useReaderMdHighlights'
import { useReaderPdfHighlights } from '../hooks/useReaderPdfHighlights'

type BookmarkOptions = Parameters<typeof useReaderBookmarks>[0]
type HighlightOptions = Parameters<typeof useReaderHighlights>[0]

export interface UseReaderAnnotationsOptions {
  bookId: string | undefined
  isEpubSurface: boolean
  isPdfSurface: boolean
  isMdSurface: boolean
  epubApiRef: MutableRefObject<EpubRendererApi | null>
  pdfApiRef: MutableRefObject<PdfRendererApi | null>
  mdApiRef: MutableRefObject<MdRendererApi | null>
  epubNav: BookmarkOptions['epubNav']
  pdfPage: number
  chapterIndex: number
  chapterLabel: string
  goChapter: (index: number) => void
  zoom: number
  setToast: (message: string | null) => void
  setChromeHidden: (hidden: boolean) => void
  activeAnnotationTool: HighlightOptions['activeAnnotationTool']
}

export function useReaderAnnotations(o: UseReaderAnnotationsOptions) {
  const bookmarks = useReaderBookmarks({
    bookId: o.bookId,
    isEpubSurface: o.isEpubSurface,
    epubApiRef: o.epubApiRef,
    epubNav: o.epubNav,
    isPdfSurface: o.isPdfSurface,
    pdfApiRef: o.pdfApiRef,
    pdfPage: o.pdfPage,
    chapterIndex: o.chapterIndex,
    chapterLabel: o.chapterLabel,
    goChapter: o.goChapter,
    setChromeHidden: o.setChromeHidden,
    setToast: o.setToast,
  })

  const highlights = useReaderHighlights({
    bookId: o.bookId,
    isEpubSurface: o.isEpubSurface,
    epubApiRef: o.epubApiRef,
    epubNav: o.epubNav,
    setToast: o.setToast,
    setChromeHidden: o.setChromeHidden,
    activeAnnotationTool: o.activeAnnotationTool,
  })

  // PDF text annotations: the PDF counterpart of `highlights` (page + normalized rects, no CFI).
  const pdfHighlights = useReaderPdfHighlights({
    bookId: o.bookId,
    isPdfSurface: o.isPdfSurface,
    pdfApiRef: o.pdfApiRef,
    zoom: o.zoom,
    setToast: o.setToast,
    setChromeHidden: o.setChromeHidden,
  })

  // Markdown annotations: the Markdown counterpart of `pdfHighlights` (piece + offset anchors, no CFI).
  const mdHighlights = useReaderMdHighlights({
    bookId: o.bookId,
    isMdSurface: o.isMdSurface,
    mdApiRef: o.mdApiRef,
    setToast: o.setToast,
    setChromeHidden: o.setChromeHidden,
  })

  return { bookmarks, highlights, pdfHighlights, mdHighlights }
}

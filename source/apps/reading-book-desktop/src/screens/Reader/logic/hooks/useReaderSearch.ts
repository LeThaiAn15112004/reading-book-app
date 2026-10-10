import { useEffect, useMemo, type MutableRefObject } from 'react'
import { bookIndexApi } from '../../../../bridge'
import type { EpubRendererApi } from '../../../../reader/renderers/epub'
import type { PdfRendererApi } from '../../../../reader/renderers/pdf'
import { useBookSearchStore, type BookSearchSurface } from '../search/bookSearchStore'

type UseReaderSearchOptions = {
  bookId: string | undefined
  isEpubSurface: boolean
  epubApiRef: MutableRefObject<EpubRendererApi | null>
  isPdfSurface: boolean
  pdfApiRef: MutableRefObject<PdfRendererApi | null>
  /** The search panel is open (Search tool / Ctrl+F). */
  searchOpen: boolean
  /** Live text of the search box (AppTitleContext). */
  readerSearchQuery: string
  /** Bumped on every Enter in the search box; 0 = never submitted. */
  readerSearchRequestId: number
}

/** EPUB: Main's chapter is the spine section; the renderer re-finds the hit in that section. */
function epubSearchSurface(apiRef: MutableRefObject<EpubRendererApi | null>): BookSearchSurface {
  return {
    paint: (matcher) => apiRef.current?.setSearchHighlights(matcher),
    goToMatch: async (match) => {
      const api = apiRef.current
      if (!api) return
      await api.goToSearchMatch({
        spineIndex: match.chapterIndex,
        occurrence: match.chapterOccurrence,
        count: match.chapterMatchCount,
      })
    },
    chapterLabels: () => apiRef.current?.getSpineSectionLabels() ?? [],
  }
}

/** PDF: Main's chapter is the 0-based page; the renderer re-finds the hit in that page's text. */
function pdfSearchSurface(apiRef: MutableRefObject<PdfRendererApi | null>): BookSearchSurface {
  return {
    paint: (matcher) => apiRef.current?.setSearchHighlights(matcher),
    goToMatch: async (match) => {
      const api = apiRef.current
      if (!api) return
      await api.goToSearchMatch({
        pageIndex: match.chapterIndex,
        occurrence: match.chapterOccurrence,
        count: match.chapterMatchCount,
      })
    },
    chapterLabels: () => {
      const total = apiRef.current?.getNavState().pageTotal ?? 0
      return Array.from({ length: total }, (_, i) => `Page ${i + 1}`)
    },
  }
}

/**
 * React-lifecycle adapter over `useBookSearchStore` (all state + logic live there): syncs the
 * screen's context and the format's search surface into the store, turns search-box submits into
 * searches, resets per book, and resumes a search that was waiting for background chunking.
 */
export function useReaderSearch({
  bookId,
  isEpubSurface,
  epubApiRef,
  isPdfSurface,
  pdfApiRef,
  searchOpen,
  readerSearchQuery,
  readerSearchRequestId,
}: UseReaderSearchOptions): void {
  const setContext = useBookSearchStore((s) => s.setContext)
  const setPanelOpen = useBookSearchStore((s) => s.setPanelOpen)
  const submit = useBookSearchStore((s) => s.submit)
  const resetForNewBook = useBookSearchStore((s) => s.resetForNewBook)
  const handleIndexStatus = useBookSearchStore((s) => s.handleIndexStatus)

  const surface = useMemo(
    () =>
      isEpubSurface
        ? epubSearchSurface(epubApiRef)
        : isPdfSurface
          ? pdfSearchSurface(pdfApiRef)
          : null,
    [isEpubSurface, epubApiRef, isPdfSurface, pdfApiRef],
  )

  useEffect(() => {
    setContext({ bookId, surface, inputQuery: readerSearchQuery })
  }, [setContext, bookId, surface, readerSearchQuery])

  useEffect(() => {
    resetForNewBook()
  }, [bookId, resetForNewBook])

  useEffect(() => {
    setPanelOpen(searchOpen)
  }, [searchOpen, setPanelOpen])

  useEffect(() => {
    return bookIndexApi.onStatus((status) => handleIndexStatus(status.bookId, status.state))
  }, [handleIndexStatus])

  // Only a submit (Enter) searches — typing alone never jumps the book around.
  useEffect(() => {
    if (readerSearchRequestId > 0) submit()
  }, [readerSearchRequestId, submit])
}

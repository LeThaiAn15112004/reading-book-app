import { useEffect, type MutableRefObject } from 'react'
import { bookIndexApi } from '../../../../bridge'
import type { EpubRendererApi } from '../../../../reader/renderers/epub'
import { useBookSearchStore } from '../search/bookSearchStore'

type UseReaderSearchOptions = {
  bookId: string | undefined
  isEpubSurface: boolean
  epubApiRef: MutableRefObject<EpubRendererApi | null>
  /** The search panel is open (Search tool / Ctrl+F). */
  searchOpen: boolean
  /** Live text of the search box (AppTitleContext). */
  readerSearchQuery: string
  /** Bumped on every Enter in the search box; 0 = never submitted. */
  readerSearchRequestId: number
}

/**
 * React-lifecycle adapter over `useBookSearchStore` (all state + logic live there): syncs the
 * screen's context into the store, turns search-box submits into searches, resets per book, and
 * resumes a search that was waiting for the book's background chunking to finish.
 */
export function useReaderSearch({
  bookId,
  isEpubSurface,
  epubApiRef,
  searchOpen,
  readerSearchQuery,
  readerSearchRequestId,
}: UseReaderSearchOptions): void {
  const setContext = useBookSearchStore((s) => s.setContext)
  const setPanelOpen = useBookSearchStore((s) => s.setPanelOpen)
  const submit = useBookSearchStore((s) => s.submit)
  const resetForNewBook = useBookSearchStore((s) => s.resetForNewBook)
  const handleIndexStatus = useBookSearchStore((s) => s.handleIndexStatus)

  useEffect(() => {
    setContext({ bookId, isEpubSurface, epubApiRef, inputQuery: readerSearchQuery })
  }, [setContext, bookId, isEpubSurface, epubApiRef, readerSearchQuery])

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

import { useEffect } from 'react'
import { bookIndexApi } from '../../../../bridge'
import { useWordCountStore } from '../wordCount/wordCountStore'

type UseWordCountOptions = {
  bookId: string | undefined
  /** The Word Count dialog is open (Tools → Word Count). */
  open: boolean
}

/**
 * React-lifecycle adapter over `useWordCountStore` (state + IPC live there): syncs the open book
 * in, loads stats each time the dialog opens, resets per book, and resumes a load that was
 * waiting for the book's background chunking to finish — the same `bookIndex:status` broadcast
 * `useReaderSearch` listens to, since both features share the same `book_chunks` index.
 */
export function useWordCount({ bookId, open }: UseWordCountOptions) {
  const setContext = useWordCountStore((s) => s.setContext)
  const resetForNewBook = useWordCountStore((s) => s.resetForNewBook)
  const load = useWordCountStore((s) => s.load)
  const handleIndexStatus = useWordCountStore((s) => s.handleIndexStatus)
  const status = useWordCountStore((s) => s.status)
  const stats = useWordCountStore((s) => s.stats)
  const errorMessage = useWordCountStore((s) => s.errorMessage)

  useEffect(() => {
    setContext(bookId)
  }, [bookId, setContext])

  useEffect(() => {
    resetForNewBook()
  }, [bookId, resetForNewBook])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    return bookIndexApi.onStatus((update) => handleIndexStatus(update.bookId, update.state))
  }, [handleIndexStatus])

  return { status, stats, errorMessage }
}

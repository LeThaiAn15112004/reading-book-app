import { useEffect } from 'react'
import { bookIndexApi } from '../../../../bridge'
import { useBookIndexStore } from '../bookIndex/bookIndexStore'

/** Let the first page paint and settle before Main is asked to do any extra work. */
const IDLE_TIMEOUT_MS = 2000

type UseBookIndexingOptions = {
  bookId: string | undefined
  /** True once the book bytes were handed to the renderer (the reader is usable). */
  ready: boolean
}

/**
 * Kicks off background chunking (`book_chunks`) the first time a book is opened. Main answers
 * immediately and does the work on a worker thread, so nothing here can delay reading.
 * Returns whether the subtle "optimising search" indicator should currently be visible.
 */
export function useBookIndexing({ bookId, ready }: UseBookIndexingOptions): boolean {
  const begin = useBookIndexStore((s) => s.begin)
  const finish = useBookIndexStore((s) => s.finish)
  const indicatorVisible = useBookIndexStore((s) => (bookId ? s.visible[bookId] === true : false))

  useEffect(() => {
    return bookIndexApi.onStatus((status) => {
      if (status.state === 'indexing') begin(status.bookId)
      else finish(status.bookId)
    })
  }, [begin, finish])

  useEffect(() => {
    if (!bookId || !ready) return

    let cancelled = false
    const run = (): void => {
      if (cancelled) return
      bookIndexApi
        .ensure(bookId)
        .then((result) => {
          if (!cancelled && result.state === 'indexing') begin(bookId)
        })
        .catch(() => {
          // Search indexing is best-effort; reading must never depend on it.
        })
    }

    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS })
      return () => {
        cancelled = true
        window.cancelIdleCallback(handle)
      }
    }
    const handle = window.setTimeout(run, 500)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [bookId, ready, begin])

  return indicatorVisible
}

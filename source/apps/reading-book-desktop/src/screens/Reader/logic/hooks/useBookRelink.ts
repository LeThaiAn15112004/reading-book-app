import { useCallback } from 'react'
import { useBookRelinkStore } from '../bookRelink/bookRelinkStore'

type UseBookRelinkOptions = {
  bookId: string | undefined
  /** Called once the book points at the chosen file — retry opening it. */
  onRelinked: () => void
}

/**
 * "Locate file…" for a book whose file was moved or deleted. The chosen file is only accepted if it
 * is the same book (SHA-256), so the book's notes, highlights and progress keep working.
 */
export function useBookRelink({ bookId, onRelinked }: UseBookRelinkOptions) {
  const locating = useBookRelinkStore((s) => s.locating)
  const message = useBookRelinkStore((s) =>
    bookId && s.notice?.bookId === bookId ? s.notice.text : null,
  )
  const locate = useBookRelinkStore((s) => s.locate)

  const locateFile = useCallback(async () => {
    if (!bookId) return
    if (await locate(bookId)) onRelinked()
  }, [bookId, locate, onRelinked])

  return { locating, message, locateFile }
}

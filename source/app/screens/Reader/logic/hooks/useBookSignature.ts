import { useEffect } from 'react'
import { useBookSignatureStore } from '../bookSignature/bookSignatureStore'

const EMPTY = { signature: null, loading: false, failed: false } as const

/**
 * Signature status of a book while a panel showing it is open. (Re)checks on every open: Main
 * answers from the stored result unless the file changed since, in which case it verifies again.
 */
export function useBookSignature(bookId: string | undefined, open: boolean) {
  const entry = useBookSignatureStore((s) => (bookId ? s.byBookId[bookId] : undefined)) ?? EMPTY
  const check = useBookSignatureStore((s) => s.check)

  useEffect(() => {
    if (open && bookId) void check(bookId)
  }, [open, bookId, check])

  return entry
}

import { create } from 'zustand'
import { libraryApi } from '../../../../bridge'

/** Derived from the bridge: the renderer never imports from electron/. */
export type BookSignatureDto = NonNullable<
  Awaited<ReturnType<typeof libraryApi.checkSignature>>['signature']
>

type SignatureEntry = {
  /** Latest known result; kept while a re-check is in flight so the UI doesn't flicker. */
  signature: BookSignatureDto | null
  loading: boolean
  /** The check itself failed (book or file unavailable) — distinct from `unsupported`. */
  failed: boolean
}

type BookSignatureState = {
  byBookId: Record<string, SignatureEntry>
  /**
   * Ask Main for the book's current signature status. Main re-verifies whenever the file no longer
   * matches the stored result, so this is safe to call every time the details are opened.
   */
  check: (bookId: string) => Promise<void>
}

const EMPTY: SignatureEntry = { signature: null, loading: false, failed: false }

/** UI state of the "is this book signed?" lookup (`library:checkSignature`). Read-only status. */
export const useBookSignatureStore = create<BookSignatureState>()((set, get) => ({
  byBookId: {},

  check: async (bookId) => {
    const previous = get().byBookId[bookId] ?? EMPTY
    if (previous.loading) return
    set((s) => ({
      byBookId: { ...s.byBookId, [bookId]: { ...previous, loading: true, failed: false } },
    }))
    try {
      const result = await libraryApi.checkSignature(bookId)
      const next: SignatureEntry =
        result.ok && result.signature
          ? { signature: result.signature, loading: false, failed: false }
          : { signature: null, loading: false, failed: true }
      set((s) => ({ byBookId: { ...s.byBookId, [bookId]: next } }))
    } catch {
      set((s) => ({
        byBookId: { ...s.byBookId, [bookId]: { signature: null, loading: false, failed: true } },
      }))
    }
  },
}))

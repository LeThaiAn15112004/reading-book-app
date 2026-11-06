import { create } from 'zustand'
import { libraryApi } from '../../../../bridge'

type RelinkNotice = { bookId: string; text: string }

type BookRelinkState = {
  /** A file dialog / hash check is in flight (buttons disabled meanwhile). */
  locating: boolean
  /** Why the last "Locate file" attempt did not link (never set when the user just cancelled). */
  notice: RelinkNotice | null
  /** Ask Main to re-attach `bookId` to a file the user picks. Resolves true once it is linked. */
  locate: (bookId: string) => Promise<boolean>
}

const GENERIC_FAILURE = 'Could not link that file to this book.'

/**
 * UI state of "Locate file" on the reader's could-not-open screen. Main owns the dialog and the
 * SHA-256 check (`library:relinkBook`); this only tracks progress and the failure reason.
 */
export const useBookRelinkStore = create<BookRelinkState>()((set, get) => ({
  locating: false,
  notice: null,

  locate: async (bookId) => {
    if (get().locating) return false
    set({ locating: true, notice: null })
    try {
      const result = await libraryApi.relinkBook(bookId)
      if (result.ok) {
        set({ locating: false })
        return true
      }
      set({
        locating: false,
        notice:
          result.errorCode === 'cancelled'
            ? null
            : { bookId, text: result.errorMessage ?? GENERIC_FAILURE },
      })
      return false
    } catch {
      set({ locating: false, notice: { bookId, text: GENERIC_FAILURE } })
      return false
    }
  },
}))

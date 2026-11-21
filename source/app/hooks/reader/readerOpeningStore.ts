/**
 * Spec 016 (US4, FR-015, research R9): "a book is being opened and its first page is not drawn yet".
 *
 * Set when the Reader starts loading a book (`firstPageSignal.beginOpening`), cleared when its first page is drawn or
 * after 10 s at most. While it is set, background work waits: search indexing / word count of that book, cover
 * drawing, the next step of a background import. Mirrored to Main (`app:setReaderOpening`) for the signature queue,
 * chunking and the import's own file reads.
 */
import { create } from 'zustand'
import { appApi } from '../../bridge/app'
import { onOpeningChange } from './firstPageSignal'

/** The longest anything waits for a first page (research R9). */
export const OPENING_MAX_MS = 10_000

type ReaderOpeningState = { opening: string | null; since: number }

export const useReaderOpeningStore = create<ReaderOpeningState>(() => ({ opening: null, since: 0 }))

let timer: ReturnType<typeof setTimeout> | null = null
const waiters = new Set<() => void>()

function clearOpening(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (useReaderOpeningStore.getState().opening === null) return
  useReaderOpeningStore.setState({ opening: null, since: 0 })
  void appApi.setReaderOpening(null)
  for (const resolve of [...waiters]) resolve()
  waiters.clear()
}

onOpeningChange((event) => {
  if (event.kind === 'drawn') {
    clearOpening()
    return
  }
  if (timer) clearTimeout(timer)
  useReaderOpeningStore.setState({ opening: event.bookId, since: Date.now() })
  void appApi.setReaderOpening(event.bookId)
  timer = setTimeout(clearOpening, OPENING_MAX_MS)
})

/** Resolves once no book is opening (immediately when none is), or after `maxMs`. */
export function waitUntilOpened(maxMs = OPENING_MAX_MS): Promise<void> {
  if (useReaderOpeningStore.getState().opening === null) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t)
      waiters.delete(done)
      resolve()
    }
    const t = setTimeout(done, maxMs)
    waiters.add(done)
  })
}

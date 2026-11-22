/**
 * Spec 016 (US4, FR-015, research R9): Main's copy of "a book is opening, its first page is not drawn yet", sent by the
 * renderer on `app:setReaderOpening`. Background work in Main waits on it — the PDF signature queue, chunking, word
 * count, and a background import yields between its 1 MiB reads — bounded by 10 s, so a lost "clear" never blocks.
 */
import { setSignatureQueueGate } from '../signature/signature-queue'

export const OPENING_MAX_MS = 10_000

let opening: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const waiters = new Set<() => void>()
const changeListeners = new Set<(opening: boolean) => void>()

/** Spec 017 (US3): told every time the gate opens or closes (e.g. to pass it on to a worker thread). */
export function onReaderOpeningChange(listener: (opening: boolean) => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

function release(): void {
  for (const resolve of [...waiters]) resolve()
  waiters.clear()
}

/** `app:setReaderOpening` — a book id, or null when its first page was drawn. Untrusted input. */
export function setReaderOpening(input: unknown): boolean {
  const bookId = (input && typeof input === 'object' ? (input as { bookId?: unknown }).bookId : undefined) ?? null
  if (bookId !== null && (typeof bookId !== 'string' || !bookId.trim())) return false
  if (timer) clearTimeout(timer)
  timer = null
  const was = opening !== null
  opening = bookId
  if (opening === null) release()
  else timer = setTimeout(() => setReaderOpening({ bookId: null }), OPENING_MAX_MS)
  if (was !== (opening !== null)) {
    for (const listener of [...changeListeners]) {
      try {
        listener(opening !== null)
      } catch {
        // a listener never breaks the gate
      }
    }
  }
  return true
}

export function isOpening(): boolean {
  return opening !== null
}

/** Resolves when no book is opening (at once when none is), or after `maxMs`. */
export function waitUntilOpened(maxMs = OPENING_MAX_MS): Promise<void> {
  if (opening === null) return Promise.resolve()
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

/** A background import's read yields to the opening book: one event-loop turn per 1 MiB chunk while it opens. */
export function yieldWhileOpening(): Promise<void> | undefined {
  return opening === null ? undefined : new Promise((resolve) => setImmediate(resolve))
}

// The PDF signature check of an imported book waits for the opening book's first page.
setSignatureQueueGate(() => waitUntilOpened())

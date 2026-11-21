/**
 * Spec 016 (FR-005, research R3): the PDF signature check of an imported book runs AFTER the book is saved, in the
 * background, one book at a time — the book appears in the Library without waiting for a full read of the file.
 *
 * - The book shows the existing "not checked yet" state (no `signatureStatus`) until its check ends.
 * - The result is written only if the book still exists and its `sha256` is the one that was checked; a book removed
 *   meanwhile is skipped quietly (spec edge case).
 * - A failed or interrupted check writes nothing: the book stays "not checked yet" (never `unsigned`) and is checked
 *   again the next time its signature is asked for (existing behaviour). The queue lives in memory only.
 * - Before each check the queue awaits `beforeEach` (US4: wait while a book is opening, bounded by the caller).
 */
import { resolveBookFile } from '../files/sandbox'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { resolveSignatureInfo } from './signature-check'

const pending: string[] = []
let running = false
let beforeEach: () => Promise<void> = async () => {}
let idleWaiters: (() => void)[] = []

/** US4 hook: awaited before each check (e.g. "wait until the opening book's first page is drawn"). */
export function setSignatureQueueGate(gate: () => Promise<void>): void {
  beforeEach = gate
}

/** Queues a background check for `bookId` (a second request for a queued book is ignored). */
export function scheduleSignatureCheck(bookId: string): void {
  if (!pending.includes(bookId)) pending.push(bookId)
  if (!running) void drain()
}

/** Resolves when the queue is empty (spikes / tests). */
export function whenSignatureQueueIdle(): Promise<void> {
  if (!running && pending.length === 0) return Promise.resolve()
  return new Promise((resolve) => idleWaiters.push(resolve))
}

/** Number of books waiting or being checked. */
export function signatureQueueSize(): number {
  return pending.length + (running ? 1 : 0)
}

async function drain(): Promise<void> {
  running = true
  try {
    while (pending.length > 0) {
      const bookId = pending.shift()!
      try {
        await beforeEach()
        await checkOne(bookId)
      } catch (err) {
        console.warn('[signature] background check failed; book stays not checked', err)
      }
    }
  } finally {
    running = false
    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) resolve()
  }
}

async function checkOne(bookId: string): Promise<void> {
  const store = getLibraryStore()
  const book = await store.findById(bookId)
  if (!book) return
  const file = await resolveBookFile(book)
  if (!file.ok) return
  const { info, fromCache } = await resolveSignatureInfo({
    format: book.format,
    filePath: file.path,
    cached: book.signature,
  })
  if (fromCache) return
  // Removed, or changed, while the file was being checked: nothing is written for it.
  const now = await store.findById(bookId)
  if (!now || now.sha256 !== book.sha256 || info.checkedSha256.toLowerCase() !== book.sha256.toLowerCase()) return
  store.saveSignature(bookId, info)
}

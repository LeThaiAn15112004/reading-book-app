/**
 * Spec 016: "the first page of the opening book is drawn" — one signal for both hosts and every format.
 *
 * The Reader calls `beginOpening(bookId)` when it starts loading a book and `setOpeningFile(...)` once the bytes are
 * known; each renderer calls `markFirstPageDrawn()` when its first page is on screen (EPUB first `rendered`, PDF page
 * render resolved, TXT / MD first paint). Renderers do not all know the book id, so only the CURRENT opening counts:
 * a later `beginOpening` replaces it, and a second `markFirstPageDrawn` does nothing.
 *
 * Used by the `open-first-page` timing step (US1) and, from US4, by the gate that holds background work back.
 */
import { recordStep } from '../app/stepTimer'

type Opening = {
  bookId: string
  startedAt: number
  format: string
  sizeBytes: number
}

export type OpeningEvent = { kind: 'begin' | 'drawn' | 'ended'; bookId: string }

let current: Opening | null = null
const listeners = new Set<(event: OpeningEvent) => void>()

function emit(event: OpeningEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // a listener must never break the Reader
    }
  }
}

export function beginOpening(bookId: string): void {
  current = { bookId, startedAt: Date.now(), format: 'unknown', sizeBytes: 0 }
  emit({ kind: 'begin', bookId })
}

/** Format + size of the opening book, for the timing line (never its name). */
export function setOpeningFile(bookId: string, format: string | null | undefined, sizeBytes: number): void {
  if (!current || current.bookId !== bookId) return
  current.format = (format ?? 'unknown').toLowerCase()
  current.sizeBytes = sizeBytes
}

/** The first page of the current opening is on screen. Idempotent. */
export function markFirstPageDrawn(): void {
  const opening = current
  if (!opening) return
  current = null
  recordStep(
    'open',
    'open-first-page',
    { format: opening.format, sizeBytes: opening.sizeBytes },
    Date.now() - opening.startedAt,
  )
  emit({ kind: 'drawn', bookId: opening.bookId })
}

/**
 * Spec 017: the current opening ended WITHOUT a first page (the reader left, or it failed). Releases the 016 gate at
 * once instead of after its 10 s limit; nothing is timed here (the opening store records the outcome).
 */
export function endOpening(): void {
  const opening = current
  if (!opening) return
  current = null
  emit({ kind: 'ended', bookId: opening.bookId })
}

/** Format + size of the current opening (timing context), or null. */
export function openingFile(): { format: string; sizeBytes: number } | null {
  return current ? { format: current.format, sizeBytes: current.sizeBytes } : null
}

/** The book being opened whose first page is not drawn yet, or null. */
export function openingBookId(): string | null {
  return current?.bookId ?? null
}

export function onOpeningChange(listener: (event: OpeningEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

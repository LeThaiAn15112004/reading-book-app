/**
 * The Reader's opening store — two jobs in one zustand store:
 *
 * 1. Spec 016 (US4, FR-015, research R9) — the GATE: "a book is being opened and its first page is not drawn yet"
 *    (`opening` / `since`, `waitUntilOpened`). Set when the Reader starts loading a book (`firstPageSignal.beginOpening`),
 *    cleared when its first page is drawn, when the opening ends without one (spec 017 `endOpening`), or after 10 s at
 *    most. While it is set, background work waits. Mirrored to Main (`app:setReaderOpening`).
 *
 * 2. Spec 017 (research R1–R4) — the single source of truth of the current OPENING (`current`, core `bookOpening`):
 *    its step, time limits (20 s per step, 3 s for the saved position), the one automatic retry, the outcome and the
 *    error with its actions. `useReaderBookOpen` and the renderers report into it; the opening screen reads it.
 *
 * Time limits count FOREGROUND time only: the clock and the foreground source are injected (`setClock`,
 * `setForegroundSource`); nothing here touches `document` / `window` at module load, so spikes run this store in Node
 * with fakes. The app attaches the DOM source with `installOpeningStoreDomSources()`; the phone adds the host's
 * `app.foregroundChanged` event (AppState) through the same `setForegroundSource`.
 */
import { create } from 'zustand'
import { bookOpening, type Opening, type OpeningCause, type OpeningStep } from '@core'
import { appApi } from '../../bridge/app'
import { recordStep } from '../app/stepTimer'
import { endOpening, onOpeningChange } from './firstPageSignal'

/** The longest anything waits for a first page (spec 016 research R9). */
export const OPENING_MAX_MS = 10_000

/** How often the current opening is checked against its limits (and the screen's elapsed time refreshed). */
const TICK_MS = 100

type ReaderOpeningState = {
  /** 016 gate: the book whose first page is awaited, or null. */
  opening: string | null
  since: number
  /** 017: the current opening (the last one, also once ended), or null before any. */
  current: Opening | null
  /** 017: foreground ms elapsed since `current` began (refreshed while pending), for the 300 ms / 5 s rules. */
  elapsedMs: number
}

export const useReaderOpeningStore = create<ReaderOpeningState>(() => ({
  opening: null,
  since: 0,
  current: null,
  elapsedMs: 0,
}))

// ─── 016 gate ──────────────────────────────────────────────────────────────────────────────────────────────────────

let gateTimer: ReturnType<typeof setTimeout> | null = null
const waiters = new Set<() => void>()

function clearGate(): void {
  if (gateTimer) clearTimeout(gateTimer)
  gateTimer = null
  if (useReaderOpeningStore.getState().opening === null) return
  useReaderOpeningStore.setState({ opening: null, since: 0 })
  void appApi.setReaderOpening(null)
  for (const resolve of [...waiters]) resolve()
  waiters.clear()
}

onOpeningChange((event) => {
  if (event.kind === 'drawn') {
    clearGate()
    reportFirstPageDrawn()
    return
  }
  if (event.kind === 'ended') {
    clearGate()
    return
  }
  if (gateTimer) clearTimeout(gateTimer)
  useReaderOpeningStore.setState({ opening: event.bookId, since: Date.now() })
  void appApi.setReaderOpening(event.bookId)
  gateTimer = setTimeout(clearGate, OPENING_MAX_MS)
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

// ─── 017 foreground clock ──────────────────────────────────────────────────────────────────────────────────────────

const defaultClock = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()

let clock: () => number = defaultClock
let foreground = true
/** Foreground ms accumulated before the current foreground interval. */
let accumulated = 0
/** Clock value when the current foreground interval began. */
let intervalStart = defaultClock()

/** Foreground milliseconds since this module loaded: the sum of the foreground intervals (never a tick count). */
export function foregroundNow(): number {
  return accumulated + (foreground ? clock() - intervalStart : 0)
}

function setForeground(active: boolean): void {
  if (active === foreground) return
  if (foreground) accumulated += clock() - intervalStart
  else intervalStart = clock()
  foreground = active
}

/** Replaces the monotonic clock (spikes / tests). Keeps the foreground time measured so far. */
export function setClock(next: () => number): void {
  accumulated = foregroundNow()
  clock = next
  intervalStart = clock()
}

type ForegroundSource = (onChange: (active: boolean) => void) => () => void
const sources = new Set<() => void>()

/** Adds a source of foreground / background changes (DOM visibility, the phone host's AppState). Returns a remover. */
export function setForegroundSource(source: ForegroundSource): () => void {
  const unsubscribe = source(setForeground)
  sources.add(unsubscribe)
  return () => {
    unsubscribe()
    sources.delete(unsubscribe)
  }
}

let domInstalled = false

/** Same name as the phone bridge's `FOREGROUND_EVENT` (the host's AppState, `{ detail: { active } }`). */
const HOST_FOREGROUND_EVENT = 'readmate:foreground'

/**
 * Attaches the DOM foreground sources: `document.visibilitychange` (both hosts) and the phone host's AppState event.
 * Called once by the app.
 */
export function installOpeningStoreDomSources(): void {
  if (domInstalled || typeof document === 'undefined' || typeof window === 'undefined') return
  domInstalled = true
  setForegroundSource((onChange) => {
    const onVisibility = () => onChange(document.visibilityState !== 'hidden')
    const onHost = (event: Event) => {
      const active = (event as CustomEvent<{ active?: unknown }>).detail?.active
      if (typeof active === 'boolean') onChange(active)
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener(HOST_FOREGROUND_EVENT, onHost)
    onVisibility()
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(HOST_FOREGROUND_EVENT, onHost)
    }
  })
}

// ─── 017 opening ───────────────────────────────────────────────────────────────────────────────────────────────────

let controller: AbortController | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let tokenSeq = 0
/** Timing context of the current opening (format + size only, never a name). */
let timingCtx = { format: 'unknown', sizeBytes: 0 }

function stopTicker(): void {
  if (ticker) clearInterval(ticker)
  ticker = null
}

const STEP_TIMING: Partial<Record<OpeningStep, 'open-content' | 'open-prepare' | 'open-position'>> = {
  content: 'open-content',
  prepare: 'open-prepare',
  position: 'open-position',
}

/** Applies a transition to the current opening; records step / outcome timing and ends the opening's work. */
function update(transition: (o: Opening) => Opening): Opening | null {
  const before = useReaderOpeningStore.getState().current
  if (!before) return null
  const now = foregroundNow()
  const after = transition(before)
  if (after === before) return before
  if (after.step !== before.step || (after.outcome !== 'pending' && before.outcome === 'pending')) {
    const step = STEP_TIMING[before.step]
    if (step) recordStep('open', step, timingCtx, now - before.stepStartedAt)
  }
  useReaderOpeningStore.setState({ current: after, elapsedMs: now - after.startedAt })
  if (before.outcome === 'pending' && after.outcome !== 'pending') onEnded(after, now)
  return after
}

function onEnded(o: Opening, now: number): void {
  stopTicker()
  if (o.outcome !== 'opened') {
    // Aborts every step still running for this opening (epub.js / pdf.js are destroyed by their listeners).
    controller?.abort()
    endOpening()
    const step = bookOpening.outcomeTimingStep(o)
    if (step && step !== 'open-first-page') recordStep('open', step, timingCtx, now - o.startedAt)
  }
}

function onTick(): void {
  update((o) => bookOpening.tick(o, foregroundNow()))
  const o = useReaderOpeningStore.getState().current
  if (o?.outcome === 'pending') useReaderOpeningStore.setState({ elapsedMs: foregroundNow() - o.startedAt })
}

/**
 * Starts a new opening; the previous one, if still pending, ends as `left` (FR-008: only the latest runs).
 * Returns its token: every async answer must carry it (`isCurrent`).
 */
export function beginBookOpening(input: {
  bookId: string
  title?: string | null
  coverUrl?: string | null
  usesSavedPosition?: boolean
}): string {
  leaveBookOpening()
  controller = new AbortController()
  const token = `open-${++tokenSeq}`
  timingCtx = { format: 'unknown', sizeBytes: 0 }
  const current = bookOpening.startOpening({ token, now: foregroundNow(), ...input })
  useReaderOpeningStore.setState({ current, elapsedMs: 0 })
  stopTicker()
  ticker = setInterval(onTick, TICK_MS)
  return token
}

/** True while `token` is the current, pending opening. */
export function isCurrentOpening(token: string): boolean {
  const o = useReaderOpeningStore.getState().current
  return !!o && o.token === token && o.outcome === 'pending'
}

/** Aborted when the current opening ends without a first page (left, failed, replaced). */
export function openingSignal(): AbortSignal | undefined {
  return controller?.signal
}

export function setOpeningBookDetails(token: string, details: { title?: string | null; coverUrl?: string | null }): void {
  const o = useReaderOpeningStore.getState().current
  if (!o || o.token !== token) return
  useReaderOpeningStore.setState({ current: bookOpening.setBookDetails(o, details) })
}

export function setOpeningUsesSavedPosition(token: string, usesSavedPosition: boolean): void {
  if (!isCurrentOpening(token)) return
  update((o) => bookOpening.setUsesSavedPosition(o, usesSavedPosition))
}

export function reportContentReady(token: string, format: string | null | undefined, sizeBytes: number): void {
  if (!isCurrentOpening(token)) return
  timingCtx = { format: (format ?? 'unknown').toLowerCase(), sizeBytes }
  update((o) => bookOpening.contentReady(o, format, foregroundNow()))
}

/** The content step failed; returns `true` when the caller must retry once (after `RETRY_DELAY_MS`). */
export function reportContentFailed(token: string, code: string | null | undefined, retryable: boolean): boolean {
  if (!isCurrentOpening(token)) return false
  let retry = false
  update((o) => {
    const r = bookOpening.contentFailed(o, code, retryable, foregroundNow())
    retry = r.retry
    return r.opening
  })
  return retry
}

// Renderers do not know the token: their reports apply to the current opening only (like `markFirstPageDrawn`).

export function reportPrepareFailed(cause: OpeningCause): void {
  update((o) => bookOpening.prepareFailed(o, cause))
}

export function reportPositionStarted(): void {
  update((o) => bookOpening.positionStarted(o, foregroundNow()))
}

export function reportPositionDone(ok: boolean): void {
  update((o) => bookOpening.positionDone(o, ok, foregroundNow()))
}

/** Called through `firstPageSignal.markFirstPageDrawn()` (the renderers' existing call). */
function reportFirstPageDrawn(): void {
  update((o) => bookOpening.firstPageDrawn(o))
}

/** The reader left (Back / Esc / system Back / unmount). Idempotent. */
export function leaveBookOpening(): void {
  update((o) => bookOpening.leave(o))
}

/** Clears the "couldn't return to where you left off" note once shown. */
export function dismissPositionLost(): void {
  const o = useReaderOpeningStore.getState().current
  if (o && o.positionRestored === false) useReaderOpeningStore.setState({ current: { ...o, positionRestored: null } })
}

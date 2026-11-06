/**
 * Safe `rendition.display()` wrappers: CFI pre-validation, spine-index fallbacks, jump timeouts
 * and the first-paint retry used while the reader host is still laying out.
 */
import type { Book, Rendition } from 'epubjs'
import { spineIndexFromCfiPath } from '@reading-book/book-reader-sdk'
import {
  isTrivialSectionStartCfi,
  resolveCfiRange,
  withEpubjsStartContainerLogMutedAsync,
} from '../cfi/cfi-dom-range'
import { toEpubjsDisplayCfi } from '../cfi/selection-cfi'
import { abortError, readHostLayoutSize, throwIfAborted, waitForFrames } from './host-layout'

export function spineIndexFromCfi(book: Book, cfi: string, fallback: number): number {
  try {
    const section = book.spine.get(cfi) as { index?: number } | undefined
    if (section && typeof section.index === 'number') return section.index
  } catch {
    /* malformed CFI / empty spine */
  }
  const fromPath = spineIndexFromCfiPath(cfi)
  if (fromPath != null && fromPath >= 0) return fromPath
  return fallback
}

/**
 * Pre-resolves `displayCfi` against its own section document before handing
 * it to `rendition.display()`. A CFI whose character offset lands past the
 * end of a text node (stale annotation after the source content changed, a
 * hand-edited DB row, a range CFI with end before start, …) makes epub.js
 * throw `IndexSizeError` from inside an async internal callback — that
 * throw never rejects `display()`'s promise and isn't visible to a
 * `try/catch` wrapped around it, so it can't be caught downstream. Worse,
 * the rendition's internal display queue is left wedged afterward: every
 * later `display()` call — even a valid one — hangs too, and nothing short
 * of recreating the rendition recovers it. Resolving the CFI here first
 * throws synchronously into *our* try/catch, so a poisoned CFI degrades to
 * the same safe `display(index)` fallback as any other malformed CFI
 * instead of wedging the reader. Cost is ~0-2ms once the section is loaded
 * (epub.js caches it). See docs/note/jump-to-location-phase0-spike-result.md
 * §4 for the failure mode this guards and the measurements behind it.
 */
async function canDisplayCfi(book: Book, displayCfi: string): Promise<boolean> {
  let section: { load?: (request?: unknown) => Promise<unknown> } | undefined
  try {
    section = book.spine.get(displayCfi) as unknown as typeof section
  } catch {
    return false
  }
  if (!section || typeof section.load !== 'function') return false
  try {
    const loaded = await section.load(book.load.bind(book))
    const doc =
      (loaded as { ownerDocument?: Document } | undefined)?.ownerDocument ??
      (loaded as Document | undefined)
    if (!doc) return false
    return Boolean(resolveCfiRange(doc, displayCfi))
  } catch {
    return false
  }
}

/**
 * Resume / jump without triggering epubjs `No startContainer found` logs.
 * Range CFIs are reduced to a display point; shallow section-start CFIs open by
 * spine index; deeper CFIs are checked with `canDisplayCfi` and use
 * display(cfi) with a spine-index fallback.
 */
export async function displayCfiSafely(
  book: Book,
  rendition: Rendition,
  cfi: string,
  fallbackIndex: number,
): Promise<void> {
  const displayCfi = toEpubjsDisplayCfi(cfi)
  if (!displayCfi) {
    console.log('[jump-debug][displayCfiSafely] toEpubjsDisplayCfi returned null for', cfi, '-> fallback spine', fallbackIndex)
    await rendition.display(fallbackIndex)
    return
  }
  const index = spineIndexFromCfi(book, displayCfi, fallbackIndex)
  if (isTrivialSectionStartCfi(displayCfi)) {
    console.log('[jump-debug][displayCfiSafely] isTrivialSectionStartCfi -> fallback spine', index, 'for', displayCfi)
    await rendition.display(index)
    return
  }
  if (!(await canDisplayCfi(book, displayCfi))) {
    console.log('[jump-debug][displayCfiSafely] canDisplayCfi=false -> fallback spine', index, 'for', displayCfi)
    await rendition.display(index)
    return
  }
  try {
    console.log('[jump-debug][displayCfiSafely] canDisplayCfi=true -> display(cfi)', displayCfi)
    await withEpubjsStartContainerLogMutedAsync(() =>
      rendition.display(displayCfi),
    )
  } catch (err) {
    console.log('[jump-debug][displayCfiSafely] display(cfi) threw -> fallback spine', index, err)
    await rendition.display(index)
  }
}

/**
 * Same intent as `displayCfiSafely`, but for CFIs epub.js generated itself
 * (`readRenditionLocation()` / `getCurrentLocation()`) rather than ones built
 * from a DOM Range. Trust `display()` directly instead of routing through
 * `canDisplayCfi`'s pre-check; still falls back to the section start if the
 * CFI is unusable or `display()` itself throws.
 */
export async function displayCfiTrusted(
  rendition: Rendition,
  cfi: string,
  fallbackIndex: number,
): Promise<void> {
  const displayCfi = toEpubjsDisplayCfi(cfi)
  if (!displayCfi) {
    await rendition.display(fallbackIndex)
    return
  }
  try {
    await withEpubjsStartContainerLogMutedAsync(() =>
      rendition.display(displayCfi),
    )
  } catch {
    await rendition.display(fallbackIndex)
  }
}

/**
 * Ceiling for `goToLocation`'s whole settle sequence (measured p99 ≈ 380ms,
 * worst observed ≈ 1.5s including a full `waitForSectionResources` wait — see
 * docs/note/jump-to-location-phase0-spike-result.md §3.3).
 *
 * `canDisplayCfi` (in `displayCfiSafely`) already screens out the known
 * malformed-CFI shapes that wedge epub.js's rendition, so this is a
 * last-resort backstop, not the primary fix. Note that rejecting here does
 * NOT repair a wedged rendition — per the spike, once epub.js's internal
 * display queue is stuck, only recreating the rendition (reopening the book)
 * recovers it, which this does not do. What this buys: the caller's awaiter
 * (and any "jumping…" shield UI gated on it) is released instead of hanging
 * forever, and existing try/catch around `goToLocation` calls sees a normal
 * rejection instead of a permanent stall.
 */
const CFI_JUMP_TIMEOUT_MS = 2000

/**
 * How long to wait for epub.js's own resize-triggered `display()` (see
 * `waitForRenditionDisplayed`) before giving up and proceeding anyway — a
 * backstop for the case where `Rendition.onResized` had no prior location to
 * restore and therefore never fires `'displayed'` at all.
 */
const RESIZE_DISPLAY_SETTLE_TIMEOUT_MS = 1500

/**
 * `Rendition.resize()` synchronously fires epub.js's own internal
 * `display()` call to restore the pre-resize location (see
 * `Rendition.onResized` in epubjs). That call resolves asynchronously, once
 * the view manager has finished re-attaching the anchor's section.
 *
 * `settleResizeAnchor` below issues a *second*, corrective `display()` once
 * layout has settled. Calling it too early races `Rendition.display()`'s
 * `this.displaying.resolve()` guard: that guard force-resolves the *first*
 * display's deferred while its manager-level work is still running in the
 * background, letting a second concurrent `manager.display()` start — and
 * two concurrent passes leave the manager's view list inconsistent.
 *
 * Waiting for the resize-triggered display's own `'displayed'` event (rather
 * than guessing with a frame count) avoids the race entirely.
 */
export function waitForRenditionDisplayed(
  rendition: Rendition,
  timeoutMs = RESIZE_DISPLAY_SETTLE_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      rendition.off('displayed', onDisplayed)
      window.clearTimeout(timer)
      resolve()
    }
    const onDisplayed = () => finish()
    rendition.on('displayed', onDisplayed)
    const timer = window.setTimeout(finish, timeoutMs)
  })
}

export async function withCfiJumpTimeout<T>(run: () => Promise<T>): Promise<T> {
  let timer: number | undefined
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          reject(new Error('CFI jump timed out'))
        }, CFI_JUMP_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer != null) window.clearTimeout(timer)
  }
}

type EnsureInitialPaintOptions = {
  /** Resume open — never reset to cover when iframe is still attaching. */
  resume?: boolean
  resumeRetry?: { book: Book; cfi: string; spineIndex: number }
}

/**
 * First display often resolves before the host finishes layout (loading shell →
 * reader). A resize + empty-iframe retry matches what a manual page-turn does.
 */
export async function ensureInitialPaint(
  host: HTMLElement,
  rendition: Rendition,
  fallbackSpine: number,
  signal?: AbortSignal,
  openToken?: string,
  options?: EnsureInitialPaintOptions,
): Promise<void> {
  await waitForFrames(2)
  throwIfAborted(signal)
  if (openToken && host.dataset.epubOpen !== openToken) {
    throw abortError()
  }

  const { width, height } = readHostLayoutSize(host)
  if (width > 0 && height > 0) {
    try {
      rendition.resize(width, height)
    } catch {
      /* destroyed / not started */
    }
  }

  if (!host.querySelector('iframe')) {
    if (options?.resume) {
      await waitForFrames(3)
      if (!host.querySelector('iframe') && options.resumeRetry) {
        const { book, cfi, spineIndex } = options.resumeRetry
        try {
          await displayCfiSafely(book, rendition, cfi, spineIndex)
        } catch {
          await rendition.display(spineIndex)
        }
      }
      if (width > 0 && height > 0) {
        try {
          rendition.resize(width, height)
        } catch {
          /* destroyed / not started */
        }
      }
    } else {
      try {
        await rendition.display(fallbackSpine)
      } catch {
        /* ignore — caller already fell back once */
      }
    }
  }
}

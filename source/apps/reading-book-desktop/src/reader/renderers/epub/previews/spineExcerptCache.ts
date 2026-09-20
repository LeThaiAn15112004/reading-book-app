import type { Book } from 'epubjs'
import { collectDescendantTextNodes } from '../cfi/cfi-dom-range'
import { spineLengthOf } from '../openEpubjs'

/** Label + opening excerpt for one spine section (chapter), keyed by 0-based spine index. */
export type SpineExcerpt = {
  spineIndex: number
  label: string
  excerpt: string
}

/**
 * Minimal epub.js `Section` surface this cache needs. epubjs's own `.d.ts`
 * types `load()` as returning `Document` synchronously; the real
 * implementation (src/section.js) returns a `Promise` that resolves with
 * `this.contents` once `this.document`/`this.contents` are populated — so
 * this local type follows the project's existing `SpineSectionLike`
 * convention (openEpubjs.ts) of typing only what is actually used instead of
 * trusting that declaration.
 */
type LoadableSection = {
  document?: Document
  load: (request?: (url: string) => Promise<unknown>) => Promise<unknown>
  unload: () => void
}

export const EXCERPT_MAX_CHARS = 160
const DEFAULT_MAX_ENTRIES = 12
const DEFAULT_PREFETCH_RADIUS = 2

/** Opening text under `doc`'s body, collapsed to one line and capped at `maxChars`. */
export function extractExcerpt(doc: Document, maxChars: number): string {
  const root = doc.body ?? doc.documentElement
  if (!root) return ''
  const nodes = collectDescendantTextNodes(root)
  let text = ''
  for (const node of nodes) {
    text += node.data
    if (text.length >= maxChars) break
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, maxChars)
}

export type SpineExcerptCache = {
  /**
   * Resolve label + opening excerpt for `spineIndex`.
   *
   * Serves from cache when present. Otherwise — for any index other than
   * the one `excludeIndex()` currently reports as active — loads the
   * section off-DOM (`Section.load`, the same `book.load`-backed path
   * epub.js's own renderer uses internally, see rendition.js) purely to
   * read its text: no iframe, no CSS, no layout, nothing attached to the
   * page. The section is unloaded again right after. Returns `undefined`
   * for the active section (its live rendition already has this — use
   * `getCurrentExcerpt`/`getSectionLabels` instead) and for anything that
   * fails to load (missing/undecryptable resource, aborted book, etc.).
   */
  get(spineIndex: number): Promise<SpineExcerpt | undefined>
  /**
   * Fire-and-forget warm-up for the sections around `spineIndex` (default
   * current ± 2). Skips indices already cached, already in flight, or
   * equal to the active section. Never throws — a failed prefetch simply
   * leaves that index uncached for `get()` to retry later.
   */
  prefetchAround(spineIndex: number, radius?: number): void
  /** Forget every cached entry. In-flight loads are left to finish on their own but are no longer tracked or cached. */
  dispose(): void
}

/**
 * Spine-indexed LRU cache of chapter labels + opening excerpts, used for
 * "which chapter is this" previews (TOC hover, bookmark lists, a future
 * chapter switcher) without paying for a full render of every section.
 *
 * Never touches the currently displayed spine section — that Section
 * instance is shared with the live rendition's view, which loads/renders it
 * independently, so racing our own `load()`/`unload()` against it could
 * clear `section.document` out from under a concurrent render.
 */
export function createSpineExcerptCache(
  book: Book,
  options: {
    /** Label for a spine index — pass a resolver backed by a single memoized `getSectionLabels()` call, not one that recomputes the whole TOC per lookup. */
    getLabel: (spineIndex: number) => string
    /** Current spine index, read fresh on every call — sections here are never off-DOM loaded. */
    excludeIndex: () => number
    maxEntries?: number
  },
): SpineExcerptCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  // Map iteration order is insertion order; re-inserting a touched key moves
  // it to the end, so the front of the map is always the least-recently-used
  // entry — cheap LRU without a separate ordering structure.
  const cache = new Map<number, SpineExcerpt>()
  const pending = new Map<number, Promise<SpineExcerpt | undefined>>()
  let disposed = false

  const remember = (entry: SpineExcerpt): SpineExcerpt => {
    cache.delete(entry.spineIndex)
    cache.set(entry.spineIndex, entry)
    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value
      if (oldestKey === undefined) break
      cache.delete(oldestKey)
    }
    return entry
  }

  const isActive = (spineIndex: number): boolean => {
    try {
      return spineIndex === options.excludeIndex()
    } catch {
      // Can't tell whether it's live — safer to assume it might be and
      // leave the section alone than to risk unloading a displayed one.
      return true
    }
  }

  const loadOne = async (spineIndex: number): Promise<SpineExcerpt | undefined> => {
    // epubjs's own `.d.ts` types `Section.load()` as returning `Document`
    // synchronously; the real implementation (src/section.js) returns a
    // `Promise`. Route through `unknown` first, same as the project's other
    // `as unknown as X` casts around epubjs's inaccurate typings.
    const section = book.spine.get(spineIndex) as unknown as
      | LoadableSection
      | undefined
    if (!section) return undefined

    let entry: SpineExcerpt | undefined
    try {
      await section.load(book.load.bind(book))
      const doc = section.document
      if (doc) {
        entry = {
          spineIndex,
          label: options.getLabel(spineIndex),
          excerpt: extractExcerpt(doc, EXCERPT_MAX_CHARS),
        }
      }
    } catch {
      entry = undefined
    } finally {
      // The section may have become the active one while we were awaiting
      // `load()` (a fast user tap can outrace an off-DOM prefetch) — leave
      // it loaded for the live view in that case instead of unloading out
      // from under it.
      if (!isActive(spineIndex)) {
        try {
          section.unload()
        } catch {
          /* best-effort cleanup only */
        }
      }
    }

    if (!entry || disposed) return entry
    return remember(entry)
  }

  const get = (spineIndex: number): Promise<SpineExcerpt | undefined> => {
    const cached = cache.get(spineIndex)
    if (cached) {
      cache.delete(spineIndex) // touch for recency
      cache.set(spineIndex, cached)
      return Promise.resolve(cached)
    }
    if (isActive(spineIndex)) return Promise.resolve(undefined)

    const length = spineLengthOf(book)
    if (spineIndex < 0 || spineIndex >= length) return Promise.resolve(undefined)

    const inFlight = pending.get(spineIndex)
    if (inFlight) return inFlight

    const promise = loadOne(spineIndex).finally(() => {
      pending.delete(spineIndex)
    })
    pending.set(spineIndex, promise)
    return promise
  }

  const prefetchAround = (spineIndex: number, radius = DEFAULT_PREFETCH_RADIUS): void => {
    if (disposed) return
    for (let offset = -radius; offset <= radius; offset += 1) {
      if (offset === 0) continue
      const index = spineIndex + offset
      if (cache.has(index) || pending.has(index)) continue
      void get(index)
    }
  }

  const dispose = (): void => {
    disposed = true
    cache.clear()
    pending.clear()
  }

  return { get, prefetchAround, dispose }
}

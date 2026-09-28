import ePubImport, { EpubCFI, type Book, type Rendition } from 'epubjs'
import {
  CfiLocation,
  type HighlightStyleKind,
  type TextMatcher,
} from '@reading-book/book-reader-sdk'
import {
  READER_THEME_PRESETS,
  fontFamilyCss,
  splitHighlightColor,
  type FontFamily,
  type FontWeight,
  type ReaderTheme,
  type TextAlign,
} from '@reading-book/book-reader-sdk'
import { cfiCodec, tryEncodeCfi, type EpubCfiDecodeResult } from './cfi/cfi-codec'
import { spineIndexFromCfiPath } from '@reading-book/book-reader-sdk'
import {
  isTrivialSectionStartCfi,
  installEpubjsStartContainerLogFilter,
  withEpubjsStartContainerLogMutedAsync,
  resolveCfiRange,
} from './cfi/cfi-dom-range'
import { toEpubjsDisplayCfi } from './cfi/selection-cfi'
import {
  cfiFromLocation,
  displayedPagesFromLocation,
  EpubPaginationTracker,
  type CumulativePageMetrics,
} from './progress/reader-position'
import {
  buildLayoutFingerprint,
  buildPaginationCacheKey,
  fingerprintEpubBytes,
  readPaginationCache,
  writePaginationCache,
} from './progress/epub-pagination-cache'
import {
  createSpineExcerptCache,
  extractExcerpt,
  EXCERPT_MAX_CHARS,
  type SpineExcerpt,
} from './previews/spineExcerptCache'
import {
  clearSearchHighlights,
  findSectionMatches,
  paintSearchHighlights,
  pickSectionMatch,
  rangeForMatch,
} from './search/epubSearchDom'
import {
  paintReadAloudHighlight,
  rangeForSegment,
  readAloudDataFor,
  textOffsetOfBoundary,
} from './readAloud/epubReadAloudDom'

type EpubjsManagerLike = Record<string, unknown>

function renditionManager(rendition: Rendition): EpubjsManagerLike | undefined {
  return (rendition as unknown as { manager?: EpubjsManagerLike }).manager
}

/**
 * Document of the currently displayed section, via `Rendition.getContents()` — the public,
 * documented accessor (`rendition.js` -> `manager.getContents()`), not a reimplementation
 * against `.manager.views` internals. epubjs's own `.d.ts` types `getContents()` as returning a
 * single `Contents`; the real implementation (`managers/default/index.js`) returns an array —
 * one entry per section view the manager currently keeps mounted (just the active section for
 * the 'default' paginated manager used here, since `display()` clears prior views before
 * appending the new one). A prior version of this walked `manager.views.current()`/`displayed()`
 * directly — `current()` doesn't exist on epubjs's `Views` class, and `displayed()` filters on a
 * view-internal `displayed` flag that isn't reliable here — which is why `getCurrentExcerpt()`
 * silently returned `undefined` for every bookmark instead of throwing.
 */
function currentSectionDocument(rendition: Rendition): Document | null {
  const contents = rendition.getContents() as unknown as
    | Array<{ document?: Document }>
    | undefined
  return contents?.[0]?.document ?? null
}

/** Vite/CJS interop: default may be the ePub fn or a module namespace. */
const ePub =
  typeof ePubImport === 'function'
    ? ePubImport
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ePubImport as any).default

export type EpubPageLayout = 'single' | 'dual'

/**
 * Live nav for footer / TOC.
 * Persist uses CFI via getCurrentLocation() — never spine index or page number.
 */
export type EpubNavState = {
  /** 0-based spine section in the book spine. */
  spineIndex: number
  spineLength: number
  /**
   * epub.js `location.start.displayed.page` — CSS pages *inside this Section*.
   * Always available; fluctuates with viewport, font size, and spread.
   */
  sectionPage: number
  /** epub.js `location.start.displayed.total` for the current Section only. */
  sectionPageTotal: number
  /**
   * 1-based page counter (CSS-driven cumulative in paginated mode).
   */
  pageCurrent: number
  /** Cumulative CSS page total across all spine sections. */
  pageTotal: number
  /** True once page counts are ready. */
  pageCountReady: boolean
  href: string
  label: string
  /** 0..1 book progress across the whole book. */
  progress: number
  /** Same as `progress`. */
  percentage: number
  /** Current viewport start CFI when known. */
  cfi?: string
}

export type EpubTocItem = {
  id: string
  label: string
  href: string
  level: number
  children: EpubTocItem[]
}

/**
 * One coalesced reader-appearance change.
 *
 * Only the provided fields are applied. Everything in here shares a single
 * relayout + pagination remeasure, so changing several appearance settings in
 * one commit costs the same as changing one — see `EpubjsHandle.applySettings`.
 */
export type EpubSettingsPatch = {
  theme?: ReaderTheme
  layout?: EpubPageLayout
  viewMode?: EpubViewMode
  fontSize?: number
  fontFamily?: FontFamily
  fontWeight?: FontWeight
  lineHeight?: number
  textAlign?: TextAlign
  marginsEnabled?: boolean
  marginPreset?: string
  chromeHidden?: boolean
}

/** Axis-aligned rect in outer-document (non-iframe) viewport coordinates. */
export type ViewportRectLike = {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

/** A live, non-collapsed text selection inside the current EPUB section. */
export type EpubSelectionInfo = {
  cfiRange: string
  text: string
  rect: ViewportRectLike
  /** BCP-47 language of the selected text: nearest `lang`/`xml:lang`, else the book's
   *  `dc:language`; empty when neither is declared. */
  lang: string
}

/** An existing highlight/underline mark was clicked. */
export type EpubHighlightClickInfo = {
  id: string
  cfiRange: string
  rect: ViewportRectLike
}

export interface EpubjsHandle {
  book: Book
  rendition: Rendition
  /** Whether the EPUB already exposes a cover document in its reading spine. */
  hasSpineCover: () => boolean
  destroy: () => void
  next: () => Promise<void>
  prev: () => Promise<void>
  nextPage: () => Promise<void>
  prevPage: () => Promise<void>
  /**
   * Scroll mode only: true when the current section's scroll container is
   * already at its top/bottom edge in the given direction — used to let a
   * wheel gesture that keeps scrolling past the end of a chapter fall through
   * into a chapter change instead of doing nothing.
   */
  isAtScrollBoundary: (direction: 'down' | 'up') => boolean
  nextSection: () => Promise<void>
  prevSection: () => Promise<void>
  goToHref: (href: string) => Promise<void>
  /** Open a spine *section* (0-based). */
  goToSpineIndex: (index: number) => Promise<void>
  /** Jump to a 1-based epub.js location. No-op until locations are generated. */
  goToLocationPage: (page: number) => Promise<void>
  getSpineLength: () => number
  getNavState: () => EpubNavState
  getToc: () => EpubTocItem[]
  /** TOC-resolved display label per spine section, indexed by spine position. */
  getSectionLabels: () => string[]
  /** Stable CFI location for persist/resume (T4.1). Undefined until relocated. */
  getCurrentLocation: () => CfiLocation | undefined
  /** Jump to a stored CFI location (T4.1 / FR-05 resume). */
  goToLocation: (location: CfiLocation) => Promise<void>
  /** Clear text selection in the last EPUB iframe that reported a selection. */
  clearSelection: () => void
  setTheme: (theme: ReaderTheme) => void
  setLayout: (layout: EpubPageLayout) => void
  /** Reflow text size (EPUB zoom) — px base; epubjs applies as %. */
  setFontSize: (px: number) => void
  setFontFamily: (family: FontFamily) => void
  setFontWeight: (weight: FontWeight) => void
  setLineHeight: (lineHeight: number) => void
  setTextAlign: (textAlign: TextAlign) => void
  setMargins: (enabled: boolean, preset: string) => void
  setChromeHidden: (hidden: boolean) => void
  /**
   * Batched form of the `set*` calls above.
   *
   * The individual setters each run a relayout + full pagination remeasure, so
   * applying N settings one by one costs N relayouts. This applies every field
   * in `patch` first and then reflows **once**. Prefer it whenever more than
   * one appearance value can change together (props sync, slider drags).
   *
   * Returns `true` when the patch reached the rendition, `false` when it was
   * dropped (destroyed/aborted handle) so the caller can retry later.
   */
  applySettings: (patch: EpubSettingsPatch) => boolean
  resize: () => void
  /**
   * Label + opening excerpt for `spineIndex` — for TOC hover previews,
   * bookmark lists, a chapter switcher. Cached; loads off-DOM (no iframe,
   * no layout) on a cache miss for any section other than the one
   * currently displayed. See `previews/spineExcerptCache.ts`.
   */
  getSpineExcerpt: (spineIndex: number) => Promise<SpineExcerpt | undefined>
  /** Warm the excerpt cache around `spineIndex` (default current ± 2). */
  prefetchSpineExcerpts: (spineIndex: number, radius?: number) => void
  /**
   * Opening text of the currently displayed section (same extraction as
   * `getSpineExcerpt`, which deliberately skips this section — see its comment).
   * Used to give a new bookmark a preview snippet at creation time.
   */
  getCurrentExcerpt: () => string | undefined
  /**
   * DEBUG — resolves `cfi` to a DOM `Range` in the currently rendered section
   * and returns its rect plus the hosting iframe's rect (both iframe-local
   * coords), so a caller can compare "where the CFI actually is" against
   * "what's on screen" without relying on a painted `<mark>` (bookmarks have
   * none). Returns `null` when the CFI doesn't resolve in the current section.
   */
  debugResolveCfiRect: (
    cfi: string,
  ) => { rect: DOMRect; iframeRect: DOMRect } | null
  /** Add (or replace) a highlight/underline mark; idempotent per (cfiRange, styleKind). */
  applyHighlight: (params: {
    id: string
    cfiRange: string
    styleKind: HighlightStyleKind
    colorHex: string
  }) => void
  removeHighlight: (cfiRange: string, styleKind: HighlightStyleKind) => void
  /** Briefly pulses the mark's opacity so a highlight jumped to from the sidebar/search stands
   *  out from any other marks sharing the same viewport. No-op if the mark isn't currently
   *  attached to a rendered view (e.g. the jump is still settling). */
  flashHighlight: (cfiRange: string, styleKind: HighlightStyleKind) => void
  /** Finds the highlight/underline mark (if any) under an outer-viewport point — used to detect a
   *  right-click landing on an existing mark. marks-pane only wires up `click`/`touchstart`
   *  listeners on a mark (see iframe.js `highlight()`/`underline()`), and browsers never fire
   *  `click` for the right mouse button, so a right-click needs this explicit hit-test instead. */
  getHighlightAtPoint: (outerX: number, outerY: number) => EpubHighlightClickInfo | null
  /** Toggles the `.rb-hl-focused` outline (index.css) on one highlight/underline's mark — or
   *  clears it when `id` is null. Re-applied on every `rendered` view (page turn, chapter change)
   *  since epub.js recreates marks per view; a class set once would vanish the moment the section
   *  re-renders. */
  setFocusedHighlight: (id: string | null) => void
  /**
   * Paint every match of `matcher` in the mounted section(s), re-applied on each `rendered`
   * view; `null` clears. Either way the current match is forgotten until the next jump.
   */
  setSearchHighlights: (matcher: TextMatcher | null) => void
  /**
   * Jump to one search match (real spine index — no synthetic-cover offset) and mark it as the
   * current hit. Resolves false when only its chapter could be opened.
   */
  goToSearchMatch: (target: EpubSearchTarget) => Promise<boolean>
  /** Fires ~250ms after a selection settles; null when the selection is cleared/collapsed. */
  onTextSelected: (cb: (info: EpubSelectionInfo | null) => void) => () => void
  /** Synchronous snapshot of whatever selection is live right now — for committing a drag-to-mark
   *  gesture exactly on pointerup instead of waiting on `onTextSelected`'s debounce. Null when
   *  there's no non-collapsed selection in any mounted section. */
  getCurrentSelectionInfo: () => EpubSelectionInfo | null
  /** Speakable segments of the displayed section, bounded by `mode`; null when nothing is mounted. */
  getReadAloudSegments: (mode: ReadAloudMode) => ReadAloudSection | null
  /**
   * Highlight segment `index` of spine section `spineIndex` and turn pages until it is on screen
   * (or jump back to it when the reader paged past it). `null` clears the highlight.
   */
  setReadAloudCursor: (cursor: { spineIndex: number; index: number } | null) => Promise<void>
}

/**
 * `viewport`: segments visible now. `fromPosition`: from the first visible segment to the end of
 * the section. `section`: the whole section.
 */
export type ReadAloudMode = 'viewport' | 'fromPosition' | 'section'

export type ReadAloudSection = {
  /** Real spine index (no synthetic-cover offset). */
  spineIndex: number
  lang: string
  /** Every segment of the section; `startIndex`..`endIndex` (exclusive) is the requested span. */
  segments: string[]
  startIndex: number
  endIndex: number
}

export type { SpineExcerpt } from './previews/spineExcerptCache'

/** A match as Main counted it: the `occurrence`-th (0-based) of `count` in spine section `spineIndex`. */
export type EpubSearchTarget = {
  spineIndex: number
  occurrence: number
  count: number
}

/** Runtime shape of an `EpubCFI` instance, covering both the string-input and Range-input forms. */
type EpubCFIHandle = { toRange(doc: Document): Range | null; toString(): string }

/**
 * `EpubCFI` export typed for the constructor shape it's used with at runtime:
 * `new EpubCFI(cfiString)`, whose `.toRange(doc)` resolves the CFI against a document without
 * touching the rendition — used by `debugResolveCfiRect`.
 */
function getEpubCFIConstructor():
  | (new (cfiFrom: string | Range, base?: string, ignoreClass?: string) => EpubCFIHandle)
  | null {
  return EpubCFI as unknown as new (
    cfiFrom: string | Range,
    base?: string,
    ignoreClass?: string,
  ) => EpubCFIHandle
}

/** Default Aa panel size — zoom % is relative to this. */
export const EPUB_BASE_FONT_PX = 18

function spineIndexFromCfi(book: Book, cfi: string, fallback: number): number {
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
async function displayCfiSafely(
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
async function displayCfiTrusted(
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

export function spineLengthOf(book: Book): number {
  const spine = book.spine as { length?: number }
  return typeof spine.length === 'number' ? spine.length : 0
}

type SpineSectionLike = {
  href?: string
  url?: string
  idref?: string
  properties?: string | string[]
  linear?: string | boolean
  next?: () => SpineSectionLike | undefined
  prev?: () => SpineSectionLike | undefined
}

function basenameLabel(href: string): string {
  const raw = href.split('/').pop() ?? href
  const noQuery = raw.split('?')[0] ?? raw
  const noHash = noQuery.split('#')[0] ?? noQuery
  const stem = noHash.replace(/\.(x?html?|xml)$/i, '')
  try {
    return decodeURIComponent(stem)
  } catch {
    return stem
  }
}

function propertyTokens(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean)
  return String(value).split(/\s+/).filter(Boolean)
}

function spinePropertyTokens(section: SpineSectionLike | null | undefined): string[] {
  return propertyTokens(section?.properties)
}

function manifestPropertyTokens(book: Book, idref: string | undefined): string[] {
  if (!idref) return []
  const manifest = (
    book as unknown as {
      packaging?: { manifest?: Record<string, { properties?: unknown }> }
    }
  ).packaging?.manifest
  return propertyTokens(manifest?.[idref]?.properties)
}

function sectionPath(section: SpineSectionLike | null | undefined): string {
  return `${section?.href ?? ''} ${section?.idref ?? ''}`.toLowerCase()
}

function isCoverSection(
  section: SpineSectionLike | null | undefined,
  book?: Book,
): boolean {
  const tokens = [
    ...spinePropertyTokens(section),
    ...(book ? manifestPropertyTokens(book, section?.idref) : []),
  ]
  if (
    tokens.some(
      (t) => t === 'cover-image' || t === 'cover' || t.startsWith('cover'),
    )
  ) {
    return true
  }
  return /\bcover\b/.test(sectionPath(section))
}

/**
 * epub.js leaves next()/prev() empty for `linear="no"` spine items.
 * Linking next/prev across all spine items ensures next/prev navigation smoothly
 * transitions across all sections (including cover, TOC, nav, and linear="no" items).
 */
export function linkSpineSections(book: Book): void {
  const length = spineLengthOf(book)
  for (let i = 0; i < length; i += 1) {
    const section = book.spine.get(i) as SpineSectionLike | undefined
    if (!section) continue
    const prevIndex = i - 1
    const nextIndex = i + 1
    section.prev = () =>
      prevIndex >= 0
        ? (book.spine.get(prevIndex) as SpineSectionLike | undefined)
        : undefined
    section.next = () =>
      nextIndex < length
        ? (book.spine.get(nextIndex) as SpineSectionLike | undefined)
        : undefined
  }
}

function normalizeTocItems(items: unknown, level = 0): EpubTocItem[] {
  if (!Array.isArray(items)) return []

  return items
    .map((item, index) => {
      const raw = item as {
        id?: unknown
        label?: unknown
        href?: unknown
        subitems?: unknown
        children?: unknown
      }
      const href = typeof raw.href === 'string' ? raw.href : ''
      const label =
        typeof raw.label === 'string' && raw.label.trim()
          ? raw.label.trim()
          : href
            ? basenameLabel(href)
            : `Section ${index + 1}`
      const id =
        typeof raw.id === 'string' && raw.id.trim()
          ? raw.id
          : `${level}-${index}-${href || label}`
      const children = normalizeTocItems(raw.subitems ?? raw.children, level + 1)
      return {
        id,
        label,
        href,
        level,
        children,
      }
    })
    .filter((item) => item.href || item.children.length > 0)
}

function normalizeHrefForLocation(href: string): string {
  return href
    .split('#')[0]
    .split('?')[0]
    .replace(/^\.\//, '')
    .replace(/\\/g, '/')
}

/** Human-readable TOC title for a spine href, including nested TOC entries. */
export function resolveTocLocationLabel(
  href: string,
  items: EpubTocItem[],
): string | undefined {
  const target = normalizeHrefForLocation(href)
  if (!target) return undefined
  let match: EpubTocItem | undefined
  const visit = (entries: EpubTocItem[]) => {
    entries.forEach((entry) => {
      if (normalizeHrefForLocation(entry.href) === target) match = entry
      visit(entry.children)
    })
  }
  visit(items)
  return match?.label
}

/** Coarse 0..1 book position from spine order, used for scroll mode or unpaginated state. */
function spinePositionFraction(
  spineIndex: number,
  spineLength: number,
  sectionPage: number,
  sectionPageTotal: number,
): number {
  if (spineLength <= 0) return 0
  const withinSection =
    sectionPageTotal > 1 ? (sectionPage - 1) / sectionPageTotal : 0
  return Math.min(1, Math.max(0, (spineIndex + withinSection) / spineLength))
}

export function buildEpubNavState(
  book: Book,
  spineIndex: number,
  toc: EpubTocItem[] = [],
  displayed?: { page: number; total: number },
  cfi?: string,
  pagination?: CumulativePageMetrics | {
    pageCurrent: number
    pageTotal: number
    progress: number
    percentage?: number
    pageCountReady?: boolean
  },
): EpubNavState {
  const spineLength = spineLengthOf(book)
  const clamped =
    spineLength <= 0
      ? 0
      : Math.min(Math.max(spineIndex, 0), spineLength - 1)
  const section = book.spine.get(clamped)
  const href = section?.href ?? ''
  const label =
    resolveTocLocationLabel(href, toc) ||
    (href ? basenameLabel(href) : '') ||
    'Section'
  const sectionPage = displayed?.page ?? 1
  const sectionPageTotal = displayed?.total ?? 1
  const pageCountReady = pagination?.pageCountReady ?? true
  const pageCurrent = pagination?.pageCurrent ?? sectionPage
  const pageTotal = pagination?.pageTotal ?? sectionPageTotal
  // Always spine/CFI-derived — never the whole-book CSS-column page estimate,
  // which drifts with font-size/line-height/margins (unlike spine order).
  const percentage = spinePositionFraction(
    clamped,
    spineLength,
    sectionPage,
    sectionPageTotal,
  )
  return {
    spineIndex: clamped,
    spineLength,
    sectionPage,
    sectionPageTotal,
    pageCurrent,
    pageTotal,
    pageCountReady,
    href,
    label,
    progress: percentage,
    percentage,
    cfi: cfi || undefined,
  }
}

/**
 * Scan section text lengths in the background to seed initial page estimates.
 */
async function scanSpineCharCounts(
  book: Book,
  signal?: AbortSignal,
): Promise<number[]> {
  const len = spineLengthOf(book)
  const charCounts: number[] = new Array(len).fill(0)
  const archive = (
    book as unknown as {
      archive?: { getText?: (href: string) => Promise<string> }
    }
  ).archive

  for (let i = 0; i < len; i += 1) {
    if (signal?.aborted) break
    const section = (book.spine.get(i) as unknown) as
      | {
          href?: string
          load?: (request?: unknown) => Promise<unknown>
        }
      | undefined
    if (!section) continue

    try {
      if (typeof archive?.getText === 'function' && section.href) {
        const rawText = await archive.getText(section.href)
        const stripped = rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
        charCounts[i] = stripped.length
        continue
      }
      if (typeof section.load === 'function') {
        const loaded = await section.load(book.load.bind(book))
        const doc =
          (loaded as { ownerDocument?: Document } | undefined)?.ownerDocument ||
          loaded
        const text =
          (doc as Document | undefined)?.body?.textContent ||
          (loaded as { textContent?: string } | undefined)?.textContent ||
          ''
        charCounts[i] = text.trim().length
      }
    } catch {
      charCounts[i] = 1200
    }
  }
  return charCounts
}

function getRenditionLayoutDelta(rendition: Rendition): number {
  const manager = renditionManager(rendition) as
    | {
        layout?: { delta?: number; pageWidth?: number; width?: number }
        container?: HTMLElement
      }
    | undefined
  const delta =
    manager?.layout?.delta ||
    manager?.layout?.pageWidth ||
    manager?.layout?.width
  if (typeof delta === 'number' && Number.isFinite(delta) && delta > 0) {
    return delta
  }
  const clientW = manager?.container?.clientWidth
  if (typeof clientW === 'number' && Number.isFinite(clientW) && clientW > 0) {
    return clientW
  }
  return 0
}

/**
 * Scroll mode (`flow: 'scrolled-doc'`) keeps the `default` manager's own
 * `container` element as the actual scrolling box — this reads its
 * scrollTop/scrollHeight directly rather than duplicating epub.js's internal
 * axis bookkeeping. A couple of px of tolerance absorbs sub-pixel rounding so
 * a wheel event at the true edge isn't missed by a fraction of a pixel.
 */
const SCROLL_BOUNDARY_EPSILON_PX = 2

function isAtVerticalScrollBoundary(
  rendition: Rendition,
  direction: 'down' | 'up',
): boolean {
  const manager = renditionManager(rendition) as
    | { container?: HTMLElement }
    | undefined
  const container = manager?.container
  if (!container) return false
  if (direction === 'down') {
    return (
      container.scrollTop + container.clientHeight >=
      container.scrollHeight - SCROLL_BOUNDARY_EPSILON_PX
    )
  }
  return container.scrollTop <= SCROLL_BOUNDARY_EPSILON_PX
}

export function applyEpubFontSize(rendition: Rendition, px: number): void {
  const clamped = Math.min(32, Math.max(12, px))
  const pct = Math.round((clamped / EPUB_BASE_FONT_PX) * 100)
  rendition.themes.fontSize(`${pct}%`)
}

type EpubContent = {
  document?: Document
}

type ThemeableRendition = Rendition & {
  getContents?: () => EpubContent[]
  hooks?: {
    content?: {
      register?: (hook: (content: EpubContent) => void) => void
    }
  }
}

const epubThemeByRendition = new WeakMap<Rendition, ReaderTheme>()
export type EpubReadingStyle = {
  fontFamily: FontFamily
  fontWeight: FontWeight
  lineHeight: number
  textAlign: TextAlign
  marginsEnabled: boolean
  marginPreset: string
  /** When true (chrome hidden), expand the text column to use more horizontal space. */
  chromeHidden: boolean
}

export const DEFAULT_EPUB_READING_STYLE: EpubReadingStyle = {
  fontFamily: 'serif',
  fontWeight: 400,
  lineHeight: 1.65,
  textAlign: 'justify',
  marginsEnabled: true,
  marginPreset: 'normal',
  chromeHidden: true,
}

const epubReadingStyleByRendition = new WeakMap<Rendition, EpubReadingStyle>()

/**
 * Page padding inside the EPUB iframe.
 * Wider gutters when chrome is hidden (immersive / Invisible UI) so text
 * uses more of the viewport; tighter when tools chrome is open.
 */
function marginPadding(
  enabled: boolean,
  preset: string,
  chromeHidden: boolean,
): string {
  if (!enabled) return chromeHidden ? '16px' : '12px'
  if (chromeHidden) {
    if (preset === 'narrow') return '28px 5vw'
    if (preset === 'wide') return '24px 3vw'
    return '28px 4vw'
  }
  if (preset === 'narrow') return '32px 48px'
  if (preset === 'wide') return '32px 12vw'
  return '32px 8vw'
}

/** Reflow column width — expands when reader chrome is hidden. */
function contentMaxWidth(
  enabled: boolean,
  preset: string,
  chromeHidden: boolean,
): string {
  if (!enabled || preset === 'off') return 'none'
  if (chromeHidden) {
    if (preset === 'narrow') return '760px'
    if (preset === 'wide') return '1140px'
    return '960px'
  }
  if (preset === 'narrow') return '580px'
  if (preset === 'wide') return '780px'
  return '680px'
}

function applyThemeVariables(doc: Document, theme: ReaderTheme): void {
  const { color, background, link, linkVisited, linkHover } =
    READER_THEME_PRESETS[theme]
  const root = doc.documentElement
  root.style.setProperty('--epub-color', color)
  root.style.setProperty('--epub-background', background)
  root.style.setProperty('--epub-link', link)
  root.style.setProperty('--epub-link-visited', linkVisited)
  root.style.setProperty('--epub-link-hover', linkHover)
  // Accent used for the native text-selection background — see `::selection` below.
  root.style.setProperty('--epub-selection-bg', linkHover)
}

function applyReadingStyleVariables(
  doc: Document,
  style: EpubReadingStyle,
): void {
  const root = doc.documentElement
  root.style.setProperty('--epub-font-family', fontFamilyCss(style.fontFamily))
  root.style.setProperty('--epub-font-weight', String(style.fontWeight))
  root.style.setProperty('--epub-line-height', String(style.lineHeight))
  root.style.setProperty('--epub-text-align', style.textAlign)
  root.style.setProperty(
    '--epub-page-padding',
    marginPadding(style.marginsEnabled, style.marginPreset, style.chromeHidden),
  )
  const maxWidth = contentMaxWidth(
    style.marginsEnabled,
    style.marginPreset,
    style.chromeHidden,
  )
  root.style.setProperty('--epub-content-max-width', maxWidth)
  root.style.setProperty(
    '--epub-content-margin-x',
    maxWidth === 'none' ? '0' : 'auto',
  )
}

/**
 * Register the EPUB overlay rules once per rendition. Values are assigned
 * separately so a theme switch never replaces the EPUB stylesheet.
 */
export function injectEpubThemeStyles(rendition: Rendition): void {
  const themeableRendition = rendition as unknown as ThemeableRendition
  // !important so author EPUB CSS (often dark link on dark page) cannot hide links.
  rendition.themes.default({
    body: {
      color: 'var(--epub-color)',
      background: 'var(--epub-background)',
      'font-family': 'var(--epub-font-family) !important',
      'font-weight': 'var(--epub-font-weight) !important',
      'line-height': 'var(--epub-line-height) !important',
      'text-align': 'var(--epub-text-align) !important',
      padding: 'var(--epub-page-padding) !important',
      margin: '0 !important',
      'box-sizing': 'border-box',
    },
    'p, li, blockquote, dd, dt': {
      'font-family': 'var(--epub-font-family) !important',
      'font-weight': 'var(--epub-font-weight) !important',
      'line-height': 'var(--epub-line-height) !important',
      'text-align': 'var(--epub-text-align) !important',
    },
    /* Center reflow column; width stays on tools-open gutters (stable left rail). */
    '.calibre, [class*="calibre"], body > div:first-of-type': {
      'max-width': 'var(--epub-content-max-width) !important',
      'margin-left': 'var(--epub-content-margin-x) !important',
      'margin-right': 'var(--epub-content-margin-x) !important',
    },
    /* Cover / full-bleed images still participate as normal spine pages. */
    img: {
      'max-width': '100% !important',
      'max-height': '100vh !important',
      height: 'auto',
      'object-fit': 'contain',
      'object-position': 'center',
    },
    'svg, image': {
      'max-width': '100%',
      'max-height': '100%',
    },
    a: {
      color: 'var(--epub-link) !important',
      'text-decoration': 'underline !important',
      'text-underline-offset': '2px',
    },
    'a:link': { color: 'var(--epub-link) !important' },
    'a:visited': { color: 'var(--epub-link-visited) !important' },
    'a:hover': { color: 'var(--epub-link-hover) !important' },
    'a:focus': { color: 'var(--epub-link-hover) !important' },
    /*
     * Explicit ::selection color so the selection stays clearly visible after
     * right-click opens the floating annotate menu — Chromium falls back to a
     * dim "inactive" gray selection once this iframe's document is no longer
     * the focused frame, which an author-defined ::selection rule overrides
     * regardless of focus state.
     */
    '::selection': {
      background: 'color-mix(in srgb, var(--epub-selection-bg) 45%, transparent)',
      color: 'inherit',
    },
    /* Hide native scrollbar inside iframe — host supplies a custom overlay. */
    '::-webkit-scrollbar': { display: 'none', width: '0', height: '0' },
    'html, body': {
      '-ms-overflow-style': 'none' as string,
      'scrollbar-width': 'none',
    },
  })
  themeableRendition.hooks?.content?.register((content: EpubContent) => {
    const theme = epubThemeByRendition.get(rendition)
    if (content.document && theme) applyThemeVariables(content.document, theme)
    const readingStyle = epubReadingStyleByRendition.get(rendition)
    if (content.document && readingStyle) {
      applyReadingStyleVariables(content.document, readingStyle)
    }
  })
}

/**
 * Updates the active iframe(s) in place. Future EPUB documents receive the
 * same values from the content hook installed by injectEpubThemeStyles().
 */
export function applyEpubThemeVars(rendition: Rendition, theme: ReaderTheme): void {
  epubThemeByRendition.set(rendition, theme)
  const contents =
    (rendition as unknown as ThemeableRendition).getContents?.() ?? []
  const activeContents = Array.isArray(contents) ? contents : [contents]
  activeContents.forEach((content: EpubContent) => {
    if (content.document) applyThemeVariables(content.document, theme)
  })
}

export function applyEpubReadingStyle(
  rendition: Rendition,
  patch: Partial<EpubReadingStyle>,
): void {
  const current = epubReadingStyleByRendition.get(rendition) ??
    DEFAULT_EPUB_READING_STYLE
  const next = { ...current, ...patch }
  epubReadingStyleByRendition.set(rendition, next)
  const contents =
    (rendition as unknown as ThemeableRendition).getContents?.() ?? []
  const activeContents = Array.isArray(contents) ? contents : [contents]
  activeContents.forEach((content: EpubContent) => {
    if (content.document) applyReadingStyleVariables(content.document, next)
  })
}

function abortError(): Error {
  const err = new Error('EPUB open aborted')
  err.name = 'AbortError'
  return err
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

/** Fresh ArrayBuffer copy (IPC / TypedArray safe). */
export function toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    const copy = new Uint8Array(data.byteLength)
    copy.set(new Uint8Array(data))
    return copy.buffer
  }
  const view = data as ArrayBufferView
  const copy = new Uint8Array(view.byteLength)
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  return copy.buffer
}

/**
 * epubjs Rendition.destroy() leaves the task queue running (q.clear is commented
 * out upstream). After StrictMode remount / abort, queued `start()` then hits
 * `this.book.package` on a destroyed book → blank reader + console TypeError.
 */
function stopRenditionQueue(rendition: Rendition | null | undefined): void {
  if (!rendition) return
  const q = (
    rendition as unknown as {
      q?: { stop?: () => void; clear?: () => void; pause?: () => void }
    }
  ).q
  try {
    q?.stop?.()
  } catch {
    try {
      q?.clear?.()
      q?.pause?.()
    } catch {
      /* ignore */
    }
  }
}

export function waitForFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) {
        resolve()
        return
      }
      requestAnimationFrame(() => step(left - 1))
    }
    step(count)
  })
}

function readHostLayoutSize(
  host: HTMLElement,
): { width: number; height: number } {
  return {
    width: Math.floor(host.clientWidth),
    height: Math.floor(host.clientHeight),
  }
}

/**
 * Avoid deciding that a section is exhausted while its intrinsic layout is
 * still changing. A timeout keeps broken remote resources from blocking nav;
 * callers must not cross a spine boundary when this returns false.
 */
export async function waitForSectionResources(
  doc: Document | null,
  timeoutMs = 1200,
): Promise<boolean> {
  if (!doc) return true

  const cleanups: Array<() => void> = []
  const pending: Promise<unknown>[] = []

  doc.querySelectorAll('img').forEach((img) => {
    if (img.complete) return
    pending.push(
      new Promise<void>((resolve) => {
        const settle = () => resolve()
        img.addEventListener('load', settle, { once: true })
        img.addEventListener('error', settle, { once: true })
        cleanups.push(() => {
          img.removeEventListener('load', settle)
          img.removeEventListener('error', settle)
        })
      }),
    )
  })

  if (pending.length === 0) return true

  let timer: number | undefined
  try {
    return await Promise.race([
      Promise.allSettled(pending).then(() => true),
      new Promise<false>((resolve) => {
        timer = window.setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timer != null) window.clearTimeout(timer)
    cleanups.forEach((cleanup) => cleanup())
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
function waitForRenditionDisplayed(
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

async function withCfiJumpTimeout<T>(run: () => Promise<T>): Promise<T> {
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
async function ensureInitialPaint(
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

function waitForHostSize(
  host: HTMLElement,
  signal?: AbortSignal,
  timeoutMs = 4000,
): Promise<{ width: number; height: number }> {
  const read = () => readHostLayoutSize(host)
  const first = read()
  if (first.width > 0 && first.height > 0) return Promise.resolve(first)

  return new Promise((resolve, reject) => {
    const started = Date.now()
    const ro = new ResizeObserver(() => {
      const size = read()
      if (size.width > 0 && size.height > 0) {
        cleanup()
        resolve(size)
      }
    })
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }
    const timer = window.setInterval(() => {
      const size = read()
      if (size.width > 0 && size.height > 0) {
        cleanup()
        resolve(size)
        return
      }
      if (Date.now() - started > timeoutMs) {
        cleanup()
        resolve({ width: Math.max(size.width, 320), height: Math.max(size.height, 480) })
      }
    }, 50)
    const cleanup = () => {
      ro.disconnect()
      window.clearInterval(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    ro.observe(host)
  })
}

/**
 * The reader always uses the `default` View Manager (one spine section at a
 * time) — only the epub.js `flow` changes between the two supported reading
 * modes: `paginated` (CSS multi-column) and `scroll` (vertical, one section
 * scrolled top-to-bottom). Switching `viewMode` never swaps the manager, so
 * an existing rendition can adopt a new flow live via `rendition.flow(...)`
 * instead of tearing down and recreating the rendition (see `applySettings`).
 */
export type EpubViewMode = 'paginated' | 'scroll'

export function flowForViewMode(viewMode: EpubViewMode): 'paginated' | 'scrolled-doc' {
  return viewMode === 'scroll' ? 'scrolled-doc' : 'paginated'
}
export const EPUB_VIEW_MANAGER = 'default'

export function spreadForLayout(layout: EpubPageLayout): 'always' | 'none' {
  return layout === 'dual' ? 'always' : 'none'
}

/** Host + iframe chrome for page spread gutters drawn in React overlay. */
export function applyDualSpreadHost(host: HTMLElement, layout: EpubPageLayout): void {
  host.dataset.epubSpread = layout
}

export type OpenEpubjsOptions = {
  theme?: ReaderTheme
  signal?: AbortSignal
  /** 1 or 2 page spread (gutters drawn in React). */
  layout?: EpubPageLayout
  /** Paginated (default) vs. continuous vertical scroll within a section. */
  viewMode?: EpubViewMode
  /** Initial reflow size in px (default 18). */
  fontSize?: number
  fontFamily?: FontFamily
  fontWeight?: FontWeight
  lineHeight?: number
  textAlign?: TextAlign
  marginsEnabled?: boolean
  marginPreset?: string
  /** Reader chrome hidden → wider text column (default true). */
  chromeHidden?: boolean
  /** Resume at CFI after theme/font apply (T4.1). Falls back to first spine. */
  initialLocation?: CfiLocation
  /** Fired once the first section iframe is painted (before open() fully settles). */
  onFirstRender?: () => void
  /** Fired when the loading lifecycle advances. */
  onStatusChange?: (status: 'opening' | 'rendering' | 'ready') => void
  /**
   * Fired once `book.locations` finishes generating, so the footer can swap
   * from the section counter to the book-wide page counter.
   */
  onLocationsReady?: () => void
}

/**
 * Open an EPUB from ArrayBuffer into `host`.
 * Spine order is preserved — cover (or any first item) is a normal page.
 */
export async function openEpubjs(
  buffer: ArrayBuffer | ArrayBufferView,
  host: HTMLElement,
  themeOrOptions: ReaderTheme | OpenEpubjsOptions = 'night',
): Promise<EpubjsHandle> {
  const options: OpenEpubjsOptions =
    typeof themeOrOptions === 'string'
      ? { theme: themeOrOptions }
      : themeOrOptions
  const theme = options.theme ?? 'night'
  const signal = options.signal
  let layout: EpubPageLayout = options.layout ?? 'single'
  let viewMode: EpubViewMode = options.viewMode ?? 'paginated'
  const initialFontSize = options.fontSize ?? EPUB_BASE_FONT_PX
  const initialReadingStyle: EpubReadingStyle = {
    fontFamily: options.fontFamily ?? DEFAULT_EPUB_READING_STYLE.fontFamily,
    fontWeight: options.fontWeight ?? DEFAULT_EPUB_READING_STYLE.fontWeight,
    lineHeight: options.lineHeight ?? DEFAULT_EPUB_READING_STYLE.lineHeight,
    textAlign: options.textAlign ?? DEFAULT_EPUB_READING_STYLE.textAlign,
    marginsEnabled:
      options.marginsEnabled ?? DEFAULT_EPUB_READING_STYLE.marginsEnabled,
    marginPreset: options.marginPreset ?? DEFAULT_EPUB_READING_STYLE.marginPreset,
    chromeHidden: options.chromeHidden ?? DEFAULT_EPUB_READING_STYLE.chromeHidden,
  }
  const initialLocation = options.initialLocation
  const onFirstRender = options.onFirstRender
  const onStatusChange = options.onStatusChange
  const onLocationsReady = options.onLocationsReady

  if (typeof ePub !== 'function') {
    throw new Error('epubjs failed to load (default export is not a function)')
  }

  installEpubjsStartContainerLogFilter()
  throwIfAborted(signal)

  const bytes = toArrayBuffer(buffer)
  if (bytes.byteLength < 22) {
    throw new Error('EPUB payload is empty or truncated')
  }

  const openToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  host.dataset.epubOpen = openToken

  const book = ePub(bytes, { openAs: 'binary' }) as Book
  let rendition: Rendition | null = null
  let activeReadingStyle: EpubReadingStyle = initialReadingStyle
  let settled = false
  let destroyed = false
  let fallbackSpine = 0
  let firstRenderNotified = false
  let resumeCfi: string | undefined
  let resumeSpineIndex: number | undefined

  const notifyFirstRender = () => {
    if (firstRenderNotified || destroyed) return
    if (host.dataset.epubOpen !== openToken) return
    if (!host.querySelector('iframe')) return
    firstRenderNotified = true
    onFirstRender?.()
  }

  const updateStatus = (next: 'opening' | 'rendering' | 'ready') => {
    if (destroyed) return
    onStatusChange?.(next)
  }

  updateStatus('opening')

  const destroyBook = () => {
    if (destroyed) return
    destroyed = true
    // Stop queued start/display before tearing down — see stopRenditionQueue.
    stopRenditionQueue(rendition)
    try {
      rendition?.destroy()
    } catch {
      /* ignore */
    }
    rendition = null
    try {
      // Avoid book.destroy → rendition.destroy recursion after we already cleaned it.
      const bookWithRendition = book as unknown as {
        rendition?: Rendition | null
      }
      bookWithRendition.rendition = null
      book.destroy()
    } catch {
      /* ignore */
    }
    if (host.dataset.epubOpen === openToken) {
      host.replaceChildren()
      delete host.dataset.epubOpen
    }
  }

  const onAbort = () => {
    if (!settled) destroyBook()
  }
  signal?.addEventListener('abort', onAbort)

  try {
    await book.ready
    throwIfAborted(signal)

    const size = await waitForHostSize(host, signal)
    throwIfAborted(signal)

    if (host.dataset.epubOpen !== openToken) {
      throw abortError()
    }
    host.replaceChildren()
    updateStatus('rendering')
    rendition = book.renderTo(host, {
      width: size.width,
      height: size.height,
      flow: flowForViewMode(viewMode),
      manager: EPUB_VIEW_MANAGER,
      spread: spreadForLayout(layout),
      // Show every spine item in order (cover included when publishers put it in spine).
      allowScriptedContent: false,
    })
    linkSpineSections(book)
    // Apply reading styles before first display so resume CFI paginates with final typography.
    injectEpubThemeStyles(rendition)
    applyEpubThemeVars(rendition, theme)
    applyEpubReadingStyle(rendition, initialReadingStyle)
    applyEpubFontSize(rendition, initialFontSize)
    applyDualSpreadHost(host, layout)
    rendition.on('rendered', notifyFirstRender)
    throwIfAborted(signal)

    // Resume at CFI when provided (T4.1); otherwise first spine item.
    fallbackSpine = 0
    if (initialLocation) {
      try {
        const decoded = cfiCodec.decode(initialLocation) as EpubCfiDecodeResult
        resumeCfi = decoded.cfi
        resumeSpineIndex = spineIndexFromCfi(book, decoded.cfi, fallbackSpine)
        await displayCfiSafely(book, rendition, decoded.cfi, resumeSpineIndex)
      } catch {
        const idx =
          resumeSpineIndex ??
          (resumeCfi
            ? spineIndexFromCfi(book, resumeCfi, fallbackSpine)
            : fallbackSpine)
        await rendition.display(idx)
      }
    } else {
      await rendition.display(fallbackSpine)
    }
    throwIfAborted(signal)
    await ensureInitialPaint(
      host,
      rendition,
      fallbackSpine,
      signal,
      openToken,
      {
        resume: Boolean(initialLocation),
        resumeRetry:
          resumeCfi && resumeSpineIndex != null
            ? { book, cfi: resumeCfi, spineIndex: resumeSpineIndex }
            : undefined,
      },
    )
    notifyFirstRender()
    updateStatus('ready')
  } catch (err) {
    destroyBook()
    throw err
  } finally {
    settled = true
    signal?.removeEventListener('abort', onAbort)
  }

  const paginationTracker = new EpubPaginationTracker(spineLengthOf(book))
  const bookFingerprint = fingerprintEpubBytes(bytes)
  let activeFontSize = initialFontSize
  let paginationMeasureToken = 0
  let paginationAbort: AbortController | null = null

  const readHostSize = () => readHostLayoutSize(host)

  const buildCacheKeyParts = () => {
    const size = readHostSize()
    const keyInput = {
      bookFingerprint,
      spineLength: spineLengthOf(book),
      width: size.width,
      height: size.height,
      layout,
      fontSize: activeFontSize,
      fontFamily: activeReadingStyle.fontFamily,
      fontWeight: activeReadingStyle.fontWeight,
      lineHeight: activeReadingStyle.lineHeight,
      textAlign: activeReadingStyle.textAlign,
      marginsEnabled: activeReadingStyle.marginsEnabled,
      marginPreset: activeReadingStyle.marginPreset,
      chromeHidden: activeReadingStyle.chromeHidden,
    }
    return {
      keyInput,
      key: buildPaginationCacheKey(keyInput),
      layoutFingerprint: buildLayoutFingerprint(keyInput),
    }
  }

  const publishLocationsReady = () => {
    if (destroyed || signal?.aborted) return
    onLocationsReady?.()
  }

  const hydrateFromCache = async (): Promise<boolean> => {
    const { key } = buildCacheKeyParts()
    const cached = await readPaginationCache(key)
    if (destroyed || signal?.aborted) return false
    if (!cached) return false
    if (cached.spineLength !== spineLengthOf(book)) return false
    if (cached.sectionPages.length !== spineLengthOf(book)) return false
    paginationTracker.hydrateExactSectionPages(cached.sectionPages)
    publishLocationsReady()
    return true
  }

  const startHiddenPaginationMeasure = () => {
    if (destroyed || signal?.aborted) return

    const token = ++paginationMeasureToken
    paginationAbort?.abort()
    const localAbort = new AbortController()
    paginationAbort = localAbort

    const onParentAbort = () => localAbort.abort()
    signal?.addEventListener('abort', onParentAbort, { once: true })

    void (async () => {
      try {
        const hit = await hydrateFromCache()
        if (hit || destroyed || signal?.aborted || token !== paginationMeasureToken) {
          return
        }

        const size = readHostSize()
        if (size.width <= 0 || size.height <= 0) return

        const { measureHiddenEpubPagination } = await import(
          './progress/hidden-epub-pagination'
        )
        if (destroyed || signal?.aborted || token !== paginationMeasureToken) {
          return
        }

        const result = await measureHiddenEpubPagination({
          buffer: bytes,
          width: size.width,
          height: size.height,
          theme,
          layout,
          fontSize: activeFontSize,
          readingStyle: { ...activeReadingStyle },
          signal: localAbort.signal,
        })

        if (destroyed || signal?.aborted || token !== paginationMeasureToken) {
          return
        }
        if (result.spineLength !== spineLengthOf(book)) return

        paginationTracker.hydrateExactSectionPages(result.sectionPages)
        const { key, layoutFingerprint } = buildCacheKeyParts()
        await writePaginationCache({
          key,
          bookFingerprint,
          layoutFingerprint,
          spineLength: result.spineLength,
          sectionPages: result.sectionPages,
        })
        publishLocationsReady()
      } catch (err) {
        if (destroyed || signal?.aborted || localAbort.signal.aborted) return
        console.warn('[epub pagination] hidden measure failed', err)
      } finally {
        signal?.removeEventListener('abort', onParentAbort)
        if (paginationAbort === localAbort) paginationAbort = null
      }
    })()
  }

  // Prefer cached totals immediately; measure in a hidden rendition on miss.
  void hydrateFromCache().then((hit) => {
    if (destroyed || signal?.aborted) return
    if (!hit) startHiddenPaginationMeasure()
  })

  // Scan section text lengths in the background to seed character counts & page estimates
  void scanSpineCharCounts(book, signal)
    .then((charCounts) => {
      if (destroyed || signal?.aborted) return
      paginationTracker.initCharCounts(charCounts)
      if (!paginationTracker.isFullyMeasured()) {
        publishLocationsReady()
      }
    })
    .catch(() => {
      /* ignore */
    })

  const activeRendition = rendition
  if (!activeRendition) {
    destroyBook()
    throw new Error('EPUB rendition failed to start')
  }

  let lastSelectionWindow: Window | null = null
  let selectionCb: ((info: EpubSelectionInfo | null) => void) | null = null

  /**
   * Converts a rect measured inside the EPUB iframe's own document (unscaled) to outer-document
   * viewport coordinates. `ReaderZoomViewport` applies `transform: scale(z)` to the iframe, so
   * `iframe.getBoundingClientRect()` (measured from the outer document) already reflects zoom
   * while a `Range`/`Selection` rect measured inside the iframe does not — naively adding the two
   * only lines up at 100% zoom. Deriving the scale from the iframe's own rendered size vs. its
   * `contentWindow.innerWidth/Height` corrects for any zoom level.
   */
  function toOuterRect(
    localRect: DOMRect,
    iframe: HTMLIFrameElement,
    win: Window,
  ): ViewportRectLike {
    const iframeRect = iframe.getBoundingClientRect()
    const scaleX = win.innerWidth > 0 ? iframeRect.width / win.innerWidth : 1
    const scaleY = win.innerHeight > 0 ? iframeRect.height / win.innerHeight : 1
    return {
      left: iframeRect.left + localRect.left * scaleX,
      top: iframeRect.top + localRect.top * scaleY,
      right: iframeRect.left + localRect.right * scaleX,
      bottom: iframeRect.top + localRect.bottom * scaleY,
      width: localRect.width * scaleX,
      height: localRect.height * scaleY,
    }
  }

  /** Historical fixed opacity per style kind — kept as the fallback for rows saved before the
   *  alpha picker existed, whose `colorHex` is plain 6-digit hex with no encoded alpha. */
  const LEGACY_ALPHA: Record<HighlightStyleKind, number> = {
    underline: 0.9,
    strikethrough: 0.9,
    highlight: 0.35,
    textbox: 1,
  }

  /**
   * epub.js/marks-pane only know 3 annotation types — `"highlight"`, `"underline"`, `"mark"`
   * (see `Annotation.attach()`/`detach()` in epubjs/src/annotations.js, which hardcode exactly
   * those 3 and silently no-op on anything else). Our `HighlightStyleKind` has 2 more:
   * `strikethrough` reuses the `underline` mark's rect+line geometry (the line is repositioned to
   * mid-height afterward — see `repositionStrikethroughLines`); `textbox` uses the `mark` type,
   * which places a plain positioned element (styled as a 📝 icon via `a[ref="epubjs-mk"]` in
   * index.css) instead of drawing over the text at all.
   */
  function epubAnnotationTypeFor(styleKind: HighlightStyleKind): 'highlight' | 'underline' | 'mark' {
    if (styleKind === 'textbox') return 'mark'
    if (styleKind === 'strikethrough') return 'underline'
    return styleKind
  }

  function styleAttrsFor(styleKind: HighlightStyleKind, colorHex: string): Record<string, string> {
    const { hex6, alpha } = splitHighlightColor(colorHex, LEGACY_ALPHA[styleKind])
    return styleKind === 'highlight'
      ? { fill: hex6, 'fill-opacity': String(alpha), 'mix-blend-mode': 'multiply' }
      : { stroke: hex6, 'stroke-opacity': String(alpha), 'mix-blend-mode': 'multiply' }
  }

  /**
   * A `strikethrough` mark is really an `underline` mark under the hood (see
   * `epubAnnotationTypeFor`) — marks-pane's `Underline.render()` (marks-pane/src/marks.js)
   * hardcodes its `<line>` at the BOTTOM of each line box, which is exactly what we want for a
   * real underline but not for a strikethrough. There's no library hook to change that, so this
   * walks the mark's own `<rect>`/`<line>` child pairs afterward and moves each `<line>` to the
   * vertical middle of its sibling `<rect>` instead. Re-run on every `rendered` view (alongside
   * `applyFocusedMarkClass`) since marks-pane recreates this geometry from scratch each time.
   */
  const strikethroughCfiRanges = new Set<string>()
  function repositionStrikethroughLines(): void {
    if (strikethroughCfiRanges.size === 0) return
    const views = activeRendition.views() as unknown as {
      forEach: (cb: (view: MarkedView) => void) => void
    }
    views.forEach((view) => {
      for (const cfiRange of strikethroughCfiRanges) {
        const element = view.underlines?.[cfiRange]?.element
        if (!element) continue
        let rect: SVGRectElement | null = null
        for (const child of Array.from(element.children)) {
          if (child.tagName === 'rect') {
            rect = child as SVGRectElement
          } else if (child.tagName === 'line' && rect) {
            const y = Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2
            child.setAttribute('y1', String(y))
            child.setAttribute('y2', String(y))
            rect = null
          }
        }
      }
    })
  }

  function applyHighlight({
    id,
    cfiRange,
    styleKind,
    colorHex,
  }: {
    id: string
    cfiRange: string
    styleKind: HighlightStyleKind
    colorHex: string
  }): void {
    const epubType = epubAnnotationTypeFor(styleKind)
    // Remove first: re-applying the same (cfiRange, type) after a color/style change, or a
    // duplicate load-on-open call, must replace the mark rather than leak a second DOM node.
    // Separate try/catch from the add() below — remove() failing (it shouldn't; epub.js no-ops
    // when the mark isn't found) must never block add() from still painting the highlight.
    try {
      activeRendition.annotations.remove(cfiRange, epubType)
    } catch {
      /* ignore */
    }
    strikethroughCfiRanges.delete(cfiRange)
    try {
      if (epubType === 'mark') {
        activeRendition.annotations.add('mark', cfiRange, { id })
      } else {
        activeRendition.annotations.add(
          epubType,
          cfiRange,
          { id },
          undefined,
          undefined,
          styleAttrsFor(styleKind, colorHex),
        )
      }
    } catch {
      /* stale/foreign cfi — ignore */
    }
    if (styleKind === 'strikethrough') strikethroughCfiRanges.add(cfiRange)
    // Re-apply the focused outline (and strikethrough line position) in case this mark is the
    // currently-focused one — e.g. a brand-new highlight created while already "focused" (see
    // `createHighlight` in useReaderHighlights.ts), whose element didn't exist yet the moment
    // `setFocusedHighlight` was called.
    applyFocusedMarkClass()
    repositionStrikethroughLines()
  }

  function removeHighlight(cfiRange: string, styleKind: HighlightStyleKind): void {
    if (styleKind === 'strikethrough') strikethroughCfiRanges.delete(cfiRange)
    try {
      activeRendition.annotations.remove(cfiRange, epubAnnotationTypeFor(styleKind))
    } catch {
      /* ignore */
    }
  }

  /** Finds the live mark epub.js/marks-pane painted for `cfiRange` — undocumented internals
   *  (`view.highlights`/`view.underlines`/`view.marks`, keyed by cfiRange) reached the same way
   *  `Annotations.remove` reaches `view.unhighlight`/`view.ununderline`/`view.unmark` upstream.
   *  Only ever populated for the section currently rendered as a view, so most lookups just miss. */
  function findMarkElement(cfiRange: string, styleKind: HighlightStyleKind): Element | null {
    const storeKey: 'highlights' | 'underlines' | 'marks' =
      styleKind === 'underline' || styleKind === 'strikethrough'
        ? 'underlines'
        : styleKind === 'textbox'
          ? 'marks'
          : 'highlights'
    let found: Element | null = null
    const views = activeRendition.views() as unknown as {
      forEach: (cb: (view: MarkedView) => void) => void
    }
    views.forEach((view) => {
      if (found) return
      const entry = view[storeKey]?.[cfiRange]
      if (entry?.element) found = entry.element
    })
    return found
  }

  /** Pulses a mark's opacity a few times — used when jumping to a highlight from the sidebar so
   *  it's obvious which one the reader landed on when several marks share the same viewport. */
  function flashHighlight(cfiRange: string, styleKind: HighlightStyleKind): void {
    const element = findMarkElement(cfiRange, styleKind)
    if (!element) return
    try {
      element.animate(
        [{ opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }],
        { duration: 900, easing: 'ease-in-out' },
      )
    } catch {
      /* Element.animate unavailable — the mark just won't pulse */
    }
  }

  /** Hit-test against each of a mark's own line-box children — mirrors marks-pane's own
   *  `Mark.getClientRects()` override (marks-pane/src/marks.js), which is NOT the native
   *  `Element.getClientRects()` (that returns just the group's single bounding box for SVG).
   *  Testing the group's bounding box alone would false-positive in the gap between two wrapped
   *  lines of a multi-line highlight. */
  function pointInMarkElement(element: SVGElement, outerX: number, outerY: number): boolean {
    let child = element.firstChild
    while (child) {
      if (child instanceof Element) {
        const r = child.getBoundingClientRect()
        if (outerX >= r.left && outerX <= r.right && outerY >= r.top && outerY <= r.bottom) {
          return true
        }
      }
      child = child.nextSibling
    }
    return false
  }

  /** Point-in-rect test for a `textbox` note's plain `<a>` icon (epub.js `mark()`, not an SVG
   *  group) — a single small element, unlike a highlight's per-line rects, so its own bounding
   *  box is all that's needed. */
  function pointInIconElement(element: Element, outerX: number, outerY: number): boolean {
    const r = element.getBoundingClientRect()
    return outerX >= r.left && outerX <= r.right && outerY >= r.top && outerY <= r.bottom
  }

  type MarkStore = Record<string, { element: SVGElement } | undefined>
  type IconStore = Record<string, { element: HTMLElement } | undefined>
  type MarkedView = { highlights?: MarkStore; underlines?: MarkStore; marks?: IconStore }

  function getHighlightAtPoint(outerX: number, outerY: number): EpubHighlightClickInfo | null {
    let found: EpubHighlightClickInfo | null = null
    const views = activeRendition.views() as unknown as {
      forEach: (cb: (view: MarkedView) => void) => void
    }
    views.forEach((view) => {
      if (found) return
      for (const store of [view.highlights, view.underlines]) {
        if (!store || found) continue
        for (const cfiRange in store) {
          const element = store[cfiRange]?.element
          const id = element?.getAttribute('data-id')
          if (!element || !id || !pointInMarkElement(element, outerX, outerY)) continue
          const rect = element.getBoundingClientRect()
          found = {
            id,
            cfiRange,
            rect: {
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            },
          }
          break
        }
      }
      if (found || !view.marks) return
      for (const cfiRange in view.marks) {
        const element = view.marks[cfiRange]?.element
        const id = element?.dataset.id
        if (!element || !id || !pointInIconElement(element, outerX, outerY)) continue
        const rect = element.getBoundingClientRect()
        found = {
          id,
          cfiRange,
          rect: {
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
        }
        break
      }
    })
    return found
  }

  let focusedMarkId: string | null = null
  function applyFocusedMarkClass(): void {
    const views = activeRendition.views() as unknown as {
      forEach: (cb: (view: MarkedView) => void) => void
    }
    views.forEach((view) => {
      for (const store of [view.highlights, view.underlines]) {
        if (!store) continue
        for (const cfiRange in store) {
          const element = store[cfiRange]?.element
          if (!element) continue
          element.classList.toggle(
            'rb-hl-focused',
            focusedMarkId != null && element.getAttribute('data-id') === focusedMarkId,
          )
        }
      }
      if (!view.marks) return
      for (const cfiRange in view.marks) {
        const element = view.marks[cfiRange]?.element
        if (!element) continue
        element.classList.toggle('rb-hl-focused', focusedMarkId != null && element.dataset.id === focusedMarkId)
      }
    })
  }

  function setFocusedHighlight(id: string | null): void {
    focusedMarkId = id
    applyFocusedMarkClass()
  }

  /**
   * epub.js's own `selected` event (below) only fires while a selection is being made or
   * extended — its underlying `selectionchange` handler in `Contents` explicitly skips
   * collapsed selections (see `contents.js`'s `triggerSelectedEvent`), so it never reports a
   * selection being *cleared*. A left click that collapses the current selection (without
   * starting a new one) would otherwise leave `onTextSelected`'s last non-null value — and the
   * floating toolbar — stuck on screen indefinitely. Watch `selectionchange` directly on
   * whichever section document last reported a real selection, and report a collapse the
   * moment it happens instead of waiting on a selection that will never come.
   */
  let selectionChangeDoc: Document | null = null
  const handleDocSelectionChange = () => {
    if (!selectionCb) return
    const sel = selectionChangeDoc?.defaultView?.getSelection()
    const collapsed = !sel || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed || !sel.toString().trim()
    if (collapsed) selectionCb(null)
  }
  function trackSelectionChangeDoc(doc: Document | null) {
    if (doc === selectionChangeDoc) return
    selectionChangeDoc?.removeEventListener('selectionchange', handleDocSelectionChange)
    selectionChangeDoc = doc
    selectionChangeDoc?.addEventListener('selectionchange', handleDocSelectionChange)
  }

  /** Track the iframe window that last reported a text selection, for `clearSelection`. */
  const handleSelected = (
    cfiRange: string,
    contents: { document?: Document; window?: Window },
  ) => {
    const win = contents.window ?? contents.document?.defaultView ?? null
    if (win) lastSelectionWindow = win
    trackSelectionChangeDoc(contents.document ?? win?.document ?? null)
    if (!selectionCb) return

    const sel = win?.getSelection()
    const text = sel?.toString()?.trim() ?? ''
    const iframe = host.querySelector('iframe')
    if (!text || !sel || sel.rangeCount === 0 || !iframe || !win) {
      selectionCb(null)
      return
    }
    const range = sel.getRangeAt(0)
    const localRect = range.getBoundingClientRect()
    if (localRect.width === 0 && localRect.height === 0) {
      selectionCb(null)
      return
    }
    selectionCb({ cfiRange, text, rect: toOuterRect(localRect, iframe, win), lang: selectionLang(range) })
  }

  const selectionLang = (range: Range): string => {
    const container = range.commonAncestorContainer
    const start = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement
    for (let el: Element | null = start; el; el = el.parentElement) {
      const lang = el.getAttribute('lang') || el.getAttribute('xml:lang')
      if (lang) return lang.trim()
    }
    const metadata = (book as unknown as { packaging?: { metadata?: { language?: unknown } } })
      .packaging?.metadata
    return typeof metadata?.language === 'string' ? metadata.language.trim() : ''
  }

  /**
   * Synchronous read of whatever text selection is live right now, bypassing epub.js's own
   * `selected` event entirely — that event only fires ~250ms after the selection *stops
   * changing*, which is fine for the right-click-menu/translate bookkeeping (`pendingSelection`)
   * but wrong for "commit the highlight the instant the mouse button comes up": at that exact
   * moment the debounced event may not have fired yet (a fast drag-release), or may be about to
   * fire again for a stale mid-drag extent. `EpubRenderer`'s pointerup handler calls this directly
   * instead of trusting whatever `onTextSelected` last delivered.
   */
  const getCurrentSelectionInfo = (): EpubSelectionInfo | null => {
    const contents = activeRendition.getContents() as unknown as
      | Array<{ document?: Document; window?: Window; sectionIndex?: number }>
      | undefined
    const EpubCFI = getEpubCFIConstructor()
    if (!EpubCFI) return null
    for (const content of contents ?? []) {
      const doc = content.document
      const win = content.window ?? doc?.defaultView ?? null
      if (!doc || !win) continue
      const sel = win.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) continue
      const text = sel.toString().trim()
      if (!text) continue
      const range = sel.getRangeAt(0)
      const localRect = range.getBoundingClientRect()
      if (localRect.width === 0 && localRect.height === 0) continue
      const iframe = (win.frameElement as HTMLIFrameElement | null) ?? host.querySelector('iframe')
      if (!iframe) continue
      const section =
        typeof content.sectionIndex === 'number'
          ? (book.spine.get(content.sectionIndex) as unknown as { cfiBase?: string } | undefined)
          : undefined
      if (typeof section?.cfiBase !== 'string') continue
      let cfiRange: string
      try {
        cfiRange = new EpubCFI(range, section.cfiBase).toString()
      } catch {
        continue
      }
      return { cfiRange, text, rect: toOuterRect(localRect, iframe, win), lang: selectionLang(range) }
    }
    return null
  }

  activeRendition.on('selected', handleSelected)
  activeRendition.on('rendered', applyFocusedMarkClass)
  activeRendition.on('rendered', repositionStrikethroughLines)
  // A view's `reframe()` (iframe.js) calls `pane.render()` directly whenever it resizes — e.g.
  // once images/fonts finish loading right after the initial `rendered` fires — which rebuilds
  // every underline's <line> from scratch at marks-pane's hardcoded bottom position, undoing the
  // reposition above. `resized` fires after those internal re-renders settle, so re-run there too.
  activeRendition.on('resized', repositionStrikethroughLines)

  /**
   * `activeRendition.resize()` and `activeRendition.display()` both mutate
   * the same epub.js ViewManager (clear views, re-measure columns, restore a
   * location). Two such calls running back-to-back — e.g. the host's
   * ResizeObserver firing `resizeToHost()` while a `goToLocation()` jump's
   * own display()/settle sequence is still in flight, which is exactly what
   * happens when chrome hides/shows or a sidebar opens right as the user
   * clicks "jump" — leave the manager's view list inconsistent
   * (stale column width / page height, split-column layout — see
   * docs/note/jump-to-location-bugfix-plan.md §3). `cancelResizeAnchor()`
   * only invalidates a pending *settle correction*; it does not stop a fresh
   * `resize()`/`display()` call from firing concurrently. Route every such
   * call through this queue instead so they run strictly one at a time — a
   * caller that arrives mid-operation just waits its turn rather than racing
   * it. The queue itself never rejects, so one failed op never wedges future
   * callers; each caller still observes its own call's rejection.
   */
  let renditionQueue: Promise<void> = Promise.resolve()
  function withRenditionLock<T>(run: () => T | Promise<T>): Promise<T> {
    const result = renditionQueue.then(run)
    renditionQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  let resizeAnchorToken = 0

  /**
   * Drop any pending anchor restore. Navigation that lands inside the *same*
   * section (a page turn, a page-scrub jump, a viewport scroll) is invisible to
   * the spine guard below, so every nav entry point must disown the anchor
   * explicitly or a late settle would yank the reader back.
   */
  const cancelResizeAnchor = () => {
    resizeAnchorToken += 1
  }

  /**
   * epub.js measures the anchor CFI's offset while the section it just
   * re-rendered is still reflowing, so the restore it runs from `resize()`
   * lands at the start of the section instead of the real position:
   * `view.locationOf()` resolves to a zero offset that `moveTo()` floors down
   * to column 0 — page 1 of the spine section. Wait for that layout to settle,
   * then re-issue the same display:
   * the section is already mounted, so epub.js takes its "already shown" fast
   * path and recomputes the offset against the now-stable layout — the same
   * correction `goToLocation` makes for jumps.
   */
  const settleResizeAnchor = async (cfi: string): Promise<void> => {
    const token = (resizeAnchorToken += 1)
    const anchorSpine = spineIndexFromCfi(book, cfi, fallbackSpine)
    // Let epub.js's own resize-triggered display() finish first — see
    // waitForRenditionDisplayed.
    await waitForRenditionDisplayed(activeRendition)
    if (token !== resizeAnchorToken) return
    await waitForSectionResources(currentSectionDocument(activeRendition))
    await waitForFrames(2)
    // A newer resize owns the position now.
    if (token !== resizeAnchorToken) return
    // A TOC jump / page nav landed elsewhere while the layout settled — that
    // is the reader's intent, so never drag them back to the pre-resize spot.
    if (currentSpineIndex() !== anchorSpine) return
    try {
      await displayCfiTrusted(activeRendition, cfi, anchorSpine)
      await waitForFrames(2)
      if (token !== resizeAnchorToken) return
      activeRendition.reportLocation()
    } catch {
      /* rendition torn down mid-resize */
    }
  }

  /**
   * `manager.resize()` clears every view and scrolls the container back to the
   * top, then restores the reading position from `rendition.location.start.cfi`
   * — the very field `readRenditionLocation()` exists to work around, because
   * epub.js does not always keep it populated. When it is empty nothing
   * restores the scroll and the reader silently lands at the start of the book,
   * so resolve the anchor CFI here and hand it to epub.js explicitly.
   */
  const resizeToHost = (intent: 'preserve' | 'reflow' = 'preserve') => {
    const { width, height } = readHostLayoutSize(host)
    if (width <= 0 || height <= 0) return

    // `reflow` is the mid-navigation recovery resize: the caller is about to
    // move the reader itself, so pinning the pre-resize position would fight
    // the turn it is trying to unstick.
    if (intent === 'reflow') {
      cancelResizeAnchor()
      void withRenditionLock(() => {
        activeRendition.resize(width, height)
      })
      return
    }

    const anchorCfi = cfiFromLocation(readRenditionLocation())
    void withRenditionLock(async () => {
      // epub.js accepts a third `epubcfi` restore anchor that its bundled
      // typings omit.
      const resizeWithAnchor = activeRendition as unknown as {
        resize: (width: number, height: number, epubcfi?: string) => void
      }
      resizeWithAnchor.resize(width, height, anchorCfi || undefined)
      // Settle runs under the same lock slot as the resize that scheduled it,
      // so a second resize/jump queued behind this call only starts once the
      // correction below has actually finished (or bailed via the token
      // check) — never mid-correction.
      if (anchorCfi) await settleResizeAnchor(anchorCfi)
      else cancelResizeAnchor()
    })
  }

  const getSpineLength = () => spineLengthOf(book)
  const hasSpineCover = () => {
    const length = spineLengthOf(book)
    for (let index = 0; index < length; index += 1) {
      const section = book.spine.get(index) as SpineSectionLike | undefined
      if (isCoverSection(section, book)) return true
    }
    return false
  }
  const getToc = () =>
    normalizeTocItems(
      (book as unknown as { navigation?: { toc?: unknown } }).navigation?.toc,
    )

  const getSectionLabels = (): string[] => {
    const toc = getToc()
    return Array.from({ length: spineLengthOf(book) }, (_, index) => {
      const href = book.spine.get(index)?.href ?? ''
      return (
        resolveTocLocationLabel(href, toc) ||
        (href ? basenameLabel(href) : '') ||
        `Section ${index + 1}`
      )
    })
  }

  const currentSpineIndex = (): number => {
    const start = activeRendition.location?.start
    if (start && typeof start.index === 'number') return start.index
    return 0
  }

  // `getSectionLabels()` walks the whole TOC once per call; the excerpt
  // cache needs a label per lookup, so memoize the array once (the TOC
  // never changes across a book's open lifetime) instead of recomputing it
  // per spine index.
  let sectionLabelsCache: string[] | null = null
  const sectionLabelsOnce = (): string[] => {
    if (!sectionLabelsCache) sectionLabelsCache = getSectionLabels()
    return sectionLabelsCache
  }
  const spineExcerptCache = createSpineExcerptCache(book, {
    getLabel: (index) => sectionLabelsOnce()[index] ?? `Section ${index + 1}`,
    excludeIndex: currentSpineIndex,
  })

  const goToSpineIndex = async (index: number) => {
    const n = spineLengthOf(book)
    if (n <= 0) return
    cancelResizeAnchor()
    const clamped = Math.min(Math.max(Math.round(index), 0), n - 1)
    await activeRendition.display(clamped)
  }

  const goToHref = async (href: string) => {
    if (!href) return
    cancelResizeAnchor()
    await activeRendition.display(href)
  }

  const readRenditionLocation = (): unknown => {
    const prop = activeRendition.location
    if (prop?.start) return prop
    const method = (
      activeRendition as unknown as {
        currentLocation?: () => unknown
      }
    ).currentLocation
    if (typeof method === 'function') {
      try {
        return method.call(activeRendition)
      } catch {
        return undefined
      }
    }
    return prop
  }

  const goToLocationPage = async (page: number) => {
    cancelResizeAnchor()
    const { spineIndex, sectionPage } = paginationTracker.resolveTargetPage(page)
    const currentSpine = currentSpineIndex()
    const displayed = currentDisplayedBoundary()
    const currentSectionP = displayed?.page ?? 1
    const delta = getRenditionLayoutDelta(activeRendition)

    const moveRenditionToOffset = (left: number) => {
      const targetRendition = activeRendition as unknown as {
        moveTo?: (offset: { top: number; left: number }) => void
      }
      targetRendition.moveTo?.({ top: 0, left })
    }

    if (spineIndex === currentSpine) {
      if (sectionPage === currentSectionP) return
      if (delta > 0) {
        moveRenditionToOffset((sectionPage - 1) * delta)
        await waitForFrames(2)
        activeRendition.reportLocation()
      }
      return
    }

    await activeRendition.display(spineIndex)
    await waitForFrames(2)
    if (sectionPage > 1) {
      const updatedDelta = getRenditionLayoutDelta(activeRendition) || delta
      if (updatedDelta > 0) {
        moveRenditionToOffset((sectionPage - 1) * updatedDelta)
        await waitForFrames(2)
        activeRendition.reportLocation()
      }
    }
  }

  const getCurrentLocation = (): CfiLocation | undefined =>
    tryEncodeCfi(readRenditionLocation())

  const getCurrentExcerpt = (): string | undefined => {
    const doc = currentSectionDocument(activeRendition)
    if (!doc) return undefined
    const excerpt = extractExcerpt(doc, EXCERPT_MAX_CHARS)
    return excerpt || undefined
  }

  const goToLocation = async (location: CfiLocation): Promise<void> => {
    cancelResizeAnchor()
    const decoded = cfiCodec.decode(location) as EpubCfiDecodeResult
    const fallbackSpine = currentSpineIndex()
    // Resolve the target spine index up front (outside the lock, no
    // epub.js call yet) so the forced-reload step below has it ready.
    const targetDisplayCfi = toEpubjsDisplayCfi(decoded.cfi)
    const targetIndex = targetDisplayCfi
      ? spineIndexFromCfi(book, targetDisplayCfi, fallbackSpine)
      : fallbackSpine
    // Whole sequence — including the fallback catch below — runs under the
    // shared rendition lock (see its declaration) so a resize racing this
    // jump (chrome hide/show, sidebar toggle) queues behind it instead of
    // mutating the ViewManager concurrently.
    await withRenditionLock(async () => {
      await withCfiJumpTimeout(async () => {
        // Force a fresh full-section (re)load by spine index before
        // landing on the precise CFI offset, even when the target section
        // is already mounted — an already-mounted section takes epub.js's
        // "already shown" fast path on the calls below, which reuses that
        // section's cached column-width/page-height instead of
        // recomputing it against the host's CURRENT size.
        await withEpubjsStartContainerLogMutedAsync(() =>
          activeRendition.display(targetIndex),
        )
        await displayCfiSafely(book, activeRendition, decoded.cfi, fallbackSpine)
        // epub.js computes the CFI's on-page offset (view.locationOf / column
        // math) right after the target section is attached to the DOM — before the
        // browser has finished reflow (fonts/images/layout) — so the first jump often
        // lands at the top of the section instead of the real offset, which is why
        // deep-linking into an annotation reads as "always jumps to the top of the
        // chapter". A manual second jump
        // "fixes" it because the section's layout has settled by then; wait for that
        // settle, then re-issue the same display(): the section is already mounted, so
        // epub.js takes its "already shown" fast path, recomputes the position against
        // the now-stable layout — the same effect as the manual second click, for free.
        await waitForSectionResources(currentSectionDocument(activeRendition))
        await waitForFrames(2)
        await displayCfiSafely(book, activeRendition, decoded.cfi, fallbackSpine)
        await waitForFrames(2)
        activeRendition.reportLocation()
      })
    })
  }

  // --- In-book search (see search/epubSearchDom.ts) -------------------------------------------

  let searchMatcher: TextMatcher | null = null
  /** The match last jumped to; `spineIndex` because a CFI's in-document path resolves in ANY doc. */
  let searchCurrent: { spineIndex: number; cfi: string } | null = null

  /**
   * Repaint hits in every mounted section view. Cheap: re-matches ~one chapter of text.
   *
   * Wrapped in try/catch per section: this runs on epub.js's `rendered` event, on the SAME
   * rendition `EpubRenderer.tsx` later registers its own `rendered` listener on (the one that
   * calls `attachFrameListeners` to wire up `contextmenu`/`pointerdown` for the new section's
   * iframe — see `attachOnRendered` there). epub.js's emitter runs listeners for one event in
   * registration order with no isolation between them, and this one is registered first (inside
   * `openEpubjs`, before the handle is even returned to the caller). An uncaught throw here — a
   * malformed section's text/CFI, a document mid-teardown — would propagate out of `emit()` and
   * skip every listener registered after it for that same event, silently leaving the new
   * section's right-click/drag-to-select handlers never attached with no error visible at the
   * call site that looks broken.
   */
  const applySearchHighlights = () => {
    const contents = activeRendition.getContents() as unknown as
      | Array<{ document?: Document; sectionIndex?: number }>
      | undefined
    const EpubCFI = getEpubCFIConstructor()
    for (const content of contents ?? []) {
      const doc = content.document
      if (!doc) continue
      try {
        if (!searchMatcher) {
          clearSearchHighlights(doc)
          continue
        }
        const { index, matches } = findSectionMatches(doc, searchMatcher)
        const ranges = matches
          .map((match) => rangeForMatch(doc, index, match))
          .filter((range): range is Range => range !== null)
        let current: Range | null = null
        if (searchCurrent && EpubCFI && searchCurrent.spineIndex === content.sectionIndex) {
          try {
            current = new EpubCFI(searchCurrent.cfi).toRange(doc)
          } catch {
            current = null
          }
        }
        paintSearchHighlights(doc, ranges, current)
      } catch (err) {
        console.error('[epub] applySearchHighlights failed for a section', err)
      }
    }
  }
  activeRendition.on('rendered', applySearchHighlights)

  /** Run `read` on the section's document: the live one when mounted, else an off-DOM load. */
  const withSectionDocument = async <T,>(
    spineIndex: number,
    read: (doc: Document, cfiBase: string) => T,
  ): Promise<T | null> => {
    const section = book.spine.get(spineIndex) as unknown as
      | {
          cfiBase?: string
          document?: Document
          load: (request?: (url: string) => Promise<unknown>) => Promise<unknown>
          unload: () => void
        }
      | undefined
    if (!section || typeof section.cfiBase !== 'string') return null

    const contents = activeRendition.getContents() as unknown as
      | Array<{ document?: Document; sectionIndex?: number }>
      | undefined
    const live = contents?.find((c) => c.sectionIndex === spineIndex)?.document
    if (live) return read(live, section.cfiBase)

    try {
      await section.load(book.load.bind(book))
      return section.document ? read(section.document, section.cfiBase) : null
    } catch {
      return null
    } finally {
      // Same rule as the excerpt cache: never unload a section that became the displayed one.
      if (currentSpineIndex() !== spineIndex) {
        try {
          section.unload()
        } catch {
          /* best-effort cleanup only */
        }
      }
    }
  }

  const setSearchHighlights = (matcher: TextMatcher | null) => {
    searchMatcher = matcher
    // A new hit set never inherits the previous query's "current" hit; goToSearchMatch sets it.
    searchCurrent = null
    applySearchHighlights()
  }

  const goToSearchMatch = async (target: EpubSearchTarget): Promise<boolean> => {
    const matcher = searchMatcher
    const EpubCFI = getEpubCFIConstructor()
    const cfi =
      matcher && EpubCFI
        ? await withSectionDocument(target.spineIndex, (doc, cfiBase) => {
            const { index, matches } = findSectionMatches(doc, matcher)
            const match = pickSectionMatch(matches, target.occurrence, target.count)
            const range = match ? rangeForMatch(doc, index, match) : null
            return range ? new EpubCFI(range, cfiBase).toString() : null
          })
        : null

    if (!cfi) {
      // Text not found in the rendered markup — at least open the right chapter.
      searchCurrent = null
      await goToSpineIndex(target.spineIndex)
      applySearchHighlights()
      return false
    }
    searchCurrent = { spineIndex: target.spineIndex, cfi }
    await goToLocation(new CfiLocation(cfi))
    applySearchHighlights()
    return true
  }

  // --- Read aloud (see readAloud/epubReadAloudDom.ts) -----------------------------------------

  let readAloudCursor: { spineIndex: number; index: number } | null = null

  const liveSectionDocument = (spineIndex: number): Document | null => {
    const contents = activeRendition.getContents() as unknown as
      | Array<{ document?: Document; sectionIndex?: number }>
      | undefined
    return contents?.find((c) => c.sectionIndex === spineIndex)?.document ?? null
  }

  const readAloudLang = (doc: Document): string => {
    const metadata = (book as unknown as { packaging?: { metadata?: { language?: unknown } } })
      .packaging?.metadata
    const bookLang = typeof metadata?.language === 'string' ? metadata.language : ''
    return (
      doc.documentElement.getAttribute('lang') ||
      doc.documentElement.getAttribute('xml:lang') ||
      bookLang ||
      navigator.language
    ).trim()
  }

  /** Text offsets of the visible range's start/end in `doc`, from epub.js's located CFIs. */
  const visibleTextBounds = (
    doc: Document,
    index: Parameters<typeof textOffsetOfBoundary>[1],
  ): { start: number; end: number } | null => {
    const EpubCFI = getEpubCFIConstructor()
    const location = readRenditionLocation() as
      | { start?: { cfi?: string }; end?: { cfi?: string } }
      | undefined
    const startCfi = location?.start?.cfi
    const endCfi = location?.end?.cfi
    if (!EpubCFI || !startCfi || !endCfi) return null
    const toRange = (cfi: string): Range | null => {
      try {
        return new EpubCFI(cfi).toRange(doc) ?? resolveCfiRange(doc, cfi)
      } catch {
        return resolveCfiRange(doc, cfi)
      }
    }
    const startRange = toRange(startCfi)
    const endRange = toRange(endCfi)
    if (!startRange || !endRange) return null
    return {
      start: textOffsetOfBoundary(doc, index, startRange.startContainer, startRange.startOffset),
      end: textOffsetOfBoundary(doc, index, endRange.endContainer, endRange.endOffset),
    }
  }

  /** Same isolation rationale as `applySearchHighlights` above — never let a bad section block
   *  `EpubRenderer.tsx`'s own `rendered` listener (`attachOnRendered`) that wires up
   *  right-click/drag-to-select for the newly rendered section. */
  const applyReadAloudHighlight = () => {
    const contents = activeRendition.getContents() as unknown as
      | Array<{ document?: Document; sectionIndex?: number }>
      | undefined
    for (const content of contents ?? []) {
      const doc = content.document
      if (!doc) continue
      try {
        if (!readAloudCursor || readAloudCursor.spineIndex !== content.sectionIndex) {
          paintReadAloudHighlight(doc, null)
          continue
        }
        const data = readAloudDataFor(doc, readAloudLang(doc))
        paintReadAloudHighlight(doc, rangeForSegment(doc, data, readAloudCursor.index))
      } catch (err) {
        console.error('[epub] applyReadAloudHighlight failed for a section', err)
      }
    }
  }
  activeRendition.on('rendered', applyReadAloudHighlight)

  const getReadAloudSegments = (mode: ReadAloudMode): ReadAloudSection | null => {
    const spineIndex = currentSpineIndex()
    const doc = liveSectionDocument(spineIndex)
    if (!doc) return null
    const lang = readAloudLang(doc)
    const data = readAloudDataFor(doc, lang)
    const segments = data.segments.map((s) => s.text)
    let startIndex = 0
    let endIndex = segments.length
    if (mode !== 'section') {
      const bounds = visibleTextBounds(doc, data.index)
      if (bounds) {
        const first = data.segments.findIndex((s) => s.end > bounds.start)
        startIndex = first < 0 ? segments.length : first
        if (mode === 'viewport') {
          const after = data.segments.findIndex((s) => s.start >= bounds.end)
          endIndex = Math.max(startIndex, after < 0 ? segments.length : after)
        }
      }
    }
    return { spineIndex, lang, segments, startIndex, endIndex }
  }

  /** 'elsewhere' = another section is displayed, or the reader paged away from the segment. */
  const readAloudSegmentPlacement = (
    spineIndex: number,
    index: number,
  ): 'visible' | 'after' | 'elsewhere' => {
    if (currentSpineIndex() !== spineIndex) return 'elsewhere'
    const doc = liveSectionDocument(spineIndex)
    if (!doc) return 'elsewhere'
    const data = readAloudDataFor(doc, readAloudLang(doc))
    const segment = data.segments[index]
    const bounds = visibleTextBounds(doc, data.index)
    // Can't tell where the view is — leave it alone rather than jump around.
    if (!segment || !bounds) return 'visible'
    if (segment.start < bounds.end && segment.end > bounds.start) return 'visible'
    return segment.start >= bounds.end ? 'after' : 'elsewhere'
  }

  const jumpToReadAloudSegment = async (spineIndex: number, index: number) => {
    if (currentSpineIndex() !== spineIndex) await goToSpineIndex(spineIndex)
    const doc = liveSectionDocument(spineIndex)
    const section = book.spine.get(spineIndex) as unknown as { cfiBase?: string } | undefined
    const EpubCFI = getEpubCFIConstructor()
    if (!doc || !EpubCFI || typeof section?.cfiBase !== 'string') return
    const range = rangeForSegment(doc, readAloudDataFor(doc, readAloudLang(doc)), index)
    if (range) await goToLocation(new CfiLocation(new EpubCFI(range, section.cfiBase).toString()))
  }

  /** Normal follow is one page turn; anything further (reader navigated away) is a direct jump. */
  const revealReadAloudSegment = async (spineIndex: number, index: number) => {
    let placement = readAloudSegmentPlacement(spineIndex, index)
    if (placement === 'visible') return
    if (placement === 'after') {
      await nextPage()
      placement = readAloudSegmentPlacement(spineIndex, index)
      if (placement === 'visible') return
    }
    await jumpToReadAloudSegment(spineIndex, index)
  }

  const setReadAloudCursor = async (cursor: { spineIndex: number; index: number } | null) => {
    readAloudCursor = cursor
    applyReadAloudHighlight()
    if (!cursor) return
    await revealReadAloudSegment(cursor.spineIndex, cursor.index)
    // A page turn into a freshly rendered view needs the highlight re-applied.
    if (readAloudCursor === cursor) applyReadAloudHighlight()
  }

  // Keep teardown on abort: this runs after `settled`, so onAbort no longer destroys.
  try {
    if (initialLocation) {
      const decoded = cfiCodec.decode(initialLocation) as EpubCfiDecodeResult
      const resumeSpineIndex = spineIndexFromCfi(
        book,
        decoded.cfi,
        fallbackSpine,
      )
      await ensureInitialPaint(
        host,
        activeRendition,
        fallbackSpine,
        signal,
        openToken,
        {
          resume: true,
          resumeRetry: {
            book,
            cfi: decoded.cfi,
            spineIndex: resumeSpineIndex,
          },
        },
      )
    }
  } catch (err) {
    destroyBook()
    throw err
  }

  const currentLocationSignature = (): string => {
    const start = (
      readRenditionLocation() as
        | {
            start?: {
              index?: number
              cfi?: string
              displayed?: { page?: number; total?: number }
            }
          }
        | undefined
    )?.start
    return JSON.stringify({
      index: start?.index,
      cfi: start?.cfi,
      page: start?.displayed?.page,
      total: start?.displayed?.total,
    })
  }

  const currentDisplayedBoundary = (): {
    page: number
    total: number
  } | null => {
    const displayed = (
      readRenditionLocation() as
        | {
            start?: {
              displayed?: { page?: number; total?: number }
            }
          }
        | undefined
    )?.start?.displayed
    if (
      typeof displayed?.page !== 'number' ||
      !Number.isFinite(displayed.page) ||
      typeof displayed.total !== 'number' ||
      !Number.isFinite(displayed.total) ||
      displayed.page < 1 ||
      displayed.total < 1
    ) {
      return null
    }
    return {
      page: Math.floor(displayed.page),
      total: Math.floor(displayed.total),
    }
  }

  const scheduleFullPaginationRemeasure = () => {
    // CSS-column page counts have no meaning in scroll mode — skip the whole
    // hidden-measurement pipeline instead of adapting it to a metric it was
    // never designed for.
    if (viewMode === 'scroll') return
    paginationTracker.invalidate()
    // `applySettings` can reach this synchronously from EpubRenderer's render
    // body (`syncEpubAppearance` is a plain function call in render, not an
    // effect) — publishing straight through would call the parent's
    // `onNavState` setState while EpubRenderer is still rendering. Deferring
    // one microtask moves it just past the current render without changing
    // when the caller perceives "locations ready" (still well before the
    // async hidden-measurement below can possibly resolve).
    queueMicrotask(publishLocationsReady)
    startHiddenPaginationMeasure()
  }

  const nextPage = async () => {
    cancelResizeAnchor()
    const beforeLocation = currentLocationSignature()
    const beforeSpine = currentSpineIndex()
    await activeRendition.next()
    await waitForFrames(2)
    if (currentLocationSignature() !== beforeLocation) return

    const resourcesReady = await waitForSectionResources(
      currentSectionDocument(activeRendition),
    )
    resizeToHost('reflow')
    await waitForFrames(2)
    await activeRendition.next()
    await waitForFrames(2)
    if (currentLocationSignature() !== beforeLocation) return

    // In scroll mode epub.js's own vertical-axis next() already resolves
    // `views.last().section.next()` once it reaches the section's real DOM
    // bottom (verified against epubjs's `managers/default` next()/prev()).
    // The `displayed.page >= displayed.total` self-heal below was tuned for
    // paginated CSS-column no-ops and is not meaningful here.
    if (viewMode === 'scroll') return

    const displayed = currentDisplayedBoundary()
    if (
      resourcesReady &&
      displayed &&
      displayed.page >= displayed.total &&
      currentSpineIndex() === beforeSpine &&
      beforeSpine < getSpineLength() - 1
    ) {
      await goToSpineIndex(beforeSpine + 1)
    }
  }
  const prevPage = async () => {
    cancelResizeAnchor()
    const beforeLocation = currentLocationSignature()
    const beforeSpine = currentSpineIndex()
    await activeRendition.prev()
    await waitForFrames(2)
    if (currentLocationSignature() !== beforeLocation) return

    const resourcesReady = await waitForSectionResources(
      currentSectionDocument(activeRendition),
    )
    resizeToHost('reflow')
    await waitForFrames(2)
    await activeRendition.prev()
    await waitForFrames(2)
    if (currentLocationSignature() !== beforeLocation) return

    if (viewMode === 'scroll') return

    const displayed = currentDisplayedBoundary()
    if (
      resourcesReady &&
      displayed &&
      displayed.page <= 1 &&
      currentSpineIndex() === beforeSpine &&
      beforeSpine > 0
    ) {
      await goToSpineIndex(beforeSpine - 1)
    }
  }

  return {
    book,
    rendition: activeRendition,
    hasSpineCover,
    destroy: () => {
      paginationAbort?.abort()
      paginationAbort = null
      spineExcerptCache.dispose()
      try {
        activeRendition.off('selected', handleSelected)
        activeRendition.off('rendered', applyFocusedMarkClass)
        activeRendition.off('rendered', repositionStrikethroughLines)
        activeRendition.off('resized', repositionStrikethroughLines)
        activeRendition.off('rendered', applySearchHighlights)
        activeRendition.off('rendered', applyReadAloudHighlight)
        trackSelectionChangeDoc(null)
      } catch {
        /* ignore */
      }
      lastSelectionWindow = null
      selectionCb = null
      focusedMarkId = null
      strikethroughCfiRanges.clear()
      stopRenditionQueue(activeRendition)
      destroyBook()
    },
    next: nextPage,
    prev: prevPage,
    nextPage,
    prevPage,
    isAtScrollBoundary: (direction) =>
      isAtVerticalScrollBoundary(activeRendition, direction),
    nextSection: async () => {
      await goToSpineIndex(currentSpineIndex() + 1)
    },
    prevSection: async () => {
      await goToSpineIndex(currentSpineIndex() - 1)
    },
    goToHref,
    goToSpineIndex,
    goToLocationPage: (page: number) => {
      // Absolute page-number navigation is a paginated-only concept — there is
      // no CSS page count to resolve against once pagination measurement is
      // skipped in scroll mode (see `scheduleFullPaginationRemeasure`).
      if (viewMode === 'scroll') return Promise.resolve()
      return goToLocationPage(page)
    },
    getSpineLength,
    getCurrentLocation,
    getSpineExcerpt: spineExcerptCache.get,
    prefetchSpineExcerpts: spineExcerptCache.prefetchAround,
    getCurrentExcerpt,
    goToLocation,
    clearSelection: () => {
      try {
        lastSelectionWindow?.getSelection()?.removeAllRanges()
      } catch {
        /* ignore */
      }
      host.querySelectorAll('iframe').forEach((frame) => {
        try {
          frame.contentWindow?.getSelection()?.removeAllRanges()
        } catch {
          /* ignore */
        }
      })
    },
    getNavState: () => {
      const location = readRenditionLocation()
      const displayed = displayedPagesFromLocation(location)
      const cfi = cfiFromLocation(location)
      const currentSpine = currentSpineIndex()

      const metrics = paginationTracker.getNavMetrics(
        currentSpine,
        displayed.page,
        displayed.total,
      )
      return buildEpubNavState(
        book,
        currentSpine,
        getToc(),
        displayed,
        cfi,
        metrics,
      )
    },
    getToc,
    getSectionLabels,
    setTheme: (next) => {
      applyEpubThemeVars(activeRendition, next)
    },
    setLayout: (next) => {
      layout = next
      activeRendition.spread(spreadForLayout(next))
      applyDualSpreadHost(host, next)
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setFontSize: (px) => {
      activeFontSize = px
      applyEpubFontSize(activeRendition, px)
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setFontFamily: (fontFamily) => {
      activeReadingStyle = { ...activeReadingStyle, fontFamily }
      applyEpubReadingStyle(activeRendition, { fontFamily })
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setFontWeight: (fontWeight) => {
      activeReadingStyle = { ...activeReadingStyle, fontWeight }
      applyEpubReadingStyle(activeRendition, { fontWeight })
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setLineHeight: (lineHeight) => {
      activeReadingStyle = { ...activeReadingStyle, lineHeight }
      applyEpubReadingStyle(activeRendition, { lineHeight })
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setTextAlign: (textAlign) => {
      activeReadingStyle = { ...activeReadingStyle, textAlign }
      applyEpubReadingStyle(activeRendition, { textAlign })
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setMargins: (marginsEnabled, marginPreset) => {
      activeReadingStyle = { ...activeReadingStyle, marginsEnabled, marginPreset }
      applyEpubReadingStyle(activeRendition, { marginsEnabled, marginPreset })
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    setChromeHidden: (chromeHidden) => {
      activeReadingStyle = { ...activeReadingStyle, chromeHidden }
      applyEpubReadingStyle(activeRendition, { chromeHidden })
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    applySettings: (patch) => {
      if (destroyed || signal?.aborted) return false

      // Theme is a pure CSS-variable swap — it never changes text metrics, so
      // it must not drag a relayout in with it.
      let needsReflow = false
      const readingStylePatch: Partial<EpubReadingStyle> = {}

      try {
        if (patch.theme !== undefined) {
          applyEpubThemeVars(activeRendition, patch.theme)
        }

        if (patch.layout !== undefined && patch.layout !== layout) {
          layout = patch.layout
          activeRendition.spread(spreadForLayout(layout))
          applyDualSpreadHost(host, layout)
          needsReflow = true
        }

        if (patch.viewMode !== undefined && patch.viewMode !== viewMode) {
          // Isolated try/catch, separate from the outer one: a failed flow
          // switch must not discard style changes already applied above in
          // this same patch, and must not leave `viewMode` pointing at a
          // mode epub.js never actually adopted.
          const previousViewMode = viewMode
          try {
            activeRendition.flow(flowForViewMode(patch.viewMode))
            viewMode = patch.viewMode
            needsReflow = true
          } catch (err) {
            console.warn('[epub settings] view mode switch failed, keeping previous mode', err)
            viewMode = previousViewMode
          }
        }

        if (patch.fontSize !== undefined && patch.fontSize !== activeFontSize) {
          activeFontSize = patch.fontSize
          applyEpubFontSize(activeRendition, patch.fontSize)
          needsReflow = true
        }

        // Collect every reading-style field into one CSS write instead of one
        // write (plus reflow) per field.
        if (
          patch.fontFamily !== undefined &&
          patch.fontFamily !== activeReadingStyle.fontFamily
        ) {
          readingStylePatch.fontFamily = patch.fontFamily
        }
        if (
          patch.fontWeight !== undefined &&
          patch.fontWeight !== activeReadingStyle.fontWeight
        ) {
          readingStylePatch.fontWeight = patch.fontWeight
        }
        if (
          patch.lineHeight !== undefined &&
          patch.lineHeight !== activeReadingStyle.lineHeight
        ) {
          readingStylePatch.lineHeight = patch.lineHeight
        }
        if (
          patch.textAlign !== undefined &&
          patch.textAlign !== activeReadingStyle.textAlign
        ) {
          readingStylePatch.textAlign = patch.textAlign
        }
        if (
          patch.marginsEnabled !== undefined &&
          patch.marginsEnabled !== activeReadingStyle.marginsEnabled
        ) {
          readingStylePatch.marginsEnabled = patch.marginsEnabled
        }
        if (
          patch.marginPreset !== undefined &&
          patch.marginPreset !== activeReadingStyle.marginPreset
        ) {
          readingStylePatch.marginPreset = patch.marginPreset
        }
        if (
          patch.chromeHidden !== undefined &&
          patch.chromeHidden !== activeReadingStyle.chromeHidden
        ) {
          readingStylePatch.chromeHidden = patch.chromeHidden
        }

        if (Object.keys(readingStylePatch).length > 0) {
          activeReadingStyle = { ...activeReadingStyle, ...readingStylePatch }
          applyEpubReadingStyle(activeRendition, readingStylePatch)
          needsReflow = true
        }
      } catch (err) {
        // A torn-down iframe mid-apply must not take the reader down with it.
        console.warn('[epub settings] apply failed', err)
        return false
      }

      if (!needsReflow) return true

      try {
        resizeToHost()
        scheduleFullPaginationRemeasure()
      } catch (err) {
        // Styles already landed; only the reflow failed. Report success so the
        // caller does not replay the same styles, and let the next resize or
        // relocate settle pagination.
        console.warn('[epub settings] reflow after apply failed', err)
      }
      return true
    },
    resize: () => {
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
    debugResolveCfiRect: (cfi) => {
      try {
        const EpubCFI = getEpubCFIConstructor()
        if (!EpubCFI) return null
        const doc = currentSectionDocument(activeRendition)
        if (!doc) return null
        const range = new EpubCFI(cfi.trim()).toRange(doc)
        if (!range) return null
        const rect = range.getBoundingClientRect()
        const iframe = host.querySelector('iframe')
        const iframeRect = iframe?.getBoundingClientRect()
        if (!iframeRect) return null
        return { rect, iframeRect }
      } catch {
        return null
      }
    },
    applyHighlight,
    removeHighlight,
    flashHighlight,
    getHighlightAtPoint,
    setFocusedHighlight,
    setSearchHighlights,
    goToSearchMatch,
    getReadAloudSegments,
    setReadAloudCursor,
    onTextSelected: (cb) => {
      selectionCb = cb
      return () => {
        if (selectionCb === cb) selectionCb = null
      }
    },
    getCurrentSelectionInfo,
  }
}

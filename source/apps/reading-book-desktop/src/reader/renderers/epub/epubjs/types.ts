/**
 * Public types of the epub.js engine wrapper: the handle `openEpubjs()` returns, its options,
 * and the nav / selection / search / read-aloud shapes that cross into React.
 */
import type { Book, Rendition } from 'epubjs'
import type {
  CfiLocation,
  FontFamily,
  FontWeight,
  HighlightStyleKind,
  ReaderTheme,
  TextAlign,
  TextMatcher,
} from '@reading-book/book-reader-sdk'
import type { SpineExcerpt } from '../previews/spineExcerptCache'

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
  /**
   * Jump to the very end of the book: the last page of the last spine section (paginated) or the
   * bottom of it (scroll). Resolves true only once the reader is really there — never merely at the
   * start of the last section.
   */
  goToEnd: () => Promise<boolean>
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

export type { SpineExcerpt } from '../previews/spineExcerptCache'

/** A match as Main counted it: the `occurrence`-th (0-based) of `count` in spine section `spineIndex`. */
export type EpubSearchTarget = {
  spineIndex: number
  occurrence: number
  count: number
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

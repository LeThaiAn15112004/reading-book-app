import ePubImport, { type Book, type Rendition } from 'epubjs'
import { CfiLocation } from '@reading-book/domain'
import {
  READER_THEME_COLORS,
  fontFamilyCss,
  type FontFamily,
  type FontWeight,
  type HighlightHandleRect,
  type ReaderTheme,
  type TextAlign,
} from '@reading-book/shared/models'
import { DomCssOverlay } from '../../overlays/dom-css-overlay'
import { cfiCodec, tryEncodeCfi, type EpubCfiDecodeResult } from './cfi-codec'
import { spineIndexFromCfiPath } from '@reading-book/shared/utils'
import {
  isTrivialSectionStartCfi,
  withEpubjsStartContainerLogMuted,
  withEpubjsStartContainerLogMutedAsync,
} from './cfi-dom-range'
import {
  captureHostPreview,
  documentToPreviewDataUrl,
  PREVIEW_THUMB_MAX_HEIGHT,
  PREVIEW_THUMB_MAX_WIDTH,
  wrapSpinePreviewHtml,
} from './capture-page-preview'
import {
  rangeToHighlightHandleRect,
  splitCfiRange,
  toEpubjsDisplayCfi,
} from './selection-cfi'

/** Vite/CJS interop: default may be the ePub fn or a module namespace. */
const ePub =
  typeof ePubImport === 'function'
    ? ePubImport
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ePubImport as any).default

export type EpubPageLayout = 'single' | 'dual' | 'triple'
export type EpubPageMode = 'scroll' | 'paginated'

/**
 * Coarse location for footer scrub / UI label.
 * Persist uses CFI via getCurrentLocation() (T4.1) — not spine index.
 */
export type EpubNavState = {
  spineIndex: number
  spineLength: number
  /** 1-based spine page for UI (“3 / 42”). */
  pageCurrent: number
  pageTotal: number
  href: string
  label: string
  /** 0..1 from spine index (length 1 → 0). */
  progress: number
}

export type EpubTocItem = {
  id: string
  label: string
  href: string
  level: number
  children: EpubTocItem[]
}

export interface EpubjsHandle {
  book: Book
  rendition: Rendition
  /** DomCssOverlay painter bound to this rendition (T5.3). */
  overlayPainter: DomCssOverlay
  /** Whether the EPUB already exposes a cover document in its reading spine. */
  hasSpineCover: () => boolean
  destroy: () => void
  next: () => Promise<void>
  prev: () => Promise<void>
  nextPage: () => Promise<void>
  prevPage: () => Promise<void>
  nextSection: () => Promise<void>
  prevSection: () => Promise<void>
  goToHref: (href: string) => Promise<void>
  goToSpineIndex: (index: number) => Promise<void>
  getSpineLength: () => number
  getNavState: () => EpubNavState
  getToc: () => EpubTocItem[]
  /** Stable CFI location for persist/resume (T4.1). Undefined until relocated. */
  getCurrentLocation: () => CfiLocation | undefined
  /** Jump to a stored CFI location (T4.1 / FR-05 resume). */
  goToLocation: (location: CfiLocation) => Promise<void>
  /** Clear text selection in the last EPUB iframe that reported a selection (T5.1). */
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
  resize: () => void
  /**
   * Snapshot the currently painted host into a JPEG data URL for Page Layout.
   * Prefer scheduling on idle — capture walks iframe documents.
   */
  captureVisiblePreview: (
    maxWidth?: number,
    maxHeight?: number,
  ) => Promise<string | null>
  /**
   * Load spine section markup for a 0-based *visible* spine position
   * (matches goToSpineIndex / pageTotal indexing).
   */
  loadSpinePreviewHtml: (visibleIndex: number) => Promise<string | null>
  /**
   * Rasterize a spine section into a JPEG data URL for Page Layout thumbnails.
   */
  rasterizeSpinePreview: (
    visibleIndex: number,
    maxWidth?: number,
    maxHeight?: number,
  ) => Promise<string | null>
}

/** Payload from epubjs `rendition.on('selected')` mapped to viewport coords (T5.1). */
export type EpubSelectionPayload = {
  cfiRange: string
  locationStart: string
  locationEnd: string
  selectedText: string
  rect: HighlightHandleRect
  /** Spine section index from epubjs Contents (sidebar stub until T5.8). */
  sectionIndex: number
}

/** Per-iframe helpers for building selection payloads on pointer release. */
export type EpubFrameSelectionContext = {
  sectionIndex: number
  cfiFromRange: (range: Range) => string | null
}

function getEpubCFIClass():
  | (new (range: Range, cfiBase: string) => { toString(): string })
  | null {
  const mod = ePubImport as {
    EpubCFI?: unknown
    default?: { EpubCFI?: unknown }
  }
  const C = mod.EpubCFI ?? mod.default?.EpubCFI
  return typeof C === 'function'
    ? (C as new (range: Range, cfiBase: string) => { toString(): string })
    : null
}

/** Build highlight/select payload from the iframe's live selection (mouseup path). */
export function buildEpubSelectionPayloadFromDocument(
  doc: Document,
  frameEl: HTMLElement | null,
  ctx: EpubFrameSelectionContext,
): EpubSelectionPayload | null {
  const win = doc.defaultView
  if (!win) return null

  const sel = win.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null

  let selectedText = ''
  try {
    selectedText = sel.toString()?.trim() ?? ''
  } catch {
    return null
  }
  if (!selectedText) return null

  let range: Range
  try {
    range = sel.getRangeAt(0)
  } catch {
    return null
  }

  const cfiRange = ctx.cfiFromRange(range)?.trim() ?? ''
  if (!cfiRange) return null

  const { locationStart, locationEnd } = splitCfiRange(cfiRange)
  if (!locationStart) return null

  return {
    cfiRange,
    locationStart,
    locationEnd: locationEnd || locationStart,
    selectedText,
    rect: rangeToHighlightHandleRect(range, frameEl),
    sectionIndex: ctx.sectionIndex,
  }
}

/** Capture CFI helpers from an epubjs rendered view for mouseup selection. */
export function epubFrameContextFromView(view: unknown): {
  doc: Document
  ctx: EpubFrameSelectionContext
} | null {
  const v = view as {
    document?: Document
    index?: number
    contents?: {
      sectionIndex?: number
      cfiFromRange?: (range: Range) => string
      cfiBase?: string
    }
  }
  const doc = v.document
  if (!doc) return null

  const contents = v.contents
  const sectionIndex = contents?.sectionIndex ?? v.index ?? 0
  const EpubCFI = getEpubCFIClass()

  return {
    doc,
    ctx: {
      sectionIndex,
      cfiFromRange: (range) => {
        try {
          if (contents?.cfiFromRange) {
            return contents.cfiFromRange(range)
          }
          if (EpubCFI && contents?.cfiBase) {
            return new EpubCFI(range, contents.cfiBase).toString()
          }
        } catch {
          /* invalid range / CFI */
        }
        return null
      },
    },
  }
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
 * Resume / jump without triggering epubjs `No startContainer found` logs.
 * Range CFIs are reduced to a display point; shallow section-start CFIs open by
 * spine index; deeper CFIs use display(cfi) with a spine-index fallback.
 */
async function displayCfiSafely(
  book: Book,
  rendition: Rendition,
  cfi: string,
  fallbackIndex: number,
): Promise<void> {
  const displayCfi = toEpubjsDisplayCfi(cfi)
  if (!displayCfi) {
    await rendition.display(fallbackIndex)
    return
  }
  const index = spineIndexFromCfi(book, displayCfi, fallbackIndex)
  if (isTrivialSectionStartCfi(displayCfi)) {
    await rendition.display(index)
    return
  }
  try {
    await withEpubjsStartContainerLogMutedAsync(() =>
      rendition.display(displayCfi),
    )
  } catch {
    await rendition.display(index)
  }
}

function spineLengthOf(book: Book): number {
  const spine = book.spine as { length?: number }
  return typeof spine.length === 'number' ? spine.length : 0
}

type SpineSectionLike = {
  href?: string
  idref?: string
  properties?: string | string[]
  linear?: string | boolean
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

/** Nav / TOC spine items — sidebar only; never rendered in the reading viewport. */
function isTocSection(
  section: SpineSectionLike | null | undefined,
  book?: Book,
): boolean {
  if (!section || isCoverSection(section, book)) return false

  const tokens = [
    ...spinePropertyTokens(section),
    ...(book ? manifestPropertyTokens(book, section.idref) : []),
  ]
  if (tokens.some((t) => t === 'nav' || t.startsWith('nav'))) return true

  const linear = section.linear
  if (linear === 'no' || linear === false) return true

  const path = sectionPath(section)
  return (
    /(?:^|[/\\])(?:toc|nav|contents?)(?:\.(?:xhtml|html|htm|xml))?$/i.test(
      path,
    ) ||
    /table[-_ ]?of[-_ ]?contents/i.test(path) ||
    /(?:^|[/\\])nav(?:\.(?:xhtml|html|htm|xml))?$/i.test(path)
  )
}

function visibleSpineIndicesOf(book: Book): number[] {
  const length = spineLengthOf(book)
  const indices: number[] = []

  for (let i = 0; i < length; i += 1) {
    const section = book.spine.get(i) as SpineSectionLike | undefined
    // Cover belongs to the reading surface; TOC/nav/contents belongs only to sidebar.
    if (!isCoverSection(section, book) && isTocSection(section, book)) continue
    indices.push(i)
  }

  if (indices.length > 0) return indices
  return Array.from({ length }, (_, index) => index)
}

function nearestVisiblePosition(
  visibleIndices: number[],
  rawIndex: number,
): number {
  if (visibleIndices.length === 0) return 0
  const exact = visibleIndices.indexOf(rawIndex)
  if (exact >= 0) return exact

  let nearest = 0
  let distance = Number.POSITIVE_INFINITY
  visibleIndices.forEach((index, position) => {
    const d = Math.abs(index - rawIndex)
    if (d < distance) {
      nearest = position
      distance = d
    }
  })
  return nearest
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

export function buildEpubNavState(
  book: Book,
  spineIndex: number,
  toc: EpubTocItem[] = [],
): EpubNavState {
  const spineLength = spineLengthOf(book)
  const pageTotal = Math.max(spineLength, 1)
  const clamped =
    spineLength <= 0
      ? 0
      : Math.min(Math.max(spineIndex, 0), spineLength - 1)
  const pageCurrent = spineLength <= 0 ? 0 : clamped + 1
  const section = book.spine.get(clamped)
  const href = section?.href ?? ''
  const label = resolveTocLocationLabel(href, toc) || (href ? basenameLabel(href) : '') || 'Page'
  const progress =
    spineLength <= 1 ? 0 : clamped / (spineLength - 1)
  return {
    spineIndex: clamped,
    spineLength,
    pageCurrent,
    pageTotal,
    href,
    label,
    progress,
  }
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
type EpubReadingStyle = {
  fontFamily: FontFamily
  fontWeight: FontWeight
  lineHeight: number
  textAlign: TextAlign
  marginsEnabled: boolean
  marginPreset: string
  /** When true (chrome hidden), expand the text column to use more horizontal space. */
  chromeHidden: boolean
}

const DEFAULT_EPUB_READING_STYLE: EpubReadingStyle = {
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
 * Always uses the tools-chrome gutters (not the immersive / chrome-hidden
 * values) so the left breathing room beside the icon rail stays stable when
 * Invisible UI toggles the top tools bar — matches "leave space like Tools open".
 */
function marginPadding(enabled: boolean, preset: string): string {
  if (!enabled) return '12px'
  if (preset === 'narrow') return '32px 48px'
  if (preset === 'wide') return '32px 12vw'
  return '32px 8vw'
}

/** Reflow column width — same tools-open metrics for chrome on or off. */
function contentMaxWidth(enabled: boolean, preset: string): string {
  if (!enabled || preset === 'off') return 'none'
  if (preset === 'narrow') return '580px'
  if (preset === 'wide') return '780px'
  return '680px'
}

function applyThemeVariables(doc: Document, theme: ReaderTheme): void {
  const { color, background, link, linkVisited, linkHover } =
    READER_THEME_COLORS[theme]
  const root = doc.documentElement
  root.style.setProperty('--epub-color', color)
  root.style.setProperty('--epub-background', background)
  root.style.setProperty('--epub-link', link)
  root.style.setProperty('--epub-link-visited', linkVisited)
  root.style.setProperty('--epub-link-hover', linkHover)
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
    marginPadding(style.marginsEnabled, style.marginPreset),
  )
  const maxWidth = contentMaxWidth(style.marginsEnabled, style.marginPreset)
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
    /* In-document nav TOC belongs in Reader sidebar, not the page canvas. */
    'nav[epub\\:type="toc"], nav[epub\\:type~="toc"], [role="doc-toc"]': {
      display: 'none !important',
    },
    /* Cover / full-bleed images still participate as normal spine pages. */
    img: {
      'max-width': '100% !important',
      'max-height': '100vh !important',
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

function waitForFrames(count = 2): Promise<void> {
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

  const rect = host.getBoundingClientRect()
  const width = Math.floor(rect.width)
  const height = Math.floor(rect.height)
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
  const read = () => {
    const r = host.getBoundingClientRect()
    return { width: Math.floor(r.width), height: Math.floor(r.height) }
  }
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

function flowForMode(pageMode: EpubPageMode, _layout: EpubPageLayout): string {
  return pageMode === 'scroll' ? 'scrolled' : 'paginated'
}

/**
 * epubjs picks the View Manager from `manager`, independent of `flow`.
 * Default manager renders one spine item at a time — next()/prev() clear
 * and jump instead of appending, which breaks true continuous scroll.
 * ContinuousViewManager appends the next section once scroll nears the
 * bottom, so chapters flow into one another without a manual page-turn.
 */
function managerForMode(pageMode: EpubPageMode): 'default' | 'continuous' {
  return pageMode === 'scroll' ? 'continuous' : 'default'
}

function spreadForLayout(
  pageMode: EpubPageMode,
  layout: EpubPageLayout,
): 'always' | 'none' {
  // Continuous scroll is a single reflowing column — no page spread gutters.
  if (pageMode === 'scroll') return 'none'
  return layout === 'dual' ? 'always' : 'none'
}

/** Host + iframe chrome for page spread gutters drawn in React overlay. */
function applyDualSpreadHost(host: HTMLElement, layout: EpubPageLayout): void {
  host.dataset.epubSpread = layout
}

export type OpenEpubjsOptions = {
  theme?: ReaderTheme
  signal?: AbortSignal
  /** 1, 2, or 3 page spread (gutters drawn in React). */
  layout?: EpubPageLayout
  pageMode?: EpubPageMode
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
  /** Text selection in iframe → FR-06 highlight tooltip (T5.1). */
  onSelected?: (payload: EpubSelectionPayload) => void
  /** Fired once the first section iframe is painted (before open() fully settles). */
  onFirstRender?: () => void
}

type EpubjsContentsLike = {
  document?: Document
  window?: Window
  sectionIndex?: number
  range?: (cfi: string) => Range | null
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
  const pageMode: EpubPageMode = options.pageMode ?? 'paginated'
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
  const onSelected = options.onSelected
  const onFirstRender = options.onFirstRender

  if (typeof ePub !== 'function') {
    throw new Error('epubjs failed to load (default export is not a function)')
  }

  throwIfAborted(signal)

  const bytes = toArrayBuffer(buffer)
  if (bytes.byteLength < 22) {
    throw new Error('EPUB payload is empty or truncated')
  }

  const openToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  host.dataset.epubOpen = openToken

  const book = ePub(bytes, { openAs: 'binary' }) as Book
  let rendition: Rendition | null = null
  let settled = false
  let destroyed = false
  let fallbackSpine = 0
  let firstRenderNotified = false

  const notifyFirstRender = () => {
    if (firstRenderNotified || destroyed) return
    if (host.dataset.epubOpen !== openToken) return
    if (!host.querySelector('iframe')) return
    firstRenderNotified = true
    onFirstRender?.()
  }

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
      ;(book as unknown as { rendition?: Rendition | null }).rendition = null
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
    rendition = book.renderTo(host, {
      width: size.width,
      height: size.height,
      flow: flowForMode(pageMode, layout),
      manager: managerForMode(pageMode),
      spread: spreadForLayout(pageMode, layout),
      // Show every spine item in order (cover included when publishers put it in spine).
      allowScriptedContent: false,
    })
    const visibleSpineIndices = visibleSpineIndicesOf(book)
    // Apply reading styles before first display so resume CFI paginates with final typography.
    injectEpubThemeStyles(rendition)
    applyEpubThemeVars(rendition, theme)
    applyEpubReadingStyle(rendition, initialReadingStyle)
    applyEpubFontSize(rendition, initialFontSize)
    applyDualSpreadHost(host, layout)
    rendition.on('rendered', notifyFirstRender)
    throwIfAborted(signal)

    // Resume at CFI when provided (T4.1); otherwise first readable spine item.
    fallbackSpine = visibleSpineIndices[0] ?? 0
    let resumeCfi: string | undefined
    let resumeSpineIndex: number | undefined
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
      // Cover is preserved; TOC/nav pages are sidebar-only.
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
  } catch (err) {
    destroyBook()
    throw err
  } finally {
    settled = true
    signal?.removeEventListener('abort', onAbort)
  }

  const activeRendition = rendition
  if (!activeRendition) {
    destroyBook()
    throw new Error('EPUB rendition failed to start')
  }

  let lastSelectionWindow: Window | null = null
  const overlayPainter = new DomCssOverlay(activeRendition, host)

  const handleSelected = (cfiRange: string, contents: EpubjsContentsLike) => {
    if (!onSelected) return
    const rangeCfi = typeof cfiRange === 'string' ? cfiRange.trim() : ''
    if (!rangeCfi) return

    const doc = contents.document
    const win = contents.window ?? doc?.defaultView ?? null
    if (win) lastSelectionWindow = win

    let selectedText = ''
    try {
      selectedText = win?.getSelection()?.toString()?.trim() ?? ''
    } catch {
      selectedText = ''
    }

    let range: Range | null = null
    try {
      range = contents.range
        ? withEpubjsStartContainerLogMuted(() => contents.range!(rangeCfi))
        : null
    } catch {
      range = null
    }
    if (!range && win?.getSelection()?.rangeCount) {
      try {
        range = win.getSelection()!.getRangeAt(0)
      } catch {
        range = null
      }
    }
    if (!selectedText && range) {
      selectedText = range.toString().trim()
    }
    if (!selectedText) return

    const { locationStart, locationEnd } = splitCfiRange(rangeCfi)
    if (!locationStart) return

    const frameEl =
      (doc?.defaultView?.frameElement as HTMLElement | null) ??
      (host.querySelector('iframe') as HTMLElement | null)
    const rect = range
      ? rangeToHighlightHandleRect(range, frameEl)
      : {
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          start: { top: 0, left: 0, lineHeight: 0 },
          end: { top: 0, left: 0, lineHeight: 0 },
        }

    onSelected({
      cfiRange: rangeCfi,
      locationStart,
      locationEnd: locationEnd || locationStart,
      selectedText,
      rect,
      sectionIndex:
        typeof contents.sectionIndex === 'number' ? contents.sectionIndex : 0,
    })
  }

  if (onSelected) {
    activeRendition.on('selected', handleSelected)
  }

  const resizeToHost = () => {
    const r = host.getBoundingClientRect()
    const w = Math.floor(r.width)
    const h = Math.floor(r.height)
    if (w > 0 && h > 0) {
      activeRendition.resize(w, h)
    }
  }

  const getVisibleSpineIndices = () => visibleSpineIndicesOf(book)
  const getSpineLength = () => getVisibleSpineIndices().length
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

  const currentSpineIndex = (): number => {
    const start = activeRendition.location?.start
    if (start && typeof start.index === 'number') return start.index
    return 0
  }

  const currentVisiblePosition = (): number =>
    nearestVisiblePosition(getVisibleSpineIndices(), currentSpineIndex())

  const goToSpineIndex = async (index: number) => {
    const visibleSpineIndices = getVisibleSpineIndices()
    const n = visibleSpineIndices.length
    if (n <= 0) return
    const clamped = Math.min(Math.max(Math.round(index), 0), n - 1)
    await activeRendition.display(visibleSpineIndices[clamped] ?? clamped)
  }
  const redirectIfExcludedSpine = async (direction: 'next' | 'prev' = 'next') => {
    const visibleSpineIndices = getVisibleSpineIndices()
    const rawIndex = currentSpineIndex()
    const currentSection = book.spine.get(rawIndex) as
      | SpineSectionLike
      | undefined
    if (!isTocSection(currentSection, book)) return

    const candidates =
      direction === 'next'
        ? visibleSpineIndices.filter((index) => index > rawIndex)
        : visibleSpineIndices.filter((index) => index < rawIndex).reverse()
    const target =
      candidates[0] ??
      visibleSpineIndices[0] ??
      visibleSpineIndices[visibleSpineIndices.length - 1]
    if (typeof target === 'number' && target !== rawIndex) {
      await activeRendition.display(target)
    }
  }

  const goToHref = async (href: string) => {
    if (!href) return
    await activeRendition.display(href)
    await redirectIfExcludedSpine('next')
  }

  const captureVisiblePreview = async (
    maxWidth = 160,
    maxHeight = 220,
  ): Promise<string | null> => {
    try {
      return await captureHostPreview(host, maxWidth, maxHeight)
    } catch {
      return null
    }
  }

  const loadSpineSectionDocument = async (
    visibleIndex: number,
  ): Promise<{
    doc: Document
    unload: () => void
  } | null> => {
    const visibleSpineIndices = getVisibleSpineIndices()
    const n = visibleSpineIndices.length
    if (n <= 0) return null
    const clamped = Math.min(Math.max(Math.round(visibleIndex), 0), n - 1)
    const rawIndex = visibleSpineIndices[clamped]
    if (typeof rawIndex !== 'number') return null

    const section = book.spine.get(rawIndex) as unknown as
      | {
          load?: (fn: (path: string) => Promise<Document>) => Promise<Document>
          unload?: () => void
        }
      | undefined
    if (!section?.load) return null

    const bookLoad = (
      book as unknown as { load: (path: string) => Promise<Document> }
    ).load.bind(book)

    try {
      const doc = await section.load(bookLoad)
      if (!doc?.body) return null
      return {
        doc,
        unload: () => {
          try {
            section.unload?.()
          } catch {
            /* ignore */
          }
        },
      }
    } catch {
      return null
    }
  }

  const loadSpinePreviewHtml = async (
    visibleIndex: number,
  ): Promise<string | null> => {
    const loaded = await loadSpineSectionDocument(visibleIndex)
    if (!loaded) return null
    try {
      const inner = loaded.doc.body.innerHTML?.trim()
      if (!inner) return null
      return wrapSpinePreviewHtml(inner)
    } finally {
      loaded.unload()
    }
  }

  const rasterizeSpinePreview = async (
    visibleIndex: number,
    maxWidth = PREVIEW_THUMB_MAX_WIDTH,
    maxHeight = PREVIEW_THUMB_MAX_HEIGHT,
  ): Promise<string | null> => {
    const loaded = await loadSpineSectionDocument(visibleIndex)
    if (!loaded) return null
    try {
      const body = loaded.doc.body
      const sw = Math.max(body.scrollWidth, body.clientWidth, 320)
      const sh = Math.max(body.scrollHeight, body.clientHeight, 400)
      return documentToPreviewDataUrl(
        loaded.doc,
        sw,
        sh,
        maxWidth,
        maxHeight,
      )
    } finally {
      loaded.unload()
    }
  }

  const skipExcludedSection = async (direction: 'next' | 'prev') => {
    await redirectIfExcludedSpine(direction)
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

  const getCurrentLocation = (): CfiLocation | undefined =>
    tryEncodeCfi(readRenditionLocation())

  const goToLocation = async (location: CfiLocation): Promise<void> => {
    const decoded = cfiCodec.decode(location) as EpubCfiDecodeResult
    const fallbackSpine = getVisibleSpineIndices()[0] ?? 0
    await displayCfiSafely(book, activeRendition, decoded.cfi, fallbackSpine)
    await redirectIfExcludedSpine('next')
  }

  // Initial resume can land on TOC/nav; match goToLocation behavior.
  // Keep teardown on abort: this runs after `settled`, so onAbort no longer destroys.
  try {
    if (initialLocation) {
      await redirectIfExcludedSpine('next')
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

  const nextPage = async () => {
    const beforeLocation = currentLocationSignature()
    await activeRendition.next()
    const afterNextLocation = currentLocationSignature()
    if (
      afterNextLocation === beforeLocation &&
      currentVisiblePosition() === 0 &&
      getSpineLength() > 1
    ) {
      await goToSpineIndex(1)
    }
    await skipExcludedSection('next')
  }
  const prevPage = async () => {
    await activeRendition.prev()
    await skipExcludedSection('prev')
  }

  return {
    book,
    rendition: activeRendition,
    overlayPainter,
    hasSpineCover,
    destroy: () => {
      void overlayPainter.clear()
      if (onSelected) {
        try {
          activeRendition.off('selected', handleSelected)
        } catch {
          /* ignore */
        }
      }
      lastSelectionWindow = null
      stopRenditionQueue(activeRendition)
      destroyBook()
    },
    next: nextPage,
    prev: prevPage,
    nextPage,
    prevPage,
    nextSection: async () => {
      await goToSpineIndex(currentVisiblePosition() + 1)
    },
    prevSection: async () => {
      await goToSpineIndex(currentVisiblePosition() - 1)
    },
    goToHref,
    goToSpineIndex,
    getSpineLength,
    getCurrentLocation,
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
    captureVisiblePreview,
    loadSpinePreviewHtml,
    rasterizeSpinePreview,
    getNavState: () => {
      const visibleSpineIndices = getVisibleSpineIndices()
      const visiblePosition = nearestVisiblePosition(
        visibleSpineIndices,
        currentSpineIndex(),
      )
      const rawIndex = visibleSpineIndices[visiblePosition] ?? currentSpineIndex()
      const state = buildEpubNavState(book, rawIndex, getToc())
      return {
        ...state,
        spineIndex: visiblePosition,
        spineLength: visibleSpineIndices.length,
        pageCurrent: visibleSpineIndices.length <= 0 ? 0 : visiblePosition + 1,
        pageTotal: Math.max(visibleSpineIndices.length, 1),
        progress:
          visibleSpineIndices.length <= 1
            ? 0
            : visiblePosition / (visibleSpineIndices.length - 1),
      }
    },
    getToc,
    setTheme: (next) => {
      applyEpubThemeVars(activeRendition, next)
    },
    setLayout: (next) => {
      layout = next
      activeRendition.spread(spreadForLayout(pageMode, next))
      applyDualSpreadHost(host, next)
      resizeToHost()
    },
    setFontSize: (px) => {
      applyEpubFontSize(activeRendition, px)
      resizeToHost()
    },
    setFontFamily: (fontFamily) => {
      applyEpubReadingStyle(activeRendition, { fontFamily })
      resizeToHost()
    },
    setFontWeight: (fontWeight) => {
      applyEpubReadingStyle(activeRendition, { fontWeight })
      resizeToHost()
    },
    setLineHeight: (lineHeight) => {
      applyEpubReadingStyle(activeRendition, { lineHeight })
      resizeToHost()
    },
    setTextAlign: (textAlign) => {
      applyEpubReadingStyle(activeRendition, { textAlign })
      resizeToHost()
    },
    setMargins: (marginsEnabled, marginPreset) => {
      applyEpubReadingStyle(activeRendition, { marginsEnabled, marginPreset })
      resizeToHost()
    },
    setChromeHidden: (chromeHidden) => {
      applyEpubReadingStyle(activeRendition, { chromeHidden })
      resizeToHost()
    },
    resize: resizeToHost,
  }
}

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
import { cfiCodec, tryEncodeCfi, type EpubCfiDecodeResult } from './cfi/cfi-codec'
import { spineIndexFromCfiPath } from '@reading-book/shared/utils'
import {
  isTrivialSectionStartCfi,
  installEpubjsStartContainerLogFilter,
  withEpubjsStartContainerLogMuted,
  withEpubjsStartContainerLogMutedAsync,
} from './cfi/cfi-dom-range'
import {
  rangeToHighlightHandleRect,
  splitCfiRange,
  toEpubjsDisplayCfi,
} from './cfi/selection-cfi'
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

type EpubjsViewLike = {
  contents?: { document?: Document; cfiBase?: string; sectionIndex?: number }
  section?: { cfiBase?: string; index?: number }
  element?: HTMLElement
}

type EpubjsManagerLike = {
  views?: {
    displayed?: () => EpubjsViewLike[]
    current?: () => EpubjsViewLike | undefined
  }
}

function renditionManager(rendition: Rendition): EpubjsManagerLike | undefined {
  return (rendition as unknown as { manager?: EpubjsManagerLike }).manager
}

function currentSectionView(rendition: Rendition): EpubjsViewLike | undefined {
  const manager = renditionManager(rendition)
  if (!manager) return undefined
  const displayed = manager.views?.displayed?.()
  const current = manager.views?.current?.()
  if (current) return current
  return Array.isArray(displayed) && displayed.length > 0 ? displayed[0] : undefined
}

function currentSectionDocument(rendition: Rendition): Document | null {
  return currentSectionView(rendition)?.contents?.document ?? null
}

function epubScrollContainer(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('.epub-container')
}

/** Vite/CJS interop: default may be the ePub fn or a module namespace. */
const ePub =
  typeof ePubImport === 'function'
    ? ePubImport
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ePubImport as any).default

export type EpubPageLayout = 'single' | 'dual'
export type EpubPageMode = 'scroll' | 'paginated'

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
  /** Move the continuous scroller while retaining reading context overlap. */
  scrollByViewport: (direction: -1 | 1) => void
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
  const percentage =
    typeof pagination?.progress === 'number' && Number.isFinite(pagination.progress)
      ? Math.min(1, Math.max(0, pagination.progress))
      : spinePositionFraction(clamped, spineLength, sectionPage, sectionPageTotal)
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
export function injectEpubThemeStyles(
  rendition: Rendition,
  pageMode: EpubPageMode = 'paginated',
): void {
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
      'max-height':
        pageMode === 'scroll' ? 'none !important' : '100vh !important',
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

export function flowForMode(pageMode: EpubPageMode): string {
  return pageMode === 'scroll' ? 'scrolled' : 'paginated'
}

/**
 * epubjs picks the View Manager from `manager`, independent of `flow`.
 * Default manager renders one spine item at a time — next()/prev() clear
 * and jump instead of appending, which breaks true continuous scroll.
 * ContinuousViewManager appends the next section once scroll nears the
 * bottom, so chapters flow into one another without a manual page-turn.
 */
export function managerForMode(pageMode: EpubPageMode): 'default' | 'continuous' {
  return pageMode === 'scroll' ? 'continuous' : 'default'
}

export function spreadForLayout(
  pageMode: EpubPageMode,
  layout: EpubPageLayout,
): 'always' | 'none' {
  // Continuous scroll is a single reflowing column — no page spread gutters.
  if (pageMode === 'scroll') return 'none'
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
  /** Fired when the loading lifecycle advances. */
  onStatusChange?: (status: 'opening' | 'rendering' | 'ready') => void
  /**
   * Fired once `book.locations` finishes generating, so the footer can swap
   * from the section counter to the book-wide page counter.
   */
  onLocationsReady?: () => void
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
      flow: flowForMode(pageMode),
      manager: managerForMode(pageMode),
      spread: spreadForLayout(pageMode, layout),
      // Show every spine item in order (cover included when publishers put it in spine).
      allowScriptedContent: false,
    })
    linkSpineSections(book)
    // Apply reading styles before first display so resume CFI paginates with final typography.
    injectEpubThemeStyles(rendition, pageMode)
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
      pageMode,
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
    if (pageMode !== 'paginated') return false
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
    if (pageMode !== 'paginated') return
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
          pageMode,
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
    const { width, height } = readHostLayoutSize(host)
    if (width > 0 && height > 0) {
      activeRendition.resize(width, height)
    }
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

  const goToSpineIndex = async (index: number) => {
    const n = spineLengthOf(book)
    if (n <= 0) return
    const clamped = Math.min(Math.max(Math.round(index), 0), n - 1)
    await activeRendition.display(clamped)
  }

  const goToHref = async (href: string) => {
    if (!href) return
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
    if (pageMode === 'scroll') {
      const spineLength = spineLengthOf(book)
      if (spineLength <= 0) return
      const clamped = Math.min(Math.max(Math.round(page), 1), spineLength)
      await goToSpineIndex(clamped - 1)
      return
    }

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

  const goToLocation = async (location: CfiLocation): Promise<void> => {
    const decoded = cfiCodec.decode(location) as EpubCfiDecodeResult
    const fallbackSpine = 0
    await displayCfiSafely(book, activeRendition, decoded.cfi, fallbackSpine)
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
    if (pageMode !== 'paginated') return
    paginationTracker.invalidate()
    publishLocationsReady()
    startHiddenPaginationMeasure()
  }

  const scrollByViewport = (direction: -1 | 1) => {
    const container = epubScrollContainer(host)
    if (!container) return
    // Preserve a small overlap so no line sits exactly on both viewport edges.
    const distance = Math.max(1, Math.floor(container.clientHeight * 0.9))
    container.scrollBy({
      top: direction * distance,
      left: 0,
      behavior: 'smooth',
    })
  }

  const nextPage = async () => {
    if (pageMode === 'scroll') {
      scrollByViewport(1)
      return
    }

    const beforeLocation = currentLocationSignature()
    const beforeSpine = currentSpineIndex()
    await activeRendition.next()
    await waitForFrames(2)
    if (currentLocationSignature() !== beforeLocation) return

    const resourcesReady = await waitForSectionResources(
      currentSectionDocument(activeRendition),
    )
    resizeToHost()
    await waitForFrames(2)
    await activeRendition.next()
    await waitForFrames(2)
    if (currentLocationSignature() !== beforeLocation) return

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
    if (pageMode === 'scroll') {
      scrollByViewport(-1)
      return
    }

    const beforeLocation = currentLocationSignature()
    const beforeSpine = currentSpineIndex()
    await activeRendition.prev()
    await waitForFrames(2)
    if (currentLocationSignature() !== beforeLocation) return

    const resourcesReady = await waitForSectionResources(
      currentSectionDocument(activeRendition),
    )
    resizeToHost()
    await waitForFrames(2)
    await activeRendition.prev()
    await waitForFrames(2)
    if (currentLocationSignature() !== beforeLocation) return

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
    overlayPainter,
    hasSpineCover,
    destroy: () => {
      paginationAbort?.abort()
      paginationAbort = null
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
    scrollByViewport,
    nextSection: async () => {
      await goToSpineIndex(currentSpineIndex() + 1)
    },
    prevSection: async () => {
      await goToSpineIndex(currentSpineIndex() - 1)
    },
    goToHref,
    goToSpineIndex,
    goToLocationPage,
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
    getNavState: () => {
      const location = readRenditionLocation()
      const displayed = displayedPagesFromLocation(location)
      const cfi = cfiFromLocation(location)
      const currentSpine = currentSpineIndex()

      if (pageMode === 'paginated') {
        const metrics = paginationTracker.getNavMetrics(
          currentSpine,
          displayed.page,
          displayed.total,
        )
        const navState = buildEpubNavState(
          book,
          currentSpine,
          getToc(),
          displayed,
          cfi,
          metrics,
        )
        return navState
      }

      const spineLength = spineLengthOf(book)
      const progress = spinePositionFraction(
        currentSpine,
        spineLength,
        displayed.page,
        displayed.total,
      )
      const navState = buildEpubNavState(
        book,
        currentSpine,
        getToc(),
        displayed,
        cfi,
        {
          pageCurrent: currentSpine + 1,
          pageTotal: Math.max(1, spineLength),
          progress,
          percentage: progress,
          pageCountReady: true,
        },
      )
      return navState
    },
    getToc,
    getSectionLabels,
    setTheme: (next) => {
      applyEpubThemeVars(activeRendition, next)
    },
    setLayout: (next) => {
      layout = next
      activeRendition.spread(spreadForLayout(pageMode, next))
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
    resize: () => {
      resizeToHost()
      scheduleFullPaginationRemeasure()
    },
  }
}

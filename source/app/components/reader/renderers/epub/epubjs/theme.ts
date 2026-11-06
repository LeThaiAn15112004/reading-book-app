/**
 * Reader appearance inside the EPUB iframe: theme colours, typography and margins applied as CSS
 * variables, so changing them never replaces the injected stylesheet.
 */
import type { Rendition } from 'epubjs'
import {
  READER_THEME_PRESETS,
  fontFamilyCss,
  type FontFamily,
  type FontWeight,
  type ReaderTheme,
  type TextAlign,
} from '@reading-book/book-reader-sdk'

/** Default Aa panel size — zoom % is relative to this. */
export const EPUB_BASE_FONT_PX = 18

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

/**
 * App chrome + reading canvas theme (SCR-06 Appearance).
 * Night / Sepia / Paper drive the whole app UI — not reader-only.
 * Platform stores JSON via localStorage / MMKV / electron-store — not React.
 */

export type ReaderTheme = 'night' | 'sepia' | 'paper'
/** Alias — same three colors are the app shell theme. */
export type AppChromeTheme = ReaderTheme

export type FontFamily = 'serif' | 'sans' | 'mono'
export type FontWeight = 300 | 400 | 600
export type TextAlign = 'left' | 'justify' | 'center'
export type ReadingLayout = 'single' | 'dual' | 'triple'
export type ReadingPageMode = 'scroll' | 'paginated'
export type ReadingMarginPreset = 'narrow' | 'normal' | 'wide'

export type ReadingPreferenceOverrides = {
  fontFamily?: FontFamily
  fontSize?: number
  fontWeight?: FontWeight
  lineHeight?: number
  textAlign?: TextAlign
  layout?: ReadingLayout
  pageMode?: ReadingPageMode
  marginEnabled?: boolean
  margin?: ReadingMarginPreset
}

export type ResolvedReadingPrefs = Required<ReadingPreferenceOverrides>

export type GlobalReadingPrefs = Required<ReadingPreferenceOverrides> & {
  theme: ReaderTheme
}

export const GLOBAL_READING_PREFS_STORAGE_KEY = 'readmate.globalReadingPrefs.v1'

export const DEFAULT_GLOBAL_READING_PREFS: GlobalReadingPrefs = {
  theme: 'night',
  fontFamily: 'serif',
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 1.65,
  textAlign: 'justify',
  layout: 'single',
  pageMode: 'paginated',
  marginEnabled: true,
  margin: 'normal',
}

const FONT_STACK: Record<FontFamily, string> = {
  serif: '"Literata", Georgia, serif',
  sans: '"Source Sans 3", system-ui, sans-serif',
  mono: 'ui-monospace, Consolas, monospace',
}

/** CSS font-family stack for Reader / Settings preview. */
export function fontFamilyCss(family: FontFamily): string {
  return FONT_STACK[family]
}

/**
 * Fixed BR-05 background/text/link pairs. Consumers must select a preset;
 * they must not combine colors from different presets.
 */
export type ReaderThemePreset = {
  label: string
  color: string
  background: string
  strongColor: string
  /** Hyperlinks / TOC entries — high contrast on this theme. */
  link: string
  linkVisited: string
  linkHover: string
  swatchBackground: string
}

export const READER_THEME_PRESETS: Record<ReaderTheme, ReaderThemePreset> = {
  night: {
    label: 'Night',
    color: '#cbd5e1',
    background: '#0f172a',
    strongColor: '#f1f5f9',
    link: '#7dd3fc',
    linkVisited: '#a5b4fc',
    linkHover: '#38bdf8',
    swatchBackground: '#0f172a',
  },
  sepia: {
    label: 'Sepia',
    color: '#e1cfb3',
    background: '#16120e',
    strongColor: '#f3e6d0',
    link: '#fbbf24',
    linkVisited: '#f59e0b',
    linkHover: '#fcd34d',
    swatchBackground: '#251f19',
  },
  paper: {
    label: 'Paper',
    color: '#334155',
    background: '#f8fafc',
    strongColor: '#0f172a',
    link: '#0369a1',
    linkVisited: '#1d4ed8',
    linkHover: '#0284c7',
    swatchBackground: '#f8fafc',
  },
}

/** @deprecated Prefer READER_THEME_PRESETS for fixed BR-05 pairs. */
export const READER_THEME_COLORS = READER_THEME_PRESETS

/**
 * Map prefs theme → `<html data-theme>` / domain AppTheme.
 * Legacy: `dark` → night, `day` → paper.
 */
export function toAppThemeAttr(theme: string): ReaderTheme {
  if (theme === 'dark' || theme === 'night') return 'night'
  if (theme === 'day' || theme === 'paper') return 'paper'
  if (theme === 'sepia') return 'sepia'
  return DEFAULT_GLOBAL_READING_PREFS.theme
}

export function isReaderTheme(value: unknown): value is ReaderTheme {
  return value === 'night' || value === 'sepia' || value === 'paper'
}

function isThemeInput(value: unknown): value is string {
  return (
    value === 'night' ||
    value === 'sepia' ||
    value === 'paper' ||
    value === 'dark' ||
    value === 'day'
  )
}

export function isFontFamily(value: unknown): value is FontFamily {
  return value === 'serif' || value === 'sans' || value === 'mono'
}

export function isFontWeight(value: unknown): value is FontWeight {
  return value === 300 || value === 400 || value === 600
}

export function isTextAlign(value: unknown): value is TextAlign {
  return value === 'left' || value === 'justify' || value === 'center'
}

export function resolveReadingPrefs(
  overrides: ReadingPreferenceOverrides | null | undefined,
  appDefaults: GlobalReadingPrefs,
): ResolvedReadingPrefs {
  return {
    fontFamily: overrides?.fontFamily ?? appDefaults.fontFamily,
    fontSize: overrides?.fontSize ?? appDefaults.fontSize,
    fontWeight: overrides?.fontWeight ?? appDefaults.fontWeight,
    lineHeight: overrides?.lineHeight ?? appDefaults.lineHeight,
    textAlign: overrides?.textAlign ?? appDefaults.textAlign,
    layout: overrides?.layout ?? appDefaults.layout,
    pageMode: overrides?.pageMode ?? appDefaults.pageMode,
    marginEnabled: overrides?.marginEnabled ?? appDefaults.marginEnabled,
    margin: overrides?.margin ?? appDefaults.margin,
  }
}

/** Merge partial JSON into a valid prefs object (storage load / IPC). */
export function normalizeGlobalReadingPrefs(
  partial: Partial<GlobalReadingPrefs> | null | undefined,
): GlobalReadingPrefs {
  const parsed = partial ?? {}
  const rawTheme = parsed.theme as unknown
  return {
    theme: isThemeInput(rawTheme)
      ? toAppThemeAttr(rawTheme)
      : DEFAULT_GLOBAL_READING_PREFS.theme,
    fontFamily: isFontFamily(parsed.fontFamily)
      ? parsed.fontFamily
      : DEFAULT_GLOBAL_READING_PREFS.fontFamily,
    fontWeight: isFontWeight(parsed.fontWeight)
      ? parsed.fontWeight
      : DEFAULT_GLOBAL_READING_PREFS.fontWeight,
    fontSize:
      typeof parsed.fontSize === 'number' && Number.isFinite(parsed.fontSize)
        ? Math.min(32, Math.max(12, parsed.fontSize))
        : DEFAULT_GLOBAL_READING_PREFS.fontSize,
    lineHeight:
      typeof parsed.lineHeight === 'number' && Number.isFinite(parsed.lineHeight)
        ? Math.min(2.3, Math.max(1.3, parsed.lineHeight))
        : DEFAULT_GLOBAL_READING_PREFS.lineHeight,
    textAlign: isTextAlign(parsed.textAlign)
      ? parsed.textAlign
      : DEFAULT_GLOBAL_READING_PREFS.textAlign,
    layout:
      parsed.layout === 'single' ||
      parsed.layout === 'dual' ||
      parsed.layout === 'triple'
        ? parsed.layout
        : DEFAULT_GLOBAL_READING_PREFS.layout,
    pageMode:
      parsed.pageMode === 'scroll'
        ? 'scroll'
        : DEFAULT_GLOBAL_READING_PREFS.pageMode,
    marginEnabled:
      typeof parsed.marginEnabled === 'boolean'
        ? parsed.marginEnabled
        : DEFAULT_GLOBAL_READING_PREFS.marginEnabled,
    margin:
      parsed.margin === 'narrow' || parsed.margin === 'wide'
        ? parsed.margin
        : DEFAULT_GLOBAL_READING_PREFS.margin,
  }
}

export function parseGlobalReadingPrefsJson(raw: string | null | undefined): GlobalReadingPrefs {
  if (!raw) return DEFAULT_GLOBAL_READING_PREFS
  try {
    return normalizeGlobalReadingPrefs(JSON.parse(raw) as Partial<GlobalReadingPrefs>)
  } catch {
    return DEFAULT_GLOBAL_READING_PREFS
  }
}

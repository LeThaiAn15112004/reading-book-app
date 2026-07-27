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

export type GlobalReadingPrefs = {
  theme: ReaderTheme
  fontFamily: FontFamily
  fontWeight: FontWeight
  textAlign: TextAlign
}

export const GLOBAL_READING_PREFS_STORAGE_KEY = 'readmate.globalReadingPrefs.v1'

export const DEFAULT_GLOBAL_READING_PREFS: GlobalReadingPrefs = {
  theme: 'night',
  fontFamily: 'serif',
  fontWeight: 400,
  textAlign: 'justify',
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

/** Body + link colors for EPUB/PDF canvas (aligned with shell theme). */
export const READER_THEME_COLORS: Record<
  ReaderTheme,
  {
    color: string
    background: string
    /** Hyperlinks / TOC entries — high contrast on this theme. */
    link: string
    linkVisited: string
    linkHover: string
  }
> = {
  night: {
    color: '#cbd5e1',
    background: '#0f172a',
    link: '#7dd3fc',
    linkVisited: '#a5b4fc',
    linkHover: '#38bdf8',
  },
  sepia: {
    color: '#e1cfb3',
    background: '#16120e',
    link: '#fbbf24',
    linkVisited: '#f59e0b',
    linkHover: '#fcd34d',
  },
  paper: {
    color: '#334155',
    background: '#f1f5f9',
    link: '#0369a1',
    linkVisited: '#1d4ed8',
    linkHover: '#0284c7',
  },
}

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
    textAlign: isTextAlign(parsed.textAlign)
      ? parsed.textAlign
      : DEFAULT_GLOBAL_READING_PREFS.textAlign,
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

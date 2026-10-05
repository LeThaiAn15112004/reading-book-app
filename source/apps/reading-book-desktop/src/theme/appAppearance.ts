import type { ReaderTheme } from '@reading-book/book-reader-sdk'

/**
 * Global app appearance (SCR-06 Settings → Appearance). App-wide only — per-book reading settings
 * (font, size, line height, layout…) live in the Reader, not here.
 */

/** User-facing theme choice. `system` follows the OS light/dark preference. */
export type AppThemeMode = 'light' | 'dark' | 'sepia' | 'system'

export type AccentColorId = 'blue' | 'purple' | 'green' | 'cyan' | 'orange' | 'red' | 'slate'

export type UiDensity = 'comfortable' | 'balanced' | 'compact'

/**
 * App UI language. `system` follows the OS/browser locale (Vietnamese when it starts with `vi`,
 * otherwise English). Book content and the Reader's Translate source/target are not affected.
 */
export type AppLanguage = 'system' | 'vi' | 'en'

export type AppAppearance = {
  themeMode: AppThemeMode
  accent: AccentColorId
  density: UiDensity
  language: AppLanguage
}

export const APP_APPEARANCE_STORAGE_KEY = 'reading-book.app-appearance.v1'

/** `orange` is the built-in amber accent of every theme (theme.css). */
export const DEFAULT_APP_APPEARANCE: AppAppearance = {
  themeMode: 'dark',
  accent: 'orange',
  density: 'balanced',
  language: 'system',
}

export const APP_THEME_MODES: readonly AppThemeMode[] = ['light', 'dark', 'sepia', 'system']

export const ACCENT_COLORS: readonly { id: AccentColorId; label: string; swatch: string }[] = [
  { id: 'blue', label: 'Blue', swatch: '#3b82f6' },
  { id: 'purple', label: 'Purple', swatch: '#8b5cf6' },
  { id: 'green', label: 'Green', swatch: '#22c55e' },
  { id: 'cyan', label: 'Cyan', swatch: '#06b6d4' },
  { id: 'orange', label: 'Orange', swatch: '#f59e0b' },
  { id: 'red', label: 'Red', swatch: '#ef4444' },
  { id: 'slate', label: 'Slate', swatch: '#94a3b8' },
]

export const UI_DENSITIES: readonly UiDensity[] = ['comfortable', 'balanced', 'compact']

export const APP_LANGUAGES: readonly { id: AppLanguage; label: string }[] = [
  { id: 'system', label: 'System Default' },
  { id: 'vi', label: 'Tiếng Việt' },
  { id: 'en', label: 'English' },
]

/** Concrete UI language for `system` (OS/browser locale), as a BCP 47 tag for `<html lang>`. */
export function resolveAppLanguage(language: AppLanguage): 'vi' | 'en' {
  if (language !== 'system') return language
  try {
    return navigator.language.toLowerCase().startsWith('vi') ? 'vi' : 'en'
  } catch {
    return 'en'
  }
}

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(SYSTEM_DARK_QUERY).matches
  } catch {
    return true
  }
}

/** Subscribe to OS light/dark changes. Returns unsubscribe. */
export function onSystemColorSchemeChange(handler: (prefersDark: boolean) => void): () => void {
  const mq = window.matchMedia(SYSTEM_DARK_QUERY)
  const listener = (e: MediaQueryListEvent) => handler(e.matches)
  mq.addEventListener('change', listener)
  return () => mq.removeEventListener('change', listener)
}

/**
 * Map the theme choice onto the existing theme ids (`html[data-theme]`, theme.css):
 * Light → Paper, Dark → Night, Sepia → Sepia, System → Paper / Night.
 */
export function resolveThemeMode(mode: AppThemeMode, prefersDark: boolean): ReaderTheme {
  switch (mode) {
    case 'light':
      return 'paper'
    case 'sepia':
      return 'sepia'
    case 'system':
      return prefersDark ? 'night' : 'paper'
    case 'dark':
    default:
      return 'night'
  }
}

/** First run after this setting existed: keep whatever theme the user already had. */
export function themeModeFromReaderTheme(theme: ReaderTheme): AppThemeMode {
  if (theme === 'paper') return 'light'
  if (theme === 'sepia') return 'sepia'
  return 'dark'
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

/** Read stored appearance; missing/invalid fields fall back (theme from the legacy reading prefs). */
export function loadAppAppearance(legacyTheme?: ReaderTheme): AppAppearance {
  const fallback: AppAppearance = {
    ...DEFAULT_APP_APPEARANCE,
    themeMode: legacyTheme ? themeModeFromReaderTheme(legacyTheme) : DEFAULT_APP_APPEARANCE.themeMode,
  }
  try {
    const raw = localStorage.getItem(APP_APPEARANCE_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Record<keyof AppAppearance, unknown>> | null
    return {
      themeMode: isOneOf(APP_THEME_MODES, parsed?.themeMode) ? parsed.themeMode : fallback.themeMode,
      accent: isOneOf(
        ACCENT_COLORS.map((c) => c.id),
        parsed?.accent,
      )
        ? parsed.accent
        : fallback.accent,
      density: isOneOf(UI_DENSITIES, parsed?.density) ? parsed.density : fallback.density,
      language: isOneOf(
        APP_LANGUAGES.map((l) => l.id),
        parsed?.language,
      )
        ? parsed.language
        : fallback.language,
    }
  } catch {
    return fallback
  }
}

/** Returns false when the write failed (quota / private mode) — the choice just won't persist. */
export function saveAppAppearance(appearance: AppAppearance): boolean {
  try {
    localStorage.setItem(APP_APPEARANCE_STORAGE_KEY, JSON.stringify(appearance))
    return true
  } catch {
    return false
  }
}

/**
 * Accent + density are plain `<html>` attributes consumed by styles/appearance.css; the language
 * sets `<html lang>` (UI strings themselves are not translated yet).
 */
export function applyAppearanceAttributes({
  accent,
  density,
  language,
}: Pick<AppAppearance, 'accent' | 'density' | 'language'>): void {
  const root = document.documentElement
  root.dataset.accent = accent
  root.dataset.density = density
  root.lang = resolveAppLanguage(language)
}

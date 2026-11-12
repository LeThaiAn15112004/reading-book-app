import { resolveUiLanguage, type MessageKey, type ReaderTheme } from '@core'
import { customAccentTokens, normalizeHex } from './accentColor'

/**
 * Global app appearance (SCR-06 Settings → Appearance). App-wide only — per-book reading settings
 * (font, size, line height, layout…) live in the Reader, not here.
 */

/** User-facing theme choice. `system` follows the OS light/dark preference. */
export type AppThemeMode = 'light' | 'dark' | 'sepia' | 'system'

export type AccentColorId = 'blue' | 'purple' | 'green' | 'cyan' | 'orange' | 'red' | 'slate'

/** A preset, or `custom` = the user's own hex in `customAccent`. */
export type AppAccent = AccentColorId | 'custom'

export type UiDensity = 'comfortable' | 'balanced' | 'compact'

/**
 * App UI language. `system` follows the OS/browser locale (Vietnamese when it starts with `vi`,
 * otherwise English). Book content and the Reader's Translate source/target are not affected.
 */
export type AppLanguage = 'system' | 'vi' | 'en'

export type AppAppearance = {
  themeMode: AppThemeMode
  accent: AppAccent
  /** Last custom hex (`#rrggbb`); kept while a preset is selected so Custom reopens on it. */
  customAccent: string
  density: UiDensity
  language: AppLanguage
}

export const APP_APPEARANCE_STORAGE_KEY = 'reading-book.app-appearance.v1'

/** `orange` is the built-in amber accent of every theme (theme.css). */
export const DEFAULT_APP_APPEARANCE: AppAppearance = {
  themeMode: 'dark',
  accent: 'orange',
  customAccent: '#ec4899',
  density: 'balanced',
  language: 'system',
}

export const APP_THEME_MODES: readonly AppThemeMode[] = ['light', 'dark', 'sepia', 'system']

export const ACCENT_COLORS: readonly { id: AccentColorId; labelKey: MessageKey; swatch: string }[] = [
  { id: 'blue', labelKey: 'settings.appearance.accent.blue', swatch: '#3b82f6' },
  { id: 'purple', labelKey: 'settings.appearance.accent.purple', swatch: '#8b5cf6' },
  { id: 'green', labelKey: 'settings.appearance.accent.green', swatch: '#22c55e' },
  { id: 'cyan', labelKey: 'settings.appearance.accent.cyan', swatch: '#06b6d4' },
  { id: 'orange', labelKey: 'settings.appearance.accent.orange', swatch: '#f59e0b' },
  { id: 'red', labelKey: 'settings.appearance.accent.red', swatch: '#ef4444' },
  { id: 'slate', labelKey: 'settings.appearance.accent.slate', swatch: '#94a3b8' },
]

export const UI_DENSITIES: readonly UiDensity[] = ['comfortable', 'balanced', 'compact']

/**
 * "System Default" is translated (`labelKey`); a language's own name is always written in that language (FR-009), so
 * "Tiếng Việt" and "English" are `nativeLabel`s, never translated.
 */
export const APP_LANGUAGES: readonly (
  | { id: 'system'; labelKey: MessageKey }
  | { id: Exclude<AppLanguage, 'system'>; nativeLabel: string }
)[] = [
  { id: 'system', labelKey: 'settings.appearance.language.system' },
  { id: 'vi', nativeLabel: 'Tiếng Việt' },
  { id: 'en', nativeLabel: 'English' },
]

/**
 * Concrete UI language for `system` (OS/browser locale), as a BCP 47 tag for `<html lang>`. Same rule as the
 * interface translations and Main (core `resolveUiLanguage`, spec 012).
 */
export function resolveAppLanguage(language: AppLanguage): 'vi' | 'en' {
  let locales: readonly string[] = []
  try {
    locales = navigator.languages?.length ? navigator.languages : [navigator.language]
  } catch {
    locales = []
  }
  return resolveUiLanguage(language, locales)
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
      accent: isOneOf<AppAccent>(
        [...ACCENT_COLORS.map((c) => c.id), 'custom'],
        parsed?.accent,
      )
        ? parsed.accent
        : fallback.accent,
      customAccent:
        (typeof parsed?.customAccent === 'string' && normalizeHex(parsed.customAccent)) ||
        fallback.customAccent,
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
 * Accent + density are plain `<html>` attributes consumed by styles/appearance.css; a custom accent
 * sets the same accent tokens inline on `<html>` instead. The language sets `<html lang>`; the interface texts
 * follow it through `source/app/i18n` (spec 012).
 */
export function applyAppearanceAttributes({
  accent,
  customAccent,
  density,
  language,
}: Pick<AppAppearance, 'accent' | 'customAccent' | 'density' | 'language'>): void {
  const root = document.documentElement
  root.dataset.accent = accent
  const tokens = customAccentTokens(normalizeHex(customAccent) ?? DEFAULT_APP_APPEARANCE.customAccent)
  for (const [name, value] of Object.entries(tokens)) {
    if (accent === 'custom') root.style.setProperty(name, value)
    else root.style.removeProperty(name)
  }
  root.dataset.density = density
  root.lang = resolveAppLanguage(language)
}

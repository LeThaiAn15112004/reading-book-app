/**
 * Map persisted reading-session theme fields ↔ ResolvedReadingPrefs.
 * Platform-agnostic — callers supply a plain session DTO (IPC / SQLite / MMKV).
 */

import {
  isFontFamily,
  isFontWeight,
  isTextAlign,
  resolveReadingPrefs,
  type GlobalReadingPrefs,
  type ReadingLayout,
  type ReadingMarginPreset,
  type ResolvedReadingPrefs,
} from './reading-prefs.js'

export const READING_FONT_SIZE_MIN = 12
export const READING_FONT_SIZE_MAX = 32

/** Plain session theme fields (matches desktop overlay getSessionState subset). */
export type ReadingSessionPrefsFields = {
  fontFamily?: string
  fontSize?: number
  fontWeight?: string | number
  lineHeight?: number
  textAlign?: string
  layoutMode?: string
  marginsEnabled?: boolean
  marginPreset?: string
}

export function clampReadingFontSize(px: number): number {
  return Math.min(
    READING_FONT_SIZE_MAX,
    Math.max(READING_FONT_SIZE_MIN, px),
  )
}

export function parseReadingLayoutMode(
  value: string | undefined,
): ReadingLayout | undefined {
  if (value === 'dual' || value === 'triple') return 'dual'
  if (value === 'single') return 'single'
  return undefined
}

function parseMarginPreset(
  value: string | undefined,
): ReadingMarginPreset | undefined {
  return value === 'narrow' || value === 'wide' || value === 'normal'
    ? value
    : undefined
}

/**
 * Hydrate per-book reading prefs from a session row.
 * `fallback` supplies defaults when session fields are absent; its `theme` is unused.
 */
export function readingPrefsFromSession(
  session: ReadingSessionPrefsFields | null | undefined,
  fallback: ResolvedReadingPrefs,
): ResolvedReadingPrefs {
  if (!session) return fallback
  const appDefaults: GlobalReadingPrefs = {
    ...fallback,
    theme: 'night',
  }
  return resolveReadingPrefs(
    {
      fontFamily: isFontFamily(session.fontFamily)
        ? session.fontFamily
        : undefined,
      fontSize:
        typeof session.fontSize === 'number' && Number.isFinite(session.fontSize)
          ? clampReadingFontSize(session.fontSize)
          : undefined,
      fontWeight: isFontWeight(Number(session.fontWeight))
        ? (Number(session.fontWeight) as ResolvedReadingPrefs['fontWeight'])
        : undefined,
      lineHeight:
        typeof session.lineHeight === 'number' &&
        Number.isFinite(session.lineHeight)
          ? Math.min(2.3, Math.max(1.3, session.lineHeight))
          : undefined,
      textAlign: isTextAlign(session.textAlign) ? session.textAlign : undefined,
      layout: parseReadingLayoutMode(session.layoutMode),
      marginEnabled: session.marginsEnabled,
      margin: parseMarginPreset(session.marginPreset),
    },
    appDefaults,
  )
}

export function readingPrefsFromGlobal(
  globalPrefs: GlobalReadingPrefs,
): ResolvedReadingPrefs {
  return resolveReadingPrefs(null, globalPrefs)
}

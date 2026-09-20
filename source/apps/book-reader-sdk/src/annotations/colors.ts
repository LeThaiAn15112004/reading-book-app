/** Highlight color presets + validation (spec 2.1). */

export interface HighlightColorPreset {
  id: string
  label: string
  hex: string
}

export const HIGHLIGHT_COLOR_PRESETS: readonly HighlightColorPreset[] = [
  { id: 'yellow', label: 'Yellow', hex: '#FFEB3B' },
  { id: 'blue', label: 'Blue', hex: '#4FC3F7' },
  { id: 'green', label: 'Green', hex: '#81C784' },
  { id: 'pink', label: 'Pink', hex: '#F48FB1' },
  { id: 'purple', label: 'Purple', hex: '#B39DDB' },
]

export const DEFAULT_HIGHLIGHT_COLOR = '#FFEB3B'

/** Suggested tag chips (spec 2.2) — tags stay free-form strings. */
export const HIGHLIGHT_TAG_PRESETS: readonly string[] = ['Important', 'Vocabulary', 'Idea']

/** `#RRGGBB` or `#RRGGBBAA`. */
export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value.trim())
}

/**
 * Split a `colorHex` into its opaque part and alpha (0–1). Plain 6-digit rows (saved before the
 * alpha picker existed) use `fallbackAlpha`, so they keep rendering exactly as before.
 */
export function splitHighlightColor(
  colorHex: string,
  fallbackAlpha: number,
): { hex6: string; alpha: number } {
  const trimmed = colorHex.trim()
  const hex6 = trimmed.slice(0, 7)
  if (trimmed.length !== 9) return { hex6, alpha: fallbackAlpha }
  const parsed = Number.parseInt(trimmed.slice(7, 9), 16)
  return { hex6, alpha: Number.isFinite(parsed) ? parsed / 255 : fallbackAlpha }
}

export function withHighlightAlpha(hex6: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
  return `${hex6.slice(0, 7)}${a}`
}

/** Tags normalized for storage: trimmed, non-empty, de-duplicated case-insensitively, order kept. */
export function normalizeTags(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags ?? []) {
    const trimmed = tag.trim()
    const key = trimmed.toLowerCase()
    if (!trimmed || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

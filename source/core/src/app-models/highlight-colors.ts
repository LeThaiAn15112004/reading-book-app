/** Preset colors + validation for the highlight color picker (spec 2.1). */

export type HighlightColorPreset = { id: string; label: string; hex: string }

export const HIGHLIGHT_COLOR_PRESETS: HighlightColorPreset[] = [
  { id: 'yellow', label: 'Yellow', hex: '#FFEB3B' },
  { id: 'blue', label: 'Blue', hex: '#4FC3F7' },
  { id: 'green', label: 'Green', hex: '#81C784' },
  { id: 'pink', label: 'Pink', hex: '#F48FB1' },
  { id: 'purple', label: 'Purple', hex: '#B39DDB' },
]

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLOR_PRESETS[0]!.hex

/** `#RRGGBB` (legacy rows / preset picks) or `#RRGGBBAA` (explicit alpha from the color picker). */
export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value.trim())
}

/**
 * Splits a highlight `colorHex` into its opaque RGB part and an alpha (0-1). Rows saved before
 * the alpha picker existed are plain 6-digit hex with no encoded alpha — `fallbackAlpha` (the
 * style kind's historical fixed opacity, see `styleAttrsFor` in openEpubjs.ts) keeps those
 * rendering exactly as before.
 */
export function splitHighlightColor(
  colorHex: string,
  fallbackAlpha: number,
): { hex6: string; alpha: number } {
  const trimmed = colorHex.trim()
  const hex6 = trimmed.slice(0, 7)
  if (trimmed.length !== 9) return { hex6, alpha: fallbackAlpha }
  const parsed = parseInt(trimmed.slice(7, 9), 16)
  return { hex6, alpha: Number.isFinite(parsed) ? parsed / 255 : fallbackAlpha }
}

/** Encodes an alpha (0-1) into the `colorHex` `#RRGGBBAA` format the color picker reads/writes. */
export function withHighlightAlpha(hex6: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
  return `${hex6}${a}`
}

/** Suggested tag chips (spec 2.2) — tags stay free-form strings; this is just UI seeding. */
export const HIGHLIGHT_TAG_PRESETS = ['Important', 'Vocabulary', 'Idea']

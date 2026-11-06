/**
 * Custom accent color (Settings → Appearance → Accent Color → Custom): hex parsing, HSV ⇄ hex for the
 * picker, and the CSS tokens the custom accent drives on `<html>`.
 */

export type Hsv = { h: number; s: number; v: number }

/** `#abc`, `abc`, `#aabbcc`, `aabbcc` (any case) → `#aabbcc`; anything else → null. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw
      .split('')
      .map((c) => c + c)
      .join('')
      .toLowerCase()}`
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`
  return null
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}

/** h 0–360, s / v 0–1. */
export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

/** WCAG relative luminance (0–1). */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Text color for content drawn on the accent (filled buttons): whichever of dark / white contrasts more. */
export function onAccentColor(hex: string): string {
  const l = luminance(hex)
  const dark = 0.0137 // luminance of #0f172a, the themes' --lib-on-accent
  return (l + 0.05) / (dark + 0.05) >= 1.05 / (l + 0.05) ? '#0f172a' : '#ffffff'
}

/** Accent tokens (same set the preset rules in styles/appearance.css override) for a custom hex. */
export function customAccentTokens(hex: string): Record<string, string> {
  const [r, g, b] = hexToRgb(hex)
  return {
    '--accent': hex,
    '--lib-accent': hex,
    '--lib-accent-hover': `color-mix(in srgb, ${hex} 82%, black)`,
    '--lib-accent-soft': `rgb(${r} ${g} ${b} / 0.14)`,
    '--lib-accent-ring': `rgb(${r} ${g} ${b} / 0.3)`,
    '--lib-on-accent': onAccentColor(hex),
  }
}

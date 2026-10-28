/**
 * Typewriter fonts: the shipped families, their real faces and which characters they cover.
 * Data only — the bytes live in the desktop app (`assets/fonts/typewriter/`, see its COVERAGE.md).
 */

export type TypewriterFamilyId = 'noto-sans' | 'noto-serif' | 'noto-sans-mono'

export interface TypewriterFamilyInfo {
  id: TypewriterFamilyId
  label: string
  /** False when the family ships no italic face (italic is then disabled, never synthesized). */
  hasItalic: boolean
}

export interface EmbeddedFontFaceInfo {
  /** Stable key, e.g. `noto-sans:bi`. */
  id: string
  family: TypewriterFamilyId
  bold: boolean
  italic: boolean
  /** File name inside `assets/fonts/typewriter/`. */
  file: string
  /** Base name used for the PDF `/BaseFont`. */
  psName: string
}

export const TYPEWRITER_DEFAULT_FAMILY: TypewriterFamilyId = 'noto-sans'

export const typewriterFamilies: readonly TypewriterFamilyInfo[] = [
  { id: 'noto-sans', label: 'Noto Sans', hasItalic: true },
  { id: 'noto-serif', label: 'Noto Serif', hasItalic: true },
  { id: 'noto-sans-mono', label: 'Noto Sans Mono', hasItalic: false },
]

function face(family: TypewriterFamilyId, base: string, bold: boolean, italic: boolean): EmbeddedFontFaceInfo {
  const style = bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular'
  return {
    id: `${family}:${bold ? 'b' : ''}${italic ? 'i' : ''}`,
    family,
    bold,
    italic,
    file: `${base}-${style}.ttf`,
    psName: `${base}-${style}`,
  }
}

export const typewriterFontFaces: readonly EmbeddedFontFaceInfo[] = [
  face('noto-sans', 'NotoSans', false, false),
  face('noto-sans', 'NotoSans', true, false),
  face('noto-sans', 'NotoSans', false, true),
  face('noto-sans', 'NotoSans', true, true),
  face('noto-serif', 'NotoSerif', false, false),
  face('noto-serif', 'NotoSerif', true, false),
  face('noto-serif', 'NotoSerif', false, true),
  face('noto-serif', 'NotoSerif', true, true),
  face('noto-sans-mono', 'NotoSansMono', false, false),
  face('noto-sans-mono', 'NotoSansMono', true, false),
]

export function isTypewriterFamily(value: unknown): value is TypewriterFamilyId {
  return typewriterFamilies.some((f) => f.id === value)
}

export function familyHasItalic(family: TypewriterFamilyId): boolean {
  return typewriterFamilies.find((f) => f.id === family)?.hasItalic ?? false
}

/** The real face for a style. A missing italic falls back to the upright face of the same weight. */
export function faceFor(family: TypewriterFamilyId, bold: boolean, italic: boolean): EmbeddedFontFaceInfo {
  const exact = typewriterFontFaces.find((f) => f.family === family && f.bold === bold && f.italic === italic)
  if (exact) return exact
  const upright = typewriterFontFaces.find((f) => f.family === family && f.bold === bold && !f.italic)
  return upright ?? faceFor(TYPEWRITER_DEFAULT_FAMILY, bold, italic)
}

/**
 * Code points every shipped face draws (verified against the font files by `spike:pdf:typewriter-font`):
 * Basic Latin, Latin-1, Latin Extended-A, ơ Ơ ư Ư, the Vietnamese block U+1EA0–1EF9 and common punctuation.
 */
export const TYPEWRITER_COVERED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x20, 0x7e],
  [0xa0, 0xac], // U+00AD (soft hyphen) is stripped by `normalizeTypewriterText`: Noto Sans Mono has no glyph for it
  [0xae, 0xff],
  [0x100, 0x17f],
  [0x1a0, 0x1a1],
  [0x1af, 0x1b0],
  [0x1ea0, 0x1ef9],
  [0x2013, 0x2014],
  [0x2018, 0x201e],
  [0x2022, 0x2022],
  [0x2026, 0x2026],
  [0x20ac, 0x20ac],
]

/** Per-family coverage; every shipped family has the same table today. */
export function familyCovers(_family: TypewriterFamilyId, cp: number): boolean {
  if (cp === 0x0a) return true
  return TYPEWRITER_COVERED_RANGES.some(([a, b]) => cp >= a && cp <= b)
}

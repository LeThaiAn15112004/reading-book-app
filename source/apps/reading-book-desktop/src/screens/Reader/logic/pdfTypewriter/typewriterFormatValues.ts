import {
  STYLE_KEYS,
  alignAt,
  effectiveStyle,
  isTypewriterColor,
  typingStyle,
  type PdfTypewriterDoc,
  type TypewriterAlign,
  type TypewriterTextStyle,
} from '@reading-book/book-reader-sdk'
import type { TypewriterFormatValues } from '../../components/rightPanel/TypewriterFormatControls'

/**
 * What the format controls show. `range` non-collapsed → the values of every character in it (a key whose value
 * differs is `mixed`); a collapsed `range` → the style typed text would take (with the pending patch); `null`
 * (a note selected, not being edited) → the whole box: `base`, with the keys any run overrides marked mixed.
 */
export function typewriterFormatValues(
  doc: PdfTypewriterDoc,
  text: string,
  range: { start: number; end: number } | null,
  pending: Partial<TypewriterTextStyle> | null,
): TypewriterFormatValues {
  const mixed = new Set<keyof TypewriterTextStyle>()
  if (range === null) {
    for (const run of doc.runs) for (const k of STYLE_KEYS) if (run.style[k] !== undefined) mixed.add(k)
    const aligns = new Set<TypewriterAlign>(doc.align.map((a) => a.align))
    const paragraphs = text.split('\n').length
    if (doc.align.length < paragraphs) aligns.add('left')
    return { style: { ...doc.base }, mixed, align: aligns.size > 1 ? 'mixed' : ([...aligns][0] ?? 'left') }
  }
  if (range.start === range.end || text.length === 0) {
    return { style: typingStyle(doc, text, range.start, pending ?? undefined), mixed, align: alignAt(doc, text, range.start) }
  }
  const first = effectiveStyle(doc, range.start)
  for (let i = range.start + 1; i < range.end; i++) {
    const s = effectiveStyle(doc, i)
    for (const k of STYLE_KEYS) if (s[k] !== first[k]) mixed.add(k)
  }
  const aligns = new Set<TypewriterAlign>()
  for (let i = range.start; i < range.end; i++) if (i === range.start || text[i - 1] === '\n') aligns.add(alignAt(doc, text, i))
  return { style: first, mixed, align: aligns.size > 1 ? 'mixed' : ([...aligns][0] ?? 'left') }
}

/** `#1E88E5` or `1e88e5` → `#1E88E5`; anything else → null. */
export function parseHexInput(raw: string): string | null {
  const t = raw.trim()
  const hex = t.startsWith('#') ? t : `#${t}`
  return isTypewriterColor(hex) ? hex.toUpperCase() : null
}

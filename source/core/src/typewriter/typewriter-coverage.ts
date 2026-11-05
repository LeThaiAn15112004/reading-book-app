/**
 * Which characters of a Typewriter note no shipped face can draw (FR-026).
 * Rule: a character missing from the chosen family falls back to the default family; if that misses it
 * too the character is unsupported and the note stays "not in the file" with the list shown.
 */

import { effectiveStyle, type PdfTypewriterDoc } from './typewriter-doc.js'
import { familyCovers, TYPEWRITER_DEFAULT_FAMILY } from './typewriter-fonts.js'

export type TypewriterCoverage = { ok: true } | { ok: false; characters: string[] }

export function checkCoverage(text: string, doc: PdfTypewriterDoc): TypewriterCoverage {
  const bad = new Set<string>()
  let offset = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const family = effectiveStyle(doc, offset).family
    if (!familyCovers(family, cp) && !familyCovers(TYPEWRITER_DEFAULT_FAMILY, cp)) bad.add(ch)
    offset += ch.length
  }
  return bad.size === 0 ? { ok: true } : { ok: false, characters: [...bad] }
}

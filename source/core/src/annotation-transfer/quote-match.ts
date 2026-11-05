/**
 * Confident re-anchoring of an annotation by its quote in plain text (specs/006-annotation-import-export, FR-011, TXT only).
 * Used when a TXT file is not the text the annotation was made on: the position is taken from the text only when the quote
 * is found exactly and unambiguously — never guessed.
 */
import type { NoteSelectionText } from '../domain/index.js'

export interface QuoteMatch {
  /** UTF-16 index of the first character of the quote in the text. */
  start: number
  /** UTF-16 index after the last character (half-open). */
  end: number
}

/** All start indices where `quote` occurs in `text` (overlapping occurrences included). */
function occurrences(text: string, quote: string): number[] {
  const found: number[] = []
  let from = 0
  for (;;) {
    const at = text.indexOf(quote, from)
    if (at < 0) return found
    found.push(at)
    from = at + 1
  }
}

/**
 * The position of `quote` in `text`, or null.
 *
 * - not found → null;
 * - found once → that position;
 * - found several times → only when the text around it matches the stored `context` (`before` / `after`, whichever are given)
 *   at exactly one of the occurrences; otherwise null (ambiguous).
 */
export function anchorByQuote(text: string, quote: string | undefined, context?: Pick<NoteSelectionText, 'before' | 'after'>): QuoteMatch | null {
  if (!quote) return null
  const at = occurrences(text, quote)
  if (at.length === 0) return null
  if (at.length === 1) return { start: at[0]!, end: at[0]! + quote.length }

  const before = context?.before
  const after = context?.after
  if (!before && !after) return null
  const fits = at.filter((start) => {
    if (before && text.slice(Math.max(0, start - before.length), start) !== before) return false
    if (after && text.slice(start + quote.length, start + quote.length + after.length) !== after) return false
    return true
  })
  return fits.length === 1 ? { start: fits[0]!, end: fits[0]! + quote.length } : null
}

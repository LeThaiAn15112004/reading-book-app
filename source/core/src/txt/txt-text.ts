/**
 * Canonical TXT text — the one string every TXT offset refers to.
 *
 * Contract (docs/implementation_plan/txt_reader.md §3):
 *  - the canonical text is the decoded file WITHOUT its BOM and with every line break (`\r\n`, lone
 *    `\r`) turned into a single `\n`;
 *  - an offset is a UTF-16 code-unit index into that string — exactly what `String.prototype.slice`,
 *    `textarea.selectionStart` and the FTS chunker's `TextParagraph.offset` use, so the same number
 *    is valid when it is saved, rendered, restored and indexed;
 *  - the app never writes a BOM or CRLF back: edited text is stored as UTF-8 with `\n`.
 */

export const TXT_BOM_CHAR = '\uFEFF'

/** Largest TXT file the reader opens at all (bytes on disk / in the edited copy). */
export const TXT_MAX_FILE_BYTES = 16 * 1024 * 1024
/**
 * Longest text (UTF-16 code units) the reading surface lets the user edit. Above it the book still
 * opens and can be read and annotated, but typing is off: every keystroke re-lays out the whole text
 * box, which costs roughly 0.35 s per key at 1 million characters (measured, docs/implementation_plan/
 * txt_reader.md §7) — fine at a few hundred thousand, not beyond.
 */
export const TXT_EDIT_MAX_CHARS = 400_000
/** Longest quote (`selectionText.highlight`) stored with an annotation, in UTF-16 code units. */
export const TXT_QUOTE_MAX_CHARS = 5000
/** Context kept before/after an annotation's quote, in UTF-16 code units. */
export const TXT_CONTEXT_CHARS = 40

export type TxtBomEncoding = 'utf-8' | 'utf-16le' | 'utf-16be'

export interface TxtBom {
  encoding: TxtBomEncoding
  /** Bytes the BOM occupies at the start of the file. */
  length: number
}

/** Byte-order mark at the start of `bytes`, or null. */
export function detectTxtBom(bytes: Uint8Array): TxtBom | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', length: 3 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', length: 2 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', length: 2 }
  }
  return null
}

/** Decoded file text → canonical text (one leading BOM dropped, every line break → `\n`). */
export function normalizeTxtText(raw: string): string {
  const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return withoutBom.includes('\r') ? withoutBom.replace(/\r\n?/g, '\n') : withoutBom
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/** True when `offset` lies between two code points (never inside a surrogate pair). */
export function isCodePointBoundary(text: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return false
  if (offset === 0 || offset === text.length) return true
  return !(isHighSurrogate(text.charCodeAt(offset - 1)) && isLowSurrogate(text.charCodeAt(offset)))
}

export function clampTxtOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return 0
  return Math.min(Math.max(Math.trunc(offset), 0), length)
}

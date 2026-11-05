/**
 * TXT reading position — a `text-offset` location (UTF-16 code unit index into the canonical text),
 * stored in `books.reading_state_json.lastReadLocation` like an EPUB CFI or a PDF page.
 */

import { Location, TextOffsetLocation } from '../domain/index.js'
import { TXT_BLOCK_ID } from './txt-annotations.js'
import { clampTxtOffset } from './txt-text.js'

export function txtReadingLocation(offset: number, textLength: number): TextOffsetLocation {
  return new TextOffsetLocation(clampTxtOffset(offset, textLength), TXT_BLOCK_ID)
}

/**
 * Saved position → offset valid for a text of `textLength`. Anything that isn't a TXT location
 * (absent, malformed, another format's) starts at the top; an offset past the end — the text got
 * shorter since — clamps to the end.
 */
export function resolveTxtReadingOffset(
  location: Location | string | undefined | null,
  textLength: number,
): number {
  let parsed: Location | undefined
  if (typeof location === 'string') {
    try {
      parsed = Location.parse(location)
    } catch {
      return 0
    }
  } else if (location) {
    parsed = location
  }
  if (!(parsed instanceof TextOffsetLocation)) return 0
  return clampTxtOffset(parsed.offset, textLength)
}

/** 0–1 share of the text above `offset`. */
export function txtReadingProgress(offset: number, textLength: number): number {
  if (textLength <= 0) return 0
  return Math.min(1, Math.max(0, offset / textLength))
}

/** Whole-number percent for the Library shelf. */
export function txtReadingPercent(offset: number, textLength: number): number {
  return Math.round(txtReadingProgress(offset, textLength) * 100)
}

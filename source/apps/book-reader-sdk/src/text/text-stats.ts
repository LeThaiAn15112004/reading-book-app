/**
 * Pure Foxit-style text statistics (Words / Characters / Lines / Non-Asian words / Asian
 * characters) accumulated over `book_chunks.content` (desktop: `word-count-service.ts`). No I/O
 * — a plain reducer over strings, so it can run against any source of chunk text.
 */

export interface TextStats {
  charactersWithSpaces: number
  charactersNoSpaces: number
  /** Paragraph count — the closest stable, index-derived analog of "lines" for reflowable text;
   *  an EPUB has no fixed visual line count (that depends on viewport width/font size/zoom at
   *  render time), but paragraph breaks are baked into `book_chunks.content` as `\n\n` (see
   *  `chunk-text.ts`'s `chunkParagraphs`), so this is exact and index-derived. */
  lines: number
  /** Word count for space-delimited scripts (Latin, Cyrillic, Vietnamese, …). */
  nonAsianWords: number
  /** Individual CJK ideograph / Kana / Hangul characters — those scripts don't use word
   *  boundaries, so they're counted per character instead, same convention as Word/Foxit. */
  asianCharacters: number
}

/** Han ideographs, Hiragana/Katakana, and Hangul syllables/jamo — grouped as one "Asian
 *  characters, Korean" stat, matching Foxit's own combined row. */
const ASIAN_CHAR_REGEX =
  /[ᄀ-ᇿ぀-ヿ㐀-䶿一-鿿가-힣豈-﫿]/g

const WHITESPACE_REGEX = /\s+/g

export function createTextStats(): TextStats {
  return {
    charactersWithSpaces: 0,
    charactersNoSpaces: 0,
    lines: 0,
    nonAsianWords: 0,
    asianCharacters: 0,
  }
}

/** Folds one chunk's `content` into a running `TextStats` total. */
export function accumulateTextStats(stats: TextStats, content: string): void {
  stats.charactersWithSpaces += content.length
  stats.charactersNoSpaces += content.replace(WHITESPACE_REGEX, '').length
  stats.lines += content.split('\n\n').filter((paragraph) => paragraph.trim().length > 0).length

  const asianMatches = content.match(ASIAN_CHAR_REGEX)
  stats.asianCharacters += asianMatches?.length ?? 0

  // Non-Asian word count: same whitespace split as elsewhere, but over the text with Asian
  // characters removed first, so a run of CJK glyphs doesn't also get counted as a "word".
  const withoutAsian = content.replace(ASIAN_CHAR_REGEX, ' ').trim()
  stats.nonAsianWords += withoutAsian ? withoutAsian.split(WHITESPACE_REGEX).length : 0
}

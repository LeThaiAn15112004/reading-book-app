/**
 * In-book full-text search primitives, shared by both sides of the search:
 *
 * - Main uses them to build the FTS5 `MATCH` expression over `book_chunks_fts` and then to count
 *   exact occurrences / word positions inside the candidate chunks FTS5 returns.
 * - The renderer uses the very same matcher to find occurrence N inside a rendered EPUB section.
 *
 * Both sides must agree on what a "word" and a "match" are, which is why this lives in the SDK.
 *
 * The rules mirror SQLite's `unicode61` tokenizer (see migration 021): a word is a run of letters,
 * numbers, combining marks and private-use characters; everything else separates words. That
 * keeps JS matches (practically) a subset of what FTS5 selects, so the chunks FTS5 skips hold no
 * JS match either.
 */

/** Same token classes as FTS5 `unicode61` (`L* N* Co`, plus combining marks, which it keeps in-token). */
const WORD_CHAR = '[\\p{L}\\p{N}\\p{M}\\p{Co}]'
const NON_WORD_CHAR = '[^\\p{L}\\p{N}\\p{M}\\p{Co}]'
const WORD_RUN = new RegExp(`${WORD_CHAR}+`, 'gu')
const IS_WORD_CHAR = new RegExp(`^${WORD_CHAR}$`, 'u')
/** A base character plus the combining marks that follow it (or stray marks). */
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu
const MARKS = /\p{M}+/gu
const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\/]/g
/** Inside `[...]` (`u` flag): only these need a backslash — and `\-` is only legal in here. */
const CLASS_SPECIALS = /[\\\]^-]/g

/** Longer queries are cut (FTS5 phrase cost and regex size both grow with token count). */
export const TEXT_SEARCH_MAX_TOKENS = 32
/**
 * A trailing token shorter than this is matched as a whole word, never as a prefix: `a*` would
 * expand to every indexed term starting with "a" in the whole library (the FTS5 `prefix='2 3'`
 * indexes only cover 2- and 3-character prefixes).
 */
export const TEXT_SEARCH_MIN_PREFIX_CHARS = 2

export interface TextSearchOptions {
  /** "Hello" does not match "hello". */
  matchCase: boolean
  /** "viet" does not match "Việt". Off by default — FTS5 folds diacritics in the index. */
  matchDiacritics: boolean
  /** "read" does not match "reader". Off: the last query word also matches as a word prefix. */
  wholeWords: boolean
}

export const DEFAULT_TEXT_SEARCH_OPTIONS: Readonly<TextSearchOptions> = Object.freeze({
  matchCase: false,
  matchDiacritics: false,
  wholeWords: false,
})

/** A parsed, non-empty query. Build it once, reuse for FTS and for every chunk / section. */
export interface TextSearchQuery {
  /** Query words in order (unicode61 tokens of the raw input, NFC). */
  tokens: readonly string[]
  /** True when the last token also matches longer words (search-as-you-type friendly). */
  prefixLast: boolean
  options: Readonly<TextSearchOptions>
}

/** Half-open `[start, end)` UTF-16 offsets into the searched text. */
export interface TextMatch {
  start: number
  end: number
}

export interface TextMatcher {
  readonly query: TextSearchQuery
  /** Every match in `text`, in order, non-overlapping. */
  find(text: string): TextMatch[]
}

/** unicode61-compatible word tokens of `text`. */
export function searchTokens(text: string): string[] {
  return text.match(WORD_RUN) ?? []
}

/**
 * Number of words starting before `end` (default: the whole text) — the unit of
 * `book_chunks.word_count`, and, for a match start, the 0-based index of the matched word.
 */
export function countSearchWords(text: string, end = text.length): number {
  let count = 0
  const re = new RegExp(WORD_RUN.source, 'gu')
  for (let word = re.exec(text); word && word.index < end; word = re.exec(text)) count += 1
  return count
}

/** Parse raw user input. Returns null when it holds no searchable word. */
export function parseTextSearchQuery(
  raw: string,
  options: Partial<TextSearchOptions> = {},
): TextSearchQuery | null {
  const merged: TextSearchOptions = { ...DEFAULT_TEXT_SEARCH_OPTIONS, ...options }
  const tokens = searchTokens(raw.normalize('NFC')).slice(0, TEXT_SEARCH_MAX_TOKENS)
  const last = tokens[tokens.length - 1]
  if (last === undefined) return null
  return {
    tokens,
    prefixLast: !merged.wholeWords && Array.from(last).length >= TEXT_SEARCH_MIN_PREFIX_CHARS,
    options: merged,
  }
}

/**
 * FTS5 `MATCH` expression for the query: one phrase (tokens must be adjacent, in order), with a
 * prefix star on the last token when `prefixLast`. Tokens only ever contain word characters, so
 * wrapping them in double quotes can't be broken out of — no FTS5 syntax injection (`OR`, `NEAR`,
 * column filters, stray quotes are all impossible).
 */
export function toFts5MatchExpression(query: TextSearchQuery): string {
  return `"${query.tokens.join(' ')}"${query.prefixLast ? '*' : ''}`
}

// ---------------------------------------------------------------------------------------------
// Matching. Case / diacritic variants are compiled INTO the regex; the searched text is never
// rewritten, so a match's offsets are offsets into the original string (no folding pass over the
// book, no offset map) and the scan runs at native regex speed.
// ---------------------------------------------------------------------------------------------

/**
 * Code points scanned to learn which characters fold together: Latin (incl. Vietnamese, Latin
 * Extended Additional), Greek, Cyrillic, Hebrew, Arabic, Indic scripts, kana… Hangul syllables
 * (U+AC00+) decompose into several jamo rather than base + marks, so they never fold to one char.
 */
const FOLD_SCAN_END = 0x3100

/** `base char -> every char that folds to it`, per case mode. Built lazily, once per process. */
const variantTables = new Map<boolean, Map<string, string[]>>()

function stripDiacritics(text: string, matchCase: boolean): string {
  const base = text.normalize('NFD').replace(MARKS, '')
  return matchCase ? base : base.toLowerCase()
}

function variantTable(matchCase: boolean): Map<string, string[]> {
  let table = variantTables.get(matchCase)
  if (table) return table
  table = new Map()
  const letterOrNumber = /[\p{L}\p{N}]/u
  for (let code = 0; code < FOLD_SCAN_END; code += 1) {
    const char = String.fromCharCode(code)
    if (!letterOrNumber.test(char)) continue
    const folded = stripDiacritics(char, matchCase)
    if (folded.length !== 1) continue
    const variants = table.get(folded)
    if (variants) variants.push(char)
    else table.set(folded, [char])
  }
  variantTables.set(matchCase, table)
  return table
}

function escapeRegExp(text: string): string {
  return text.replace(REGEXP_SPECIALS, '\\$&')
}

function escapeClassChar(char: string): string {
  return char.replace(CLASS_SPECIALS, '\\$&')
}

/**
 * Diacritic-insensitive pattern for one query character: every character that folds to the same
 * base ("e" -> [eèéẹẻẽêềếệểễ…]), then `\p{M}*` so decomposed text ("e" + U+0323 + U+0302) is
 * covered too and the match spans the whole letter.
 */
function foldedCharPattern(char: string, matchCase: boolean): string {
  const folded = stripDiacritics(char, matchCase)
  if (folded.length === 0) return '' // a lone combining mark in the query — ignored, like FTS5
  const variants = folded.length === 1 ? variantTable(matchCase).get(folded) : undefined
  const body =
    variants && variants.length > 1
      ? `[${variants.map(escapeClassChar).join('')}]`
      : escapeRegExp(folded.length === 1 ? folded : char)
  return `${body}\\p{M}*`
}

/**
 * Diacritic-sensitive pattern for one query cluster: its precomposed or decomposed spelling, and
 * no further combining mark after it ("e" must not match the "e" of a decomposed "é").
 */
function exactClusterPattern(cluster: string): string {
  const composed = cluster.normalize('NFC')
  const decomposed = cluster.normalize('NFD')
  const body =
    composed === decomposed
      ? escapeRegExp(composed)
      : `(?:${escapeRegExp(composed)}|${escapeRegExp(decomposed)})`
  return `${body}(?!\\p{M})`
}

function tokenPattern(token: string, options: Readonly<TextSearchOptions>): string {
  if (options.matchDiacritics) {
    return (token.match(CLUSTER) ?? []).map(exactClusterPattern).join('')
  }
  return Array.from(token)
    .map((char) => foldedCharPattern(char, options.matchCase))
    .join('')
}

/** True when the character (code point) ending right before `index` is a word character. */
function wordCharBefore(text: string, index: number): boolean {
  if (index <= 0) return false
  const low = text.charCodeAt(index - 1)
  const start = low >= 0xdc00 && low <= 0xdfff && index >= 2 ? index - 2 : index - 1
  return IS_WORD_CHAR.test(text.slice(start, index))
}

/**
 * Exact matcher for a query: tokens in order, separated in the text by any run of non-word
 * characters (so "old man" matches "old, man" — the same adjacency rule as an FTS5 phrase),
 * starting on a word boundary, and ending on one unless the last token is a prefix.
 *
 * The start boundary is checked in JS on each candidate instead of as a leading `(?<!…)` in the
 * regex: a leading lookbehind runs at EVERY position of the text, and on non-Latin-1 text (all of
 * Vietnamese) each run is a Unicode-property lookup — ~10x slower on a whole book.
 */
export function createTextMatcher(query: TextSearchQuery): TextMatcher {
  const parts = query.tokens
    .map((token) => tokenPattern(token, query.options))
    .filter((part) => part.length > 0)

  const pattern =
    parts.length === 0
      ? null
      : new RegExp(
          `${parts.join(`${NON_WORD_CHAR}+`)}${query.prefixLast ? '' : `(?!${WORD_CHAR})`}`,
          query.options.matchCase ? 'gu' : 'giu',
        )

  return {
    query,
    find(text: string): TextMatch[] {
      if (!pattern || !text) return []
      const re = new RegExp(pattern) // own lastIndex: find() is re-entrant
      const matches: TextMatch[] = []
      for (let found = re.exec(text); found; found = re.exec(text)) {
        if (found[0].length === 0 || wordCharBefore(text, found.index)) {
          // Mid-word hit ("heory" in "theory"): retry one code point later — a real match may
          // start inside the rejected span. (Stepping into a surrogate pair would make a `u`
          // regex back up to the same spot forever.)
          re.lastIndex = found.index + ((text.codePointAt(found.index) ?? 0) > 0xffff ? 2 : 1)
          continue
        }
        matches.push({ start: found.index, end: found.index + found[0].length })
      }
      return matches
    },
  }
}

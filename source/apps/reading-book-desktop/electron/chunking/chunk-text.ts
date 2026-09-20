/**
 * Pure paragraph → chunk packer for the `book_chunks` table (FTS / RAG input).
 * No I/O and no Electron imports so it can run inside a worker thread.
 */

/** A chunk closes as soon as it reaches this many words. */
export const CHUNK_TARGET_WORDS = 400
/** A chunk never grows past this many words (paragraphs/sentences are split to honour it). */
export const CHUNK_MAX_WORDS = 500
/** Guard for scripts without spaces (CJK) where a "word" is an entire paragraph. */
const CHUNK_MAX_CHARS = 4000

export interface TextParagraph {
  /** Spine index for EPUB, always 0 for single-flow formats (txt/md). */
  chapterIndex: number
  /** Char offset of the paragraph inside the chapter's normalised text. */
  offset: number
  text: string
}

export interface TextChunk {
  chunkIndex: number
  content: string
  /** `Location.toString()`-compatible JSON (`kind: 'text-offset'`). */
  locationStart: string
  locationEnd: string
}

interface Unit {
  start: number
  end: number
  words: number
}

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/**
 * Same wire shape as the bookmark locators written by migration 017:
 * `TextOffsetLocation` JSON plus `chapterIndex` (used as the coarse jump fallback).
 * `blockId` is `spine:<n>` — real per-node CFIs need a DOM and only exist in the renderer.
 */
export function textOffsetLocationJson(chapterIndex: number, offset: number): string {
  return JSON.stringify({
    kind: 'text-offset',
    offset,
    blockId: `spine:${chapterIndex}`,
    chapterIndex,
  })
}

/** Sentence-ish units of a paragraph, each one hard-split to fit CHUNK_MAX_WORDS. */
function splitOversized(text: string): Unit[] {
  const units: Unit[] = []

  for (const match of text.matchAll(/[^.!?…。！？]+[.!?…。！？]*\s*/g)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    const words = countWords(match[0])
    if (words <= CHUNK_MAX_WORDS && match[0].length <= CHUNK_MAX_CHARS) {
      units.push({ start, end, words })
      continue
    }

    // A single sentence longer than a chunk: slice by word windows, then by chars.
    const wordMatches = [...match[0].matchAll(/\S+/g)]
    if (wordMatches.length > 1) {
      for (let i = 0; i < wordMatches.length; i += CHUNK_TARGET_WORDS) {
        const first = wordMatches[i]
        const last = wordMatches[Math.min(i + CHUNK_TARGET_WORDS, wordMatches.length) - 1]
        const s = start + (first.index ?? 0)
        const e = start + (last.index ?? 0) + last[0].length
        units.push({ start: s, end: e, words: Math.min(CHUNK_TARGET_WORDS, wordMatches.length - i) })
      }
    } else {
      for (let s = start; s < end; s += CHUNK_MAX_CHARS) {
        units.push({ start: s, end: Math.min(s + CHUNK_MAX_CHARS, end), words: 1 })
      }
    }
  }

  return units
}

/** Break a paragraph that is too large for one chunk into ≤ target-sized paragraphs. */
function splitParagraph(paragraph: TextParagraph): TextParagraph[] {
  const pieces: TextParagraph[] = []
  let pieceStart = -1
  let pieceEnd = 0
  let pieceWords = 0

  const flush = () => {
    if (pieceStart < 0) return
    const text = paragraph.text.slice(pieceStart, pieceEnd).trim()
    if (text) {
      pieces.push({
        chapterIndex: paragraph.chapterIndex,
        offset: paragraph.offset + pieceStart,
        text,
      })
    }
    pieceStart = -1
    pieceWords = 0
  }

  for (const unit of splitOversized(paragraph.text)) {
    if (pieceStart >= 0 && pieceWords + unit.words > CHUNK_TARGET_WORDS) flush()
    if (pieceStart < 0) pieceStart = unit.start
    pieceEnd = unit.end
    pieceWords += unit.words
  }
  flush()

  return pieces
}

/**
 * Pack paragraphs into ~300–500 word chunks along paragraph boundaries.
 * A chunk never crosses a chapter boundary, so `chapterIndex` in its location is exact.
 */
export function* chunkParagraphs(paragraphs: Iterable<TextParagraph>): Generator<TextChunk> {
  let chunkIndex = 0
  let parts: TextParagraph[] = []
  let words = 0

  const flush = (): TextChunk | null => {
    if (parts.length === 0) return null
    const first = parts[0]
    const last = parts[parts.length - 1]
    const chunk: TextChunk = {
      chunkIndex: chunkIndex++,
      content: parts.map((p) => p.text).join('\n\n'),
      locationStart: textOffsetLocationJson(first.chapterIndex, first.offset),
      locationEnd: textOffsetLocationJson(last.chapterIndex, last.offset + last.text.length),
    }
    parts = []
    words = 0
    return chunk
  }

  for (const raw of paragraphs) {
    const text = raw.text.trim()
    if (!text) continue

    const paragraph: TextParagraph = { ...raw, text }
    const paragraphWords = countWords(text)
    const candidates =
      paragraphWords > CHUNK_MAX_WORDS || text.length > CHUNK_MAX_CHARS
        ? splitParagraph(paragraph)
        : [paragraph]

    for (const candidate of candidates) {
      const candidateWords = countWords(candidate.text)
      const chapterChanged =
        parts.length > 0 && parts[0].chapterIndex !== candidate.chapterIndex

      if (chapterChanged || (parts.length > 0 && words + candidateWords > CHUNK_MAX_WORDS)) {
        const chunk = flush()
        if (chunk) yield chunk
      }

      parts.push(candidate)
      words += candidateWords

      if (words >= CHUNK_TARGET_WORDS) {
        const chunk = flush()
        if (chunk) yield chunk
      }
    }
  }

  const tail = flush()
  if (tail) yield tail
}

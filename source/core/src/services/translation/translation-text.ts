/**
 * Pure text helpers for translation: make arbitrary reader selections safe to feed a seq2seq
 * model, and split long input into model-sized segments that can be joined back losslessly.
 */

// C0/C1 control chars except \t \n \r, zero-width chars, BOM, and bidi overrides — invisible,
// but they either break tokenization or make the model hallucinate.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‍⁠﻿‪-‮⁦-⁩]/g
const SOFT_HYPHEN = /­/g
const HORIZONTAL_SPACE = /[ \t   -   　]+/g

/**
 * Normalizes input for translation. Keeps paragraph structure (blank lines) because the caller
 * reassembles paragraphs; line breaks *inside* a paragraph are hard-wrap artifacts from
 * PDF/TXT sources and become spaces.
 */
export function sanitizeTranslationInput(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(SOFT_HYPHEN, '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\n/g, ' ').replace(HORIZONTAL_SPACE, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)
    .join('\n\n')
}

/** Whether the text contains anything a model could translate (letters, in any script). */
export function hasTranslatableContent(text: string): boolean {
  return /\p{L}/u.test(text)
}

export type TranslationPlan = {
  /** Segments to send to the model, in order. */
  segments: string[]
  /** For each paragraph, how many consecutive segments it owns (0 = pass-through paragraph). */
  paragraphs: { segmentCount: number; passthrough: string | null }[]
}

/**
 * Splits sanitized text into paragraphs, then each paragraph into sentences packed up to
 * `maxSegmentChars`. A single sentence longer than the limit is cut on word boundaries, and a
 * single word longer than the limit is hard-cut. Paragraphs with no letters (numbers, "***")
 * are passed through untranslated instead of wasting inference on them.
 */
export function planTranslation(text: string, maxSegmentChars: number): TranslationPlan {
  const segments: string[] = []
  const paragraphs: TranslationPlan['paragraphs'] = []

  for (const paragraph of text.split('\n\n')) {
    if (!hasTranslatableContent(paragraph)) {
      paragraphs.push({ segmentCount: 0, passthrough: paragraph })
      continue
    }
    const pieces = packPieces(splitSentences(paragraph), maxSegmentChars)
    segments.push(...pieces)
    paragraphs.push({ segmentCount: pieces.length, passthrough: null })
  }
  return { segments, paragraphs }
}

/** Inverse of `planTranslation`: stitches translated segments back into paragraphs. */
export function assembleTranslation(plan: TranslationPlan, translated: readonly string[]): string {
  let cursor = 0
  return plan.paragraphs
    .map(({ segmentCount, passthrough }) => {
      if (passthrough !== null) return passthrough
      const parts = translated.slice(cursor, cursor + segmentCount)
      cursor += segmentCount
      return parts.map((part) => part.trim()).join(' ')
    })
    .join('\n\n')
}

function splitSentences(paragraph: string): string[] {
  // Sentence end = terminal punctuation (+ closing quotes/brackets) followed by whitespace.
  // `Intl.Segmenter` would be better but is missing on Hermes (React Native).
  return paragraph
    .split(/(?<=[.!?…。！？]["'”’»)\]]*)\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
}

function packPieces(sentences: readonly string[], limit: number): string[] {
  const out: string[] = []
  let current = ''
  const flush = () => {
    if (current) out.push(current)
    current = ''
  }

  for (const sentence of sentences) {
    for (const piece of sentence.length > limit ? splitOversized(sentence, limit) : [sentence]) {
      if (!current) current = piece
      else if (current.length + 1 + piece.length <= limit) current += ` ${piece}`
      else {
        flush()
        current = piece
      }
    }
  }
  flush()
  return out
}

function splitOversized(sentence: string, limit: number): string[] {
  const out: string[] = []
  let current = ''
  for (const word of sentence.split(' ')) {
    if (word.length > limit) {
      if (current) out.push(current)
      current = ''
      for (let i = 0; i < word.length; i += limit) out.push(word.slice(i, i + limit))
    } else if (!current) current = word
    else if (current.length + 1 + word.length <= limit) current += ` ${word}`
    else {
      out.push(current)
      current = word
    }
  }
  if (current) out.push(current)
  return out
}

import {
  buildTxtSelectionText,
  packTxtHighlightLocator,
  type TxtReaderHighlight,
} from '../../src/txt/index.js'
import type { HighlightStyleKind } from '../../src/app-models/highlight-location.js'

/** Tiny seeded PRNG (mulberry32) so property tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomInt(next: () => number, low: number, highInclusive: number): number {
  return low + Math.floor(next() * (highInclusive - low + 1))
}

export const SAMPLE_TEXT = [
  'Chương 1: Khởi đầu',
  '',
  'Trời hôm nay rất đẹp. Tôi đi dạo trong công viên 🌳 và nghe chim hót.',
  'Line three has the word needle in it.',
  'Cuối cùng — hết. 😀👍',
].join('\n')

let counter = 0

/** A highlight row over `[startOffset, endOffset)` of `text` (quote taken from the text). */
export function makeHighlight(
  text: string,
  startOffset: number,
  endOffset: number,
  extra: Partial<TxtReaderHighlight> = {},
): TxtReaderHighlight {
  counter += 1
  const styleKind: HighlightStyleKind = extra.styleKind ?? 'highlight'
  return {
    id: extra.id ?? `h${counter}`,
    locatorRef: packTxtHighlightLocator({ startOffset, endOffset }),
    startOffset,
    endOffset,
    chapterIndex: 0,
    styleKind,
    colorHex: '#ffeb3b',
    tags: [],
    selectionText: buildTxtSelectionText(text, startOffset, endOffset),
    createdAt: extra.createdAt ?? `2026-10-18T00:00:${String(counter % 60).padStart(2, '0')}.000Z`,
    updatedAt: '2026-10-18T00:00:00.000Z',
    ...extra,
  }
}

/** Highlight over the first occurrence of `needle` in `text`. */
export function highlightOf(text: string, needle: string, extra: Partial<TxtReaderHighlight> = {}): TxtReaderHighlight {
  const at = text.indexOf(needle)
  if (at < 0) throw new Error(`needle not found: ${needle}`)
  return makeHighlight(text, at, at + needle.length, extra)
}

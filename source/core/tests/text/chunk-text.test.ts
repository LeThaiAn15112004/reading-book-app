import { describe, expect, it } from 'vitest'
import {
  CHUNK_MAX_WORDS,
  CHUNK_TARGET_WORDS,
  chunkParagraphs,
  textOffsetLocationJson,
  type TextParagraph,
} from '../../src/text/chunk-text.js'

const words = (n: number, word = 'lorem') => Array.from({ length: n }, () => word).join(' ')
const wordCount = (text: string) => text.trim().split(/\s+/).length

describe('chunkParagraphs', () => {
  it('yields nothing for empty or blank input', () => {
    expect([...chunkParagraphs([])]).toEqual([])
    expect([...chunkParagraphs([{ chapterIndex: 0, offset: 0, text: '   ' }])]).toEqual([])
  })

  it('packs small paragraphs of one chapter into a single chunk', () => {
    const chunks = [
      ...chunkParagraphs([
        { chapterIndex: 0, offset: 0, text: 'First paragraph.' },
        { chapterIndex: 0, offset: 20, text: 'Second paragraph.' },
      ]),
    ]
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({
      chunkIndex: 0,
      content: 'First paragraph.\n\nSecond paragraph.',
      locationStart: textOffsetLocationJson(0, 0),
      locationEnd: textOffsetLocationJson(0, 20 + 'Second paragraph.'.length),
    })
  })

  it('never lets a chunk cross a chapter boundary', () => {
    const chunks = [
      ...chunkParagraphs([
        { chapterIndex: 0, offset: 0, text: 'Chapter one.' },
        { chapterIndex: 1, offset: 0, text: 'Chapter two.' },
      ]),
    ]
    expect(chunks.map((c) => JSON.parse(c.locationStart).chapterIndex)).toEqual([0, 1])
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1])
  })

  it('splits an oversized paragraph so no chunk exceeds the max word count', () => {
    const sentence = `${words(50)}. `
    const paragraph: TextParagraph = { chapterIndex: 2, offset: 100, text: sentence.repeat(30) }
    const chunks = [...chunkParagraphs([paragraph])]

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(wordCount(chunk.content)).toBeLessThanOrEqual(CHUNK_MAX_WORDS)
    }
    const total = chunks.reduce((sum, c) => sum + wordCount(c.content), 0)
    expect(total).toBe(50 * 30)
  })

  it('hard-splits a single sentence longer than a chunk', () => {
    const chunks = [...chunkParagraphs([{ chapterIndex: 0, offset: 0, text: words(CHUNK_TARGET_WORDS * 3) }])]
    expect(chunks).toHaveLength(3)
    expect(chunks.every((c) => wordCount(c.content) === CHUNK_TARGET_WORDS)).toBe(true)
  })

  it('keeps offsets pointing into the source paragraph text', () => {
    const text = `${words(300, 'alpha')}. ${words(300, 'beta')}.`
    const [, second] = [...chunkParagraphs([{ chapterIndex: 0, offset: 1000, text }])]
    const start = JSON.parse(second!.locationStart).offset as number
    expect(text.slice(start - 1000).startsWith('beta')).toBe(true)
  })
})

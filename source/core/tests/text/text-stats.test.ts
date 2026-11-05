import { describe, expect, it } from 'vitest'
import { accumulateTextStats, createTextStats } from '../../src/text/text-stats.js'

describe('accumulateTextStats', () => {
  it('counts Latin / Vietnamese words, characters and paragraphs', () => {
    const stats = createTextStats()
    accumulateTextStats(stats, 'Xin chào thế giới\n\nHello world')

    expect(stats.nonAsianWords).toBe(6)
    expect(stats.lines).toBe(2)
    expect(stats.charactersWithSpaces).toBe('Xin chào thế giới\n\nHello world'.length)
    expect(stats.charactersNoSpaces).toBe('Xinchàothếgiới'.length + 'Helloworld'.length)
    expect(stats.asianCharacters).toBe(0)
  })

  it('counts CJK per character, not as words', () => {
    const stats = createTextStats()
    accumulateTextStats(stats, '日本語 text 한국어')

    expect(stats.asianCharacters).toBe(6)
    expect(stats.nonAsianWords).toBe(1)
  })

  it('accumulates across chunks and ignores blank paragraphs', () => {
    const stats = createTextStats()
    accumulateTextStats(stats, 'one two')
    accumulateTextStats(stats, 'three\n\n   \n\nfour')

    expect(stats.nonAsianWords).toBe(4)
    expect(stats.lines).toBe(3)
  })
})

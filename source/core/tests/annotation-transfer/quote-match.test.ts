import { describe, expect, it } from 'vitest'
import { anchorByQuote } from '../../src/annotation-transfer/index.js'

const TEXT = 'Trăm năm trong cõi người ta. Chữ tài chữ mệnh khéo là ghét nhau. Trăm năm là bao lâu?'

describe('anchorByQuote', () => {
  it('finds a quote that occurs once', () => {
    const m = anchorByQuote(TEXT, 'Chữ tài chữ mệnh')
    expect(m).toEqual({ start: TEXT.indexOf('Chữ tài'), end: TEXT.indexOf('Chữ tài') + 'Chữ tài chữ mệnh'.length })
    expect(TEXT.slice(m!.start, m!.end)).toBe('Chữ tài chữ mệnh')
  })

  it('refuses a quote that occurs more than once when there is no context', () => {
    expect(anchorByQuote(TEXT, 'Trăm năm')).toBeNull()
    expect(anchorByQuote(TEXT, 'Trăm năm', {})).toBeNull()
  })

  it('resolves an ambiguous quote by the text before or after it', () => {
    const first = TEXT.indexOf('Trăm năm')
    const second = TEXT.lastIndexOf('Trăm năm')
    expect(anchorByQuote(TEXT, 'Trăm năm', { after: ' trong cõi' })?.start).toBe(first)
    expect(anchorByQuote(TEXT, 'Trăm năm', { before: 'ghét nhau. ' })?.start).toBe(second)
    expect(anchorByQuote(TEXT, 'Trăm năm', { before: 'ghét nhau. ', after: ' là bao' })?.start).toBe(second)
  })

  it('stays ambiguous when the context fits none or more than one occurrence', () => {
    expect(anchorByQuote(TEXT, 'Trăm năm', { before: 'không có ' })).toBeNull()
    expect(anchorByQuote('ab ab ab', 'ab', { after: ' ' })).toBeNull()
  })

  it('accepts the start of the text, where the stored context is shorter', () => {
    expect(anchorByQuote('ab cd ab ef', 'ab', { before: '' , after: ' ef' })?.start).toBe(6)
    expect(anchorByQuote('ab cd ab ef', 'ab', { before: 'x' })).toBeNull()
  })

  it('returns null for an absent or empty quote and for a quote that changed even slightly', () => {
    expect(anchorByQuote(TEXT, undefined)).toBeNull()
    expect(anchorByQuote(TEXT, '')).toBeNull()
    expect(anchorByQuote(TEXT, 'Chữ tài chữ mạng')).toBeNull()
    expect(anchorByQuote(TEXT, 'chữ tài chữ mệnh')).toBeNull()
  })

  it('is exact on combining marks: precomposed and decomposed forms are different text', () => {
    const decomposed = 'Tiếng Việt'.normalize('NFD')
    expect(anchorByQuote(`Nói ${decomposed} hay`, 'Tiếng Việt')).toBeNull()
    expect(anchorByQuote(`Nói ${decomposed} hay`, decomposed)?.start).toBe(4)
  })

  it('counts overlapping occurrences as ambiguous', () => {
    expect(anchorByQuote('aaa', 'aa')).toBeNull()
  })

  it('never returns a position whose text differs from the quote (SC-008)', () => {
    for (const quote of ['Trăm năm', 'trong cõi người ta', 'là', 'bao lâu?', 'x']) {
      for (const context of [undefined, { before: 'ghét nhau. ' }, { after: ' trong' }]) {
        const m = anchorByQuote(TEXT, quote, context)
        if (m) expect(TEXT.slice(m.start, m.end)).toBe(quote)
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
import { checkCoverage, emptyTypewriterDoc, faceFor, typewriterFontFaces, typewriterFamilies } from '../../src/typewriter/index.js'

describe('faceFor', () => {
  it('returns the exact real face', () => {
    expect(faceFor('noto-serif', true, true).file).toBe('NotoSerif-BoldItalic.ttf')
    expect(faceFor('noto-sans', false, false).file).toBe('NotoSans-Regular.ttf')
  })
  it('falls back to the upright face when the family has no italic', () => {
    expect(faceFor('noto-sans-mono', false, true).file).toBe('NotoSansMono-Regular.ttf')
    expect(faceFor('noto-sans-mono', true, true).file).toBe('NotoSansMono-Bold.ttf')
  })
  it('lists unique face ids and files', () => {
    expect(new Set(typewriterFontFaces.map((f) => f.id)).size).toBe(typewriterFontFaces.length)
    expect(new Set(typewriterFontFaces.map((f) => f.file)).size).toBe(typewriterFontFaces.length)
    expect(typewriterFamilies.every((f) => typewriterFontFaces.some((x) => x.family === f.id))).toBe(true)
  })
})

describe('checkCoverage', () => {
  const doc = emptyTypewriterDoc()
  it('passes every precomposed Vietnamese letter', () => {
    const marks = ['̀', '̉', '̃', '́', '̣']
    const letters: string[] = ['đ', 'Đ']
    for (const v of 'aăâeêioôơuưy') {
      for (const c of [v, v.toUpperCase()]) {
        letters.push(c, ...marks.map((m) => (c + m).normalize('NFC')))
      }
    }
    expect(checkCoverage(letters.join(' '), doc)).toEqual({ ok: true })
  })
  it('reports Arabic, Thai and emoji once each', () => {
    const r = checkCoverage('ok ع ع ก 😀\nfine', doc)
    expect(r).toEqual({ ok: false, characters: ['ع', 'ก', '😀'] })
  })
  it('accepts newlines and typographic punctuation', () => {
    expect(checkCoverage('“a” – b…\n€', doc)).toEqual({ ok: true })
  })
})

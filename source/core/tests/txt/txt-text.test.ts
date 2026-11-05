import { describe, expect, it } from 'vitest'
import {
  clampTxtOffset,
  detectTxtBom,
  isCodePointBoundary,
  normalizeTxtText,
} from '../../src/txt/index.js'

describe('normalizeTxtText', () => {
  it('drops a leading BOM', () => {
    expect(normalizeTxtText('\uFEFFhello')).toBe('hello')
  })

  it('drops only ONE leading BOM and only at the start', () => {
    expect(normalizeTxtText('\uFEFF\uFEFFa')).toBe('\uFEFFa')
    expect(normalizeTxtText('a\uFEFFb')).toBe('a\uFEFFb')
  })

  it('turns CRLF, lone CR and LF into single LF', () => {
    expect(normalizeTxtText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
    expect(normalizeTxtText('\r\n\r\n')).toBe('\n\n')
    expect(normalizeTxtText('a\r\r\nb')).toBe('a\n\nb')
  })

  it('keeps blank lines, trailing newline and surrounding spaces exactly', () => {
    expect(normalizeTxtText('  indented\r\n\r\nend \r\n')).toBe('  indented\n\nend \n')
  })

  it('leaves Vietnamese, combining marks and emoji untouched (no Unicode normalisation)', () => {
    const nfc = 'Tiếng Việt: ắ ằ ẳ'
    const nfd = nfc.normalize('NFD')
    expect(normalizeTxtText(nfc)).toBe(nfc)
    expect(normalizeTxtText(nfd)).toBe(nfd)
    expect(normalizeTxtText('😀\r\n👨‍👩‍👧')).toBe('😀\n👨‍👩‍👧')
  })

  it('handles the empty text', () => {
    expect(normalizeTxtText('')).toBe('')
    expect(normalizeTxtText('\uFEFF')).toBe('')
  })

  it('is idempotent', () => {
    const once = normalizeTxtText('\uFEFFa\r\nb\r')
    expect(normalizeTxtText(once)).toBe(once)
  })
})

describe('detectTxtBom', () => {
  it('recognises UTF-8, UTF-16 LE and UTF-16 BE marks', () => {
    expect(detectTxtBom(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41))).toEqual({ encoding: 'utf-8', length: 3 })
    expect(detectTxtBom(Uint8Array.of(0xff, 0xfe, 0x41, 0x00))).toEqual({ encoding: 'utf-16le', length: 2 })
    expect(detectTxtBom(Uint8Array.of(0xfe, 0xff, 0x00, 0x41))).toEqual({ encoding: 'utf-16be', length: 2 })
  })

  it('returns null without a mark or for tiny inputs', () => {
    expect(detectTxtBom(Uint8Array.of(0x41, 0x42, 0x43))).toBeNull()
    expect(detectTxtBom(Uint8Array.of())).toBeNull()
    expect(detectTxtBom(Uint8Array.of(0xef, 0xbb))).toBeNull()
  })
})

describe('isCodePointBoundary', () => {
  const text = 'a😀b'

  it('accepts the ends and positions between code points', () => {
    expect(isCodePointBoundary(text, 0)).toBe(true)
    expect(isCodePointBoundary(text, 1)).toBe(true)
    expect(isCodePointBoundary(text, 3)).toBe(true)
    expect(isCodePointBoundary(text, 4)).toBe(true)
  })

  it('rejects the middle of a surrogate pair and out-of-range / non-integer offsets', () => {
    expect(isCodePointBoundary(text, 2)).toBe(false)
    expect(isCodePointBoundary(text, -1)).toBe(false)
    expect(isCodePointBoundary(text, 5)).toBe(false)
    expect(isCodePointBoundary(text, 1.5)).toBe(false)
  })
})

describe('clampTxtOffset', () => {
  it('clamps into [0, length] and truncates', () => {
    expect(clampTxtOffset(-5, 10)).toBe(0)
    expect(clampTxtOffset(99, 10)).toBe(10)
    expect(clampTxtOffset(3.9, 10)).toBe(3)
    expect(clampTxtOffset(Number.NaN, 10)).toBe(0)
  })
})

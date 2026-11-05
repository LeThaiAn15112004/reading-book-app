import { describe, expect, it } from 'vitest'
import { emptyTypewriterDoc, layoutTypewriter, TYPEWRITER_LINE_HEIGHT, type FontMetrics, type PdfTypewriterDoc } from '../../src/typewriter/index.js'

/** 1000-unit em: every letter 500 wide, space 250, '?' missing in every face. */
const metrics: FontMetrics = {
  advance: (_f, cp) => (cp === 0x3f ? undefined : cp === 0x20 ? 250 : 500),
  ascent: () => 800,
  descent: () => -200,
  unitsPerEm: () => 1000,
}

// pageWidth 100, size 0.1 → font size 10; letter = 5, space = 2.5
const make = (over: Partial<PdfTypewriterDoc> = {}): PdfTypewriterDoc => {
  const d = emptyTypewriterDoc()
  return { ...d, base: { ...d.base, size: 0.1 }, ...over }
}
const lay = (text: string, box: number, doc = make()) => layoutTypewriter(doc, text, box, 100, metrics)
const lineTexts = (l: ReturnType<typeof lay>) => l.lines.map((x) => x.segments.map((s) => s.text).join(''))

describe('layoutTypewriter', () => {
  it('keeps a short text on one line, height 1.2 × size', () => {
    const l = lay('abc', 100)
    expect(lineTexts(l)).toEqual(['abc'])
    expect(l.height).toBeCloseTo(10 * TYPEWRITER_LINE_HEIGHT)
    expect(l.lines[0]!.width).toBeCloseTo(15)
  })

  it('wraps at spaces and hangs trailing spaces', () => {
    const l = lay('aaaa bbbb cc', 22)
    expect(lineTexts(l)).toEqual(['aaaa', 'bbbb', 'cc'])
  })

  it('breaks an over-long word between characters', () => {
    const l = lay('abcdefgh', 17)
    expect(lineTexts(l)).toEqual(['abc', 'def', 'gh'])
  })

  it('does not separate a combining mark from its base', () => {
    const l = lay('ab́cd', 11)
    expect(lineTexts(l).join('')).toBe('ab́cd')
    expect(lineTexts(l).every((t) => !t.startsWith('́'))).toBe(true)
  })

  it('makes an empty paragraph a line of its own', () => {
    const l = lay('a\n\nb', 100)
    expect(l.lines).toHaveLength(3)
    expect(l.height).toBeCloseTo(3 * 12)
  })

  it('aligns center and right per paragraph', () => {
    const d = make({ align: [{ start: 3, align: 'center' }, { start: 6, align: 'right' }] })
    const l = lay('ab\ncd\nef', 50, d)
    expect(l.lines.map((x) => x.segments[0]!.x)).toEqual([0, 20, 40])
  })

  it('justifies every line but the last of a paragraph, one word per segment', () => {
    const d = make({ align: [{ start: 0, align: 'justify' }] })
    const l = lay('aa bb cc dd', 27, d)
    expect(lineTexts(l)).toEqual(['aabb', 'cc dd'])
    const first = l.lines[0]!
    expect(first.segments.map((s) => s.text)).toEqual(['aa', 'bb'])
    expect(first.justified).toBe(true)
    const last = first.segments[first.segments.length - 1]!
    expect(last.x + last.width).toBeCloseTo(27)
    expect(l.lines[1]!.justified).toBe(false)
  })

  it('splits segments on style changes and uses the tallest size for the line', () => {
    const d = make({ runs: [{ start: 2, end: 4, style: { size: 0.2, bold: true } }] })
    const l = lay('abcdef', 200, d)
    expect(l.lines[0]!.segments.map((s) => s.text)).toEqual(['ab', 'cd', 'ef'])
    expect(l.lines[0]!.height).toBeCloseTo(20 * TYPEWRITER_LINE_HEIGHT)
    expect(l.lines[0]!.segments[1]!.face.bold).toBe(true)
  })

  it('reports unsupported code points', () => {
    expect(lay('a?b', 100).unsupported).toEqual([0x3f])
  })

  it('is deterministic', () => {
    const text = 'một hai ba bốn năm sáu bảy tám chín mười\nxin chào'
    expect(JSON.stringify(lay(text, 63))).toBe(JSON.stringify(lay(text, 63)))
  })
})

describe('layoutTypewriter — compact line spacing (no drift)', () => {
  it('stacks lines edge to edge: each line starts where the one above ends, every pitch is 1.2 × size', () => {
    const l = lay('one\ntwo\n\nfour', 100)
    expect(l.lines).toHaveLength(4)
    let top = 0
    for (const line of l.lines) {
      expect(line.top).toBeCloseTo(top)
      expect(line.height).toBeCloseTo(10 * TYPEWRITER_LINE_HEIGHT)
      top += line.height
    }
    expect(l.height).toBeCloseTo(top)
  })

  it('a baseline lies inside its own line box (a renderer positions glyphs relative to line.top, never to the note)', () => {
    const l = lay('one\ntwo\n\nfour\nfive', 100)
    for (const line of l.lines) {
      expect(line.baseline).toBeGreaterThan(line.top)
      expect(line.baseline).toBeLessThan(line.top + line.height)
    }
  })

  it('Enter adds exactly one line of the current size; a blank line has the same height as a text line', () => {
    const one = lay('abc', 100).height
    expect(lay('abc\n', 100).height).toBeCloseTo(one * 2)
    expect(lay('abc\n\n', 100).height).toBeCloseTo(one * 3)
  })

  it('a size change scales the spacing linearly, with no extra gap', () => {
    const big = (size: number) => lay('one\ntwo\nthree', 100, make({ base: { ...make().base, size } })).height
    expect(big(0.2)).toBeCloseTo(big(0.1) * 2)
    expect(big(0.05)).toBeCloseTo(big(0.1) / 2)
  })

  it('a larger run raises only its own line', () => {
    let d = make()
    d = { ...d, runs: [{ start: 4, end: 7, style: { size: 0.2 } }] }
    const l = lay('one\ntwo\nthree', 100, d)
    expect(l.lines.map((x) => x.height)).toEqual([expect.closeTo(12), expect.closeTo(24), expect.closeTo(12)])
  })

  it('narrowing the box never loses a character (it only adds lines)', () => {
    const text = 'aaaa bbbb cccc dddd'
    for (const width of [100, 40, 22, 12, 5]) {
      const l = lay(text, width)
      expect(lineTexts(l).join('').replace(/ /g, '')).toBe(text.replace(/ /g, ''))
      expect(l.height).toBeCloseTo(l.lines.length * 12)
    }
  })
})

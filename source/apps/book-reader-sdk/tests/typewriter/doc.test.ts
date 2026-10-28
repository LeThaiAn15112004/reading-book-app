import { describe, expect, it } from 'vitest'
import {
  alignAt,
  defaultTypewriterStyle,
  effectiveStyle,
  emptyTypewriterDoc,
  normalizeTypewriterText,
  parseTypewriterDoc,
  TYPEWRITER_MAX_CHARS,
  TYPEWRITER_MAX_SIZE,
  type PdfTypewriterDoc,
} from '../../src/typewriter/index.js'

const doc = (over: Partial<PdfTypewriterDoc> = {}): PdfTypewriterDoc => ({ ...emptyTypewriterDoc(), ...over })

describe('normalizeTypewriterText', () => {
  it('uses NFC, \\n line breaks and drops control characters', () => {
    expect(normalizeTypewriterText('a\r\nb\rc\u0007d\te')).toBe('a\nb\ncde')
    expect(normalizeTypewriterText('ế')).toBe('ế')
    expect(normalizeTypewriterText('x y')).toBe('x\ny')
  })
})

describe('parseTypewriterDoc', () => {
  const text = 'Xin chào\nthế giới'

  it('accepts an empty-override doc and a valid one', () => {
    expect(parseTypewriterDoc(doc(), text)).toBeDefined()
    const ok = doc({ runs: [{ start: 0, end: 3, style: { bold: true } }], align: [{ start: 9, align: 'center' }] })
    expect(parseTypewriterDoc(ok, text)).toEqual(ok)
  })

  it('rejects invalid text', () => {
    expect(parseTypewriterDoc(doc(), '')).toBeUndefined()
    expect(parseTypewriterDoc(doc(), '  \n ')).toBeUndefined()
    expect(parseTypewriterDoc(doc(), 'a'.repeat(TYPEWRITER_MAX_CHARS + 1))).toBeUndefined()
    expect(parseTypewriterDoc(doc(), 'ê')).toBeUndefined()
  })

  it('rejects bad run geometry', () => {
    const run = (start: number, end: number, style: object = { bold: true }) => doc({ runs: [{ start, end, style }] })
    expect(parseTypewriterDoc(run(3, 3), text)).toBeUndefined()
    expect(parseTypewriterDoc(run(-1, 2), text)).toBeUndefined()
    expect(parseTypewriterDoc(run(0, text.length + 1), text)).toBeUndefined()
    expect(parseTypewriterDoc(run(0, 2, {}), text)).toBeUndefined()
    expect(parseTypewriterDoc(run(0, 2, { bold: 'yes' }), text)).toBeUndefined()
    expect(parseTypewriterDoc(run(0, 2, { family: 'comic-sans' }), text)).toBeUndefined()
    expect(parseTypewriterDoc(run(0, 2, { color: 'red' }), text)).toBeUndefined()
    expect(parseTypewriterDoc(run(0, 2, { size: TYPEWRITER_MAX_SIZE * 2 }), text)).toBeUndefined()
  })

  it('rejects overlapping, unmerged and surrogate-splitting runs', () => {
    const b = { bold: true }
    expect(parseTypewriterDoc(doc({ runs: [{ start: 0, end: 4, style: b }, { start: 3, end: 5, style: { italic: true } }] }), text)).toBeUndefined()
    expect(parseTypewriterDoc(doc({ runs: [{ start: 0, end: 2, style: b }, { start: 2, end: 4, style: { bold: true } }] }), text)).toBeUndefined()
    expect(parseTypewriterDoc(doc({ runs: [{ start: 0, end: 2, style: b }, { start: 2, end: 4, style: { italic: true } }] }), text)).toBeDefined()
    expect(parseTypewriterDoc(doc({ runs: [{ start: 2, end: 3, style: b }] }),'a\u{1F600}b')).toBeUndefined()
  })

  it('checks alignment spans', () => {
    expect(parseTypewriterDoc(doc({ align: [{ start: 3, align: 'right' }] }), text)).toBeUndefined()
    expect(parseTypewriterDoc(doc({ align: [{ start: 9, align: 'right' }, { start: 9, align: 'left' }] }), text)).toBeUndefined()
    expect(parseTypewriterDoc(doc({ align: [{ start: 9, align: 'wide' as never }] }), text)).toBeUndefined()
  })

  it('enforces the run and span caps', () => {
    const many = 'ab'.repeat(300)
    const runs = Array.from({ length: 501 }, (_, i) => ({ start: i, end: i + 1, style: i % 2 ? { bold: true } : { italic: true } }))
    expect(parseTypewriterDoc(doc({ runs }), many)).toBeUndefined()
  })

  it('rejects a wrong version or missing base', () => {
    expect(parseTypewriterDoc({ ...doc(), v: 2 }, text)).toBeUndefined()
    expect(parseTypewriterDoc({ v: 1, runs: [], align: [] }, text)).toBeUndefined()
    expect(parseTypewriterDoc(null, text)).toBeUndefined()
  })
})

describe('effectiveStyle / alignAt', () => {
  const d = doc({ runs: [{ start: 2, end: 4, style: { bold: true, color: '#FF0000' } }], align: [{ start: 4, align: 'right' }] })
  it('overlays the run on base', () => {
    expect(effectiveStyle(d, 1)).toEqual(defaultTypewriterStyle())
    expect(effectiveStyle(d, 2)).toEqual({ ...defaultTypewriterStyle(), bold: true, color: '#FF0000' })
    expect(effectiveStyle(d, 4)).toEqual(defaultTypewriterStyle())
  })
  it('finds the paragraph alignment', () => {
    const text = 'abc\ndefg'
    expect(alignAt(d, text, 1)).toBe('left')
    expect(alignAt(d, text, 6)).toBe('right')
  })
})

import { describe, expect, it } from 'vitest'
import {
  applyAlign,
  applyStyle,
  editText,
  effectiveStyle,
  emptyTypewriterDoc,
  parseTypewriterDoc,
  rangeFlag,
  toggleStyle,
  typingStyle,
  TYPEWRITER_MAX_CHARS,
  type PdfTypewriterDoc,
} from '../../src/typewriter/index.js'

const base = (): PdfTypewriterDoc => emptyTypewriterDoc()

describe('applyStyle', () => {
  it('turns a range into merged runs', () => {
    let d = applyStyle(base(), 'abcdef', { start: 1, end: 3 }, { bold: true })
    d = applyStyle(d, 'abcdef', { start: 3, end: 5 }, { bold: true })
    expect(d.runs).toEqual([{ start: 1, end: 5, style: { bold: true } }])
  })

  it('removes an override when it equals base again', () => {
    let d = applyStyle(base(), 'abcdef', { start: 1, end: 3 }, { bold: true })
    d = applyStyle(d, 'abcdef', { start: 1, end: 3 }, { bold: false })
    expect(d.runs).toEqual([])
  })

  it('whole-box change sets base and clears only the touched keys', () => {
    let d = applyStyle(base(), 'abcdef', { start: 0, end: 2 }, { bold: true, color: '#ff0000' })
    d = applyStyle(d, 'abcdef', null, { color: '#00ff00' })
    expect(d.base.color).toBe('#00FF00')
    expect(d.runs).toEqual([{ start: 0, end: 2, style: { bold: true } }])
  })

  it('splits a run when part of it changes another key', () => {
    let d = applyStyle(base(), 'abcdef', { start: 0, end: 4 }, { bold: true })
    d = applyStyle(d, 'abcdef', { start: 2, end: 6 }, { italic: true })
    expect(d.runs).toEqual([
      { start: 0, end: 2, style: { bold: true } },
      { start: 2, end: 4, style: { bold: true, italic: true } },
      { start: 4, end: 6, style: { italic: true } },
    ])
    expect(parseTypewriterDoc(d, 'abcdef')).toBeDefined()
  })

  it('clamps size and ignores an empty patch or empty range', () => {
    const d = applyStyle(base(), 'abc', null, { size: 5 })
    expect(d.base.size).toBeLessThanOrEqual(1)
    expect(applyStyle(base(), 'abc', null, {})).toEqual(base())
    expect(applyStyle(base(), 'abc', { start: 2, end: 2 }, { bold: true }).runs).toEqual([])
  })

  it('never splits a surrogate pair', () => {
    const text = 'a\u{1F600}b'
    const d = applyStyle(base(), text, { start: 2, end: 3 }, { bold: true })
    expect(parseTypewriterDoc(d, text)).toBeDefined()
  })
})

describe('toggleStyle / rangeFlag', () => {
  it('sets all on a partly-set range, clears when all set', () => {
    const text = 'abcdef'
    let d = applyStyle(base(), text, { start: 0, end: 2 }, { bold: true })
    expect(rangeFlag(d, text, { start: 0, end: 4 }, 'bold')).toBe('mixed')
    d = toggleStyle(d, text, { start: 0, end: 4 }, 'bold')
    expect(rangeFlag(d, text, { start: 0, end: 4 }, 'bold')).toBe(true)
    d = toggleStyle(d, text, { start: 0, end: 4 }, 'bold')
    expect(rangeFlag(d, text, { start: 0, end: 4 }, 'bold')).toBe(false)
  })
})

describe('typingStyle', () => {
  it('takes the character before the caret plus the pending patch', () => {
    const d = applyStyle(base(), 'abc', { start: 0, end: 2 }, { bold: true })
    expect(typingStyle(d, 'abc', 2).bold).toBe(true)
    expect(typingStyle(d, 'abc', 3).bold).toBe(false)
    expect(typingStyle(d, 'abc', 2, { bold: false, italic: true })).toMatchObject({ bold: false, italic: true })
    expect(typingStyle(d, 'abc', 0).bold).toBe(false)
  })
})

describe('applyAlign', () => {
  it('aligns the paragraphs touched by the range', () => {
    const text = 'ab\ncd\nef'
    const d = applyAlign(base(), text, { start: 4, end: 7 }, 'center')
    expect(d.align).toEqual([{ start: 3, align: 'center' }, { start: 6, align: 'center' }])
  })
  it('aligns the paragraph at a collapsed caret, whole box with null, drops left', () => {
    const text = 'ab\ncd'
    expect(applyAlign(base(), text, { start: 4, end: 4 }, 'right').align).toEqual([{ start: 3, align: 'right' }])
    expect(applyAlign(base(), text, null, 'justify').align).toHaveLength(2)
    const d = applyAlign(base(), text, null, 'justify')
    expect(applyAlign(d, text, null, 'left').align).toEqual([])
  })
})

describe('editText', () => {
  it('inserted text takes the style of the character before the caret', () => {
    const text = 'abcd'
    const d = applyStyle(base(), text, { start: 1, end: 3 }, { bold: true })
    const r = editText(d, text, { start: 3, end: 3, insert: 'XY' })
    expect(r.text).toBe('abcXYd')
    expect(effectiveStyle(r.doc, 3).bold).toBe(true)
    expect(effectiveStyle(r.doc, 5).bold).toBe(false)
    expect(parseTypewriterDoc(r.doc, r.text)).toBeDefined()
  })

  it('pending style overrides the inherited one for inserted text only', () => {
    const text = 'abcd'
    const d = applyStyle(base(), text, { start: 0, end: 2 }, { bold: true })
    const r = editText(d, text, { start: 2, end: 2, insert: 'Z', pending: { bold: false } })
    expect(effectiveStyle(r.doc, 1).bold).toBe(true)
    expect(effectiveStyle(r.doc, 2).bold).toBe(false)
  })

  it('shifts runs after the edit, trims overlapping ones', () => {
    const text = 'abcdefgh'
    const d = applyStyle(applyStyle(base(), text, { start: 1, end: 3 }, { bold: true }), text, { start: 5, end: 7 }, { italic: true })
    const r = editText(d, text, { start: 2, end: 4, insert: '' })
    expect(r.text).toBe('abefgh')
    expect(r.doc.runs).toEqual([
      { start: 1, end: 2, style: { bold: true } },
      { start: 3, end: 5, style: { italic: true } },
    ])
  })

  it('maps paragraph alignment through inserts and deletes', () => {
    const text = 'ab\ncd\nef'
    const d = applyAlign(base(), text, { start: 6, end: 7 }, 'right')
    const r1 = editText(d, text, { start: 0, end: 0, insert: 'xx' })
    expect(r1.doc.align).toEqual([{ start: 8, align: 'right' }])
    const r2 = editText(d, text, { start: 2, end: 3, insert: '' })
    expect(r2.text).toBe('abcd\nef')
    expect(r2.doc.align).toEqual([{ start: 5, align: 'right' }])
    const r3 = editText(d, text, { start: 5, end: 6, insert: '' })
    expect(r3.doc.align).toEqual([])
    expect(parseTypewriterDoc(r3.doc, r3.text)).toBeDefined()
  })

  it('a new paragraph inherits the alignment of the one it splits', () => {
    const text = 'abcd'
    const d = applyAlign(base(), text, null, 'center')
    const r = editText(d, text, { start: 2, end: 2, insert: '\n' })
    expect(r.doc.align).toEqual([{ start: 0, align: 'center' }, { start: 3, align: 'center' }])
  })

  it('normalizes the inserted text and honours the character cap', () => {
    const r = editText(base(), 'a', { start: 1, end: 1, insert: 'b\r\nc' })
    expect(r.text).toBe('ab\nc')
    const long = 'x'.repeat(TYPEWRITER_MAX_CHARS - 1)
    const cut = editText(base(), long, { start: long.length, end: long.length, insert: 'yyyy' })
    expect(cut.text.length).toBe(TYPEWRITER_MAX_CHARS)
    expect(cut.truncated).toBe(true)
  })
})

describe('formatting edge cases (T-03 / T-04)', () => {
  it('toggling bold on a partly-bold range bolds all, a second toggle clears all', () => {
    let d = applyStyle(base(), 'abcdef', { start: 0, end: 2 }, { bold: true })
    d = toggleStyle(d, 'abcdef', { start: 0, end: 4 }, 'bold')
    expect(d.runs).toEqual([{ start: 0, end: 4, style: { bold: true } }])
    d = toggleStyle(d, 'abcdef', { start: 0, end: 4 }, 'bold')
    expect(d.runs).toEqual([])
  })

  it('typingStyle without a pending patch is the plain style', () => {
    expect(typingStyle(base(), 'abc', 3, { bold: true }).bold).toBe(true)
    expect(typingStyle(base(), 'abc', 1).bold).toBe(false)
  })

  it('whole-box size change keeps per-range colour and bold', () => {
    let d = applyStyle(base(), 'abcdef', { start: 1, end: 3 }, { bold: true, color: '#ff0000' })
    d = applyStyle(d, 'abcdef', null, { size: 0.05 })
    expect(d.runs).toEqual([{ start: 1, end: 3, style: { bold: true, color: '#FF0000' } }])
  })

  it('an edit across a run boundary keeps the doc valid', () => {
    const d0 = applyStyle(base(), 'abcdef', { start: 2, end: 4 }, { bold: true })
    const r = editText(d0, 'abcdef', { start: 3, end: 5, insert: 'XYZ' })
    expect(r.text).toBe('abcXYZf')
    expect(parseTypewriterDoc(r.doc, r.text)).not.toBeNull()
  })

  it('alignment follows its paragraph when text is inserted before it', () => {
    const t = 'one\ntwo\nthree'
    const d0 = applyAlign(base(), t, { start: 4, end: 6 }, 'center')
    const r = editText(d0, t, { start: 0, end: 0, insert: 'zero\n' })
    expect(r.doc.align).toEqual([{ start: 9, align: 'center' }])
  })
})

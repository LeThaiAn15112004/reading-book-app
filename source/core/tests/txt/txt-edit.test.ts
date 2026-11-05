import { describe, expect, it } from 'vitest'
import {
  applyTextEdit,
  deriveTextEdit,
  invertTextEdit,
  isEditInRange,
  isNoopEdit,
  shiftOffsetForEdit,
  textEditDelta,
  type TextEdit,
} from '../../src/txt/index.js'
import { randomInt, rng } from './txt-fixtures.js'

const edit = (start: number, deleteLength: number, insert: string): TextEdit => ({ start, deleteLength, insert })

describe('applyTextEdit / invertTextEdit', () => {
  it('inserts, deletes and replaces', () => {
    expect(applyTextEdit('hello world', edit(5, 0, ','))).toBe('hello, world')
    expect(applyTextEdit('hello world', edit(5, 6, ''))).toBe('hello')
    expect(applyTextEdit('hello world', edit(6, 5, 'there'))).toBe('hello there')
  })

  it('invert applied to the result gives the original back', () => {
    const before = 'Xin chào 😀 thế giới'
    for (const e of [edit(4, 0, 'XYZ'), edit(4, 4, ''), edit(0, 3, 'Hi'), edit(before.length, 0, '!')]) {
      const after = applyTextEdit(before, e)
      expect(applyTextEdit(after, invertTextEdit(before, e))).toBe(before)
    }
  })

  it('reports delta, no-ops and range validity', () => {
    expect(textEditDelta(edit(0, 2, 'abcd'))).toBe(2)
    expect(textEditDelta(edit(0, 5, ''))).toBe(-5)
    expect(isNoopEdit(edit(3, 0, ''))).toBe(true)
    expect(isNoopEdit(edit(3, 1, ''))).toBe(false)
    expect(isEditInRange(5, edit(5, 0, 'x'))).toBe(true)
    expect(isEditInRange(5, edit(4, 2, ''))).toBe(false)
    expect(isEditInRange(5, edit(-1, 0, 'x'))).toBe(false)
    expect(isEditInRange(5, edit(1.5, 0, 'x'))).toBe(false)
  })
})

describe('shiftOffsetForEdit', () => {
  const e = edit(10, 5, 'abc') // removes [10,15), inserts 3 → delta -2

  it('keeps positions at or before the edit', () => {
    expect(shiftOffsetForEdit(0, e)).toBe(0)
    expect(shiftOffsetForEdit(10, e)).toBe(10)
  })

  it('moves positions at or after the removed region by the delta', () => {
    expect(shiftOffsetForEdit(15, e)).toBe(13)
    expect(shiftOffsetForEdit(40, e)).toBe(38)
  })

  it('collapses positions inside the removed region to the edit start', () => {
    expect(shiftOffsetForEdit(11, e)).toBe(10)
    expect(shiftOffsetForEdit(14, e)).toBe(10)
  })

  it('moves a position after a pure insertion', () => {
    expect(shiftOffsetForEdit(10, edit(10, 0, 'xx'))).toBe(10)
    expect(shiftOffsetForEdit(11, edit(10, 0, 'xx'))).toBe(13)
  })
})

describe('deriveTextEdit', () => {
  it('returns null for equal texts', () => {
    expect(deriveTextEdit('same', 'same')).toBeNull()
    expect(deriveTextEdit('same', 'same', { selectionStart: 1, selectionEnd: 1 })).toBeNull()
  })

  describe('with the selection captured before the input', () => {
    it('typing a character inserts at the caret', () => {
      expect(deriveTextEdit('hello', 'helXlo', { selectionStart: 3, selectionEnd: 3, inputType: 'insertText' })).toEqual(
        edit(3, 0, 'X'),
      )
    })

    it('typing a letter equal to its neighbours still lands at the caret, not at the run end', () => {
      expect(deriveTextEdit('aaa', 'aaaa', { selectionStart: 1, selectionEnd: 1, inputType: 'insertText' })).toEqual(
        edit(1, 0, 'a'),
      )
      expect(deriveTextEdit('aaa', 'aaaa', { selectionStart: 0, selectionEnd: 0, inputType: 'insertText' })).toEqual(
        edit(0, 0, 'a'),
      )
    })

    it('typing over a selection replaces exactly the selection', () => {
      expect(deriveTextEdit('abcdef', 'aXef', { selectionStart: 1, selectionEnd: 4, inputType: 'insertText' })).toEqual(
        edit(1, 3, 'X'),
      )
    })

    it('cut / delete of a selection removes exactly the selection', () => {
      expect(deriveTextEdit('abcdef', 'aef', { selectionStart: 1, selectionEnd: 4, inputType: 'deleteByCut' })).toEqual(
        edit(1, 3, ''),
      )
    })

    it('pasting multi-line text at the caret', () => {
      expect(
        deriveTextEdit('ab', 'a1\n2b', { selectionStart: 1, selectionEnd: 1, inputType: 'insertFromPaste' }),
      ).toEqual(edit(1, 0, '1\n2'))
    })

    it('Backspace removes the char BEFORE the caret, even among equal chars', () => {
      expect(
        deriveTextEdit('aaaa', 'aaa', { selectionStart: 2, selectionEnd: 2, inputType: 'deleteContentBackward' }),
      ).toEqual(edit(1, 1, ''))
    })

    it('Delete removes the char AFTER the caret, even among equal chars', () => {
      expect(
        deriveTextEdit('aaaa', 'aaa', { selectionStart: 2, selectionEnd: 2, inputType: 'deleteContentForward' }),
      ).toEqual(edit(2, 1, ''))
    })

    it('Backspace over an emoji removes both UTF-16 units', () => {
      expect(
        deriveTextEdit('a😀b', 'ab', { selectionStart: 3, selectionEnd: 3, inputType: 'deleteContentBackward' }),
      ).toEqual(edit(1, 2, ''))
    })

    it('Ctrl+Backspace removes the word before the caret', () => {
      expect(
        deriveTextEdit('one two three', 'one three', { selectionStart: 8, selectionEnd: 8, inputType: 'deleteWordBackward' }),
      ).toEqual(edit(4, 4, ''))
    })

    it('Enter inserts a newline', () => {
      expect(deriveTextEdit('ab', 'a\nb', { selectionStart: 1, selectionEnd: 1, inputType: 'insertLineBreak' })).toEqual(
        edit(1, 0, '\n'),
      )
    })

    it('an IME commit replacing the composing text (selection = composing range)', () => {
      expect(deriveTextEdit('say viet', 'say việt', { selectionStart: 4, selectionEnd: 8 })).toEqual(edit(4, 4, 'việt'))
    })

    it('falls back to the diff when the hint does not describe the change', () => {
      const derived = deriveTextEdit('abcdef', 'abcXdef', { selectionStart: 0, selectionEnd: 0, inputType: 'insertText' })
      expect(applyTextEdit('abcdef', derived!)).toBe('abcXdef')
      expect(derived).toEqual(edit(3, 0, 'X'))
    })

    it('ignores a hint pointing outside the text', () => {
      const derived = deriveTextEdit('abc', 'abXc', { selectionStart: 99, selectionEnd: 99 })
      expect(derived).toEqual(edit(2, 0, 'X'))
    })
  })

  describe('without a hint (smallest region)', () => {
    it('finds an insertion, a deletion and a replacement', () => {
      expect(deriveTextEdit('hello world', 'hello brave world')).toEqual(edit(6, 0, 'brave '))
      expect(deriveTextEdit('hello brave world', 'hello world')).toEqual(edit(6, 6, ''))
      expect(deriveTextEdit('abcXdef', 'abcYdef')).toEqual(edit(3, 1, 'Y'))
    })

    it('handles edits at the very start and end', () => {
      expect(deriveTextEdit('abc', 'Xabc')).toEqual(edit(0, 0, 'X'))
      expect(deriveTextEdit('abc', 'abcX')).toEqual(edit(3, 0, 'X'))
      expect(deriveTextEdit('abc', '')).toEqual(edit(0, 3, ''))
      expect(deriveTextEdit('', 'abc')).toEqual(edit(0, 0, 'abc'))
    })

    it('uses the caret to settle an ambiguous run', () => {
      expect(deriveTextEdit('aaa', 'aaaa', { selectionStart: 2, selectionEnd: 2 })).toEqual(edit(2, 0, 'a'))
      expect(deriveTextEdit('aaa', 'aaaa')).toEqual(edit(3, 0, 'a'))
    })

    it('replaces the whole text when nothing is shared', () => {
      expect(deriveTextEdit('abc', 'xyz')).toEqual(edit(0, 3, 'xyz'))
    })
  })

  it('always reproduces `after` (randomised, with and without hints)', () => {
    const next = rng(20261018)
    const alphabet = ['a', 'b', ' ', '\n', 'é', '😀', 'ệ']
    const word = (n: number) => Array.from({ length: n }, () => alphabet[randomInt(next, 0, alphabet.length - 1)]).join('')
    for (let i = 0; i < 400; i++) {
      const before = word(randomInt(next, 0, 14))
      const start = randomInt(next, 0, before.length)
      const del = randomInt(next, 0, before.length - start)
      const ins = word(randomInt(next, 0, 4))
      const after = before.slice(0, start) + ins + before.slice(start + del)
      const hinted = deriveTextEdit(before, after, { selectionStart: start, selectionEnd: start + del })
      const plain = deriveTextEdit(before, after)
      if (before === after) {
        expect(hinted).toBeNull()
        expect(plain).toBeNull()
        continue
      }
      expect(applyTextEdit(before, hinted!)).toBe(after)
      expect(applyTextEdit(before, plain!)).toBe(after)
      // With the real selection the region is exactly what was replaced.
      expect(hinted).toEqual(edit(start, del, ins))
    }
  })
})

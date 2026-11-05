import { describe, expect, it } from 'vitest'
import { Location, TextOffsetLocation } from '../../src/domain/index.js'
import {
  applyTextEdit,
  buildTxtSelectionText,
  isConsistentTxtHighlight,
  isValidTxtRange,
  packTxtAnnotationRef,
  packTxtHighlightLocator,
  parseTxtAnnotation,
  parseTxtAnnotationRef,
  planAnnotationEdit,
  quoteMatchesText,
  relationToEdit,
  splitAnnotationsByText,
  txtAnnotationLocation,
  txtHighlightDtoToReaderHighlight,
  txtMarkAt,
  withTxtOffsets,
  TXT_QUOTE_MAX_CHARS,
  type TextEdit,
  type TxtSpan,
} from '../../src/txt/index.js'
import { highlightOf, makeHighlight, randomInt, rng, SAMPLE_TEXT } from './txt-fixtures.js'

const edit = (start: number, deleteLength: number, insert: string): TextEdit => ({ start, deleteLength, insert })
const span = (id: string, startOffset: number, endOffset: number): TxtSpan => ({ id, startOffset, endOffset })

describe('relationToEdit — one annotation [10, 20) against every kind of edit', () => {
  const a = span('a', 10, 20)
  const cases: Array<[string, TextEdit, 'before' | 'after' | 'affected']> = [
    // pure insertions
    ['insert well before', edit(2, 0, 'xyz'), 'after'],
    ['insert right before the start', edit(10, 0, 'xyz'), 'after'],
    ['insert one inside the start', edit(11, 0, 'xyz'), 'affected'],
    ['insert in the middle', edit(15, 0, 'xyz'), 'affected'],
    ['insert one inside the end', edit(19, 0, 'xyz'), 'affected'],
    ['insert right after the end', edit(20, 0, 'xyz'), 'before'],
    ['insert well after', edit(30, 0, 'xyz'), 'before'],
    // deletions / replacements
    ['delete ending exactly at the start', edit(5, 5, ''), 'after'],
    ['delete overlapping the first char', edit(5, 6, ''), 'affected'],
    ['delete the first char', edit(10, 1, ''), 'affected'],
    ['delete strictly inside', edit(12, 3, ''), 'affected'],
    ['delete the last char', edit(19, 1, ''), 'affected'],
    ['delete overlapping the last char', edit(19, 5, ''), 'affected'],
    ['delete starting exactly at the end', edit(20, 5, ''), 'before'],
    ['delete exactly the annotation', edit(10, 10, ''), 'affected'],
    ['delete a superset', edit(0, 100, ''), 'affected'],
    ['replace inside', edit(12, 2, 'zzzzzz'), 'affected'],
    ['replace ending at the start', edit(0, 10, 'Q'), 'after'],
    ['replace starting at the end', edit(20, 3, 'Q'), 'before'],
    ['replace straddling the start', edit(8, 4, 'Q'), 'affected'],
    ['replace straddling the end', edit(18, 4, 'Q'), 'affected'],
    // nothing happens
    ['no-op at the start', edit(10, 0, ''), 'after'],
    ['no-op in the middle', edit(15, 0, ''), 'affected'],
  ]
  it.each(cases)('%s', (_name, e, expected) => {
    expect(relationToEdit(a, e)).toBe(expected)
  })
})

describe('planAnnotationEdit', () => {
  it('moves annotations after the edit by the delta and keeps the ones before as they are', () => {
    const items = [span('a', 0, 5), span('b', 10, 20), span('c', 30, 40)]
    const plan = planAnnotationEdit(items, edit(25, 0, 'abc'))
    expect(plan.removed).toEqual([])
    expect(plan.kept).toEqual([span('a', 0, 5), span('b', 10, 20), span('c', 33, 43)])
    expect(plan.shiftedIds).toEqual(['c'])
  })

  it('moves annotations back when text before them is deleted', () => {
    const plan = planAnnotationEdit([span('b', 10, 20)], edit(2, 5, ''))
    expect(plan.kept).toEqual([span('b', 5, 15)])
  })

  it('removes ONLY the annotations the edit touches, however many', () => {
    const items = [span('a', 0, 5), span('b', 10, 20), span('c', 30, 40), span('d', 50, 60)]
    const plan = planAnnotationEdit(items, edit(12, 20, ''))
    expect(plan.removed.map((h) => h.id)).toEqual(['b', 'c'])
    expect(plan.kept).toEqual([span('a', 0, 5), span('d', 30, 40)])
    expect(plan.shiftedIds).toEqual(['d'])
  })

  it('treats overlapping annotations independently', () => {
    const items = [span('wide', 10, 40), span('inner', 20, 25), span('tail', 35, 50)]
    const plan = planAnnotationEdit(items, edit(22, 1, 'XY'))
    expect(plan.removed.map((h) => h.id)).toEqual(['wide', 'inner'])
    expect(plan.kept).toEqual([span('tail', 36, 51)])
  })

  it('does not mutate its input and keeps extra fields on kept rows', () => {
    const row = { ...span('a', 10, 20), colorHex: '#fff' }
    const input = [row]
    const plan = planAnnotationEdit(input, edit(0, 0, 'zz'))
    expect(plan.kept[0]).toEqual({ id: 'a', startOffset: 12, endOffset: 22, colorHex: '#fff' })
    expect(row.startOffset).toBe(10)
  })

  it('an empty edit changes nothing', () => {
    const items = [span('a', 10, 20)]
    const plan = planAnnotationEdit(items, edit(30, 0, ''))
    expect(plan.kept).toEqual(items)
    expect(plan.shiftedIds).toEqual([])
  })

  it('agrees with an independent oracle and keeps every survivor on the same text (randomised)', () => {
    const next = rng(77)
    for (let round = 0; round < 300; round++) {
      const length = randomInt(next, 20, 80)
      const text = Array.from({ length }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')
      const items: TxtSpan[] = []
      for (let i = 0; i < randomInt(next, 1, 6); i++) {
        const s = randomInt(next, 0, length - 2)
        items.push(span(`s${i}`, s, randomInt(next, s + 1, Math.min(length, s + 15))))
      }
      const start = randomInt(next, 0, length)
      const e = edit(start, randomInt(next, 0, length - start), 'ZZ'.slice(0, randomInt(next, 0, 2)))
      const plan = planAnnotationEdit(items, e)
      const afterText = applyTextEdit(text, e)

      const oracleAffected = (s: TxtSpan) =>
        e.deleteLength > 0
          ? s.startOffset < e.start + e.deleteLength && e.start < s.endOffset
          : s.startOffset < e.start && e.start < s.endOffset
      expect(plan.removed.map((h) => h.id)).toEqual(items.filter(oracleAffected).map((h) => h.id))
      expect(plan.kept.length + plan.removed.length).toBe(items.length)
      for (const kept of plan.kept) {
        const original = items.find((h) => h.id === kept.id)!
        expect(afterText.slice(kept.startOffset, kept.endOffset)).toBe(text.slice(original.startOffset, original.endOffset))
      }
    }
  })
})

describe('anchors and validation', () => {
  it('isValidTxtRange needs a non-empty range inside the text on code-point boundaries', () => {
    const text = 'a😀b'
    expect(isValidTxtRange(0, 1, text)).toBe(true)
    expect(isValidTxtRange(1, 3, text)).toBe(true)
    expect(isValidTxtRange(0, 4, text)).toBe(true)
    expect(isValidTxtRange(2, 3, text)).toBe(false) // starts inside the emoji
    expect(isValidTxtRange(1, 2, text)).toBe(false) // ends inside the emoji
    expect(isValidTxtRange(2, 2, text)).toBe(false)
    expect(isValidTxtRange(3, 1, text)).toBe(false)
    expect(isValidTxtRange(-1, 2, text)).toBe(false)
    expect(isValidTxtRange(0, 5, text)).toBe(false)
    expect(isValidTxtRange(0.5, 2, text)).toBe(false)
  })

  it('parseTxtAnnotation accepts only whole, ordered, non-negative offsets', () => {
    expect(parseTxtAnnotation({ startOffset: 3, endOffset: 9 })).toEqual({ startOffset: 3, endOffset: 9 })
    for (const bad of [
      null,
      undefined,
      'x',
      {},
      { startOffset: 3 },
      { startOffset: '3', endOffset: 9 },
      { startOffset: -1, endOffset: 9 },
      { startOffset: 9, endOffset: 9 },
      { startOffset: 9, endOffset: 3 },
      { startOffset: 1.5, endOffset: 9 },
      { startOffset: 0, endOffset: Number.POSITIVE_INFINITY },
      { startOffset: 0, endOffset: Number.NaN },
    ]) {
      expect(parseTxtAnnotation(bad)).toBeUndefined()
    }
  })

  it('parseTxtAnnotationRef rejects non-JSON and oversize payloads', () => {
    const ref = packTxtAnnotationRef({ startOffset: 3, endOffset: 9 })
    expect(parseTxtAnnotationRef(ref)).toEqual({ startOffset: 3, endOffset: 9 })
    expect(parseTxtAnnotationRef('{nope')).toBeUndefined()
    expect(parseTxtAnnotationRef('')).toBeUndefined()
    expect(parseTxtAnnotationRef(42)).toBeUndefined()
    expect(parseTxtAnnotationRef(' '.repeat(5000))).toBeUndefined()
  })

  it('the locator is a text-offset at the start with chapterIndex 0 and survives Location.parse', () => {
    const json = JSON.parse(packTxtHighlightLocator({ startOffset: 12, endOffset: 30 }))
    expect(json).toEqual({ kind: 'text-offset', offset: 12, blockId: 'txt', chapterIndex: 0 })
    const parsed = Location.parse(JSON.stringify(json))
    expect(parsed).toBeInstanceOf(TextOffsetLocation)
    expect(txtAnnotationLocation({ startOffset: 12, endOffset: 30 }).equals(parsed)).toBe(true)
  })

  it('isConsistentTxtHighlight requires a text-offset locator at the annotation start', () => {
    const annotation = { startOffset: 12, endOffset: 30 }
    expect(isConsistentTxtHighlight({ kind: 'text-offset', offset: 12 }, annotation)).toBe(true)
    expect(isConsistentTxtHighlight({ kind: 'text-offset', offset: 13 }, annotation)).toBe(false)
    expect(isConsistentTxtHighlight({ kind: 'page-rect', page: 1 }, annotation)).toBe(false)
    expect(isConsistentTxtHighlight({ kind: 'cfi', cfi: 'epubcfi(/6/2)' }, annotation)).toBe(false)
  })

  it('withTxtOffsets moves the row and its locator together', () => {
    const row = highlightOf(SAMPLE_TEXT, 'needle')
    const moved = withTxtOffsets(row, row.startOffset + 4, row.endOffset + 4)
    expect(moved.startOffset).toBe(row.startOffset + 4)
    expect(JSON.parse(moved.locatorRef).offset).toBe(row.startOffset + 4)
    expect(moved.id).toBe(row.id)
  })
})

describe('quotes and stale rows', () => {
  it('buildTxtSelectionText keeps the quote and a little context, and caps a huge quote', () => {
    const text = SAMPLE_TEXT
    const at = text.indexOf('needle')
    const sel = buildTxtSelectionText(text, at, at + 6)
    expect(sel.highlight).toBe('needle')
    expect(sel.before?.endsWith('word ')).toBe(true)
    expect(sel.after?.startsWith(' in it')).toBe(true)

    const big = 'x'.repeat(TXT_QUOTE_MAX_CHARS + 500)
    expect(buildTxtSelectionText(big, 0, big.length).highlight).toHaveLength(TXT_QUOTE_MAX_CHARS)
    expect(buildTxtSelectionText('abc', 0, 3)).toEqual({ highlight: 'abc' })
  })

  it('quoteMatchesText checks the quote at the offsets (a truncated quote is a prefix)', () => {
    const text = 'hello world'
    expect(quoteMatchesText(text, span('x', 6, 11), 'world')).toBe(true)
    expect(quoteMatchesText(text, span('x', 6, 11), 'wor')).toBe(true)
    expect(quoteMatchesText(text, span('x', 6, 11), 'earth')).toBe(false)
    expect(quoteMatchesText(text, span('x', 6, 8), 'world')).toBe(false)
    expect(quoteMatchesText(text, span('x', 6, 11), undefined)).toBe(true)
  })

  it('splitAnnotationsByText hides rows whose text moved or vanished instead of re-pointing them', () => {
    const original = SAMPLE_TEXT
    const rows = [highlightOf(original, 'needle'), highlightOf(original, 'Khởi đầu'), highlightOf(original, '😀👍')]
    expect(splitAnnotationsByText(rows, original)).toEqual({ valid: rows, stale: [] })

    const changed = 'PREFIX ' + original // everything shifted by 7
    const split = splitAnnotationsByText(rows, changed)
    expect(split.valid).toEqual([])
    expect(split.stale.map((r) => r.id)).toEqual(rows.map((r) => r.id))

    const truncated = original.slice(0, original.indexOf('needle') + 3)
    const split2 = splitAnnotationsByText(rows, truncated)
    expect(split2.valid.map((r) => r.id)).toEqual([rows[1]!.id])
    expect(split2.stale.map((r) => r.id)).toEqual([rows[0]!.id, rows[2]!.id])
  })
})

describe('DTO mapping', () => {
  const dto = {
    id: 'n1',
    locatorRef: packTxtHighlightLocator({ startOffset: 5, endOffset: 11 }),
    styleKind: 'underline' as const,
    colorHex: '#4fc3f7',
    note: ' hi ',
    tags: ['t'],
    selectionTextRef: JSON.stringify({ highlight: 'needle' }),
    txtAnnotationRef: packTxtAnnotationRef({ startOffset: 5, endOffset: 11 }),
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:01.000Z',
  }

  it('maps a TXT row', () => {
    const row = txtHighlightDtoToReaderHighlight(dto)!
    expect(row).toMatchObject({
      id: 'n1',
      startOffset: 5,
      endOffset: 11,
      chapterIndex: 0,
      styleKind: 'underline',
      colorHex: '#4fc3f7',
      note: 'hi',
      tags: ['t'],
    })
    expect(row.selectionText?.highlight).toBe('needle')
  })

  it('refuses rows that are not TXT annotations', () => {
    expect(txtHighlightDtoToReaderHighlight({ ...dto, txtAnnotationRef: undefined })).toBeNull()
    expect(txtHighlightDtoToReaderHighlight({ ...dto, txtAnnotationRef: '{"startOffset":9,"endOffset":2}' })).toBeNull()
    expect(txtHighlightDtoToReaderHighlight({ ...dto, locatorRef: ' ' })).toBeNull()
  })

  it('falls back to the default color', () => {
    expect(txtHighlightDtoToReaderHighlight({ ...dto, colorHex: ' ' })!.colorHex).toMatch(/^#/)
  })
})

describe('txtMarkAt', () => {
  const marks = [makeHighlight('0123456789', 2, 6, { id: 'low' }), makeHighlight('0123456789', 4, 8, { id: 'top' })]
  it('returns the last drawn mark covering the offset, end exclusive', () => {
    expect(txtMarkAt(marks, 3)?.id).toBe('low')
    expect(txtMarkAt(marks, 5)?.id).toBe('top')
    expect(txtMarkAt(marks, 8)).toBeNull()
    expect(txtMarkAt(marks, 1)).toBeNull()
  })
})

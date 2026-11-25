import { describe, expect, it } from 'vitest'
import { bookmarkLabelFor, chapterNameFor, placeFor, type ContentsEntry } from '../../src/app-models/reader-place.js'

const toc: ContentsEntry[] = [
  { title: 'One', order: 1 },
  { title: 'Two', order: 3 },
  { title: 'Two · part', order: 3 },
  { title: 'Three', order: 6 },
]

describe('chapterNameFor (spec 019 FR-018)', () => {
  it('names the last entry at or before the place', () => {
    expect(chapterNameFor(toc, 1)).toBe('One')
    expect(chapterNameFor(toc, 2)).toBe('One')
    expect(chapterNameFor(toc, 3)).toBe('Two · part')
    expect(chapterNameFor(toc, 99)).toBe('Three')
  })

  it('is null before the first entry and without contents', () => {
    expect(chapterNameFor(toc, 0)).toBeNull()
    expect(chapterNameFor([], 4)).toBeNull()
  })

  it('does not need sorted entries and skips empty titles', () => {
    expect(chapterNameFor([{ title: 'B', order: 5 }, { title: 'A', order: 2 }, { title: ' ', order: 4 }], 4)).toBe('A')
  })
})

describe('placeFor (spec 019 FR-010a)', () => {
  it('EPUB Page: page in chapter, percent while counting', () => {
    expect(placeFor('epub', 'page', { name: 'Two', progress: 0.4, sectionPage: 4, sectionPageTotal: 12 })).toEqual({
      name: 'Two',
      detail: { kind: 'pageInChapter', page: 4, total: 12 },
    })
    expect(placeFor('epub', 'page', { name: 'Two', progress: 0.4, sectionPage: 1, sectionPageTotal: 0 }).detail).toEqual({
      kind: 'percent',
      value: 40,
    })
  })

  it('EPUB Scroll: percent', () => {
    expect(placeFor('epub', 'scroll', { name: null, progress: 0.256, sectionPage: 2, sectionPageTotal: 3 })).toEqual({
      name: null,
      detail: { kind: 'percent', value: 26 },
    })
  })

  it('PDF: page x / y in both views, percent instead of page 0', () => {
    expect(placeFor('pdf', 'scroll', { name: 'Intro', progress: 0, page: 3, pageTotal: 20 }).detail).toEqual({
      kind: 'page',
      page: 3,
      total: 20,
    })
    expect(placeFor('pdf', 'page', { name: null, progress: 0, page: 0, pageTotal: 0 }).detail).toEqual({ kind: 'percent', value: 0 })
  })

  it('Markdown and TXT: name (heading / title) + percent', () => {
    expect(placeFor('md', 'scroll', { name: 'Usage', progress: 0.5 })).toEqual({ name: 'Usage', detail: { kind: 'percent', value: 50 } })
    expect(placeFor('txt', 'scroll', { name: 'My book', progress: 1.4 })).toEqual({
      name: 'My book',
      detail: { kind: 'percent', value: 100 },
    })
    expect(placeFor('md', 'scroll', { name: '  ', progress: 0 }).name).toBeNull()
  })
})

describe('bookmarkLabelFor (FR-019)', () => {
  it('uses the name, else the formatted place', () => {
    const format = (d: { kind: string }) => `fmt:${d.kind}`
    expect(bookmarkLabelFor({ name: 'Two', detail: { kind: 'percent', value: 3 } }, format)).toBe('Two')
    expect(bookmarkLabelFor({ name: null, detail: { kind: 'percent', value: 3 } }, format)).toBe('fmt:percent')
  })
})

import { describe, expect, it } from 'vitest'
import type { LibraryBook } from '../../src/app-models/library-book'
import { bulkAddSummary, collectionCoverSlots, pickerRows } from '../../src/app-models/collection-view'

const book = (id: string, title: string, author = 'Unknown'): LibraryBook => ({
  id,
  title,
  author,
  fileName: `${id}.epub`,
  format: 'epub',
  isFavorite: false,
  status: 'not-started',
  noteCount: 0,
})

const books = [
  book('a', 'Dune', 'Frank Herbert'),
  book('b', 'Emma', 'Jane Austen'),
  book('c', 'Persuasion', 'Jane Austen'),
  book('d', 'Neuromancer', 'William Gibson'),
]

describe('pickerRows', () => {
  it('keeps the input order and returns every book for an empty or blank query', () => {
    expect(pickerRows(books, [], '').map((r) => r.book.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(pickerRows(books, [], '   ').map((r) => r.book.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('filters by title or author, ignoring case and surrounding spaces', () => {
    expect(pickerRows(books, [], 'austen').map((r) => r.book.id)).toEqual(['b', 'c'])
    expect(pickerRows(books, [], '  NEURO ').map((r) => r.book.id)).toEqual(['d'])
    expect(pickerRows(books, [], 'epub')).toEqual([])
  })

  it('marks exactly the books already in the collection as included', () => {
    const rows = pickerRows(books, ['c', 'zz'], '')
    expect(rows.map((r) => r.included)).toEqual([false, false, true, false])
  })

  it('filters 1 000 books well under the SC-006 budget', () => {
    const many = Array.from({ length: 1000 }, (_, i) => book(`id-${i}`, `Title number ${i}`, `Author ${i % 37}`))
    const ids = many.slice(0, 300).map((b) => b.id)
    const runs: number[] = []
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      pickerRows(many, ids, 'r 1')
      runs.push(performance.now() - start)
    }
    runs.sort((x, y) => x - y)
    expect(runs[10]).toBeLessThan(50)
  })
})

describe('bulkAddSummary', () => {
  it('reports a failure, a partial add and a full add', () => {
    expect(bulkAddSummary({ ok: false, added: [], skipped: [] })).toEqual({ kind: 'failed', added: 0, skipped: 0 })
    expect(bulkAddSummary({ ok: true, added: ['a', 'b'], skipped: ['c'] })).toEqual({ kind: 'partial', added: 2, skipped: 1 })
    expect(bulkAddSummary({ ok: true, added: ['a'], skipped: [] })).toEqual({ kind: 'added', added: 1, skipped: 0 })
  })
})

describe('collectionCoverSlots', () => {
  const inLibrary = new Set(['a', 'b', 'c', 'd'])
  const has = (id: string) => inLibrary.has(id)

  it('always returns `count` slots, books first in collection order', () => {
    expect(collectionCoverSlots(['d', 'a', 'b', 'c'], has)).toEqual([
      { kind: 'book', bookId: 'd' },
      { kind: 'book', bookId: 'a' },
      { kind: 'book', bookId: 'b' },
    ])
  })

  it('skips ids missing from the library and pads with empty slots', () => {
    expect(collectionCoverSlots(['gone', 'b'], has)).toEqual([
      { kind: 'book', bookId: 'b' },
      { kind: 'empty' },
      { kind: 'empty' },
    ])
    expect(collectionCoverSlots([], has)).toEqual([{ kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }])
  })

  it('honours a custom count, including 0', () => {
    expect(collectionCoverSlots(['a', 'b'], has, 1)).toEqual([{ kind: 'book', bookId: 'a' }])
    expect(collectionCoverSlots(['a'], has, 0)).toEqual([])
  })
})

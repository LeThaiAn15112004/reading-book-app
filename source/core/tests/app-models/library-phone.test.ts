import { describe, expect, it } from 'vitest'
import type { LibraryBook } from '../../src/app-models/library-book.js'
import {
  PHONE_LIBRARY_CHIPS,
  continueAction,
  filterPhoneChip,
  listRowProgress,
  pickPhoneContinueReading,
  toPhoneChip,
} from '../../src/app-models/library-phone.js'

function book(id: string, patch: Partial<LibraryBook> = {}): LibraryBook {
  return {
    id,
    title: id,
    author: '—',
    fileName: `${id}.epub`,
    format: 'epub',
    isFavorite: false,
    status: 'not-started',
    noteCount: 0,
    ...patch,
  }
}

const ids = (books: LibraryBook[]) => books.map((b) => b.id)

describe('PHONE_LIBRARY_CHIPS', () => {
  it('lists All, Recent, Saved (favourites), Completed in this order', () => {
    expect(PHONE_LIBRARY_CHIPS.map((c) => c.id)).toEqual(['all', 'recent', 'favorites', 'completed'])
    expect(PHONE_LIBRARY_CHIPS.map((c) => c.labelKey)).toEqual([
      'library.phone.chips.all',
      'library.phone.chips.recent',
      'library.phone.chips.saved',
      'library.phone.chips.completed',
    ])
  })
})

describe('filterPhoneChip', () => {
  const books = [
    book('never'),
    book('old', { status: 'reading', lastReadAt: '2026-01-01T00:00:00Z' }),
    book('fav', { isFavorite: true }),
    book('done', { status: 'completed', lastReadAt: '2026-03-01T00:00:00Z' }),
    book('new', { status: 'reading', lastReadAt: '2026-05-01T00:00:00Z' }),
  ]

  it('all keeps every book in the given order', () => {
    expect(ids(filterPhoneChip(books, 'all'))).toEqual(['never', 'old', 'fav', 'done', 'new'])
  })

  it('recent keeps books with a lastReadAt, most recently read first, whatever the input order', () => {
    expect(ids(filterPhoneChip(books, 'recent'))).toEqual(['new', 'done', 'old'])
    expect(ids(filterPhoneChip([...books].reverse(), 'recent'))).toEqual(['new', 'done', 'old'])
  })

  it('favorites keeps isFavorite books, completed keeps status completed', () => {
    expect(ids(filterPhoneChip(books, 'favorites'))).toEqual(['fav'])
    expect(ids(filterPhoneChip(books, 'completed'))).toEqual(['done'])
  })

  it('does not mutate its input', () => {
    const copy = [...books]
    filterPhoneChip(books, 'recent')
    expect(books).toEqual(copy)
  })
})

describe('toPhoneChip', () => {
  it('keeps phone chips and shows desktop-only filters as All', () => {
    expect(toPhoneChip('all')).toBe('all')
    expect(toPhoneChip('recent')).toBe('recent')
    expect(toPhoneChip('favorites')).toBe('favorites')
    expect(toPhoneChip('completed')).toBe('completed')
    expect(toPhoneChip('reading')).toBe('all')
    expect(toPhoneChip('not-started')).toBe('all')
  })
})

describe('pickPhoneContinueReading', () => {
  it('includes reading and completed books that have a lastReadAt, newest first, ties by title', () => {
    const books = [
      book('never', { status: 'not-started', lastReadAt: '2026-09-01T00:00:00Z' }),
      book('noDate', { status: 'reading' }),
      book('b', { status: 'reading', lastReadAt: '2026-02-01T00:00:00Z' }),
      book('a', { status: 'completed', lastReadAt: '2026-02-01T00:00:00Z' }),
      book('z', { status: 'reading', lastReadAt: '2026-04-01T00:00:00Z' }),
    ]
    expect(ids(pickPhoneContinueReading(books))).toEqual(['z', 'a', 'b'])
  })

  it('returns at most 10 by default and honours a limit', () => {
    const books = Array.from({ length: 14 }, (_, i) =>
      book(`b${String(i).padStart(2, '0')}`, { status: 'reading', lastReadAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z` }),
    )
    expect(pickPhoneContinueReading(books)).toHaveLength(10)
    expect(pickPhoneContinueReading(books)[0]?.id).toBe('b13')
    expect(pickPhoneContinueReading(books, 3)).toHaveLength(3)
  })
})

describe('continueAction', () => {
  it('is read-again for a completed book or one at 100 %, resume otherwise', () => {
    expect(continueAction(book('a', { status: 'completed' }))).toBe('read-again')
    expect(continueAction(book('b', { status: 'reading', progressPercent: 100 }))).toBe('read-again')
    expect(continueAction(book('c', { status: 'reading', progressPercent: 99.6 }))).toBe('resume')
    expect(continueAction(book('d', { status: 'reading' }))).toBe('resume')
  })
})

describe('listRowProgress', () => {
  it('shows rounded progress once the book was opened', () => {
    expect(listRowProgress(book('a', { lastReadAt: '2026-01-01T00:00:00Z', progressPercent: 42.4 }))).toBe(42)
    expect(listRowProgress(book('b', { lastReadAt: '2026-01-01T00:00:00Z' }))).toBe(0)
    expect(listRowProgress(book('c', { progressPercent: 12.6 }))).toBe(13)
  })

  it('shows no bar for a book never opened', () => {
    expect(listRowProgress(book('d'))).toBeUndefined()
    expect(listRowProgress(book('e', { progressPercent: 0 }))).toBeUndefined()
  })
})

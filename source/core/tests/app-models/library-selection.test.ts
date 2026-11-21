import { describe, expect, it } from 'vitest'
import {
  allSelected,
  bulkFavoriteTarget,
  bulkResult,
  favoriteChanges,
  pruneSelection,
  removalKindOf,
  toggleSelected,
} from '../../src/app-models/library-selection'

describe('library selection', () => {
  it('toggles in pick order and prunes to the shown books', () => {
    expect(toggleSelected(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleSelected(['a', 'b'], 'a')).toEqual(['b'])
    expect(pruneSelection(['a', 'b', 'c'], ['c', 'a'])).toEqual(['a', 'c'])
  })

  it('all selected only when every shown book is picked', () => {
    expect(allSelected(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(allSelected(['a'], ['a', 'b'])).toBe(false)
    expect(allSelected([], [])).toBe(false)
  })

  it('favourite: add when one is not a favourite, remove when all are; only changed ids are written', () => {
    const books = [
      { id: 'a', isFavorite: true },
      { id: 'b', isFavorite: false },
      { id: 'c' },
    ]
    expect(bulkFavoriteTarget(books, ['a', 'b'])).toBe(true)
    expect(bulkFavoriteTarget(books, ['a'])).toBe(false)
    expect(favoriteChanges(books, ['a', 'b', 'c'], true)).toEqual(['b', 'c'])
    expect(favoriteChanges(books, ['a', 'b'], false)).toEqual(['a'])
  })

  it('removal kind and result', () => {
    expect(removalKindOf({ chapterCount: 3 })).toBe('remove-audiobook')
    expect(removalKindOf({ chapterCount: 0 })).toBe('remove')
    expect(removalKindOf({})).toBe('remove')
    expect(bulkResult(3, 0)).toEqual({ kind: 'done', count: 3 })
    expect(bulkResult(2, 1)).toEqual({ kind: 'partial', done: 2, failed: 1 })
    expect(bulkResult(0, 2)).toEqual({ kind: 'failed' })
  })
})

import { describe, expect, it } from 'vitest'
import { Book, DocumentFormat, libraryCodec, libraryStatements as q } from '../../src/index.js'

const placeholders = (sql: string): number => (sql.match(/\?/g) ?? []).length

const book = new Book({
  id: 'b1',
  title: 'T',
  filePath: '/x/file.epub',
  format: DocumentFormat.Epub,
  sha256: 'a'.repeat(64),
  addedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('library statements', () => {
  it('every builder binds exactly as many parameters as it has placeholders', () => {
    const now = '2026-01-01T00:00:00.000Z'
    const all = [
      q.selectBookById('b'),
      q.selectBookBySha256('h'),
      q.selectBookByProviderAndExternalId('p', 'e'),
      q.selectAllBooksNewestFirst(),
      q.selectAllBookIds(),
      q.selectBookFilePaths(),
      q.selectBookTitle('b'),
      q.selectBookGenres('b'),
      q.selectBookReadingStatus('b'),
      q.selectBookReadingState('b'),
      q.insertBook(libraryCodec.bookToRowValues(book, ['A'])),
      q.deleteBook('b'),
      q.deleteNotesOfBook('b'),
      q.deleteCollectionLinksOfBook('b'),
      q.updateReadingStatus('b', 'reading', now),
      q.updateFavorite('b', true, now),
      q.updateCoverPath('b', 'c', now),
      q.updateFilePath('b', 'f', now),
      q.updateGenres('b', '[]'),
      q.patchReadingState('b', { updatedAt: now }),
      q.updateFileFingerprint('b', 'h', '{}'),
      q.patchMetadata('b', '{}'),
      q.updateBookMetadata('b', 't', '{}', now),
      q.updateBookMetadataAndGenres('b', 't', '{}', '[]', now),
      q.selectAuthorByName('n'),
      q.insertAuthor('a', 'n', null, now),
      q.insertBookAuthor('b', 'a', 0),
      q.deleteBookAuthors('b'),
      q.selectAuthorNamesOfBook('b'),
      q.selectAllAuthorNames(),
      q.selectCollections(),
      q.selectCollectionBookIds('c'),
      q.selectAllCollectionLinks(),
      q.selectCollectionExists('c'),
      q.insertCollection('c', 'n', null, now, now),
      q.updateCollection('c', 'n', null, now),
      q.deleteCollection('c'),
      q.deleteCollectionLinks('c'),
      q.selectNextCollectionSortOrder('c'),
      q.insertCollectionBook('c', 'b', 0, now),
      q.touchCollection('c', now),
      q.deleteCollectionBook('c', 'b'),
      q.insertAudioChapter(['i', 'b', 0, 't', 'f', 's', 'mp3', 1, 'h', null]),
      q.selectAudioChapters('b'),
      q.selectAudioChapter('b', 'c'),
      q.selectHasAudioChapters('b'),
      q.selectAudioChapterCounts(),
    ]
    for (const statement of all) expect(statement.params.length, statement.sql).toBe(placeholders(statement.sql))
  })

  it('insertBook takes the 15 values of bookToRowValues, in column order', () => {
    const values = libraryCodec.bookToRowValues(book, ['b', 'A'])
    expect(values).toHaveLength(15)
    expect(values[0]).toBe('b1')
    expect(values[12]).toBe('["A","b"]')
    expect(q.insertBook(values).params).toEqual(values)
  })

  it('a book without a signature stores no signature member in metadata_json', () => {
    const metadata = JSON.parse(libraryCodec.bookToRowValues(book)[11] as string) as Record<string, unknown>
    expect(Object.keys(metadata).some((k) => k.startsWith('signat') || k === 'signerName' || k === 'signedAt')).toBe(false)
  })
})

/**
 * Removing a book (spec 008, T049; `data-model.md`, Removal; FR-017h): rows first in one transaction, then the
 * app's copy and cover; only app-private paths can ever be named.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createFileService } from '../host/file-service'
import { HostServiceError } from '../host/protocol'
import { prepareMobileStorage } from '../bridge'
import { count, createFakeHost, MemoryFs, testUuid, type FakeHost } from './fake-host'

let host: FakeHost
afterEach(() => {
  host?.sql.db.close()
  host = undefined as unknown as FakeHost
})

async function bookWithEverything() {
  host.fs.queuePick('Keep me.md', '# Title\n\nBody')
  const { bookId } = await host.api.import.fromFile()
  const id = bookId!
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9])
  await host.api.library.setGeneratedCover(id, png.buffer)
  await host.api.library.updateMetadata({ id, title: 'Keep me', author: 'Someone' })
  const collection = await host.api.library.createCollection({ name: 'Shelf' })
  await host.api.library.addBookToCollection(collection.id, id)
  await host.api.overlay.saveBookmark({ bookId: id, locatorRef: JSON.stringify({ kind: 'text-offset', offset: 0, blockId: 'md', chapterIndex: 0 }) })
  return id
}

describe('removeBook', () => {
  it('removes the rows, then the copy and the cover', async () => {
    host = await createFakeHost()
    const bookId = await bookWithEverything()
    expect(host.fs.paths()).toEqual([`books/${bookId}/file`, `covers/${bookId}.png`])
    host.requests.length = 0
    expect(await host.api.library.removeBook(bookId)).toEqual({ ok: true })
    for (const table of ['books', 'notes', 'collection_books', 'book_authors']) expect(count(host, table), table).toBe(0)
    expect(count(host, 'collections')).toBe(1)
    expect(host.fs.paths()).toEqual([])
    // Order: the row transaction strictly before the file removal.
    const writes = host.requests.filter((r) => r === 'sql.transaction' || r === 'files.removeBook')
    expect(writes).toEqual(['sql.transaction', 'files.removeBook'])
    expect(await host.api.library.listBooks()).toEqual([])
  })

  it('keeps the library consistent when the files cannot be removed; the next startup sweep removes them', async () => {
    host = await createFakeHost()
    const bookId = await bookWithEverything()
    const realRemove = host.fs.remove.bind(host.fs)
    host.fs.remove = () => {
      throw new Error('EBUSY')
    }
    expect(await host.api.library.removeBook(bookId)).toEqual({ ok: true })
    expect(count(host, 'books')).toBe(0)
    host.fs.remove = realRemove
    await prepareMobileStorage(host.ctx)
    expect(host.fs.paths()).toEqual([])
  })

  it('answers ok: false for an unknown id and touches nothing', async () => {
    host = await createFakeHost()
    const bookId = await bookWithEverything()
    expect(await host.api.library.removeBook(testUuid())).toEqual({ ok: false })
    expect(await host.api.library.removeBook('')).toEqual({ ok: false })
    expect(count(host, 'books')).toBe(1)
    expect(host.fs.paths()).toContain(`books/${bookId}/file`)
  })
})

describe('only app-private paths', () => {
  const service = (fs: MemoryFs) => createFileService({ fs, devChunks: true })
  const refusal = (run: () => unknown) => {
    try {
      run()
    } catch (error) {
      return error instanceof HostServiceError ? error.code : String(error)
    }
    return 'accepted'
  }

  it('refuses any book id that is not a UUID, so nothing outside books/{uuid} and covers/{uuid}.png is named', () => {
    const fs = new MemoryFs()
    fs.writeFile('readmate.db', new Uint8Array([1]))
    fs.writeFile('books/keep/file', new Uint8Array([2]))
    const files = service(fs)
    for (const bookId of ['../readmate.db', '..', 'keep', '', '/data/user/0', 'books/x', `${testUuid()}/../..`, 42]) {
      expect(refusal(() => files.removeBook!({ bookId })), String(bookId)).toBe('INVALID_ARGUMENT')
    }
    expect(fs.paths()).toEqual(['books/keep/file', 'readmate.db'])
  })

  it('removes exactly books/{id}/ and covers/{id}.png, nothing beside them', () => {
    const fs = new MemoryFs()
    const id = testUuid()
    const other = testUuid()
    for (const p of [`books/${id}/file`, `covers/${id}.png`, `books/${other}/file`, `covers/${other}.png`, 'readmate.db']) fs.writeFile(p, new Uint8Array([1]))
    service(fs).removeBook!({ bookId: id })
    expect(fs.paths()).toEqual([`books/${other}/file`, `covers/${other}.png`, 'readmate.db'])
  })

  it('has no route that writes into an imported book', () => {
    const files = service(new MemoryFs())
    expect(Object.keys(files).sort()).toEqual(['cancel', 'commitStaged', 'discardStaged', 'hashStaged', 'pick', 'readChunk', 'readCover', 'removeBook', 'stage', 'sweep', 'writeCover'])
  })
})

/**
 * Import (spec 008, T048), following the state flow of `data-model.md`:
 *   idle → picking → copying → hashing → checking → storing → done;  any step → failed | cancelled → cleanup.
 * Success, duplicate, cancel, no space, commit-failure cleanup and the startup sweep, on the real host services.
 */
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileService } from '../host/file-service'
import { prepareMobileStorage } from '../bridge'
import { count, createFakeHost, MemoryFs, testUuid, type FakeHost } from './fake-host'

let host: FakeHost
afterEach(() => {
  host?.sql.db.close()
  host = undefined as unknown as FakeHost
})

async function epub(meta: { title: string; creator: string; subject?: string }) {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>${meta.title}</dc:title><dc:creator>${meta.creator}</dc:creator>${meta.subject ? `<dc:subject>${meta.subject}</dc:subject>` : ''}<dc:language>vi</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  )
  zip.file('OEBPS/c1.xhtml', '<html><body><p>One</p></body></html>')
  zip.file('OEBPS/c2.xhtml', '<html><body><p>Two</p></body></html>')
  return zip.generateAsync({ type: 'uint8array' })
}

const nothingLeftBehind = (h: FakeHost, keepBooks = 0) => {
  expect(h.fs.list('staging'), 'staging/').toEqual([])
  expect(h.fs.list('books'), 'books/').toHaveLength(keepBooks)
  expect(h.fs.cacheUris(), 'picker cache copies').toEqual([])
}

describe('success', () => {
  it('copies, hashes with Desktop’s SHA-256, stores the row with EPUB metadata, and reports progress', async () => {
    host = await createFakeHost()
    const bytes = await epub({ title: 'Dế Mèn phiêu lưu ký', creator: 'Tô Hoài', subject: 'Thiếu nhi' })
    host.fs.queuePick('de-men.epub', bytes)
    const progress: unknown[] = []
    host.api.import.onProgress((p) => progress.push(p))
    const result = await host.api.import.fromFile()
    expect(result).toEqual({ ok: true, bookId: expect.any(String) })
    const bookId = result.bookId!
    expect(host.fs.files.get(`books/${bookId}/file`)).toEqual(bytes)
    const row = host.sql.db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as Record<string, string>
    expect(row).toMatchObject({ file_path: `books/${bookId}/file`, file_format: 'epub', sha256: createHash('sha256').update(bytes).digest('hex'), title: 'Dế Mèn phiêu lưu ký' })
    expect(JSON.parse(row.metadata_json!)).toMatchObject({ fileSizeBytes: bytes.length, pageCount: 2 })
    expect(JSON.parse(row.genres_json!)).toEqual(['Thiếu nhi'])
    expect(await host.api.library.getBook(bookId)).toMatchObject({ author: 'Tô Hoài', genres: ['Thiếu nhi'], pageCount: 2 })
    expect(progress[0]).toEqual({ stage: 'importing', filename: 'de-men.epub' })
    expect(progress.length).toBeGreaterThan(1)
    nothingLeftBehind(host, 1)
  })

  it('takes the title from the file name when there is no metadata (and for a broken EPUB)', async () => {
    host = await createFakeHost()
    host.fs.queuePick('Bài giảng 01.pdf', '%PDF-1.7')
    host.fs.queuePick('Broken.epub', 'not a zip')
    const a = await host.api.import.fromFile()
    const b = await host.api.import.fromFile()
    expect((await host.api.library.getBook(a.bookId!))?.title).toBe('Bài giảng 01')
    expect((await host.api.library.getBook(b.bookId!))?.title).toBe('Broken')
  })

  it('answers the picker outcomes with Desktop’s codes and leaves nothing behind', async () => {
    host = await createFakeHost()
    host.fs.queueCancelledPick()
    expect(await host.api.import.fromFile()).toMatchObject({ ok: false, errorCode: 'cancelled' })
    host.fs.queuePick('song.mp3', 'ID3')
    expect(await host.api.import.fromFile()).toMatchObject({ ok: false, errorCode: 'unsupported_format' })
    nothingLeftBehind(host)
    expect(count(host, 'books')).toBe(0)
  })
})

describe('duplicate', () => {
  it('is a result naming the existing book, and leaves no second copy', async () => {
    host = await createFakeHost()
    host.fs.queuePick('a.pdf', '%PDF same bytes')
    host.fs.queuePick('renamed copy.pdf', '%PDF same bytes')
    const first = await host.api.import.fromFile()
    const second = await host.api.import.fromFile()
    expect(second).toEqual({ ok: false, bookId: first.bookId, errorCode: 'duplicate', errorMessage: expect.any(String) })
    expect(count(host, 'books')).toBe(1)
    nothingLeftBehind(host, 1)
  })
})

describe('cancel', () => {
  it('stops the copy, answers cancelled, and leaves no staging folder and no row', async () => {
    host = await createFakeHost()
    host.fs.queuePick('long.pdf', new Uint8Array(12 * 1024 * 1024))
    let cancelled = false
    host.api.import.onProgress((p) => {
      if (!cancelled && (p.receivedBytes ?? 0) > 0) {
        cancelled = true
        void host.api.import.cancel()
      }
    })
    expect(await host.api.import.fromFile()).toMatchObject({ ok: false, errorCode: 'cancelled' })
    expect(count(host, 'books')).toBe(0)
    nothingLeftBehind(host)
  })

  it('answers ok: false when nothing is running', async () => {
    host = await createFakeHost()
    expect(await host.api.import.cancel()).toEqual({ ok: false })
  })
})

describe('no space', () => {
  it('is refused before copying when the device is too full, with a clear message', async () => {
    host = await createFakeHost()
    host.fs.available = 1024
    host.fs.queuePick('a.pdf', '%PDF')
    const result = await host.api.import.fromFile()
    expect(result).toMatchObject({ ok: false, errorCode: 'save_failed' })
    expect(result.errorMessage).toMatch(/not enough free space/i)
    expect(count(host, 'books')).toBe(0)
    nothingLeftBehind(host)
  })

  it('is caught when the disk fills up halfway through the copy', async () => {
    host = await createFakeHost()
    host.fs.failWriteAt = { count: 2, message: 'ENOSPC: no space left on device' }
    host.fs.queuePick('big.pdf', new Uint8Array(3 * 1024 * 1024))
    const result = await host.api.import.fromFile()
    expect(result.errorMessage).toMatch(/not enough free space/i)
    expect(count(host, 'books')).toBe(0)
    nothingLeftBehind(host)
  })
})

describe('commit failure cleanup', () => {
  it('removes the moved file when the row cannot be written', async () => {
    host = await createFakeHost()
    host.sql.failNextTransactionMatching(/INSERT INTO books/)
    host.fs.queuePick('a.pdf', '%PDF')
    expect(await host.api.import.fromFile()).toMatchObject({ ok: false, errorCode: 'save_failed' })
    expect(count(host, 'books')).toBe(0)
    nothingLeftBehind(host)
  })

  it('discards the staged copy when the move into books/ fails', async () => {
    host = await createFakeHost()
    host.fs.failMove = true
    host.fs.queuePick('a.pdf', '%PDF')
    expect(await host.api.import.fromFile()).toMatchObject({ ok: false, errorCode: 'save_failed' })
    nothingLeftBehind(host)
  })
})

describe('startup sweep', () => {
  it('empties staging/ and removes book folders and covers without a row, keeping the library', async () => {
    host = await createFakeHost()
    host.fs.queuePick('keep.pdf', '%PDF keep')
    const { bookId } = await host.api.import.fromFile()
    const orphan = testUuid()
    host.fs.writeFile(`staging/${testUuid()}/file`, new Uint8Array([1]))
    host.fs.writeFile(`books/${orphan}/file`, new Uint8Array([2]))
    host.fs.writeFile(`covers/${orphan}.png`, new Uint8Array([3]))
    host.fs.writeFile(`covers/${bookId}.png`, new Uint8Array([4]))
    host.fs.writeFile('books/not-a-uuid/file', new Uint8Array([5]))
    await prepareMobileStorage(host.ctx)
    expect(host.fs.paths()).toEqual([`books/${bookId}/file`, `covers/${bookId}.png`].sort())
  })

  it('never sweeps a staging folder whose copy is still running', async () => {
    const fs = new MemoryFs()
    const service = createFileService({ fs, devChunks: false, yieldToEvents: () => new Promise((r) => setTimeout(r, 0)) })
    fs.queuePick('a.pdf', new Uint8Array(3 * 1024 * 1024))
    const picked = (await service.pick!({ extensions: ['pdf'] })) as { pickId: string }
    const stagingId = testUuid()
    const staging = (service.stage!({ pickId: picked.pickId, stagingId }) as Promise<unknown>)
    await new Promise((r) => setTimeout(r, 0))
    service.sweep!({ knownBookIds: [] })
    await staging
    expect(fs.fileSize(`staging/${stagingId}/file`)).toBe(3 * 1024 * 1024)
  })
})

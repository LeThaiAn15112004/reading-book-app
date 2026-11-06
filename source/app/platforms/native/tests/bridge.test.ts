/**
 * Mobile Bridge (spec 008, T047): `DesktopApi` satisfied, not-available behaviour, safe empty results, serialized
 * writes, the chunked `openBookContent` route and its 20 MB refusal. Runs the real bridge against the real host
 * services (`fake-host.ts`).
 */
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import { DEV_BOOK_MAX_BYTES } from '../host/protocol'
import type { DesktopApi } from '../bridge'
import { createBookContentSource } from '../bridge/book-content'
import { createWriteQueue, type HostClient } from '../bridge/host-client'
import { NotAvailableOnPlatformError } from '../bridge/unavailable'
import { bookFilePath } from '../stores/library-store'
import { count, createFakeHost, testUuid, type FakeHost } from './fake-host'

let host: FakeHost
afterEach(() => {
  host?.sql.db.close()
  host = undefined as unknown as FakeHost
})

async function importText(name: string, body: string | Uint8Array) {
  host.fs.queuePick(name, body)
  const result = await host.api.import.fromFile()
  expect(result).toMatchObject({ ok: true })
  return result.bookId!
}

describe('the DesktopApi shape', () => {
  it('is the DesktopApi type, and every group the UI imports exists', async () => {
    host = await createFakeHost()
    expectTypeOf(host.api).toEqualTypeOf<DesktopApi>()
    const groups = ['library', 'import', 'overlay', 'txt', 'graphics', 'attachments', 'annotationTransfer', 'zipImport', 'audio', 'bookIndex', 'search', 'wordCount', 'cloud', 'notifications', 'background', 'updates', 'storage', 'translation', 'transcription'] as const
    for (const g of groups) expect(host.api[g], g).toBeTypeOf('object')
    expect(await host.api.ping()).toBe('pong')
    expect(await host.api.getAppInfo()).toMatchObject({ name: 'Readmate', transcriptionSupported: false })
  })
})

describe('not available on this platform', () => {
  it('rejects with NotAvailableOnPlatformError for methods without a failure shape', async () => {
    host = await createFakeHost()
    const error = await host.api.cloud.connect('google_drive').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NotAvailableOnPlatformError)
    expect(error).toMatchObject({ code: 'NOT_AVAILABLE_ON_PLATFORM', method: 'cloud.connect' })
    await expect(host.api.library.showInFolder('x')).rejects.toMatchObject({ method: 'library.showInFolder' })
    await expect(host.api.translation.translate({ requestId: 'r', text: 't', sourceLang: 'en', targetLang: 'vi' })).rejects.toBeInstanceOf(NotAvailableOnPlatformError)
  })

  it('resolves with the method’s own failure shape and not_available when it has one', async () => {
    host = await createFakeHost()
    expect(await host.api.library.relinkBook('x')).toMatchObject({ ok: false, errorCode: 'not_available' })
    expect(await host.api.import.fromUrl('https://example.com/a.epub')).toMatchObject({ ok: false, bookId: null, errorCode: 'not_available' })
    expect(await host.api.txt.commit({ bookId: 'x', baseRevision: 0, upserts: [], deletedIds: [] })).toMatchObject({ ok: false, errorCode: 'not_available' })
  })
})

describe('safe empty results', () => {
  it('answers what the Reader calls while reading, without errors', async () => {
    host = await createFakeHost()
    expect(await host.api.overlay.listInk('b')).toEqual([])
    expect(await host.api.overlay.listPdfAnnotationConflicts('b')).toEqual([])
    expect(await host.api.overlay.watchPdfEmbeddedAnnotations('b')).toEqual({ ok: true })
    expect(await host.api.overlay.unwatchPdfEmbeddedAnnotations('b')).toEqual({ ok: true })
    expect(await host.api.getFullscreen()).toBe(false)
    expect(await host.api.getGoogleOAuthConfig()).toBeNull()
    for (const off of [
      host.api.onFullscreenChanged(() => {}),
      host.api.overlay.onPdfEmbeddedAnnotationsChanged(() => {}),
      host.api.bookIndex.onStatus(() => {}),
      host.api.notifications.onOpenBook(() => {}),
      host.api.transcription.onProgress(() => {}),
    ]) {
      expect(off).toBeTypeOf('function')
      expect(() => off()).not.toThrow()
    }
  })
})

describe('serialized writes', () => {
  it('runs queued tasks one at a time, in order, and a failure does not stop the next', async () => {
    const queue = createWriteQueue()
    const order: string[] = []
    let active = 0
    let maxActive = 0
    const task = (name: string, fail = false) => () =>
      new Promise<string>((resolve, reject) => {
        active++
        maxActive = Math.max(maxActive, active)
        setTimeout(() => {
          active--
          order.push(name)
          if (fail) reject(new Error(name))
          else resolve(name)
        }, 3)
      })
    const results = await Promise.allSettled([queue.run(task('a')), queue.run(task('b', true)), queue.run(task('c'))])
    expect(order).toEqual(['a', 'b', 'c'])
    expect(maxActive).toBe(1)
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
  })

  it('never lets two host transactions overlap, however many saves the UI fires at once', async () => {
    host = await createFakeHost()
    const bookId = await importText('Notes.md', '# Title\n\nSome text.')
    const original = host.sql.engine.exclusiveTransaction.bind(host.sql.engine)
    let active = 0
    let maxActive = 0
    host.sql.engine.exclusiveTransaction = async (taskFn) => {
      active++
      maxActive = Math.max(maxActive, active)
      try {
        await new Promise((r) => setTimeout(r, 2))
        return await original(taskFn)
      } finally {
        active--
      }
    }
    const locatorRef = JSON.stringify({ kind: 'text-offset', offset: 0, blockId: 'md', chapterIndex: 0 })
    const saves = Array.from({ length: 12 }, (_, i) =>
      i % 3 === 0 ? host.api.library.addBookToCollection('missing', bookId) : host.api.overlay.saveBookmark({ bookId, locatorRef, label: `b${i}` }),
    )
    saves.push(host.api.library.markAsReading(bookId), host.api.library.markAsReading(bookId))
    await Promise.all(saves)
    expect(maxActive).toBe(1)
    expect((await host.api.overlay.listBookmarks(bookId)).length).toBe(8)
  })
})

describe('openBookContent', () => {
  it('assembles a book from 1 MiB chunks in Expo Go and returns the same ArrayBuffer result as Desktop', async () => {
    host = await createFakeHost()
    const bytes = new Uint8Array(2.5 * 1024 * 1024).map((_, i) => (i * 7) % 251)
    host.fs.queuePick('Big.pdf', bytes)
    const { bookId } = await host.api.import.fromFile()
    host.requests.length = 0
    const result = await host.api.library.openBookContent(bookId!)
    expect(result).toMatchObject({ ok: true, bookId, format: 'pdf', byteLength: bytes.length })
    expect(Buffer.from(result.data!).equals(Buffer.from(bytes))).toBe(true)
    expect(host.requests.filter((r) => r === 'files.readChunk')).toHaveLength(3)
  })

  it('refuses a book above 20 MB in Expo Go with a clear too_large result, reading nothing', async () => {
    host = await createFakeHost()
    const bookId = await importText('Small.pdf', '%PDF-1.4 small')
    host.fs.files.set(bookFilePath(bookId), new Uint8Array(DEV_BOOK_MAX_BYTES + 1))
    const result = await host.api.library.openBookContent(bookId)
    expect(result).toMatchObject({ ok: false, errorCode: 'too_large' })
    expect(result.errorMessage).toMatch(/20 MB/)
  })

  it('reports a missing copy as missing_file, and an unknown id as not_found', async () => {
    host = await createFakeHost()
    const bookId = await importText('Gone.pdf', '%PDF-1.4')
    host.fs.remove(`books/${bookId}`)
    expect(await host.api.library.openBookContent(bookId)).toMatchObject({ ok: false, errorCode: 'missing_file' })
    expect(await host.api.library.openBookContent(testUuid())).toMatchObject({ ok: false, errorCode: 'not_found' })
  })

  it('sends nothing for TXT, as Desktop does (txt.open reads it)', async () => {
    host = await createFakeHost()
    const bookId = await importText('Plain.txt', 'hello')
    expect(await host.api.library.openBookContent(bookId)).toMatchObject({ ok: true, format: 'txt', byteLength: 0 })
  })

  it('uses the local server in the real app: token-protected book and cover URLs, no bytes over postMessage', async () => {
    const urls: string[] = []
    const fakeFetch = (async (url: string) => {
      urls.push(url)
      return new Response(new Uint8Array([1, 2, 3]))
    }) as unknown as typeof fetch
    const neverCalled = { call: () => Promise.reject(new Error('no RPC expected')), onEvent: () => () => {} } as HostClient
    const source = createBookContentSource(neverCalled, { baseUrl: 'http://127.0.0.1:47821', token: 'tok' }, fakeFetch)
    const id = testUuid()
    expect(new Uint8Array(await source.read(id))).toEqual(new Uint8Array([1, 2, 3]))
    expect(urls).toEqual([`http://127.0.0.1:47821/books/${id}?t=tok`])
    expect(await source.coverUrl(id, '2026-01-01')).toBe(`http://127.0.0.1:47821/covers/${id}?t=tok&v=2026-01-01`)
  })
})

describe('library, overlay and txt over the bridge', () => {
  it('lists an imported book with Desktop’s DTO fields and a data: cover once one is generated', async () => {
    host = await createFakeHost()
    const bookId = await importText('My Book.pdf', '%PDF-1.4')
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    expect(await host.api.library.setGeneratedCover(bookId, png.buffer)).toEqual({ ok: true })
    expect(await host.api.library.setGeneratedCover(bookId, png.buffer)).toEqual({ ok: false })
    const [book] = await host.api.library.listBooks()
    expect(book).toMatchObject({ id: bookId, title: 'My Book', format: 'pdf', fileStorage: 'referenced', readingStatus: 'not-started' })
    expect(book!.coverUrl).toMatch(/^data:image\/png;base64,/)
    expect(JSON.stringify(book)).not.toMatch(/books\/|file:\/\//)
  })

  it('round-trips session state the way Desktop merges it (a settings-only save keeps the location)', async () => {
    host = await createFakeHost()
    const bookId = await importText('Doc.md', '# A')
    const lastReadLocation = JSON.stringify({ kind: 'text-offset', offset: 4, blockId: 'md', chapterIndex: 0 })
    expect(await host.api.overlay.saveSessionState({ bookId, lastReadLocation, percent: 40, fontSize: 18 })).toEqual({ ok: true })
    expect(await host.api.overlay.saveSessionState({ bookId, fontSize: 20 })).toEqual({ ok: true })
    const state = await host.api.overlay.getSessionState(bookId)
    expect(state).toMatchObject({ bookId, percent: 40, fontSize: 20 })
    expect(JSON.parse(state!.lastReadLocation!)).toMatchObject({ kind: 'text-offset', offset: 4 })
  })

  it('saves text markup, and refuses TXT rows and kinds Mobile does not create (null, as Desktop)', async () => {
    host = await createFakeHost()
    const bookId = await importText('Doc.md', '# A\n\nText')
    const locatorRef = JSON.stringify({ kind: 'text-offset', offset: 0, blockId: 'md', chapterIndex: 0 })
    const mdAnnotationRef = JSON.stringify({ startSegment: 0, startOffset: 0, endSegment: 0, endOffset: 1 })
    const saved = await host.api.overlay.saveHighlight({ bookId, locatorRef, styleKind: 'highlight', colorHex: '#FFEB3B', mdAnnotationRef, note: ' n ' })
    expect(saved).toMatchObject({ bookId, styleKind: 'highlight', note: 'n', mdAnnotationRef })
    expect(await host.api.overlay.saveHighlight({ bookId, locatorRef, styleKind: 'rectangle', colorHex: '#000' })).toBeNull()
    expect(await host.api.overlay.saveHighlight({ bookId, locatorRef, styleKind: 'highlight', colorHex: '#000', txtAnnotationRef: '{"startOffset":0,"endOffset":1}' })).toBeNull()
    expect(await host.api.overlay.saveHighlight({ bookId, locatorRef: 'not json', styleKind: 'highlight', colorHex: '#000' })).toBeNull()
    expect(await host.api.overlay.listHighlights(bookId)).toHaveLength(1)
    expect(await host.api.overlay.deleteHighlight({ bookId, id: saved!.id })).toEqual({ ok: true })
    expect(count(host, 'notes')).toBe(0)
  })

  it('opens TXT read-only, decoded as Desktop decodes it', async () => {
    host = await createFakeHost()
    const bookId = await importText('Poem.txt', new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Xin chào\r\nthế giới')]))
    expect(await host.api.txt.open(bookId)).toMatchObject({ ok: true, text: 'Xin chào\nthế giới', revision: 0, editable: false, encoding: 'utf-8', highlights: [] })
    const legacy = await importText('Old.txt', new Uint8Array([0x63, 0x61, 0x66, 0xe9]))
    expect(await host.api.txt.open(legacy)).toMatchObject({ ok: true, text: 'café', notices: ['legacy_encoding'] })
  })

  it('runs onRequestFlushSession when the app goes to the background', async () => {
    host = await createFakeHost()
    let flushed = 0
    const off = host.api.onRequestFlushSession(() => {
      flushed++
    })
    host.emit('lifecycle', { state: 'active' })
    host.emit('lifecycle', { state: 'background' })
    await host.settle()
    expect(flushed).toBe(1)
    off()
    host.emit('lifecycle', { state: 'background' })
    await host.settle()
    expect(flushed).toBe(1)
  })
})

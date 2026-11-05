/**
 * End-to-end flow through the public SDK API with the reference in-memory adapters:
 * import → duplicate detection → open → annotate → undo/redo → bookmark → session autosave →
 * reopen from storage in a brand-new SDK instance. Replaces the former `examples/node-host`
 * script, so the scenario breaks the build as soon as the API drifts instead of rotting.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  CfiLocation,
  buildCfiRange,
  createBookReaderSdk,
  createInMemoryFileSystem,
  createInMemoryStorage,
  filterMarkups,
  isSdkError,
  silentLogger,
  spineIndexFromCfi,
  type ArchiveAdapter,
  type BookReaderSdk,
  type InMemoryFileSystem,
  type InMemoryStorage,
  type ReaderMarkup,
  type SdkEventMap,
} from '../../src/index.js'

// ── Fixture: a fake "zip" whose bytes are a JSON map of entry → text | byte array ────────────
type Entries = Record<string, string | number[]>

const fakeArchive: ArchiveAdapter = {
  async open(bytes) {
    const entries = JSON.parse(String.fromCharCode(...bytes)) as Entries
    const toBytes = (v: string | number[]) =>
      Uint8Array.from(typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : v)
    return {
      listEntries: () => Object.keys(entries),
      readText: async (path) => (typeof entries[path] === 'string' ? (entries[path] as string) : null),
      readBytes: async (path) => (entries[path] === undefined ? null : toBytes(entries[path]!)),
    }
  },
}

const chapter = (n: number) =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Chapter ${n}</p></body></html>`

const EPUB_ENTRIES: Entries = {
  mimetype: 'application/epub+zip',
  'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="uid">urn:uuid:1234</dc:identifier>
        <dc:title>Alice&apos;s Adventures in Wonderland</dc:title>
        <dc:creator id="c1">Lewis Carroll</dc:creator>
        <dc:language>en</dc:language>
        <dc:subject>Fantasy</dc:subject><dc:subject>Classics</dc:subject>
        <dc:description><![CDATA[<p>A girl & a rabbit hole.</p>]]></dc:description>
        <!-- <dc:title>commented out</dc:title> -->
      </metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="cover" href="images/cover%20art.png" media-type="image/png" properties="cover-image"/>
        <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch3" href="text/ch3.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/></spine>
    </package>`,
  'OEBPS/nav.xhtml': '<html/>',
  'OEBPS/images/cover art.png': [0x89, 0x50, 0x4e, 0x47, 1, 2, 3],
  'OEBPS/text/ch1.xhtml': chapter(1),
  'OEBPS/text/ch2.xhtml': chapter(2),
  'OEBPS/text/ch3.xhtml': chapter(3),
}

const SOURCE = 'downloads/alice_in_wonderland.epub'
const epubBytes = () => Uint8Array.from([...JSON.stringify(EPUB_ENTRIES)].map((c) => c.charCodeAt(0)))
const range = (chapterStep: number, from: number, to: number) =>
  buildCfiRange(`/6/${chapterStep}!/4/2`, `/1:${from}`, `/1:${to}`)

// ── Harness ──────────────────────────────────────────────────────────────────────────────────
interface Host {
  sdk: BookReaderSdk
  errors: SdkEventMap['error'][]
  painted: Map<string, string>
  surfaceLog: string[]
}

let storage: InMemoryStorage
let fileSystem: InMemoryFileSystem
const live: BookReaderSdk[] = []

function boot(): Host {
  const sdk = createBookReaderSdk({
    adapters: {
      storage,
      fileSystem,
      archive: fakeArchive,
      // hash / ids / clock / scheduler omitted on purpose → portable defaults (WebCrypto, setTimeout)
      logger: silentLogger,
    },
    options: { autosaveDelayMs: 10 },
  })
  live.push(sdk)
  const errors: SdkEventMap['error'][] = []
  sdk.events.on('error', (e) => errors.push(e))

  // A fake render surface: records what the stores ask the engine to paint.
  const painted = new Map<string, string>()
  const surfaceLog: string[] = []
  const kindOf = (m: ReaderMarkup) => ('styleKind' in m ? m.styleKind : 'bookmark')
  sdk.attachSurface({
    paintMarkup: (m) => painted.set(m.id, kindOf(m)),
    unpaintMarkup: (m) => painted.delete(m.id),
    setFocusedMarkup: (id) => surfaceLog.push(`focus:${id}`),
    clearSelection: () => surfaceLog.push('clearSelection'),
    goTo: async (loc) => void surfaceLog.push(`goTo:${loc.kind}`),
    flashMarkup: (m) => surfaceLog.push(`flash:${m.id}`),
  })
  return { sdk, errors, painted, surfaceLog }
}

async function importAlice(sdk: BookReaderSdk) {
  const result = await sdk.stores.library.getState().importFile({ sourceRef: SOURCE })
  if (result.status !== 'imported') throw new Error(`import failed: ${JSON.stringify(result)}`)
  return result.book
}

describe('reader flow (in-memory host)', () => {
  let host: Host

  const setup = () => {
    storage = createInMemoryStorage()
    fileSystem = createInMemoryFileSystem({ [SOURCE]: epubBytes() })
    host = boot()
  }

  afterEach(async () => {
    await Promise.all(live.splice(0).map((sdk) => sdk.dispose()))
    expect(host.errors).toEqual([])
  })

  it('imports an EPUB with package metadata and detects duplicates', async () => {
    setup()
    const { sdk } = host
    const book = await importAlice(sdk)

    expect(book.title).toBe("Alice's Adventures in Wonderland")
    expect(book.description).toBe('<p>A girl & a rabbit hole.</p>')
    expect(book.pageCount).toBe(3)
    expect(book.format).toBe('epub')
    expect(book.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(book.coverPath).toMatch(/-cover\.png$/)
    expect(fileSystem.files.has(book.filePath)).toBe(true)

    expect((await sdk.stores.library.getState().importFile({ sourceRef: SOURCE })).status).toBe('duplicate')
    expect(sdk.stores.library.getState().books).toHaveLength(1)
    // The original file is never mutated.
    expect(fileSystem.files.get(SOURCE)).toEqual(epubBytes())
  })

  it('rejects an unsupported file type without touching storage', async () => {
    setup()
    fileSystem.files.set('downloads/notes.xyz', new Uint8Array([1]))
    const result = await host.sdk.stores.library.getState().importFile({ sourceRef: 'downloads/notes.xyz' })

    expect(result.status).toBe('failed')
    expect(storage.tables.books.size).toBe(0)
    host.errors.length = 0 // the failure is expected to be reported as an error event
  })

  it('creates, restyles, undoes/redoes and jumps to annotations', async () => {
    setup()
    const { sdk, painted, surfaceLog } = host
    const book = await importAlice(sdk)
    await sdk.openBook(book.id)
    const annotations = sdk.stores.annotations

    const later = await annotations.getState().create({
      styleKind: 'highlight',
      location: new CfiLocation(range(4, 10, 20)),
      chapterIndex: spineIndexFromCfi(range(4, 10, 20)) ?? 0,
      selectionText: { highlight: 'down the rabbit hole' },
      tags: ['Idea', 'idea', ' '],
    })
    const earlier = await annotations.getState().create({
      styleKind: 'underline',
      location: new CfiLocation(range(2, 0, 5)),
      chapterIndex: 0,
      colorHex: '#4FC3F7',
      selectionText: { highlight: 'Alice' },
    })
    expect(later && earlier).toBeTruthy()
    expect(later!.tags).toEqual(['Idea'])
    expect(later!.colorHex).toBe('#FFEB3B')
    expect(annotations.getState().lastUsedColorHex).toBe('#4FC3F7')
    expect(annotations.getState().items.map((m) => m.id)).toEqual([earlier!.id, later!.id])
    expect(painted.size).toBe(2)

    await annotations.getState().update(later!.id, { styleKind: 'strikethrough', note: '  remember this  ' })
    expect(painted.get(later!.id)).toBe('strikethrough')
    annotations.getState().undo()
    expect(annotations.getState().items.find((m) => m.id === later!.id)?.styleKind).toBe('highlight')
    annotations.getState().redo()
    expect(annotations.getState().items.find((m) => m.id === later!.id)?.note).toBe('remember this')

    const note = await annotations.getState().create({
      styleKind: 'textbox',
      location: new CfiLocation(range(6, 1, 2)),
      chapterIndex: 2,
      note: 'A sticky note',
      colorHex: '#000000',
    })
    expect(annotations.getState().lastUsedColorHex).toBe('#4FC3F7')

    await annotations.getState().remove(earlier!.id)
    annotations.getState().undo()
    await annotations.getState().whenIdle()
    expect(annotations.getState().items).toHaveLength(3)

    expect(await annotations.getState().jumpTo(note!.id)).toBe(true)
    expect(surfaceLog.slice(-2)).toEqual(['goTo:cfi', `flash:${note!.id}`])

    const found = filterMarkups(annotations.getState().items, { text: 'rabbit', styleKinds: ['strikethrough'] })
    expect(found.map((m) => m.id)).toEqual([later!.id])
  })

  it('toggles bookmarks and refuses to overwrite an annotation with a bookmark', async () => {
    setup()
    const { sdk } = host
    const book = await importAlice(sdk)
    await sdk.openBook(book.id)

    const bookmarks = sdk.stores.bookmarks
    const here = { location: new CfiLocation('epubcfi(/6/4!/4/2/1:0)'), chapterIndex: 1, label: 'Ch. 2' }
    expect((await bookmarks.getState().toggleAt(here)).action).toBe('added')
    expect((await bookmarks.getState().toggleAt(here)).action).toBe('removed')
    await bookmarks.getState().add(here)
    expect(bookmarks.getState().items).toHaveLength(1)

    const markup = await sdk.stores.annotations.getState().create({
      styleKind: 'highlight',
      location: new CfiLocation(range(4, 0, 3)),
      chapterIndex: 1,
    })
    await expect(
      storage.overlays.saveBookmark({ id: markup!.id, bookId: book.id, locator: bookmarks.getState().items[0]!.locator }),
    ).rejects.toSatisfy(isSdkError)
  })

  it('autosaves the session and restores everything in a fresh SDK instance', async () => {
    setup()
    const first = host
    const book = await importAlice(first.sdk)
    await first.sdk.openBook(book.id)

    await first.sdk.stores.annotations.getState().create({
      styleKind: 'underline',
      location: new CfiLocation(range(2, 0, 5)),
      chapterIndex: 0,
      note: 'kept',
      tags: ['Idea'],
    })
    await first.sdk.stores.bookmarks.getState().add({
      location: new CfiLocation('epubcfi(/6/4!/4/2/1:0)'),
      chapterIndex: 1,
    })

    const saved = new Promise<SdkEventMap['session:saved']>((resolve) =>
      first.sdk.events.on('session:saved', resolve),
    )
    const session = first.sdk.stores.session
    session.getState().updateLocation(new CfiLocation('epubcfi(/6/6!/4/2/1:30)'), { percent: 72.5, label: 'Chapter 3' })
    session.getState().updatePrefs({ fontSize: 20, fontFamily: 'sans' })
    expect(session.getState().dirty).toBe(true)
    expect((await saved).bookId).toBe(book.id)
    expect(session.getState().dirty).toBe(false)

    await first.sdk.dispose()
    await expect(first.sdk.openBook(book.id)).rejects.toSatisfy(isSdkError)

    host = boot()
    await host.sdk.openBook(book.id)
    const reopened = host.sdk.stores.annotations.getState().items
    expect(reopened.map((m) => [m.styleKind, m.note ?? null, m.tags])).toEqual([['underline', 'kept', ['Idea']]])
    expect(host.sdk.stores.bookmarks.getState().items).toHaveLength(1)

    const restored = host.sdk.stores.session.getState()
    expect(restored.percent).toBe(72.5)
    expect(restored.locationLabel).toBe('Chapter 3')
    expect(restored.location?.equals(new CfiLocation('epubcfi(/6/6!/4/2/1:30)'))).toBe(true)
    expect(restored.prefs).toMatchObject({ fontSize: 20, fontFamily: 'sans' })
    expect(first.errors).toEqual([])
  })
})

// End-to-end host: loads the SDK from a RELATIVE path at runtime (no npm install, no workspace,
// no node_modules), injects Node implementations of every port, and exercises import → open →
// annotate → undo/redo → bookmark → session autosave → reopen from disk.
//
//   node examples/node-host/host.mjs
//   BOOK_READER_SDK=../../some/other/place/dist/index.mjs node host.mjs
//
// Exits non-zero on the first failed assertion.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { nodeFileSystem, nodeSqliteDatabase, nodeSqliteLibraryAndSessions } from './node-adapters.mjs'
import { createZip, nodeZipArchive } from './node-zip.mjs'

// ── 1. Resolve the SDK relative to THIS file, wherever the app folder lives ──────────────────
const sdkUrl = new URL(process.env.BOOK_READER_SDK ?? '../../dist/index.mjs', import.meta.url)
const sdk$ = await import(sdkUrl.href)
const {
  createBookReaderSdk,
  createSqlNoteRepositories,
  ensureNotesSchema,
  cfiLocation,
  buildCfiRange,
  spineIndexFromCfi,
  formatCitation,
  filterMarkups,
  isSdkError,
} = sdk$
console.log(`SDK ${sdk$.SDK_VERSION} loaded from ${sdkUrl.pathname}`)

// ── 2. Fixture: a tiny but valid EPUB written to a "Downloads" folder ─────────────────────────
const work = await mkdtemp(join(tmpdir(), 'book-reader-sdk-'))
const sourcePath = join(work, 'downloads', 'alice_in_wonderland.epub')
const chapter = (n) =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Chapter ${n}</p></body></html>`
const epubBytes = createZip([
  { name: 'mimetype', data: 'application/epub+zip', store: true },
  {
    name: 'META-INF/container.xml',
    data: `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  },
  {
    name: 'OEBPS/content.opf',
    data: `<?xml version="1.0" encoding="UTF-8"?>
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
  },
  { name: 'OEBPS/nav.xhtml', data: '<html/>' },
  { name: 'OEBPS/images/cover art.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
  { name: 'OEBPS/text/ch1.xhtml', data: chapter(1) },
  { name: 'OEBPS/text/ch2.xhtml', data: chapter(2) },
  { name: 'OEBPS/text/ch3.xhtml', data: chapter(3) },
])
await (await import('node:fs/promises')).mkdir(join(work, 'downloads'), { recursive: true })
await writeFile(sourcePath, epubBytes)
const sha = async (p) => createHash('sha256').update(await readFile(p)).digest('hex')
const sourceHashBefore = await sha(sourcePath)

// ── 3. Inject adapters ────────────────────────────────────────────────────────────────────────
const dbPath = join(work, 'library.sqlite')

async function bootSdk() {
  const db = new DatabaseSync(dbPath)
  const sql = nodeSqliteDatabase(db)
  await ensureNotesSchema(sql)
  const notes = createSqlNoteRepositories(sql)
  const { library, sessions } = await nodeSqliteLibraryAndSessions(sql)

  const sdk = createBookReaderSdk({
    adapters: {
      storage: { library, sessions, annotations: notes.annotations, bookmarks: notes.bookmarks },
      fileSystem: await nodeFileSystem(join(work, 'sandbox')),
      archive: nodeZipArchive,
      // hash / ids / clock / scheduler omitted on purpose → portable defaults (WebCrypto, setTimeout)
      logger: { debug() {}, info() {}, warn: (m) => console.warn('  [warn]', m), error: (m) => console.error('  [error]', m) },
    },
    options: { autosaveDelayMs: 50 },
  })
  return { sdk, db, sql }
}

let { sdk, db, sql } = await bootSdk()
const errors = []
sdk.events.on('error', (e) => errors.push(e))

// A fake render surface: records what the stores ask the engine to paint.
const painted = new Map()
const surfaceLog = []
sdk.attachSurface({
  paintMarkup: (m) => painted.set(m.id, m.kind),
  unpaintMarkup: (m) => painted.delete(m.id),
  setFocusedMarkup: (id) => surfaceLog.push(`focus:${id}`),
  clearSelection: () => surfaceLog.push('clearSelection'),
  goTo: async (loc) => surfaceLog.push(`goTo:${loc.kind}`),
  flashMarkup: (m) => surfaceLog.push(`flash:${m.id}`),
})

// ── 4. Library: import + duplicate detection + EPUB metadata ─────────────────────────────────
const library = sdk.stores.library
const imported = await library.getState().importFile({ sourceRef: sourcePath })
assert.equal(imported.status, 'imported', JSON.stringify(imported))
const book = imported.book
assert.equal(book.title, "Alice's Adventures in Wonderland")
assert.deepEqual(book.authors, ['Lewis Carroll'])
assert.deepEqual(book.genres, ['Fantasy', 'Classics'])
assert.equal(book.description, '<p>A girl & a rabbit hole.</p>')
assert.equal(book.pageCount, 3)
assert.equal(book.format, 'epub')
assert.ok(book.coverRef?.endsWith('-cover.png'), 'cover extracted from "images/cover%20art.png"')
assert.equal(book.sha256, sourceHashBefore, 'WebCrypto default hash matches node:crypto')
assert.equal((await library.getState().importFile({ sourceRef: sourcePath })).status, 'duplicate')
assert.equal(library.getState().books.length, 1)
console.log(`✔ imported "${book.title}" by ${book.authors.join(', ')} — duplicate re-import detected`)

// ── 5. Open book + annotations (highlight / underline / strikethrough / text note) ───────────
await sdk.openBook(book.id)
const annotations = sdk.stores.annotations
const range = (chapterStep, from, to) => buildCfiRange(`/6/${chapterStep}!/4/2`, `/1:${from}`, `/1:${to}`)

const later = await annotations.getState().create({
  kind: 'highlight',
  location: cfiLocation(range(4, 10, 20)),
  chapterIndex: spineIndexFromCfi(range(4, 10, 20)),
  selectionText: { highlight: 'down the rabbit hole' },
  tags: ['Idea', 'idea', ' '],
})
const earlier = await annotations.getState().create({
  kind: 'underline',
  location: cfiLocation(range(2, 0, 5)),
  chapterIndex: 0,
  colorHex: '#4FC3F7',
  selectionText: { highlight: 'Alice' },
})
assert.ok(later && earlier)
assert.deepEqual(later.tags, ['Idea'], 'tags normalized')
assert.equal(later.colorHex, '#FFEB3B', 'default color')
assert.equal(annotations.getState().lastUsedColorHex, '#4FC3F7')
assert.deepEqual(annotations.getState().items.map((m) => m.id), [earlier.id, later.id], 'document order')
assert.equal(painted.size, 2)

await annotations.getState().update(later.id, { kind: 'strikethrough', note: '  remember this  ' })
assert.equal(painted.get(later.id), 'strikethrough', 'surface repainted with the new kind')
annotations.getState().undo()
assert.equal(annotations.getState().items.find((m) => m.id === later.id).kind, 'highlight')
annotations.getState().redo()
assert.equal(annotations.getState().items.find((m) => m.id === later.id).note, 'remember this')

const note = await annotations.getState().create({
  kind: 'textbox',
  location: cfiLocation(range(6, 1, 2)),
  chapterIndex: 2,
  note: 'A sticky note',
  colorHex: '#000000',
})
assert.equal(annotations.getState().lastUsedColorHex, '#4FC3F7', 'textbox color does not become the default')
await annotations.getState().remove(earlier.id)
annotations.getState().undo() // bring the underline back
await annotations.getState().whenIdle()
assert.equal(annotations.getState().items.length, 3)
assert.equal(await annotations.getState().jumpTo(note.id), true)
assert.deepEqual(surfaceLog.slice(-2), ['goTo:cfi', `flash:${note.id}`])

const found = filterMarkups(annotations.getState().items, { text: 'rabbit', kinds: ['strikethrough'] })
assert.equal(found.length, 1)
console.log(`✔ 3 markups, kind change repainted, undo/redo persisted — citation:\n  ${formatCitation({
  text: found[0].selectionText.highlight, bookTitle: book.title, author: book.authors[0], locationLabel: 'Chapter 2',
}).replace(/\n+/g, ' ')}`)

// ── 6. Bookmarks + guard against cross-group id reuse ─────────────────────────────────────────
const bookmarks = sdk.stores.bookmarks
const here = { location: cfiLocation('epubcfi(/6/4!/4/2/1:0)'), chapterIndex: 1, label: 'Ch. 2' }
assert.equal((await bookmarks.getState().toggleAt(here)).action, 'added')
assert.equal((await bookmarks.getState().toggleAt(here)).action, 'removed')
await bookmarks.getState().add(here)

const conflict = await sql.run(
  `INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES (?, ?, '{"group":"bookmark"}', 'x', 'x')
   ON CONFLICT(id) DO UPDATE SET note_json = excluded.note_json WHERE json_extract(note_json, '$.group') = 'bookmark'`,
  [later.id, book.id],
)
assert.equal(conflict.changes, 0, 'a bookmark write can never overwrite an annotation row')
console.log('✔ bookmark toggle add/remove, cross-group upsert refused')

// ── 7. Session autosave (debounced through the default scheduler) ────────────────────────────
const session = sdk.stores.session
session.getState().updateLocation(cfiLocation('epubcfi(/6/6!/4/2/1:30)'), { percent: 72.5, label: 'Chapter 3' })
session.getState().updatePrefs({ fontSize: 99, fontFamily: 'sans', textAlign: 'nope' })
assert.equal(session.getState().dirty, true)
await new Promise((r) => setTimeout(r, 120))
assert.equal(session.getState().dirty, false, 'autosaved after the quiet period')
assert.deepEqual(session.getState().prefs, { fontSize: 32, fontFamily: 'sans' }, 'prefs sanitized + clamped')
console.log('✔ session autosaved (fontSize clamped to 32, invalid textAlign dropped)')

// ── 8. Persistence round trip through a brand-new SDK instance ───────────────────────────────
await sdk.dispose()
assert.equal(isSdkError(await sdk.openBook(book.id).catch((e) => e)), true, 'disposed instance rejects')
db.close()
;({ sdk, db, sql } = await bootSdk())
await sdk.stores.library.getState().load()
await sdk.openBook(book.id)
const reopened = sdk.stores.annotations.getState().items
assert.deepEqual(
  reopened.map((m) => [m.kind, m.note ?? null, m.tags]),
  [
    ['underline', null, []],
    ['strikethrough', 'remember this', ['Idea']],
    ['textbox', 'A sticky note', []],
  ],
)
assert.equal(sdk.stores.bookmarks.getState().items.length, 1)
assert.equal(sdk.stores.session.getState().percent, 72.5)
assert.equal(sdk.stores.session.getState().location.cfi, 'epubcfi(/6/6!/4/2/1:30)')

const [row] = await sql.all(`SELECT note_json FROM notes WHERE id = ?`, [later.id])
const noteJson = JSON.parse(row.note_json)
assert.equal(noteJson.group, 'annotation')
assert.equal(noteJson.type, 'strikethrough')
assert.equal(noteJson.locatorExtended.locator.kind, 'cfi')
assert.equal(typeof noteJson.locatorExtended.locator.chapterIndex, 'number')
console.log('✔ fresh SDK instance reloaded markups, bookmark and session from SQLite (desktop note_json format)')

// ── 9. Invariants ─────────────────────────────────────────────────────────────────────────────
assert.equal(await sha(sourcePath), sourceHashBefore, 'original file never mutated')
assert.deepEqual(errors, [], 'no error events')
await sdk.dispose()
db.close()
await rm(work, { recursive: true, force: true })
console.log('✔ source file untouched, no error events — all checks passed')

/**
 * The data contract between Desktop and Mobile (spec 008, US4, FR-019 / FR-021): one runner, the same versioned
 * fixtures, any store that implements the SDK ports. Desktop runs it against `SqliteOverlayStore` /
 * `SqliteLibraryStore` on the migrated schema (`spike:contract:fixtures`), Mobile against its own stores on
 * `node:sqlite` (`web/tests/contract-conformance.test.ts`).
 *
 * The host gives the stores plus raw row access, because the contract is what lands in the columns, not only what
 * the store hands back. The SDK classes are injected so this file has only type imports (Desktop's spike runs it
 * against the built bundle, Mobile against the source).
 */
import type {
  Book,
  BookProps,
  LibraryStore,
  Location,
  OverlayStore,
  ReadingSessionState,
  ReadingSessionStateProps,
  SaveBookmarkInput,
  SaveHighlightInput,
} from '../../src/index.js'

export interface NoteRowRaw {
  id: string
  book_id: string
  note_json: string
  created_at: string
  updated_at: string
}

export interface ContractHost {
  overlay: OverlayStore
  library?: LibraryStore
  /** A minimal `books` row of this format, made however the host likes; returns its id. */
  addBook(format: string): Promise<string>
  noteRow(id: string): Promise<NoteRowRaw | undefined>
  insertNoteRow(row: NoteRowRaw): Promise<void>
  /** Every column of one `books` row, as stored. */
  bookRow(id: string): Promise<Record<string, unknown> | undefined>
  countNotes(bookId: string): Promise<number>
}

export interface ContractSdk {
  Location: { parse(raw: string): Location }
  ReadingSessionState: new (props: ReadingSessionStateProps) => ReadingSessionState
  Book: new (props: BookProps) => Book
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export interface HighlightFixture {
  contractVersion: 1
  kind: string
  bookFormat: string
  save: Omit<SaveHighlightInput, 'bookId' | 'id'>
  expect: { noteJson: Json; record: Json }
}
export interface BookmarkFixture {
  contractVersion: 1
  kind: string
  bookFormat: string
  bookmark: Omit<SaveBookmarkInput, 'bookId' | 'id'>
  expect: { noteJson: Json; record: Json }
}
export interface SessionFixture {
  contractVersion: 1
  kind: string
  bookFormat: string
  session: Omit<ReadingSessionStateProps, 'bookId' | 'lastReadLocation'> & { lastReadLocation: string }
  expect: { readingStateJson: Json }
}
export interface BookFixture {
  contractVersion: 1
  kind: string
  book: Omit<BookProps, 'id'>
  expect: { row: Json; book: Json }
}
export type ContractFixture = HighlightFixture | BookmarkFixture | SessionFixture | BookFixture

export interface ContractResult {
  name: string
  ok: boolean
  detail?: string
}

const TIMESTAMP = '<timestamp>'
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

/** Sorted keys, `undefined` dropped: two values are the same contract value iff their canonical strings are equal. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = sortKeys(v)
    }
    return out
  }
  return value
}

/** `created` / `modified` stamps become the placeholder (they must still be ISO timestamps). */
function maskStamps(value: unknown, keys: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => maskStamps(v, keys))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = keys.includes(k) && typeof v === 'string' && ISO.test(v) ? TIMESTAMP : maskStamps(v, keys)
    return out
  }
  return value
}

/** First path where two values differ, for a readable failure. */
export function firstDifference(actual: unknown, expected: unknown, path = '$'): string | undefined {
  if (canonical(actual) === canonical(expected)) return undefined
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object' && !Array.isArray(actual) === !Array.isArray(expected)) {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
    for (const k of [...keys].sort()) {
      const d = firstDifference((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${path}.${k}`)
      if (d) return d
    }
  }
  return `${path}: got ${canonical(actual)}, expected ${canonical(expected)}`
}

const withId = (value: unknown, id: string): unknown => JSON.parse(JSON.stringify(value).replaceAll('<id>', id))
const isHighlight = (f: ContractFixture): f is HighlightFixture => 'save' in f
const isBookmark = (f: ContractFixture): f is BookmarkFixture => 'bookmark' in f
const isSession = (f: ContractFixture): f is SessionFixture => 'session' in f
const isBook = (f: ContractFixture): f is BookFixture => 'book' in f

/** A record without the fields every row has (ids, stamps) and without `undefined` members. */
function recordBody(record: object): unknown {
  const { id: _id, bookId: _bookId, createdAt: _c, updatedAt: _u, ...rest } = record as Record<string, unknown>
  return rest
}

export async function runOverlayContract(host: ContractHost, sdk: ContractSdk, fixtures: readonly ContractFixture[]): Promise<ContractResult[]> {
  const results: ContractResult[] = []
  const check = async (name: string, fn: () => Promise<string | undefined | void>) => {
    try {
      const detail = await fn()
      results.push(detail ? { name, ok: false, detail } : { name, ok: true })
    } catch (error) {
      results.push({ name, ok: false, detail: `threw: ${error instanceof Error ? error.message : String(error)}` })
    }
  }
  const books = new Map<string, string>()
  const bookFor = async (format: string) => {
    if (!books.has(format)) books.set(format, await host.addBook(format))
    return books.get(format)!
  }

  // Rows of kinds this store does not write must survive everything below untouched (forward compatibility).
  const foreignBook = await bookFor('pdf')
  const foreignRows: NoteRowRaw[] = [
    {
      id: 'contract-foreign-ink',
      book_id: foreignBook,
      note_json: JSON.stringify({ schemaVersion: 1, type: 'ink', group: 'annotation', locatorExtended: { locator: { kind: 'page-rect', page: 1, chapterIndex: 0 } }, pdfInk: { pageIndex: 0, points: [[0.1, 0.1], [0.2, 0.2]], width: 0.002 }, style: { colorHex: '#1E88E5', opacity: 1 } }),
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'contract-foreign-future',
      book_id: foreignBook,
      note_json: JSON.stringify({ schemaVersion: 2, type: 'future-kind', group: 'future-group', locatorExtended: { locator: { kind: 'page-rect', page: 2, chapterIndex: 1 } }, extra: { keep: [1, 'two', null] } }),
      created_at: '2026-01-02T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    },
  ]
  for (const row of foreignRows) await host.insertNoteRow(row)

  for (const fixture of fixtures) {
    if (fixture.contractVersion !== 1) {
      results.push({ name: `${fixture.kind}: contract version`, ok: false, detail: `unknown contractVersion ${String(fixture.contractVersion)}` })
      continue
    }

    if (isHighlight(fixture)) {
      const bookId = await bookFor(fixture.bookFormat)
      let id = ''
      let createdAt = ''
      await check(`${fixture.kind}: stored note_json`, async () => {
        const saved = await host.overlay.saveHighlight({ ...fixture.save, bookId })
        id = saved.id
        createdAt = saved.createdAt
        const row = await host.noteRow(id)
        if (!row) return 'no row written'
        if (row.book_id !== bookId) return `book_id ${row.book_id}`
        const stored = JSON.parse(row.note_json) as Record<string, unknown>
        const shape = firstDifference(maskStamps(stored, ['created', 'modified']), fixture.expect.noteJson)
        if (shape) return shape
        return stored.created === row.created_at ? undefined : `note_json.created ${String(stored.created)} ≠ created_at ${row.created_at}`
      })
      await check(`${fixture.kind}: listed record`, async () => {
        const listed = (await host.overlay.listHighlights(bookId)).find((h) => h.id === id)
        if (!listed) return 'not listed'
        if (listed.createdAt !== createdAt) return 'createdAt changed'
        return firstDifference(recordBody(listed), fixture.expect.record)
      })
      await check(`${fixture.kind}: update keeps the row, its creation time and every other field`, async () => {
        const updated = await host.overlay.saveHighlight({ ...fixture.save, id, bookId, note: 'Changed', colorHex: '#EF9A9A', createdAt: undefined })
        if (updated.id !== id) return 'a new id was assigned'
        if (updated.createdAt !== createdAt) return `createdAt ${updated.createdAt} ≠ ${createdAt}`
        const stored = JSON.parse((await host.noteRow(id))!.note_json) as Record<string, unknown>
        const expected = { ...(fixture.expect.noteJson as Record<string, Json>), note: 'Changed', style: { colorHex: '#EF9A9A' } }
        return firstDifference(maskStamps(stored, ['created', 'modified']), expected)
      })
      await check(`${fixture.kind}: a bookmark write never converts it`, async () => {
        try {
          await host.overlay.saveBookmark({ id, bookId, locator: fixture.save.locator, label: 'x' })
        } catch {
          return (await host.noteRow(id)) ? undefined : 'row lost'
        }
        return 'saveBookmark over a highlight id did not fail'
      })
      await check(`${fixture.kind}: delete`, async () => {
        if (!(await host.overlay.deleteHighlight(bookId, id))) return 'first delete returned false'
        if (await host.noteRow(id)) return 'row still there'
        if (await host.overlay.deleteHighlight(bookId, id)) return 'second delete returned true'
        return undefined
      })
    } else if (isBookmark(fixture)) {
      const bookId = await bookFor(fixture.bookFormat)
      let id = ''
      await check(`${fixture.kind}: stored note_json`, async () => {
        const saved = await host.overlay.saveBookmark({ ...fixture.bookmark, bookId })
        id = saved.id
        const row = await host.noteRow(id)
        if (!row) return 'no row written'
        return firstDifference(maskStamps(JSON.parse(row.note_json), ['created', 'modified']), fixture.expect.noteJson)
      })
      await check(`${fixture.kind}: listed record`, async () => {
        const listed = (await host.overlay.listBookmarks(bookId)).find((b) => b.id === id)
        if (!listed) return 'not listed'
        return firstDifference(recordBody(listed), fixture.expect.record)
      })
      await check(`${fixture.kind}: not listed as a highlight; a highlight write never converts it`, async () => {
        if ((await host.overlay.listHighlights(bookId)).some((h) => h.id === id)) return 'listed as a highlight'
        try {
          await host.overlay.saveHighlight({ id, bookId, locator: fixture.bookmark.locator, styleKind: 'highlight', colorHex: '#FFEB3B' })
        } catch {
          return undefined
        }
        return 'saveHighlight over a bookmark id did not fail'
      })
      await check(`${fixture.kind}: delete`, async () => {
        if (!(await host.overlay.deleteBookmark(bookId, id))) return 'delete returned false'
        return (await host.noteRow(id)) ? 'row still there' : undefined
      })
    } else if (isSession(fixture)) {
      const bookId = await bookFor(fixture.bookFormat)
      const { lastReadLocation, ...rest } = fixture.session
      const state = () => new sdk.ReadingSessionState({ ...rest, bookId, lastReadLocation: sdk.Location.parse(lastReadLocation) })
      await check(`${fixture.kind}: stored reading_state_json`, async () => {
        await host.overlay.saveSessionState(state())
        const row = await host.bookRow(bookId)
        const stored = JSON.parse(String(row?.reading_state_json ?? '{}')) as Record<string, unknown>
        const unpacked = { ...stored, lastReadLocation: typeof stored.lastReadLocation === 'string' ? JSON.parse(stored.lastReadLocation) : stored.lastReadLocation }
        return firstDifference(unpacked, fixture.expect.readingStateJson)
      })
      await check(`${fixture.kind}: read back`, async () => {
        const got = await host.overlay.getSessionState(bookId)
        if (!got) return 'no session'
        const expected = state()
        const pick = (s: ReadingSessionState) => ({ ...s, lastReadLocation: JSON.parse(s.lastReadLocation.toString()) as unknown })
        return firstDifference(pick(got), pick(expected))
      })
      await check(`${fixture.kind}: an older write is dropped`, async () => {
        const older = state()
        older.updatedAt = '2000-01-01T00:00:00.000Z'
        older.percent = 1
        await host.overlay.saveSessionState(older)
        const stored = JSON.parse(String((await host.bookRow(bookId))?.reading_state_json)) as { percent?: number }
        return stored.percent === fixture.session.percent ? undefined : `percent became ${String(stored.percent)}`
      })
    } else if (isBook(fixture)) {
      const library = host.library
      if (!library) continue
      const id = '5b0f2c1e-8d4a-4c3e-9f6b-2a7d1e0c9b84'
      await check(`${fixture.kind}: stored row`, async () => {
        await library.save(new sdk.Book({ ...(withId(fixture.book, id) as Omit<BookProps, 'id'>), id }))
        const row = await host.bookRow(id)
        if (!row) return 'no row'
        const { id: _id, ...columns } = row
        const parsed = { ...columns, metadata_json: JSON.parse(String(columns.metadata_json)), genres_json: JSON.parse(String(columns.genres_json)), reading_state_json: JSON.parse(String(columns.reading_state_json)) }
        return firstDifference(parsed, withId(fixture.expect.row, id))
      })
      await check(`${fixture.kind}: findById and findBySha256`, async () => {
        const found = await library.findById(id)
        if (!found) return 'not found by id'
        const bySha = await library.findBySha256(fixture.book.sha256)
        if (bySha?.id !== id) return 'not found by sha256'
        const { id: _id, authors: _a, ...props } = { ...found } as Record<string, unknown>
        return firstDifference(props, withId(fixture.expect.book, id))
      })
      await check(`${fixture.kind}: a second book with the same sha256 is refused`, async () => {
        // A valid second book in every respect but its sha256, so only the uniqueness rule can refuse it.
        const otherId = 'c3a1b2d4-0000-4000-8000-000000000001'
        try {
          await library.save(new sdk.Book({ ...(withId(fixture.book, otherId) as Omit<BookProps, 'id'>), id: otherId }))
        } catch {
          return (await host.bookRow(otherId)) ? 'refused, but a row was written' : undefined
        }
        return 'duplicate sha256 was stored'
      })
      await check(`${fixture.kind}: deleteCascade removes the book and its notes`, async () => {
        await host.overlay.saveBookmark({ bookId: id, locator: { kind: 'cfi', cfi: 'epubcfi(/6/2!/4/2/1:0)', chapterIndex: 0 } })
        await library.deleteCascade(id)
        if (await host.bookRow(id)) return 'book row still there'
        const left = await host.countNotes(id)
        return left === 0 ? undefined : `${left} notes left`
      })
    }
  }

  await check('rows of other kinds are untouched and never listed', async () => {
    for (const row of foreignRows) {
      const now = await host.noteRow(row.id)
      if (!now) return `${row.id} was deleted`
      if (canonical(now) !== canonical(row)) return `${row.id} changed: ${firstDifference(now, row) ?? ''}`
    }
    const listed = [...(await host.overlay.listHighlights(foreignBook)), ...(await host.overlay.listBookmarks(foreignBook))].map((r) => r.id)
    return foreignRows.some((r) => listed.includes(r.id)) ? `listed: ${listed.join(', ')}` : undefined
  })

  return results
}

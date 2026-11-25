/**
 * `txt.commit` on the phone bridge (spec 019 FR-015a; `specs/019-mobile-reader-redesign/contracts/mobile-txt-commit.md`):
 * marks only, all or nothing, checked against the book's decoded text with the same core checks as Desktop's Main.
 * Runs the real bridge against the real host services (`fake-host.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { packTxtAnnotationRef } from '@core'
import fixture from '../../../../core/tests/contracts/fixtures/v1/txt-underline.json'
import { createFakeHost, type FakeHost } from './fake-host'

let host: FakeHost
afterEach(() => {
  host?.sql.db.close()
  host = undefined as unknown as FakeHost
})

const save = fixture.save
const { before, highlight, after } = save.selectionText
// The fixture's offsets (120–140) land on its quote in this text.
const TEXT = `${'x'.repeat(save.txtAnnotation.startOffset - before.length)}${before}${highlight}${after}`

async function importText(name: string, body: string) {
  host.fs.queuePick(name, body)
  const result = await host.api.import.fromFile()
  expect(result).toMatchObject({ ok: true })
  return result.bookId!
}

function upsert(bookId: string, patch: Record<string, unknown> = {}) {
  return {
    id: 'mark-1',
    bookId,
    locatorRef: JSON.stringify(save.locator),
    styleKind: save.styleKind,
    colorHex: save.colorHex,
    selectionTextRef: JSON.stringify(save.selectionText),
    txtAnnotationRef: packTxtAnnotationRef(save.txtAnnotation),
    ...patch,
  } as never
}

describe('txt.commit on the phone (marks only)', () => {
  it('round trip of the contract row: commit, then txt.open returns it', async () => {
    host = await createFakeHost()
    const bookId = await importText('Story.txt', TEXT)
    expect(await host.api.txt.commit({ bookId, baseRevision: 0, upserts: [upsert(bookId)], deletedIds: [] })).toEqual({ ok: true, revision: 0 })
    const opened = await host.api.txt.open(bookId)
    expect(opened).toMatchObject({ ok: true, revision: 0, editable: false })
    expect(opened.highlights).toHaveLength(1)
    expect(opened.highlights![0]).toMatchObject({
      id: 'mark-1',
      styleKind: save.styleKind,
      colorHex: save.colorHex,
      txtAnnotationRef: packTxtAnnotationRef(save.txtAnnotation),
    })

    // Change the colour, then delete: both through commit.
    expect(await host.api.txt.commit({ bookId, baseRevision: 0, upserts: [upsert(bookId, { colorHex: '#FFEB3B' })], deletedIds: [] })).toMatchObject({ ok: true })
    expect((await host.api.txt.open(bookId)).highlights![0]).toMatchObject({ colorHex: '#FFEB3B' })
    expect(await host.api.txt.commit({ bookId, baseRevision: 0, upserts: [], deletedIds: ['mark-1'] })).toMatchObject({ ok: true })
    expect((await host.api.txt.open(bookId)).highlights).toEqual([])
  })

  it('refuses a bad shape, a text, another revision and a missing / non-TXT book', async () => {
    host = await createFakeHost()
    const bookId = await importText('Story.txt', TEXT)
    expect(await host.api.txt.commit(null as never)).toMatchObject({ ok: false, errorCode: 'invalid' })
    expect(await host.api.txt.commit({ bookId, baseRevision: 0, upserts: 'x' as never, deletedIds: [] })).toMatchObject({ errorCode: 'invalid' })
    expect(await host.api.txt.commit({ bookId, baseRevision: 0, text: 'new text', upserts: [], deletedIds: [] })).toMatchObject({ errorCode: 'invalid' })
    expect(await host.api.txt.commit({ bookId, baseRevision: 1, upserts: [], deletedIds: [] })).toMatchObject({ errorCode: 'conflict' })
    expect(await host.api.txt.commit({ bookId: 'nope', baseRevision: 0, upserts: [], deletedIds: [] })).toMatchObject({ errorCode: 'not_found' })
  })

  it('refuses a mark outside the text, with the wrong quote or without its range — nothing written', async () => {
    host = await createFakeHost()
    const bookId = await importText('Story.txt', TEXT)
    const good = upsert(bookId, { id: 'good' })
    const cases = [
      upsert(bookId, { txtAnnotationRef: packTxtAnnotationRef({ startOffset: 0, endOffset: TEXT.length + 5 }) }),
      upsert(bookId, { selectionTextRef: JSON.stringify({ highlight: 'something else' }) }),
      upsert(bookId, { txtAnnotationRef: undefined }),
    ]
    for (const bad of cases) {
      expect(await host.api.txt.commit({ bookId, baseRevision: 0, upserts: [good, bad], deletedIds: [] })).toMatchObject({ ok: false, errorCode: 'invalid' })
    }
    expect((await host.api.txt.open(bookId)).highlights).toEqual([])
  })

  it('refuses ids of another book or of a non-TXT row', async () => {
    host = await createFakeHost()
    const bookA = await importText('A.txt', TEXT)
    // Same quote at the same place, different bytes (an identical file is a duplicate import).
    const bookB = await importText('B.txt', `${TEXT} The end.`)
    expect(await host.api.txt.commit({ bookId: bookA, baseRevision: 0, upserts: [upsert(bookA, { id: 'shared' })], deletedIds: [] })).toMatchObject({ ok: true })
    expect(await host.api.txt.commit({ bookId: bookB, baseRevision: 0, upserts: [upsert(bookB, { id: 'shared' })], deletedIds: [] })).toMatchObject({ errorCode: 'invalid' })
    expect(await host.api.txt.commit({ bookId: bookB, baseRevision: 0, upserts: [], deletedIds: ['shared'] })).toMatchObject({ errorCode: 'invalid' })
    // A bookmark is not a TXT mark.
    const bookmark = await host.api.overlay.saveBookmark({ bookId: bookB, locatorRef: JSON.stringify(save.locator), label: 'Here' } as never)
    expect(bookmark).toBeTruthy()
    const bookmarkId = (bookmark as { id: string }).id
    expect(await host.api.txt.commit({ bookId: bookB, baseRevision: 0, upserts: [], deletedIds: [bookmarkId] })).toMatchObject({ errorCode: 'invalid' })
    expect((await host.api.txt.open(bookA)).highlights).toHaveLength(1)
  })

  it('a SQL failure writes nothing (one host transaction)', async () => {
    host = await createFakeHost()
    const bookId = await importText('Story.txt', TEXT)
    host.sql.failNextTransactionMatching(/DELETE FROM notes/)
    const result = await host.api.txt.commit({
      bookId,
      baseRevision: 0,
      upserts: [upsert(bookId, { id: 'one' })],
      deletedIds: ['two'],
    })
    expect(result).toMatchObject({ ok: false, errorCode: 'db_failed' })
    expect((await host.api.txt.open(bookId)).highlights).toEqual([])
  })
})

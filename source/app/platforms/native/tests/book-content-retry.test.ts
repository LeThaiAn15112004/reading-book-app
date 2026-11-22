/**
 * Spec 017 (US1, T012, R3 / FR-004 / FR-007): the phone's `openBookContent` says which failures may pass — the Reader
 * retries those once — and answers a missing / too-large book at once, never as retryable.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { DEV_BOOK_MAX_BYTES } from '../host/protocol'
import { HostCallError } from '../bridge/host-client'
import { bookFilePath } from '../stores/library-store'
import { createFakeHost, type FakeHost } from './fake-host'

let host: FakeHost
afterEach(() => {
  host?.sql.db.close()
  host = undefined as unknown as FakeHost
})

async function importPdf(name: string) {
  host.fs.queuePick(name, '%PDF-1.4 body')
  const result = await host.api.import.fromFile()
  expect(result).toMatchObject({ ok: true })
  return result.bookId!
}

describe('openBookContent failures (spec 017)', () => {
  it('a thrown fetch / 5xx / interrupted read is retryable', async () => {
    host = await createFakeHost()
    const bookId = await importPdf('Busy.pdf')
    const original = host.ctx.content.read
    host.ctx.content.read = async () => {
      throw new HostCallError('READ_FAILED', 'The book could not be read (HTTP 503)', 'server', 'books')
    }
    expect(await host.api.library.openBookContent(bookId)).toMatchObject({ ok: false, errorCode: 'read_failed', retryable: true })
    host.ctx.content.read = original
    expect(await host.api.library.openBookContent(bookId)).toMatchObject({ ok: true, format: 'pdf' })
  })

  it('an unexpected failure is not retryable', async () => {
    host = await createFakeHost()
    const bookId = await importPdf('Odd.pdf')
    host.ctx.content.read = async () => {
      throw new Error('boom')
    }
    const result = await host.api.library.openBookContent(bookId)
    expect(result).toMatchObject({ ok: false, errorCode: 'read_failed' })
    expect(result.retryable).toBe(false)
  })

  it('a missing book answers missing_file at once, not retryable (FR-007 / SC-004)', async () => {
    host = await createFakeHost()
    const bookId = await importPdf('Gone.pdf')
    host.fs.remove(`books/${bookId}`)
    const started = Date.now()
    const result = await host.api.library.openBookContent(bookId)
    expect(result).toMatchObject({ ok: false, errorCode: 'missing_file' })
    expect(result.retryable).toBeFalsy()
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('a book above 20 MB in Expo Go is too_large, not retryable', async () => {
    host = await createFakeHost()
    const bookId = await importPdf('Huge.pdf')
    host.fs.files.set(bookFilePath(bookId), new Uint8Array(DEV_BOOK_MAX_BYTES + 1))
    const result = await host.api.library.openBookContent(bookId)
    expect(result).toMatchObject({ ok: false, errorCode: 'too_large' })
    expect(result.retryable).toBeFalsy()
  })
})

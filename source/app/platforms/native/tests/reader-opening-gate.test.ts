/**
 * Spec 017 (US3, T037 / T043, FR-018): while a book opens in the WebView, the host's import chunk loops (copy / hash
 * fallbacks) wait between chunks — each wait at most 10 s — and the bridge tells the host through
 * `app.setReaderOpening { opening }`.
 */
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileService } from '../host/file-service'
import { createReaderOpeningGate } from '../host/reader-opening-gate'
import { createFakeHost, MemoryFs, testUuid, type FakeHost } from './fake-host'

let host: FakeHost | undefined
afterEach(() => {
  host?.sql.db.close()
  host = undefined
})

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

async function stagingJob(gate: ReturnType<typeof createReaderOpeningGate>) {
  const fs = new MemoryFs()
  const files = createFileService({
    fs,
    devChunks: false,
    yieldToEvents: () => new Promise((resolve) => setTimeout(resolve, 0)),
    whenNotOpening: () => gate.whenNotOpening(),
  })
  fs.queuePick('Book.pdf', randomBytes(3 * 1024 * 1024 + 5))
  const picked = (await files.pick!({ extensions: ['pdf'] })) as { pickId: string }
  return { files, picked, stagingId: testUuid() }
}

describe('host reader-opening gate', () => {
  it('the bridge sends app.setReaderOpening { opening } and the host gate follows it', async () => {
    host = await createFakeHost()
    await host.api.setReaderOpening({ bookId: 'b1' })
    expect(host.requests).toContain('app.setReaderOpening')
    expect(host.gate.isOpening()).toBe(true)
    await host.api.setReaderOpening({ bookId: null })
    expect(host.gate.isOpening()).toBe(false)
  })

  it('the chunked copy waits while a book is opening and goes on once its first page is drawn', async () => {
    const gate = createReaderOpeningGate()
    const { files, picked, stagingId } = await stagingJob(gate)
    gate.set(true)
    let finished = false
    const pending = (files.stage!({ pickId: picked.pickId, stagingId }) as Promise<unknown>).then((r) => {
      finished = true
      return r
    })
    await tick(60)
    expect(finished).toBe(false)
    gate.set(false)
    await expect(pending).resolves.toMatchObject({ size: 3 * 1024 * 1024 + 5 })
  })

  it('each wait is bounded: a gate never cleared does not block the import', async () => {
    const gate = createReaderOpeningGate({ maxMs: 15 })
    const { files, picked, stagingId } = await stagingJob(gate)
    gate.set(true)
    await expect(files.stage!({ pickId: picked.pickId, stagingId }) as Promise<unknown>).resolves.toMatchObject({
      size: 3 * 1024 * 1024 + 5,
    })
  })

  it('refuses a non-boolean opening', async () => {
    host = await createFakeHost()
    const result = await host.ctx.client.call('app', 'setReaderOpening', { opening: 'yes' }).catch((e: { code?: string }) => e.code)
    expect(result).toBe('INVALID_ARGUMENT')
  })
})

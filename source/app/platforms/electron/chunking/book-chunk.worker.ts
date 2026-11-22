/**
 * Worker-thread entry: extract → chunk → batch-insert one book. Built as its own bundle entry
 * (see vite.config.ts) and started by book-chunk-service.ts. Must not import `electron`.
 *
 * Text extraction and chunking run entirely off the Main thread with NO database lock held; the
 * worker only touches SQLite (its own connection) for one short transaction at the very end.
 */
import Database from 'better-sqlite3'
import { parentPort, workerData } from 'node:worker_threads'
import { insertBookChunks } from './book-chunk-writer'
import type { BookChunkControlMessage, BookChunkJob, BookChunkWorkerMessage } from './book-chunk-job'
import { chunkParagraphs, type TextParagraph } from '@core'
import { extractBookParagraphs } from './extract-book-text'

// Spec 017 (US3, FR-018): while a book is opening (told by Main) extraction pauses between paragraphs — each pause at
// most 10 s, like Main's own gate, so a lost "drawn" never blocks the index.
const OPENING_MAX_MS = 10_000
const PARAGRAPHS_PER_CHECK = 64
let opening = false
let resumeWaiters: (() => void)[] = []

parentPort?.on('message', (message: BookChunkControlMessage) => {
  if (message?.type !== 'opening') return
  opening = message.opening
  if (!opening) {
    for (const resolve of resumeWaiters) resolve()
    resumeWaiters = []
  }
})

function whenNotOpening(): Promise<void> | undefined {
  if (!opening) return undefined
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t)
      resolve()
    }
    const t = setTimeout(done, OPENING_MAX_MS)
    resumeWaiters.push(done)
  })
}

async function run(job: BookChunkJob): Promise<number> {
  const paragraphs: TextParagraph[] = []
  for await (const paragraph of extractBookParagraphs(job.filePath, job.format)) {
    paragraphs.push(paragraph)
    if (paragraphs.length % PARAGRAPHS_PER_CHECK === 0) await whenNotOpening()
  }
  await whenNotOpening()

  const chunks = [...chunkParagraphs(paragraphs)]
  if (chunks.length === 0) return 0

  const db = new Database(job.dbPath, { timeout: 10_000 })
  try {
    db.pragma('foreign_keys = ON')
    return insertBookChunks(db, job.bookId, chunks)
  } finally {
    db.close()
  }
}

function post(message: BookChunkWorkerMessage): void {
  parentPort?.postMessage(message)
}

run(workerData as BookChunkJob).then(
  (chunkCount) => post({ type: 'done', chunkCount }),
  (err: unknown) =>
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
).finally(() => parentPort?.removeAllListeners('message'))

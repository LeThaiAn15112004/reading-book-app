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
import type { BookChunkJob, BookChunkWorkerMessage } from './book-chunk-job'
import { chunkParagraphs, type TextParagraph } from '@reading-book/book-reader-sdk'
import { extractBookParagraphs } from './extract-book-text'

async function run(job: BookChunkJob): Promise<number> {
  const paragraphs: TextParagraph[] = []
  for await (const paragraph of extractBookParagraphs(job.filePath, job.format)) {
    paragraphs.push(paragraph)
  }

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
)

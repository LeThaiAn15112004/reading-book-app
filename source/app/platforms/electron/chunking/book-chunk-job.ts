import type { DocumentFormatDto } from '../ipc/api-types'

/** `workerData` for book-chunk.worker.ts. */
export interface BookChunkJob {
  bookId: string
  /** Already sandbox-checked absolute path (never leaves Main / the worker). */
  filePath: string
  format: DocumentFormatDto
  /** Path of the SQLite file; the worker opens its own connection. */
  dbPath: string
}

export type BookChunkWorkerMessage =
  | { type: 'done'; chunkCount: number }
  | { type: 'error'; message: string }

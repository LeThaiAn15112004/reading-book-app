import { BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { resolveBookFile } from '../files/sandbox'
import { BookIndexChannels } from '../ipc/channels'
import type { BookIndexStatusDto, EnsureBookIndexResult } from '../ipc/api-types'
import { getDatabase } from '../persistence/db'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { hasBookChunks } from './book-chunk-writer'
import type { BookChunkJob, BookChunkWorkerMessage } from './book-chunk-job'
import { isChunkableFormat } from './extract-book-text'

/** Emitted next to main.js by the extra bundle entry in vite.config.ts. */
const WORKER_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'book-chunk.worker.js',
)

/** Chunking a huge book must not be able to starve the app of memory. */
const WORKER_HEAP_LIMIT_MB = 768

const running = new Map<string, Worker>()
/** Books whose slot is claimed but whose worker isn't started yet (async lookup window). */
const pending = new Set<string>()
/** Books that yielded no text this session (image-only EPUB…) — don't respawn on every open. */
const yieldedNoText = new Set<string>()

function broadcast(status: BookIndexStatusDto): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(BookIndexChannels.status, status)
    }
  }
}

/** Returns false when the worker could not even be created (status `error` already sent). */
function spawnWorker(job: BookChunkJob): boolean {
  const { bookId } = job
  let worker: Worker
  try {
    worker = new Worker(WORKER_PATH, {
      workerData: job,
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_LIMIT_MB },
    })
  } catch (err) {
    broadcast({
      bookId,
      state: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return false
  }

  running.set(bookId, worker)
  let settled = false
  const settle = (status: BookIndexStatusDto): void => {
    if (settled) return
    settled = true
    running.delete(bookId)
    broadcast(status)
  }

  worker.on('message', (message: BookChunkWorkerMessage) => {
    if (message.type === 'done') {
      if (message.chunkCount === 0) yieldedNoText.add(bookId)
      settle({ bookId, state: 'done', chunkCount: message.chunkCount })
    } else {
      settle({ bookId, state: 'error', errorMessage: message.message })
    }
  })
  worker.on('error', (err) => {
    settle({ bookId, state: 'error', errorMessage: err.message })
  })
  worker.on('exit', (code) => {
    // A clean run already settled via 'message'; this covers crashes / OOM / terminate().
    settle({ bookId, state: 'error', errorMessage: `Chunk worker exited with code ${code}` })
  })

  broadcast({ bookId, state: 'indexing' })
  return true
}

/**
 * Make sure a book has rows in `book_chunks`, without ever blocking the caller on the work.
 *
 * - Already chunked -> `ready` (one indexed `SELECT 1`, no CPU spent).
 * - Not yet chunked -> a worker thread is started and `indexing` is returned immediately; the
 *   outcome arrives later as a `bookIndex:status` broadcast (`done` / `error`).
 *
 * Safe to call repeatedly / concurrently (e.g. React StrictMode double effects): the slot is
 * claimed synchronously, before the first `await`.
 */
export async function ensureBookChunks(bookId: string): Promise<EnsureBookIndexResult> {
  const id = bookId.trim()
  if (!id) return { state: 'error' }
  if (pending.has(id) || running.has(id)) return { state: 'indexing' }
  if (yieldedNoText.has(id)) return { state: 'ready' }
  if (hasBookChunks(getDatabase(), id)) return { state: 'ready' }

  pending.add(id)
  try {
    const book = await getLibraryStore().findById(id)
    if (!book) return { state: 'error' }
    if (!isChunkableFormat(book.format)) return { state: 'unsupported' }

    // Existing chunks keep serving search / word count when the file is gone (checked above), so
    // a missing or moved book file only blocks *creating* chunks.
    const file = await resolveBookFile(book)
    if (!file.ok) return { state: 'error' }

    const started = spawnWorker({
      bookId: id,
      filePath: file.path,
      format: book.format,
      dbPath: getDatabase().name,
    })
    return { state: started ? 'indexing' : 'error' }
  } finally {
    // `running` (set synchronously inside spawnWorker) takes over the claim.
    pending.delete(id)
  }
}

/** Stop in-flight workers on app quit so they can't outlive the DB / process. */
export function disposeBookChunkWorkers(): void {
  for (const worker of running.values()) {
    void worker.terminate()
  }
  running.clear()
}

import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import { createReadStream } from 'node:fs'

export interface FileHashResult {
  sha256: string
  fileSizeBytes: number
}

export interface HashFileOptions {
  /** Spec 016: aborting stops the read; the promise rejects with a `CANCELLED` error. */
  signal?: AbortSignal
  /** Spec 016: bytes read so far (for the progress percentage), at most every chunk. */
  onProgress?: (doneBytes: number, totalBytes: number) => void
  /** Spec 016 (FR-015): awaited between chunks — lets a background import yield while a book is opening. */
  pause?: () => Promise<void> | void
}

export class HashCancelledError extends Error {
  readonly code = 'CANCELLED'
  constructor() {
    super('Hashing cancelled')
  }
}

/** Read chunk size: 1 MiB (research R9). */
const CHUNK_BYTES = 1024 * 1024

/** SHA-256 hex digest + byte size for a local file (T2.6 / feeds T2.7). */
export async function hashFile(filePath: string, options: HashFileOptions = {}): Promise<FileHashResult> {
  const { signal, onProgress, pause } = options
  if (signal?.aborted) throw new HashCancelledError()
  const stat = await fsp.stat(filePath)
  const hash = createHash('sha256')

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { highWaterMark: CHUNK_BYTES })
    let done = 0
    const onAbort = () => {
      stream.destroy()
      reject(new HashCancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const finish = (err?: unknown) => {
      signal?.removeEventListener('abort', onAbort)
      if (err) reject(err)
      else resolve()
    }
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk)
      done += chunk.length
      onProgress?.(done, stat.size)
      if (pause) {
        const waiting = pause()
        if (waiting) {
          stream.pause()
          void Promise.resolve(waiting).then(() => {
            if (!stream.destroyed) stream.resume()
          })
        }
      }
    })
    stream.on('error', (err) => finish(err))
    stream.on('end', () => finish())
  })

  return {
    sha256: hash.digest('hex'),
    fileSizeBytes: stat.size,
  }
}

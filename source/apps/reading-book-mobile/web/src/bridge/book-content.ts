/**
 * Where book bytes and covers come from (spec 008, T058, R14): the local server in the real app (`GET
 * /books/{id}?t=…`, never over `postMessage`), and in Expo Go, which has no server, the development-only
 * `files.readChunk` in 1 MiB base64 chunks up to 20 MB per book. Covers are server URLs built per launch, or
 * `data:` URLs in Expo Go. Nothing here ever sees a filesystem path.
 */
import { base64ToBytes } from '../../../src/host/encoding'
import { DEV_CHUNK_MAX_BYTES, type BootValues } from '../../../src/host/protocol'
import { HostCallError, type HostClient } from './host-client'

export interface BookContentSource {
  /** Whole book; rejects with a `HostCallError` (`NOT_FOUND`, `BOOK_TOO_LARGE_FOR_DEV`, `READ_FAILED`). */
  read(bookId: string): Promise<ArrayBuffer>
  /** Renderer-safe cover URL, or undefined when there is none. `version` changes when the cover does. */
  coverUrl(bookId: string, version: string): Promise<string | undefined>
}

export function createBookContentSource(
  client: HostClient,
  boot: Pick<BootValues, 'baseUrl' | 'token'>,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): BookContentSource {
  const { baseUrl, token } = boot
  const coverCache = new Map<string, string | undefined>()

  if (baseUrl && token) {
    const url = (kind: 'books' | 'covers', id: string) => `${baseUrl}/${kind}/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`
    return {
      async read(bookId) {
        let response: Response
        try {
          response = await fetchImpl(url('books', bookId), { cache: 'no-store' })
        } catch {
          throw new HostCallError('READ_FAILED', 'The book could not be read', 'server', 'books')
        }
        if (response.status === 404) throw new HostCallError('NOT_FOUND', 'The book file is missing', 'server', 'books')
        if (!response.ok) throw new HostCallError('READ_FAILED', `The book could not be read (HTTP ${response.status})`, 'server', 'books')
        return response.arrayBuffer()
      },
      async coverUrl(bookId, version) {
        return `${url('covers', bookId)}&v=${encodeURIComponent(version)}`
      },
    }
  }

  return {
    async read(bookId) {
      const parts: Uint8Array[] = []
      let offset = 0
      let total = 0
      for (;;) {
        const chunk = await client.call<{ base64: string; eof: boolean; size: number }>('files', 'readChunk', { bookId, offset, length: DEV_CHUNK_MAX_BYTES })
        const bytes = base64ToBytes(chunk.base64)
        if (!bytes) throw new HostCallError('READ_FAILED', 'The host sent a damaged chunk', 'files', 'readChunk')
        parts.push(bytes)
        offset += bytes.length
        total = chunk.size
        if (chunk.eof || bytes.length === 0) break
      }
      if (offset !== total) throw new HostCallError('READ_FAILED', 'The book changed while it was read', 'files', 'readChunk')
      const out = new Uint8Array(total)
      let at = 0
      for (const p of parts) {
        out.set(p, at)
        at += p.length
      }
      return out.buffer
    },
    async coverUrl(bookId, version) {
      const key = `${bookId}:${version}`
      if (coverCache.has(key)) return coverCache.get(key)
      let value: string | undefined
      try {
        const cover = await client.call<{ base64: string } | null>('files', 'readCover', { bookId })
        value = cover ? `data:image/png;base64,${cover.base64}` : undefined
      } catch {
        value = undefined
      }
      coverCache.set(key, value)
      return value
    },
  }
}

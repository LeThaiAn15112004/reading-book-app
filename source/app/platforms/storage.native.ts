/**
 * Platform adapter `storage`, Mobile WebView (spec 009 T044; was `web/src/bridge/book-content.ts`).
 * Where book bytes and covers come from (spec 008, T058, R14): the local server in the real app (`GET
 * /books/{id}?t=…`, never over `postMessage`), and in Expo Go, which has no server, the development-only
 * `files.readChunk` in 1 MiB base64 chunks up to 20 MB per book. Covers are server URLs built per launch, or
 * `data:` URLs in Expo Go. Nothing here ever sees a filesystem path.
 */
import { base64ToBytes } from './native/host/encoding'
import { DEV_CHUNK_MAX_BYTES } from './native/host/protocol'
import { HostCallError } from './native/bridge/host-client'
import type { BookContentBoot, BookContentHost, BookContentSource } from './storage-types'

export type { BookContentBoot, BookContentHost, BookContentSource }

export function createBookContentSource(
  client: BookContentHost,
  boot: BookContentBoot,
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
      // Spec 016: one `Range` request to the local server (`206` + `Content-Range: bytes a-b/total`).
      async readRange(bookId, offset, length) {
        if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 1) {
          throw new HostCallError('INVALID_ARGUMENT', 'Bad byte range', 'server', 'books')
        }
        let response: Response
        try {
          response = await fetchImpl(url('books', bookId), { cache: 'no-store', headers: { Range: `bytes=${offset}-${offset + length - 1}` } })
        } catch {
          throw new HostCallError('READ_FAILED', 'The book could not be read', 'server', 'books')
        }
        if (response.status === 404) throw new HostCallError('NOT_FOUND', 'The book file is missing', 'server', 'books')
        if (response.status === 416) throw new HostCallError('INVALID_ARGUMENT', 'Byte range past the end of the book', 'server', 'books')
        if (response.status === 206) {
          const total = Number(/\/(\d+)\s*$/.exec(response.headers.get('Content-Range') ?? '')?.[1])
          const data = new Uint8Array(await response.arrayBuffer())
          if (!Number.isFinite(total) || data.length !== length) throw new HostCallError('READ_FAILED', 'The server sent a damaged range', 'server', 'books')
          return { data, sizeBytes: total }
        }
        if (!response.ok) throw new HostCallError('READ_FAILED', `The book could not be read (HTTP ${response.status})`, 'server', 'books')
        // A server that ignores Range sends the whole file: still correct, only slower.
        const whole = new Uint8Array(await response.arrayBuffer())
        if (offset + length > whole.length) throw new HostCallError('INVALID_ARGUMENT', 'Byte range past the end of the book', 'server', 'books')
        return { data: whole.slice(offset, offset + length), sizeBytes: whole.length }
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
    // Spec 016: Expo Go (no local server) reads ranges with the development-only `files.readChunk`.
    async readRange(bookId, offset, length) {
      if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 1) {
        throw new HostCallError('INVALID_ARGUMENT', 'Bad byte range', 'files', 'readChunk')
      }
      const out = new Uint8Array(length)
      let done = 0
      let size = 0
      while (done < length) {
        const chunk = await client.call<{ base64: string; eof: boolean; size: number }>('files', 'readChunk', {
          bookId,
          offset: offset + done,
          length: Math.min(DEV_CHUNK_MAX_BYTES, length - done),
        })
        const bytes = base64ToBytes(chunk.base64)
        if (!bytes) throw new HostCallError('READ_FAILED', 'The host sent a damaged chunk', 'files', 'readChunk')
        size = chunk.size
        if (bytes.length === 0) break
        out.set(bytes.subarray(0, length - done), done)
        done += bytes.length
      }
      if (done < length) throw new HostCallError('INVALID_ARGUMENT', 'Byte range past the end of the book', 'files', 'readChunk')
      return { data: out, sizeBytes: size }
    },
  }
}

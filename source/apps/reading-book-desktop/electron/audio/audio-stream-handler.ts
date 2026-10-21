import fs from 'node:fs'
import { Readable } from 'node:stream'
import { audioMimeForFormat, parseByteRange } from '@reading-book/book-reader-sdk'

/**
 * HTTP-style streaming of one audiobook file, with byte-Range support, for the `rb-audio` protocol.
 * Electron-free on purpose (only `node:fs` / `node:stream` and the Fetch `Request` / `Response`), so
 * `spikes/audio/run-audio-main.mjs` can drive it against real files without a window.
 *
 *  - the URL names a BOOK ID only (`rb-audio://local/{bookId}`); the path never comes from the renderer
 *    and the lookup is the caller's, which re-validates the registered path on every request;
 *  - `Content-Type` is the app's own (`audioMimeForFormat`), never the renderer's or the extension's;
 *  - one `fs.createReadStream({ start, end })` per request, handed to the Response as a web stream:
 *    nothing is buffered, and cancelling the request (the player seeking away) destroys the stream.
 *
 * Verified against the Chromium media stack in docs/implementation_plan/audiobook_implementation_plan.md
 * (PoC variant B): 206 + `Content-Range` is what lets `<audio>` seek; a `200` answer to a Range
 * request makes seeking fail.
 */
export type AudioFileLookup = (
  bookId: string,
) => Promise<{ ok: true; path: string; format: string } | { ok: false }>

export interface AudioStreamHandlerOptions {
  /** Test hook: called once per body stream opened, with a function that tells how many bytes were read. */
  onStreamOpened?: (info: { bookId: string; start: number; end: number }, closed: Promise<{ bytesRead: number }>) => void
}

/** `rb-audio://local/{bookId}` → the id; anything else (other host, nested path, empty, NUL) → null. */
export function parseAudioRequestUrl(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.hostname !== 'local') return null
  let id: string
  try {
    id = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  } catch {
    return null
  }
  if (!id || id.includes('/') || id.includes('\\') || id.includes('\0')) return null
  return id
}

const notFound = () => new Response('Not found', { status: 404 })

export function createAudioStreamHandler(
  lookup: AudioFileLookup,
  options: AudioStreamHandlerOptions = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }
    const bookId = parseAudioRequestUrl(request.url)
    if (bookId === null) return notFound()

    try {
      const found = await lookup(bookId)
      if (!found.ok) return notFound()
      const mime = audioMimeForFormat(found.format)
      if (!mime) return notFound()

      const size = (await fs.promises.stat(found.path)).size
      const base: Record<string, string> = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      }

      const range = parseByteRange(request.headers.get('range'), size)
      if (range.kind === 'unsatisfiable') {
        return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } })
      }
      if (size === 0) return new Response(null, { status: 200, headers: { ...base, 'Content-Length': '0' } })

      const partial = range.kind === 'range'
      const start = partial ? range.start : 0
      const end = partial ? range.end : size - 1
      const headers: Record<string, string> = { ...base, 'Content-Length': String(end - start + 1) }
      if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      const status = partial ? 206 : 200

      if (request.method === 'HEAD') return new Response(null, { status, headers })

      const stream = fs.createReadStream(found.path, { start, end })
      options.onStreamOpened?.(
        { bookId, start, end },
        new Promise((resolve) => stream.once('close', () => resolve({ bytesRead: stream.bytesRead }))),
      )
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { status, headers })
    } catch {
      // The file vanished or became unreadable between the lookup and the open.
      return notFound()
    }
  }
}

import { net, protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertPathAllowed } from './sandbox'
import { getLibraryStore } from '../persistence/sqlite-library-store'

/** Custom scheme for sandboxed book covers (renderer never sees absolute paths). */
export const COVER_PROTOCOL = 'rb-cover'

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

/** Must run before `app.whenReady()`. */
export function registerCoverSchemePrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: COVER_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ])
}

/** Renderer-safe URL for a book cover (`rb-cover://local/{bookId}`). */
export function coverUrlForBookId(bookId: string): string {
  return `${COVER_PROTOCOL}://local/${encodeURIComponent(bookId)}`
}

function bookIdFromCoverRequest(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl)
    if (url.hostname !== 'local') return null
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, '')).trim()
    return id || null
  } catch {
    return null
  }
}

/**
 * Serve `{userData}/books/.../cover.*` by book id.
 * Call after DB is open (`app.whenReady`).
 */
export function registerCoverProtocol(): void {
  protocol.handle(COVER_PROTOCOL, async (request) => {
    const bookId = bookIdFromCoverRequest(request.url)
    if (!bookId) {
      return new Response('Not found', { status: 404 })
    }

    try {
      const book = await getLibraryStore().findById(bookId)
      const coverPath = book?.coverPath
      if (!coverPath) {
        return new Response('Not found', { status: 404 })
      }

      const resolved = assertPathAllowed(coverPath)
      await fs.promises.access(resolved, fs.constants.R_OK)

      const ext = path.extname(resolved).toLowerCase()
      const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
      const fileResponse = await net.fetch(pathToFileURL(resolved).href)
      const headers = new Headers(fileResponse.headers)
      headers.set('Content-Type', mime)
      headers.set('Cache-Control', 'no-cache')
      return new Response(fileResponse.body, {
        status: fileResponse.status,
        statusText: fileResponse.statusText,
        headers,
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

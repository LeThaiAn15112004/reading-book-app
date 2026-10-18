import { protocol } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { MD_MAX_IMAGE_BYTES, classifyMdImageSrc } from '@reading-book/book-reader-sdk'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { resolveBookFile } from '../files/sandbox'

/**
 * Images referenced by a Markdown book (`![](img/a.png)`), served by book id + relative path.
 * The renderer never sees a filesystem path and cannot name a file outside the document's folder:
 *  - the book is looked up in the library and its registered path validated (`resolveBookFile`);
 *  - the relative path passes the SDK's lexical policy (no remote, absolute, drive, `..`, non-image);
 *  - the REAL path of the image (symlinks followed) must stay inside the real folder of the .md.
 * See docs/implementation_plan/markdown_reader.md §4.
 */
export const MD_ASSET_PROTOCOL = 'rb-md-asset'

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}

/** Scheme privileges; registered together with the other custom schemes, before `app.ready`. */
export const MD_ASSET_SCHEME: Electron.CustomScheme = {
  scheme: MD_ASSET_PROTOCOL,
  privileges: { standard: true, secure: true },
}

export type MdAssetResolution =
  | { ok: true; path: string; mime: string }
  | { ok: false; reason: 'blocked' | 'not_found' | 'too_large' }

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Resolve `relativeSrc` (as written in the Markdown) next to the Markdown file `mdFilePath`.
 * Pure filesystem + path logic (no Electron), so the Main spike can exercise it on temp files.
 */
export async function resolveMdAssetFile(
  mdFilePath: string,
  relativeSrc: string,
): Promise<MdAssetResolution> {
  const ref = classifyMdImageSrc(relativeSrc)
  if (ref.kind !== 'relative') return { ok: false, reason: 'blocked' }
  try {
    const realDir = await fsp.realpath(path.dirname(mdFilePath))
    const candidate = path.join(realDir, ...ref.path.split('/'))
    const real = await fsp.realpath(candidate)
    if (!isInside(realDir, real)) return { ok: false, reason: 'blocked' }
    const mime = MIME_BY_EXT[path.extname(real).toLowerCase()]
    if (!mime) return { ok: false, reason: 'blocked' }
    const stat = await fsp.stat(real)
    if (!stat.isFile()) return { ok: false, reason: 'not_found' }
    if (stat.size > MD_MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large' }
    return { ok: true, path: real, mime }
  } catch {
    return { ok: false, reason: 'not_found' }
  }
}

/** `rb-md-asset://local/{bookId}/{seg}/{seg}` → book id + the relative path as written. */
export function parseMdAssetRequest(requestUrl: string): { bookId: string; src: string } | null {
  try {
    const url = new URL(requestUrl)
    if (url.hostname !== 'local') return null
    const parts = url.pathname.replace(/^\/+/, '').split('/')
    const bookId = decodeURIComponent(parts.shift() ?? '').trim()
    if (!bookId || parts.length === 0) return null
    return { bookId, src: parts.map((p) => decodeURIComponent(p)).join('/') }
  } catch {
    return null
  }
}

const notFound = () => new Response('Not found', { status: 404 })

/** Call after the DB is open (`app.whenReady`). */
export function registerMdAssetProtocol(): void {
  protocol.handle(MD_ASSET_PROTOCOL, async (request) => {
    const parsed = parseMdAssetRequest(request.url)
    if (!parsed) return notFound()
    try {
      const book = await getLibraryStore().findById(parsed.bookId)
      if (!book || book.format !== 'md') return notFound()
      const file = await resolveBookFile(book)
      if (!file.ok) return notFound()
      const asset = await resolveMdAssetFile(file.path, parsed.src)
      if (!asset.ok) return notFound()
      const bytes = await fsp.readFile(asset.path)
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'Content-Type': asset.mime,
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          // An SVG opened as a document (not via <img>) still may not run script or load anything.
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        },
      })
    } catch {
      return notFound()
    }
  })
}

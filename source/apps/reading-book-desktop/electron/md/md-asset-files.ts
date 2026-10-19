import fsp from 'node:fs/promises'
import path from 'node:path'
import { MD_MAX_IMAGE_BYTES, classifyMdImageSrc } from '@reading-book/book-reader-sdk'

/** Pure filesystem + path logic for Markdown images (no Electron), so a spike can run it on temp files. */

export const MD_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
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
    const mime = MD_MIME_BY_EXT[path.extname(real).toLowerCase()]
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

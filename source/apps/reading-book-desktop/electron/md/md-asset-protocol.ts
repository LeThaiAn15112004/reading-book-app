import { protocol } from 'electron'
import fsp from 'node:fs/promises'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { resolveBookFile } from '../files/sandbox'
import { parseMdAssetRequest, resolveMdAssetFile } from './md-asset-files'

/**
 * Images referenced by a Markdown book (`![](img/a.png)`), served by book id + relative path.
 * The renderer never sees a filesystem path and cannot name a file outside the document's folder:
 *  - the book is looked up in the library and its registered path validated (`resolveBookFile`);
 *  - the relative path passes the SDK's lexical policy (no remote, absolute, drive, `..`, non-image);
 *  - the REAL path of the image (symlinks followed) must stay inside the real folder of the .md.
 * See docs/implementation_plan/markdown_reader.md §4.
 */
export const MD_ASSET_PROTOCOL = 'rb-md-asset'

/** Scheme privileges; registered together with the other custom schemes, before `app.ready`. */
export const MD_ASSET_SCHEME: Electron.CustomScheme = {
  scheme: MD_ASSET_PROTOCOL,
  privileges: { standard: true, secure: true },
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

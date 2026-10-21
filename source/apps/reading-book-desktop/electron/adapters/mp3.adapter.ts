import type { DocumentImporter, ImportResult } from '@reading-book/book-reader-sdk'
import { DocumentFormat } from '@reading-book/book-reader-sdk'
import { parseFile } from 'music-metadata'
import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { buildImportResult } from './filename-fallback-importer'

const COVER_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

/**
 * MP3 DocumentImporter. Title / artist / album / genre / embedded cover come from the file's tags via
 * `music-metadata` (best effort: a missing tag falls back to the file name, a bad cover is skipped).
 *
 * The file itself must still look like MP3 audio: the parser has to find a container and a codec.
 * `music-metadata` does NOT throw for a text file renamed to `.mp3` (it just reports no format), so
 * that check is explicit — otherwise such a file would enter the library and never play.
 * A file whose ID3 header is damaged makes the parser throw; that is reported as unreadable too.
 *
 * Duration is not stored at import time: the player learns it from the `<audio>` element and keeps it
 * in `reading_state_json.audioProgress`.
 */
export function createMp3Adapter(options: { coversDir: () => string }): DocumentImporter {
  return {
    canHandle(filePath: string): boolean {
      return path.extname(path.basename(filePath)).toLowerCase() === '.mp3'
    },
    async import(filePath: string): Promise<ImportResult> {
      const parsed = await parseFile(filePath, { duration: false, includeChapters: false })
      if (!parsed.format.container || !parsed.format.codec) {
        throw new Error('Not a readable MP3 audio file.')
      }
      const { common } = parsed
      const artists = (common.artists?.length ? common.artists : common.artist ? [common.artist] : [])
        .map((a) => a.trim())
        .filter(Boolean)

      let coverPath: string | undefined
      const picture = common.picture?.[0]
      const ext = picture ? COVER_EXT_BY_MIME[picture.format.toLowerCase()] : undefined
      if (picture && ext) {
        const dest = path.join(options.coversDir(), `${randomUUID()}${ext}`)
        try {
          await fsp.writeFile(dest, picture.data)
          coverPath = dest
        } catch {
          coverPath = undefined
        }
      }

      return buildImportResult(filePath, DocumentFormat.Mp3, {
        title: common.title,
        authorNames: artists,
        coverPath,
        description: common.album ? `Album: ${common.album}` : undefined,
        genreNames: (common.genre ?? []).slice(0, 8),
      })
    },
  }
}

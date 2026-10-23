import type { DocumentFormat, DocumentImporter, ImportResult } from '@reading-book/book-reader-sdk'
import { audioFormatFromExtension } from '@reading-book/book-reader-sdk'
import { parseFile, type IAudioMetadata } from 'music-metadata'
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
 * What the parser must report for a file to be accepted as `format`. The extension alone proves nothing
 * (`.m4a` may hold ALAC, `.ogg` may hold Speex, a text file can be renamed `.wav`), so container AND codec
 * are checked against what the bundled Chromium can decode. (Real M4B files often carry an `M4A` ftyp brand,
 * so both MP4 audio formats accept any MP4-family brand; the codec is what matters.) `music-metadata` reports these exact strings.
 */
const ACCEPTED: Readonly<Record<string, { container: RegExp; codec: RegExp; label: string }>> = {
  mp3: { container: /^MPEG$/i, codec: /^MPEG \d(\.\d)? Layer 3$/i, label: 'MP3' },
  m4a: { container: /^(M4A|M4B|MP4|isom|mp42)/i, codec: /AAC/i, label: 'M4A (AAC)' },
  m4b: { container: /^(M4A|M4B|MP4|isom|mp42)/i, codec: /AAC/i, label: 'M4B (AAC)' },
  aac: { container: /^ADTS/i, codec: /AAC/i, label: 'AAC (ADTS)' },
  wav: { container: /^WAVE$/i, codec: /^(PCM|IEEE_FLOAT)$/i, label: 'WAV (PCM)' },
  flac: { container: /^FLAC$/i, codec: /^FLAC$/i, label: 'FLAC' },
  ogg: { container: /^Ogg$/i, codec: /^(Vorbis|Opus)/i, label: 'Ogg (Vorbis/Opus)' },
  opus: { container: /^Ogg$/i, codec: /^Opus/i, label: 'Opus' },
}

/**
 * Parse `filePath` and require that it really is `format` (container AND codec). Returns the parsed metadata;
 * throws a user-readable Error otherwise. Shared by the importer and the ZIP import preview, so both apply one rule.
 */
export async function probeAudioFile(filePath: string, format: string): Promise<IAudioMetadata> {
  const accepted = ACCEPTED[format]
  if (!accepted) throw new Error(`No audio import rule for format: ${format}`)
  const parsed = await parseFile(filePath, { duration: false, includeChapters: false })
  const { container, codec } = parsed.format
  if (!container || !codec) {
    throw new Error(`Not a readable ${accepted.label} audio file.`)
  }
  if (!accepted.container.test(container) || !accepted.codec.test(codec)) {
    throw new Error(`Not a playable ${accepted.label} file (found ${container} / ${codec}).`)
  }
  return parsed
}

/**
 * Audiobook DocumentImporter (one per format). Title / artist / album / genre / embedded cover come from the
 * file's tags via `music-metadata` (best effort: a missing tag falls back to the file name, a bad cover is skipped).
 *
 * The file itself must really be that format: the parser has to find a matching container and codec.
 * `music-metadata` does NOT throw for a text file renamed to `.mp3` (it just reports no format), so
 * that check is explicit — otherwise such a file would enter the library and never play.
 * A file whose header is damaged makes the parser throw; that is reported as unreadable too.
 *
 * Duration is not stored at import time: the player learns it from the `<audio>` element and keeps it
 * in `reading_state_json.audioProgress`. The file is never rewritten, renamed or transcoded.
 */
export function createAudioAdapter(format: DocumentFormat, options: { coversDir: () => string }): DocumentImporter {
  const accepted = ACCEPTED[format]
  if (!accepted) throw new Error(`No audio import rule for format: ${format}`)
  return {
    canHandle(filePath: string): boolean {
      return audioFormatFromExtension(path.extname(path.basename(filePath))) === format
    },
    async import(filePath: string): Promise<ImportResult> {
      const parsed = await probeAudioFile(filePath, format)
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

      return buildImportResult(filePath, format, {
        title: common.title,
        authorNames: artists,
        coverPath,
        description: common.album ? `Album: ${common.album}` : undefined,
        genreNames: (common.genre ?? []).slice(0, 8),
      })
    },
  }
}

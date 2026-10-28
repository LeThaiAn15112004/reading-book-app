import { whisperLanguageForTag } from '@reading-book/book-reader-sdk'

/**
 * The language an audio file declares about itself (spec 004, FR-005: the default transcription language is the audiobook's own
 * language tag when it maps to a Whisper language). Electron-free: the tag parser is injected, so the Main spike drives it with
 * fakes; `transcription-runtime.ts` passes the real `music-metadata` reader.
 */

/** The part of `music-metadata`'s result this module reads (`common.language` — an ISO 639-2 tag such as `eng`). */
export interface ParsedAudioTags {
  common?: { language?: string; languages?: string[] }
}

export type ParseAudioTags = (filePath: string) => Promise<ParsedAudioTags>

/** The Whisper language code of the file's own tag, or `null` when there is no tag, it is not mapped, or the file cannot be read. */
export async function readAudioLanguageTag(filePath: string, parse: ParseAudioTags): Promise<string | null> {
  try {
    const { common } = await parse(filePath)
    const candidates = [common?.language, ...(common?.languages ?? [])]
    for (const candidate of candidates) {
      const code = whisperLanguageForTag(candidate)
      if (code) return code
    }
    return null
  } catch {
    // A tag that cannot be read is simply "no tag": the default falls back to the app language.
    return null
  }
}

/**
 * A per-book cache around `readAudioLanguageTag`: the tag is read once per book (the file of a single-file audiobook, the first
 * track of a multi-track one) and the answer — including "none" — is remembered until the book is forgotten.
 */
export function createLanguageTagCache(options: {
  resolveFile: (bookId: string) => Promise<string | null>
  parse: ParseAudioTags
}) {
  const cache = new Map<string, Promise<string | null>>()
  return {
    get(bookId: string): Promise<string | null> {
      let known = cache.get(bookId)
      if (!known) {
        known = options
          .resolveFile(bookId)
          .then((file) => (file ? readAudioLanguageTag(file, options.parse) : null))
          .catch(() => null)
        cache.set(bookId, known)
      }
      return known
    },
    forget(bookId: string): void {
      cache.delete(bookId)
    },
  }
}

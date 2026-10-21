import { protocol } from 'electron'
import { isAudioFormat } from '@reading-book/book-reader-sdk'
import { resolveBookFile } from '../files/sandbox'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { createAudioStreamHandler } from './audio-stream-handler'

/**
 * `rb-audio://local/{bookId}` — streams an audiobook's file to the renderer's `<audio>` element.
 * The renderer only ever names a book id; the library row decides the file, `resolveBookFile`
 * re-checks it on every request (absolute path, extension matches the format, symlinks resolved,
 * regular readable file), and the renderer never sees a filesystem path. See audio-stream-handler.ts.
 */
export const AUDIO_PROTOCOL = 'rb-audio'

/**
 * Same privileges as the PoC variant that was verified to play and seek in Electron 39
 * (`stream` is what Electron documents for media elements). Registered with the other custom
 * schemes before `app.whenReady()`.
 */
export const AUDIO_SCHEME: Electron.CustomScheme = {
  scheme: AUDIO_PROTOCOL,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}

/** Call after the DB is open (`app.whenReady`). */
export function registerAudioProtocol(): void {
  protocol.handle(
    AUDIO_PROTOCOL,
    createAudioStreamHandler(async (bookId) => {
      const book = await getLibraryStore().findById(bookId)
      if (!book || !isAudioFormat(book.format)) return { ok: false }
      const file = await resolveBookFile(book)
      return file.ok ? { ok: true, path: file.path, format: book.format } : { ok: false }
    }),
  )
}

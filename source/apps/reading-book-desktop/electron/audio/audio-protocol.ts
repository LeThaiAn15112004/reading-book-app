import { protocol } from 'electron'
import { bookFileStorage, resolveBookFile } from '../files/sandbox'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { createBookAudioLookup } from './audio-lookup'
import { createAudioStreamHandler } from './audio-stream-handler'

/**
 * `rb-audio://local/{bookId}[/{trackId}]` — streams an audiobook's file (or one chapter of a multi-chapter audiobook,
 * see `audio-lookup.ts`) to the renderer's `<audio>` element.
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
    createAudioStreamHandler(
      createBookAudioLookup({
        findBook: (bookId) => getLibraryStore().findById(bookId),
        getChapter: (bookId, trackId) => getLibraryStore().getAudioChapter(bookId, trackId),
        isManaged: (filePath) => bookFileStorage(filePath) === 'managed',
        resolveFile: async (book) => {
          const file = await resolveBookFile(book)
          return file.ok ? { ok: true, path: file.path } : { ok: false }
        },
      }),
    ),
  )
}

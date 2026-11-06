import { features } from '@reading-book/config'
import { app, BrowserWindow } from 'electron'
import { parseFile } from 'music-metadata'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBookAudioLookup } from '../audio/audio-lookup'
import { bookFileStorage, resolveBookFile } from '../files/sandbox'
import { TranscriptionChannels } from '../ipc/channels'
import { getDatabase } from '../persistence/db'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { SqliteTranscriptStore } from '../persistence/sqlite-transcript-store'
import { createAudioDecoder } from './audio-decoder'
import { isTranscriptionPlatformSupported } from './ffmpeg-artifacts'
import { createLanguageTagCache } from './audio-language-tag'
import { createModelManager } from './model-manager'
import { createSpeechProcessHost, launchForkedProcess } from './speech-process-host'
import { createTranscriptionService, type TranscriptionService, type TranscriptionSource } from './transcription-service'

/**
 * Wires the real collaborators of the transcription service (spec 004): the SQLite store, the speech process, the
 * own-build FFmpeg decoder, the model manager and the library. The only place of the feature that touches `electron`
 * (the service itself is Electron-free so the Main spike can drive it with fakes).
 */

const PROCESS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'transcription.process.js')

let service: TranscriptionService | null = null
let sharedStore: SqliteTranscriptStore | null = null

function transcriptStore(): SqliteTranscriptStore {
  sharedStore ??= new SqliteTranscriptStore(getDatabase())
  return sharedStore
}

/** `{userData}/transcription-models` — verified model folders (see model-manager.ts). */
export function getSpeechModelsDir(): string {
  return path.join(app.getPath('userData'), 'transcription-models')
}
const modelsDir = getSpeechModelsDir

/**
 * Where `ffmpeg/<platform>-<arch>/` lives: `process.resourcesPath` when packaged (electron-builder `extraResources`, outside
 * the asar); otherwise the desktop app's own `resources/` folder, found from this bundle (`dist-electron/`) rather than
 * `app.getAppPath()`, which is `dist-electron/` itself when Electron is started on `dist-electron/main.js` (E2E).
 */
function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources')
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function createSource(): TranscriptionSource {
  const lookup = createBookAudioLookup({
    findBook: (bookId) => getLibraryStore().findById(bookId),
    getChapter: (bookId, trackId) => getLibraryStore().getAudioChapter(bookId, trackId),
    isManaged: (filePath) => bookFileStorage(filePath) === 'managed',
    resolveFile: async (book) => {
      const file = await resolveBookFile(book)
      return file.ok ? { ok: true, path: file.path } : { ok: false }
    },
  })
  const languageTags = createLanguageTagCache({
    resolveFile: async (bookId) => {
      const firstTrack = getLibraryStore().listAudioChapters(bookId)[0]
      const file = await lookup(bookId, firstTrack?.id)
      return file.ok ? file.path : null
    },
    parse: (filePath) => parseFile(filePath, { duration: false, includeChapters: false }),
  })
  return {
    languageTag: (bookId) => languageTags.get(bookId),
    findBook: async (bookId) => {
      const book = await getLibraryStore().findById(bookId)
      return book ? { id: book.id, format: book.format } : undefined
    },
    listTracks: (bookId) =>
      getLibraryStore()
        .listAudioChapters(bookId)
        .map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          durationMs: chapter.durationSeconds === null ? null : Math.round(chapter.durationSeconds * 1000),
        })),
    resolveFile: async (bookId, trackId) => {
      const file = await lookup(bookId, trackId)
      return file.ok ? { ok: true, path: file.path } : { ok: false }
    },
    probeDurationMs: async (filePath) => {
      try {
        const parsed = await parseFile(filePath, { duration: true, includeChapters: false })
        const seconds = parsed.format.duration
        return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null
      } catch {
        return null
      }
    },
  }
}

/**
 * Startup recovery (T015a): a transcript whose job was cut short by a quit or a crash becomes `partial` (or `failed` when
 * nothing was transcribed) with `INTERRUPTED`. Call after the database is open and BEFORE the IPC handlers can serve
 * `transcription:start`. Idempotent. A job is never restarted automatically: the user resumes it from the panel.
 */
export function recoverInterruptedTranscripts(): number {
  try {
    return transcriptStore().recoverInterrupted()
  } catch (error) {
    console.error('Transcript recovery failed:', error)
    return 0
  }
}

export function getTranscriptionService(): TranscriptionService {
  if (service) return service
  service = createTranscriptionService({
    store: transcriptStore(),
    speech: createSpeechProcessHost({ launch: launchForkedProcess(PROCESS_PATH), modelsDir: modelsDir() }),
    decoder: createAudioDecoder({ resourcesDir: resourcesDir() }),
    models: createModelManager({ modelsDir: modelsDir() }),
    source: createSource(),
    // The release gate, read at every call: while it is off, or this platform has no shipped decoder (FR-017), `start` and
    // `downloadModel` answer FEATURE_DISABLED.
    isEnabled: () => features.audiobookTranscriptionEnabled && isTranscriptionPlatformSupported(),
    events: {
      progress: (job) => broadcast(TranscriptionChannels.progress, job),
      passagesAdded: (added) => broadcast(TranscriptionChannels.passagesAdded, added),
      modelProgress: (progress) => broadcast(TranscriptionChannels.modelProgress, progress),
    },
  })
  return service
}

/**
 * A book is being removed or its file deleted: cancel its queued / running transcription and wait until the job has ended
 * (FR-015), then drop its transcript. A no-op when the service was never created — a job can only exist once it has been.
 * Never throws: removing the book must not depend on the transcript.
 */
export async function cancelTranscriptionOfBook(bookId: string): Promise<void> {
  const current = service
  if (!current) return
  try {
    await current.delete(bookId)
  } catch (error) {
    console.error('Cancelling the transcription of a removed book failed:', error)
  }
}

/**
 * Settings → Storage → remove a downloaded speech model. When the service was never created nothing can be running, so it is
 * created (cheap: no process is started) and does the removal like any other — the busy check and the stop of the speech process
 * live in `removeModel`.
 */
export function removeSpeechModel(modelId: unknown) {
  return getTranscriptionService().removeModel(modelId)
}

/** App quit: cancel the queue and the running job, stop the speech process. Safe when the service was never used. */
export function disposeTranscription(): void {
  const current = service
  service = null
  void current?.shutdown().catch(() => undefined)
}

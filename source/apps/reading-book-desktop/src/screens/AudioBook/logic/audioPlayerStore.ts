import { create } from 'zustand'
import {
  clampPlaybackRate,
  clampSeekPosition,
  knownDuration,
  resolveRestorePosition,
  shouldPersistProgress,
} from '@reading-book/book-reader-sdk'
import { libraryApi, overlayApi } from '../../../bridge'
import { registerSessionFlushHandler } from '../../Reader/logic/session/sessionFlushRegistry'

/**
 * The audiobook player. One module-level `<audio>` element at a time (so two books can never play
 * together); the store only mirrors its state for React. The element streams from the Main-owned
 * `rb-audio://local/{bookId}` protocol (HTTP Range) — the file never crosses IPC or enters JS memory.
 *
 * Progress is written as seconds under `reading_state_json.audioProgress` (not as a `Location`):
 * every 5 s while playing (and only if the position moved), immediately on pause / end / rate change
 * / leaving the book, and through the session-flush registry when the window closes.
 */
type PlayerStatus = 'idle' | 'loading' | 'ready' | 'error'

type AudioPlayerState = {
  bookId: string | null
  status: PlayerStatus
  errorCode: string | null
  errorMessage: string | null
  title: string
  author: string | undefined
  coverUrl: string | undefined
  playing: boolean
  /** Waiting for data (initial buffering or after a seek). */
  buffering: boolean
  ended: boolean
  positionSeconds: number
  /** `null` until the element reports a finite duration. */
  durationSeconds: number | null
  playbackRate: number
  load: (bookId: string) => Promise<void>
  play: () => void
  pause: () => void
  toggle: () => void
  seekTo: (seconds: number) => void
  skipBy: (deltaSeconds: number) => void
  setRate: (rate: number) => void
  /** Save progress, stop, release the element. Safe to call twice. */
  dispose: () => Promise<void>
}

const MEDIA_ERROR_MESSAGE =
  'This audio file could not be played. It may be damaged or use an encoding this app cannot decode.'

const INITIAL = {
  bookId: null,
  status: 'idle' as PlayerStatus,
  errorCode: null,
  errorMessage: null,
  title: 'Untitled',
  author: undefined,
  coverUrl: undefined,
  playing: false,
  buffering: false,
  ended: false,
  positionSeconds: 0,
  durationSeconds: null,
  playbackRate: 1,
}

export function audioStreamUrl(bookId: string): string {
  return `rb-audio://local/${encodeURIComponent(bookId)}`
}

// ---- module-level, non-reactive ----
let audio: HTMLAudioElement | null = null
let detachListeners: (() => void) | null = null
let unregisterFlush: (() => void) | null = null
let saveTimer: ReturnType<typeof setInterval> | null = null
let lastSaved: { position: number; at: number } | null = null
let saveChain: Promise<unknown> = Promise.resolve()
let generation = 0
let markedReading = false

export const useAudioPlayerStore = create<AudioPlayerState>()((set, get) => {
  /** Write the current progress. `force` skips the throttle (pause, end, leaving, closing). */
  const persist = (force: boolean): Promise<unknown> => {
    const el = audio
    const { bookId } = get()
    if (!el || !bookId || get().status !== 'ready') return saveChain
    const position = el.currentTime
    const ok = shouldPersistProgress({
      force,
      position,
      lastSavedPosition: lastSaved?.position ?? null,
      nowMs: Date.now(),
      lastSavedAtMs: lastSaved?.at ?? null,
    })
    if (!ok) return saveChain
    lastSaved = { position, at: Date.now() }
    const duration = knownDuration(el.duration)
    const input = {
      bookId,
      positionSeconds: position,
      playbackRate: el.playbackRate,
      ...(duration !== null ? { durationSeconds: duration } : {}),
    }
    // Writes are chained so a slow one can never land after a newer one.
    saveChain = saveChain.then(() => overlayApi.saveAudioProgress(input)).catch(() => undefined)
    return saveChain
  }

  const startSaveTimer = () => {
    if (saveTimer !== null) return
    saveTimer = setInterval(() => void persist(false), 1000)
  }
  const stopSaveTimer = () => {
    if (saveTimer !== null) clearInterval(saveTimer)
    saveTimer = null
  }

  const teardown = () => {
    stopSaveTimer()
    detachListeners?.()
    detachListeners = null
    unregisterFlush?.()
    unregisterFlush = null
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load() // releases the stream (the protocol sees the request cancelled)
      audio = null
    }
    lastSaved = null
  }

  const fail = (code: string, message: string) => {
    stopSaveTimer()
    set({ status: 'error', errorCode: code, errorMessage: message, playing: false, buffering: false })
  }

  return {
    ...INITIAL,

    load: async (bookId) => {
      const myGeneration = ++generation
      await get().dispose()
      if (myGeneration !== generation) return
      markedReading = false
      set({ ...INITIAL, bookId, status: 'loading' })

      try {
        // Preflight in Main: a moved / unreadable file gets a specific error here, because the media
        // element reports every failure as the same generic "source not supported".
        const [book, opened, progress] = await Promise.all([
          libraryApi.getBook(bookId),
          libraryApi.openBookContent(bookId),
          overlayApi.getAudioProgress(bookId),
        ])
        if (myGeneration !== generation) return
        if (!book) return fail('not_found', 'This book is no longer in your library.')
        if (!opened.ok) {
          return fail(opened.errorCode ?? 'read_failed', opened.errorMessage ?? 'Could not open this audio file.')
        }
        set({ title: book.title, author: book.author, coverUrl: book.coverUrl })

        const el = new Audio()
        el.preload = 'metadata'
        audio = el
        const rate = clampPlaybackRate(progress?.playbackRate ?? 1)
        // The load algorithm resets playbackRate to defaultPlaybackRate, so set both.
        el.defaultPlaybackRate = rate
        el.playbackRate = rate
        set({ playbackRate: rate })

        let restored = false
        const syncDuration = () => set({ durationSeconds: knownDuration(el.duration) })
        const on = <K extends keyof HTMLMediaElementEventMap>(type: K, fn: () => void) => {
          el.addEventListener(type, fn)
          return () => el.removeEventListener(type, fn)
        }
        const offs = [
          on('loadedmetadata', () => {
            syncDuration()
            if (!restored) {
              restored = true
              const start = resolveRestorePosition(progress?.positionSeconds, el.duration)
              if (start > 0) el.currentTime = start
              set({ positionSeconds: start })
            }
            set({ status: 'ready', buffering: false })
          }),
          on('durationchange', syncDuration),
          on('timeupdate', () => set({ positionSeconds: el.currentTime })),
          on('seeked', () => {
            set({ positionSeconds: el.currentTime, buffering: false, ended: el.ended })
            // A seek is a deliberate act (one `seeked` per commit): save it now, even when paused,
            // when no timer is running.
            void persist(true)
          }),
          on('seeking', () => set({ buffering: true })),
          on('waiting', () => set({ buffering: true })),
          on('canplay', () => set({ buffering: false })),
          on('playing', () => {
            set({ playing: true, buffering: false, ended: false })
            startSaveTimer()
          }),
          on('pause', () => {
            set({ playing: false })
            stopSaveTimer()
            void persist(true)
          }),
          on('ratechange', () => {
            set({ playbackRate: clampPlaybackRate(el.playbackRate) })
            void persist(true)
          }),
          on('ended', () => {
            set({ playing: false, ended: true, positionSeconds: el.currentTime })
            stopSaveTimer()
            void persist(true)
          }),
          on('error', () => fail('media_error', MEDIA_ERROR_MESSAGE)),
        ]
        detachListeners = () => offs.forEach((off) => off())
        unregisterFlush = registerSessionFlushHandler(async () => {
          await persist(true)
        })
        el.src = audioStreamUrl(bookId)
      } catch (err) {
        if (myGeneration !== generation) return
        console.warn('[audio] could not open the book', err)
        fail('read_failed', 'Could not open this audio file.')
      }
    },

    play: () => {
      const el = audio
      if (!el || get().status !== 'ready') return
      if (el.ended) el.currentTime = 0
      if (!markedReading && get().bookId) {
        markedReading = true
        void libraryApi.markAsReading(get().bookId as string)
      }
      void el.play().catch((err: unknown) => {
        // A pause() or a new src while play() is pending rejects with AbortError: not a failure.
        if (err instanceof DOMException && err.name === 'AbortError') return
        fail('media_error', MEDIA_ERROR_MESSAGE)
      })
    },

    pause: () => audio?.pause(),

    toggle: () => {
      if (get().playing) get().pause()
      else get().play()
    },

    seekTo: (seconds) => {
      const el = audio
      if (!el || get().status !== 'ready') return
      const target = clampSeekPosition(seconds, el.duration)
      el.currentTime = target
      set({ positionSeconds: target, ended: false })
    },

    skipBy: (delta) => {
      const el = audio
      if (!el) return
      get().seekTo(el.currentTime + delta)
    },

    setRate: (rate) => {
      if (audio) audio.playbackRate = clampPlaybackRate(rate)
    },

    dispose: async () => {
      if (!audio && get().status === 'idle') return
      await persist(true)
      teardown()
      set({ ...INITIAL })
    },
  }
})

import { create } from 'zustand'
import {
  absoluteFromScoped,
  chapterIndexAt,
  chapterStart,
  clampPlaybackRate,
  clampSeekPosition,
  createAudioBookmark,
  isProgressScope,
  knownDuration,
  nextChapterTarget,
  normalizeChapters,
  previousChapterTarget,
  resolveBookmarkTarget,
  updateAudioBookmarkNote,
  resolveRestorePosition,
  shouldPersistProgress,
  timelineView,
  type AudioBookmark,
  type AudioChapter,
  type ChapterStatus,
  type ProgressScope,
  type RawChapter,
} from '@reading-book/book-reader-sdk'
import { audioApi, libraryApi, overlayApi } from '../../../bridge'
import { registerSessionFlushHandler } from '../../Reader/logic/session/sessionFlushRegistry'

/**
 * The audiobook player. One module-level `<audio>` element at a time (so two books can never play
 * together); the store only mirrors its state for React. The element streams from the Main-owned
 * `rb-audio://local/{bookId}` protocol (HTTP Range) — the file never crosses IPC or enters JS memory.
 *
 * ONE canonical position: `positionSeconds` = `HTMLMediaElement.currentTime`. The Book / Chapter scope
 * only changes how the timeline is derived from it (SDK `timelineView`); switching scope never moves
 * the audio, and a seek on the scoped timeline is mapped back to this position (`absoluteFromScoped`).
 *
 * Chapters come from the file itself (Main reads ID3 `CHAP`/`CTOC`) and are validated against the real
 * duration; with none, or with an untrustworthy list, there are no chapters — never a guess.
 *
 * Progress (seconds, scope, current chapter id) is written under `reading_state_json.audioProgress`:
 * every 5 s while playing (only if the position moved), immediately on pause / seek / end / rate or
 * scope change / leaving the book, and through the session-flush registry when the window closes.
 * Bookmarks are saved as a whole list through `audio:saveBookmarks`.
 */
type PlayerStatus = 'idle' | 'loading' | 'ready' | 'error'

export type SleepOption = { kind: 'off' } | { kind: 'minutes'; minutes: number } | { kind: 'chapter' }
export const SLEEP_MINUTES: readonly number[] = [15, 30, 45, 60]

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
  /** The canonical position, seconds from the start of the audio. */
  positionSeconds: number
  /** `null` until the element reports a finite duration. */
  durationSeconds: number | null
  playbackRate: number
  volume: number
  /** The timeline the user chose; Chapter falls back to Book wherever no chapter applies. */
  scope: ProgressScope
  chapters: AudioChapter[]
  chapterStatus: ChapterStatus
  chapterReason: string | null
  /** The audiobook's notes: marked positions with optional text. One list feeds the sidebar AND the timeline markers. */
  notes: AudioBookmark[]
  sleep: SleepOption
  /** Wall-clock ms when a minutes-based sleep timer fires (the UI ticks its own countdown). */
  sleepEndsAt: number | null
  load: (bookId: string) => Promise<void>
  play: () => void
  pause: () => void
  toggle: () => void
  /** Seek to a canonical position (clamped to the audio). */
  seekTo: (seconds: number) => void
  /** Seek on the CURRENT timeline: `relativeSeconds` is inside the shown range (book or chapter). */
  seekScoped: (relativeSeconds: number) => void
  skipBy: (deltaSeconds: number) => void
  setRate: (rate: number) => void
  setVolume: (volume: number) => void
  setScope: (scope: ProgressScope) => void
  previousChapter: () => void
  nextChapter: () => void
  goToChapter: (chapterId: string) => void
  /** Mark the current position; returns the new note's id (so the UI can offer to type its text). */
  addNote: (note?: string) => string | null
  /** Change the text of an existing note in place (never creates another). */
  updateNote: (noteId: string, note: string) => void
  removeNote: (noteId: string) => void
  goToNote: (noteId: string) => void
  setSleep: (option: SleepOption) => void
  /** Save progress, stop, release the element. Safe to call twice. */
  dispose: () => Promise<void>
}

const MEDIA_ERROR_MESSAGE =
  'This audio file could not be played. It may be damaged or use an encoding this app cannot decode.'
const VOLUME_KEY = 'readmate.audioVolume.v1'

function readVolume(): number {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(VOLUME_KEY)
    const n = raw === null ? NaN : Number(raw)
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1
  } catch {
    return 1
  }
}
function writeVolume(volume: number): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(VOLUME_KEY, String(volume))
  } catch {
    // Not persisted; the session keeps it.
  }
}

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
  scope: 'book' as ProgressScope,
  chapters: [] as AudioChapter[],
  chapterStatus: 'none' as ChapterStatus,
  chapterReason: null,
  notes: [] as AudioBookmark[],
  sleep: { kind: 'off' } as SleepOption,
  sleepEndsAt: null,
}

export function audioStreamUrl(bookId: string): string {
  return `rb-audio://local/${encodeURIComponent(bookId)}`
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ---- module-level, non-reactive ----
let audio: HTMLAudioElement | null = null
let detachListeners: (() => void) | null = null
let unregisterFlush: (() => void) | null = null
let saveTimer: ReturnType<typeof setInterval> | null = null
let sleepTimeout: ReturnType<typeof setTimeout> | null = null
let sleepChapterEnd: number | null = null
let lastSaved: { position: number; at: number } | null = null
let saveChain: Promise<unknown> = Promise.resolve()
let bookmarkChain: Promise<unknown> = Promise.resolve()
let rawChapters: RawChapter[] = []
let generation = 0
let markedReading = false

export const useAudioPlayerStore = create<AudioPlayerState>()((set, get) => {
  /** The chapter id to store with the progress: a string inside a chapter, null when chapters exist but none applies, absent when unknown. */
  const chapterIdForSave = (position: number): string | null | undefined => {
    const { chapters, chapterStatus } = get()
    if (chapterStatus !== 'ok') return undefined
    const i = chapterIndexAt(chapters, position)
    return i >= 0 ? (chapters[i] as AudioChapter).id : null
  }

  /** Write the current progress. `force` skips the throttle (pause, seek, end, leaving, closing). */
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
    const chapterId = chapterIdForSave(position)
    const input = {
      bookId,
      positionSeconds: position,
      playbackRate: el.playbackRate,
      scope: get().scope,
      ...(duration !== null ? { durationSeconds: duration } : {}),
      ...(chapterId !== undefined ? { chapterId } : {}),
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

  const clearSleep = () => {
    if (sleepTimeout !== null) clearTimeout(sleepTimeout)
    sleepTimeout = null
    sleepChapterEnd = null
    if (get().sleep.kind !== 'off' || get().sleepEndsAt !== null) set({ sleep: { kind: 'off' }, sleepEndsAt: null })
  }

  const saveBookmarks = (bookId: string, bookmarks: AudioBookmark[]) => {
    bookmarkChain = bookmarkChain.then(() => audioApi.saveBookmarks({ bookId, bookmarks })).catch(() => undefined)
  }

  const revalidateChapters = () => {
    const el = audio
    if (!el) return
    const result = normalizeChapters(rawChapters, el.duration)
    set({ chapters: result.chapters, chapterStatus: result.status, chapterReason: result.reason ?? null })
  }

  const teardown = () => {
    stopSaveTimer()
    if (sleepTimeout !== null) clearTimeout(sleepTimeout)
    sleepTimeout = null
    sleepChapterEnd = null
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
    rawChapters = []
  }

  const fail = (code: string, message: string) => {
    stopSaveTimer()
    set({ status: 'error', errorCode: code, errorMessage: message, playing: false, buffering: false })
  }

  return {
    ...INITIAL,
    volume: readVolume(),

    load: async (bookId) => {
      const myGeneration = ++generation
      await get().dispose()
      if (myGeneration !== generation) return
      markedReading = false
      set({ ...INITIAL, volume: get().volume, bookId, status: 'loading' })

      try {
        // Preflight in Main: a moved / unreadable file gets a specific error here, because the media
        // element reports every failure as the same generic "source not supported".
        const [book, opened, progress, chaptersResult, bookmarks] = await Promise.all([
          libraryApi.getBook(bookId),
          libraryApi.openBookContent(bookId),
          overlayApi.getAudioProgress(bookId),
          audioApi.getChapters(bookId).catch(() => ({ ok: false, chapters: [] })),
          audioApi.getBookmarks(bookId).catch(() => []),
        ])
        if (myGeneration !== generation) return
        if (!book) return fail('not_found', 'This book is no longer in your library.')
        if (!opened.ok) {
          return fail(opened.errorCode ?? 'read_failed', opened.errorMessage ?? 'Could not open this audio file.')
        }
        rawChapters = chaptersResult.ok ? (chaptersResult.chapters as RawChapter[]) : []
        set({
          title: book.title,
          author: book.author,
          coverUrl: book.coverUrl,
          notes: bookmarks as AudioBookmark[],
          scope: isProgressScope(progress?.scope) ? progress.scope : 'book',
        })

        const el = new Audio()
        el.preload = 'metadata'
        audio = el
        const rate = clampPlaybackRate(progress?.playbackRate ?? 1)
        // The load algorithm resets playbackRate to defaultPlaybackRate, so set both.
        el.defaultPlaybackRate = rate
        el.playbackRate = rate
        el.volume = get().volume
        set({ playbackRate: rate })

        let restored = false
        const syncDuration = () => {
          set({ durationSeconds: knownDuration(el.duration) })
          revalidateChapters()
        }
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
          on('timeupdate', () => {
            set({ positionSeconds: el.currentTime })
            // "Stop at the end of this chapter": the boundary was fixed when the timer was set.
            if (sleepChapterEnd !== null && el.currentTime >= sleepChapterEnd - 0.3) {
              clearSleep()
              el.pause()
            }
          }),
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
            clearSleep()
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

    seekScoped: (relativeSeconds) => {
      const el = audio
      if (!el || get().status !== 'ready') return
      const { scope, chapters, positionSeconds } = get()
      const view = timelineView(scope, positionSeconds, el.duration, chapters)
      if (!view) return
      get().seekTo(absoluteFromScoped(view, relativeSeconds))
    },

    skipBy: (delta) => {
      const el = audio
      if (!el) return
      get().seekTo(el.currentTime + delta)
    },

    setRate: (rate) => {
      if (audio) audio.playbackRate = clampPlaybackRate(rate)
    },

    setVolume: (volume) => {
      const v = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1
      if (audio) audio.volume = v
      set({ volume: v })
      writeVolume(v)
    },

    setScope: (scope) => {
      if (!isProgressScope(scope) || scope === get().scope) return
      // Display only: the audio is not touched.
      set({ scope })
      void persist(true)
    },

    previousChapter: () => {
      const el = audio
      if (!el || get().chapterStatus !== 'ok') return
      const target = previousChapterTarget(get().chapters, el.currentTime)
      if (target !== null) get().seekTo(target)
    },

    nextChapter: () => {
      const el = audio
      if (!el || get().chapterStatus !== 'ok') return
      const target = nextChapterTarget(get().chapters, el.currentTime)
      if (target !== null) get().seekTo(target)
    },

    goToChapter: (chapterId) => {
      if (get().chapterStatus !== 'ok') return
      const target = chapterStart(get().chapters, chapterId)
      if (target !== null) get().seekTo(target)
    },

    addNote: (note) => {
      const el = audio
      const { bookId } = get()
      if (!el || !bookId || get().status !== 'ready') return null
      const created = createAudioBookmark({
        id: newId(),
        positionSeconds: clampSeekPosition(el.currentTime, el.duration),
        chapters: get().chapterStatus === 'ok' ? get().chapters : [],
        nowIso: new Date().toISOString(),
        note,
      })
      const next = [...get().notes, created].sort((x, y) => x.positionSeconds - y.positionSeconds)
      set({ notes: next })
      saveBookmarks(bookId, next)
      return created.id
    },

    updateNote: (noteId, note) => {
      const { bookId, notes } = get()
      if (!bookId || !notes.some((n) => n.id === noteId)) return
      const next = updateAudioBookmarkNote(notes, noteId, note)
      set({ notes: next })
      saveBookmarks(bookId, next)
    },

    removeNote: (noteId) => {
      const { bookId, notes } = get()
      if (!bookId) return
      const next = notes.filter((n) => n.id !== noteId)
      if (next.length === notes.length) return
      set({ notes: next })
      saveBookmarks(bookId, next)
    },

    goToNote: (noteId) => {
      const el = audio
      if (!el) return
      const found = get().notes.find((n) => n.id === noteId)
      if (!found) return
      get().seekTo(resolveBookmarkTarget(found, get().chapterStatus === 'ok' ? get().chapters : [], el.duration))
    },

    setSleep: (option) => {
      clearSleep()
      if (option.kind === 'minutes') {
        const minutes = Math.min(600, Math.max(1, Math.round(option.minutes)))
        const endsAt = Date.now() + minutes * 60_000
        sleepTimeout = setTimeout(() => {
          sleepTimeout = null
          clearSleep()
          audio?.pause()
        }, minutes * 60_000)
        set({ sleep: { kind: 'minutes', minutes }, sleepEndsAt: endsAt })
      } else if (option.kind === 'chapter') {
        const el = audio
        const { chapters, chapterStatus } = get()
        const i = el && chapterStatus === 'ok' ? chapterIndexAt(chapters, el.currentTime) : -1
        if (i < 0) return // no chapter to stop at: the control is disabled in that case
        sleepChapterEnd = (chapters[i] as AudioChapter).endSeconds
        set({ sleep: { kind: 'chapter' }, sleepEndsAt: null })
      }
    },

    dispose: async () => {
      if (!audio && get().status === 'idle') return
      await persist(true)
      await bookmarkChain
      teardown()
      set({ ...INITIAL, volume: get().volume })
    },
  }
})

import { create } from 'zustand'
import {
  absoluteFromScoped,
  canAddAnotherNote,
  chapterIndexAt,
  chapterStart,
  clampPlaybackRate,
  clampSeekPosition,
  createAudioBookmark,
  isProgressScope,
  knownDuration,
  MAX_AUDIO_BOOKMARKS,
  nextChapterTarget,
  normalizeChapters,
  orderTrackNotes,
  previousChapterTarget,
  nextTrackIndex,
  previousTrackAction,
  resolveBookmarkTarget,
  resolveInitialTrack,
  updateAudioBookmarkNote,
  resolveRestorePosition,
  shouldPersistProgress,
  timelineView,
  trackNoteJumpTarget,
  type AudioBookmark,
  type AudioChapter,
  type AudioTrack,
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
 *
 * MULTI-TRACK audiobooks (chapters picked from a ZIP; `tracks.length > 0`) play ONE track at a time, and every position here
 * is seconds WITHIN the current track (no whole-book timeline, no totals, no percent). Each track gets its OWN `Audio`
 * element: the previous one is retired (listeners removed, source released) and every handler drops events whose element is no
 * longer the current one, so a late `loadedmetadata` / `error` / `ended` of an old track can never touch the current one.
 * `switching` (a track change in flight) is deliberately separate from the screen-level `status`, which stays `ready` — the
 * screen blanks to "opening…" whenever `status` is `loading`. Single-file audiobooks never enter this mode.
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
  /** Multi-track audiobooks: the tracks in playback order (`[]` for a single-file audiobook). */
  tracks: AudioTrack[]
  /** Index of the current track in `tracks`; `-1` for a single-file audiobook. */
  trackIndex: number
  /** A track change is in flight (never the screen-level `status`). No progress is written while it is. */
  switching: boolean
  /** Ids of tracks that could not be played; the other tracks keep working. */
  trackErrors: ReadonlySet<string>
  /** Multi-track: the Notes could not be read, so they are neither shown as empty nor editable (an unread list must never overwrite the stored one). */
  notesUnavailable: boolean
  /** A message about the last Note action (limit reached, save refused, jump failed); `null` when there is none. */
  noteNotice: string | null
  /**
   * Multi-track: the Note most recently added by `addNote` (a NEW object on every add; `null` after `load` and for single-file
   * audiobooks). Only a signal for the grouped Notes tab, which opens that Note's track row; nothing else sets it.
   */
  lastAddedNote: { id: string; trackId: string } | null
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
  /**
   * Multi-track: play another track from its start, keeping the play state (playing stays playing, paused stays paused).
   * The current track is a no-op (unless it failed, then it is retried). The old track's position is saved first.
   */
  goToTrack: (index: number) => void
  /** Mark the current position; returns the new note's id (so the UI can offer to type its text). */
  addNote: (note?: string) => string | null
  /** Change the text of an existing note in place (never creates another). */
  updateNote: (noteId: string, note: string) => void
  removeNote: (noteId: string) => void
  goToNote: (noteId: string) => void
  /**
   * Go to an exact position: `seconds` inside track `trackId` of a multi-track audiobook, or on the one timeline of a single-file
   * one (`trackId` is ignored there). Same rules as a Note jump (keeps the play state, falls back to the origin track, paused,
   * when the target cannot be played). Used by the transcript's "play from here".
   */
  goToPosition: (trackId: string | undefined, seconds: number) => void
  dismissNoteNotice: () => void
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
  tracks: [] as AudioTrack[],
  trackIndex: -1,
  switching: false,
  trackErrors: new Set<string>() as ReadonlySet<string>,
  notesUnavailable: false,
  noteNotice: null as string | null,
  lastAddedNote: null as { id: string; trackId: string } | null,
}

/** `rb-audio://local/{bookId}` (a single-file audiobook) or `…/{bookId}/{trackId}` (one track of a multi-track one). */
export function audioStreamUrl(bookId: string, trackId?: string): string {
  const base = `rb-audio://local/${encodeURIComponent(bookId)}`
  return trackId === undefined ? base : `${base}/${encodeURIComponent(trackId)}`
}

/**
 * Whether a Note can be added right now. Single-file: the player is ready (as before). Multi-track: there must also be a real
 * current position (no track change in flight, the current track has not failed) and the Notes must have been read.
 * The cap is NOT part of this: at the limit the control stays usable so that the user is told why nothing was added.
 */
export function selectCanAddNote(
  s: Pick<AudioPlayerState, 'status' | 'tracks' | 'trackIndex' | 'switching' | 'trackErrors' | 'notesUnavailable'>,
): boolean {
  if (s.status !== 'ready') return false
  if (s.tracks.length === 0) return true
  const track = s.tracks[s.trackIndex]
  return !s.switching && !!track && !s.trackErrors.has(track.id) && !s.notesUnavailable
}

const NOTE_LIMIT_NOTICE = `An audiobook can hold up to ${MAX_AUDIO_BOOKMARKS} Notes. Delete one to add another.`
const NOTE_SAVE_NOTICE = 'Your Notes could not be saved, so the list was reloaded from your library.'

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
/** Bumped on every track switch (and on teardown): guards the asynchronous continuations that are not element events. */
let trackSwitch = 0
/**
 * The Note jump that is still waiting for its target track, bound to the `trackSwitch` token it started. If the target fails
 * while this is still the latest switch, the player goes back to the origin (the track and second it was on). Every other
 * `openTrack` replaces or clears it, and the target's `loadedmetadata` clears it (a finished jump never rolls back).
 */
let pendingJump: { token: number; originIndex: number; originSeconds: number } | null = null
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
    // Multi-track: nothing is written while a track change is in flight, nor for a track that failed (its position is
    // meaningless); the last good progress stays as it was.
    const { tracks, trackIndex, switching, trackErrors } = get()
    const track = tracks.length > 0 ? tracks[trackIndex] : undefined
    if (tracks.length > 0 && (switching || !track || trackErrors.has(track.id))) return saveChain
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
    // `trackId` and `position` are read in the same synchronous step from the same (current) element, so the position of
    // one track can never be written with the id of another. A track-relative save carries no duration / chapter id.
    const input = track
      ? { bookId, positionSeconds: position, playbackRate: el.playbackRate, scope: get().scope, trackId: track.id }
      : {
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

  /** Multi-track only: put the Notes back as Main has them (after a refused or failed save) and tell the user. */
  const reloadNotes = async (bookId: string) => {
    try {
      const list = await audioApi.getBookmarks(bookId)
      if (get().bookId === bookId) set({ notes: orderTrackNotes(list as AudioBookmark[], get().tracks), noteNotice: NOTE_SAVE_NOTICE })
    } catch {
      if (get().bookId === bookId) set({ notesUnavailable: true, noteNotice: NOTE_SAVE_NOTICE })
    }
  }

  const saveBookmarks = (bookId: string, bookmarks: AudioBookmark[]) => {
    if (get().tracks.length > 0) {
      // Multi-track: Main can refuse a list (ownership, size), so the result is inspected.
      bookmarkChain = bookmarkChain
        .then(async () => {
          const result = await audioApi.saveBookmarks({ bookId, bookmarks })
          if (result?.ok === false) await reloadNotes(bookId)
        })
        .catch(() => reloadNotes(bookId))
      return
    }
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
    trackSwitch += 1
    pendingJump = null
  }

  const fail = (code: string, message: string) => {
    stopSaveTimer()
    set({ status: 'error', errorCode: code, errorMessage: message, playing: false, buffering: false })
  }

  // ---- multi-track ----

  /** Release the current element: listeners off FIRST (so nothing it still emits is handled), then stop and free the stream. */
  const retireElement = () => {
    stopSaveTimer()
    detachListeners?.()
    detachListeners = null
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audio = null
    }
  }

  /**
   * The current track cannot be played. Only that track is marked: the screen-level `status` stays `ready` (so the player
   * and the track list stay on screen), nothing is saved for it, and any other track can be chosen right away.
   */
  const trackFailed = (el: HTMLAudioElement) => {
    if (el !== audio) return
    el.pause()
    const { tracks, trackIndex, trackErrors } = get()
    const track = tracks[trackIndex]
    set({
      status: 'ready',
      switching: false,
      playing: false,
      buffering: false,
      trackErrors: track ? new Set([...trackErrors, track.id]) : trackErrors,
    })
    stopSaveTimer()
    // A failed Note jump goes back to where it started, but only if this is still the switch that jump started. Any newer
    // switch has already replaced `audio` and bumped `trackSwitch` (so this call would not have got this far) and has also
    // replaced or cleared `pendingJump`. The fallback is an ordinary `openTrack` with no jump of its own: if the origin fails
    // too, nothing is pending and the usual error state for that track stays (no second fallback, no loop).
    const jump = pendingJump
    pendingJump = null
    if (jump && jump.token === trackSwitch && track) {
      const origin = get().tracks[jump.originIndex]
      openTrack(jump.originIndex, jump.originSeconds, false, false, { exact: true })
      set({
        noteNotice: origin
          ? `“${track.title}” could not be played. You are back on “${origin.title}”.`
          : `“${track.title}” could not be played.`,
      })
    }
  }

  /**
   * Make track `index` the current one on a brand-new element. Everything the previous element may still emit is dropped:
   * its listeners are removed, and each handler below also checks `el === audio` and the switch token.
   */
  const openTrack = (
    index: number,
    startSeconds: number,
    autoplay: boolean,
    saveOnReady = false,
    options: { exact?: boolean; origin?: { index: number; seconds: number } | null } = {},
  ) => {
    const { bookId, tracks, trackErrors } = get()
    const track = tracks[index]
    if (!bookId || !track) return
    retireElement()
    // "Stop at the end of this track" belongs to the track it was set on; a different track starts without it.
    if (get().sleep.kind === 'chapter') clearSleep()
    const token = ++trackSwitch
    // Only a Note jump with a settled origin keeps a fallback; every other way of opening a track drops any older one.
    pendingJump = options.origin ? { token, originIndex: options.origin.index, originSeconds: options.origin.seconds } : null
    lastSaved = null // the new track's first timer-save must not be judged against the old track's position
    const el = new Audio()
    el.preload = 'metadata'
    audio = el
    const rate = clampPlaybackRate(get().playbackRate)
    el.defaultPlaybackRate = rate
    el.playbackRate = rate
    el.volume = get().volume
    const retry = new Set(trackErrors)
    retry.delete(track.id)
    // `trackIndex`, `switching` and the new element are replaced in ONE synchronous step; `status` is not touched.
    set({
      trackIndex: index,
      switching: true,
      trackErrors: retry,
      positionSeconds: 0,
      durationSeconds: track.durationSeconds,
      ended: false,
      buffering: true,
      playing: autoplay,
      noteNotice: null,
    })

    const current = () => el === audio && token === trackSwitch
    const on = <K extends keyof HTMLMediaElementEventMap>(type: K, fn: () => void) => {
      const guarded = () => {
        if (current()) fn()
      }
      el.addEventListener(type, guarded)
      return () => el.removeEventListener(type, guarded)
    }
    let started = false
    const offs = [
      on('loadedmetadata', () => {
        const duration = knownDuration(el.duration)
        const { tracks: all } = get()
        set({
          durationSeconds: duration,
          // A duration learned here is kept in memory only (the list shows it); it is not written back in this release.
          tracks: all.map((t, i) => (i === index && t.durationSeconds === null && duration !== null ? { ...t, durationSeconds: duration } : t)),
        })
        if (!started) {
          started = true
          // A Note jump lands on the exact second (clamped into the track); resuming keeps the "restart a finished track" rule.
          const start = options.exact
            ? clampSeekPosition(startSeconds, el.duration)
            : startSeconds > 0
              ? resolveRestorePosition(startSeconds, el.duration)
              : 0
          if (start > 0) el.currentTime = start
          set({ positionSeconds: start })
        }
        // The target loaded: the jump has succeeded and can no longer fall back.
        if (pendingJump?.token === token) pendingJump = null
        set({ status: 'ready', switching: false, buffering: false })
        // After an automatic advance the new track is what must be remembered (not the end of the one just finished).
        if (saveOnReady) void persist(true)
        if (autoplay) get().play()
      }),
      on('durationchange', () => set({ durationSeconds: knownDuration(el.duration) })),
      on('timeupdate', () => {
        set({ positionSeconds: el.currentTime })
        if (sleepChapterEnd !== null && el.currentTime >= sleepChapterEnd - 0.3) {
          clearSleep()
          el.pause()
        }
      }),
      on('seeked', () => {
        set({ positionSeconds: el.currentTime, buffering: false, ended: el.ended })
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
        const { tracks: all, trackIndex: at } = get()
        const next = nextTrackIndex(at, all.length)
        if (next !== null) {
          // Auto-advance: straight on to the next track, playing. A running minutes timer keeps counting; the finished
          // track's end position is not saved (the next track is, as soon as it is ready). If the next track cannot be
          // opened it is marked and playback stops there — it never skips on to a third track by itself.
          stopSaveTimer()
          openTrack(next, 0, true, true)
          return
        }
        // The last track: stop, exactly like the end of a single-file audiobook.
        set({ playing: false, ended: true, positionSeconds: el.currentTime })
        stopSaveTimer()
        clearSleep()
        void persist(true)
      }),
      on('error', () => trackFailed(el)),
    ]
    detachListeners = () => offs.forEach((off) => off())
    el.src = audioStreamUrl(bookId, track.id)
  }

  /**
   * Multi-track: go to `target.index` at the exact second (clamp only — never `resolveRestorePosition`). Shared by a Note jump and by
   * the transcript's "play from here", so both behave the same: on the current, healthy track only the position moves; another
   * track is opened on a new element keeping the play state, and if it cannot be played the player returns to where it was (paused).
   */
  const jumpToTarget = (target: { index: number; seconds: number }): void => {
    const el = audio
    const state = get()
    const current = state.tracks[state.trackIndex]
    const settled = !!el && !!current && !state.switching && !state.trackErrors.has(current.id)
    // On the current, healthy track: only the position moves (no reload, no restart).
    if (settled && target.index === state.trackIndex) {
      set({ noteNotice: null })
      get().seekTo(target.seconds)
      return
    }
    const wasPlaying = state.playing
    // Where to come back to if the target cannot be played: only from a settled state; a jump that starts while another
    // jump is still loading inherits that jump's origin (the in-flight track never played). Otherwise there is none.
    const inherited = pendingJump && pendingJump.token === trackSwitch ? { index: pendingJump.originIndex, seconds: pendingJump.originSeconds } : null
    const origin = settled && el ? { index: state.trackIndex, seconds: el.currentTime } : inherited
    // 1. Save the OLD track first (a no-op while a switch is in flight or the track failed), 2. then open the target.
    void persist(true)
    openTrack(target.index, target.seconds, wasPlaying, true, { exact: true, origin })
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
        const [book, opened, progress, tracksResult] = await Promise.all([
          libraryApi.getBook(bookId),
          libraryApi.openBookContent(bookId),
          overlayApi.getAudioProgress(bookId),
          audioApi.getTracks(bookId).catch(() => ({ ok: false, tracks: [] as AudioTrack[] })),
        ])
        if (myGeneration !== generation) return
        if (!book) return fail('not_found', 'This book is no longer in your library.')
        if (!opened.ok) {
          return fail(opened.errorCode ?? 'read_failed', opened.errorMessage ?? 'Could not open this audio file.')
        }

        // ---- multi-track audiobook: one element per track (see the header comment). Nothing below this block runs for it.
        const loadedTracks = tracksResult.ok ? tracksResult.tracks : []
        if (loadedTracks.length > 0) {
          const initial = resolveInitialTrack(loadedTracks, progress)
          rawChapters = []
          const rate = clampPlaybackRate(progress?.playbackRate ?? 1)
          const trackList = loadedTracks.map((t) => ({ id: t.id, title: t.title, durationSeconds: t.durationSeconds }))
          // Notes are read once the tracks are known (they are ordered by track). A read that FAILS is not an empty list: the
          // Notes stay unavailable, so a later save can never replace the stored Notes with an unread (empty) one.
          let trackNotes: AudioBookmark[] = []
          let notesUnavailable = false
          try {
            trackNotes = orderTrackNotes((await audioApi.getBookmarks(bookId)) as AudioBookmark[], trackList)
          } catch {
            notesUnavailable = true
          }
          if (myGeneration !== generation) return
          set({
            title: book.title,
            author: book.author,
            coverUrl: book.coverUrl,
            notes: trackNotes,
            notesUnavailable,
            tracks: trackList,
            playbackRate: rate,
          })
          unregisterFlush = registerSessionFlushHandler(async () => {
            await persist(true)
          })
          openTrack(initial.index, initial.startSeconds, false)
          return
        }

        const [chaptersResult, bookmarks] = await Promise.all([
          audioApi.getChapters(bookId).catch(() => ({ ok: false, chapters: [] })),
          audioApi.getBookmarks(bookId).catch(() => []),
        ])
        if (myGeneration !== generation) return
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
        if (el !== audio) return // a retired element's pending play(): not about the current track
        if (get().tracks.length > 0) return trackFailed(el)
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
      // Multi-track: "previous" restarts the track when more than 3 s in (or on the first track), otherwise goes back one track.
      if (get().tracks.length > 0) {
        if (!el || get().status !== 'ready') return
        const { trackIndex } = get()
        if (previousTrackAction(trackIndex, el.currentTime) === 'restart') get().seekTo(0)
        else get().goToTrack(trackIndex - 1)
        return
      }
      if (!el || get().chapterStatus !== 'ok') return
      const target = previousChapterTarget(get().chapters, el.currentTime)
      if (target !== null) get().seekTo(target)
    },

    nextChapter: () => {
      const el = audio
      // Multi-track: the next track (a no-op after the last one). The play state is kept, like clicking a track.
      if (get().tracks.length > 0) {
        const { tracks, trackIndex } = get()
        const next = nextTrackIndex(trackIndex, tracks.length)
        if (next !== null) get().goToTrack(next)
        return
      }
      if (!el || get().chapterStatus !== 'ok') return
      const target = nextChapterTarget(get().chapters, el.currentTime)
      if (target !== null) get().seekTo(target)
    },

    goToChapter: (chapterId) => {
      if (get().chapterStatus !== 'ok') return
      const target = chapterStart(get().chapters, chapterId)
      if (target !== null) get().seekTo(target)
    },

    goToTrack: (index) => {
      const { tracks, trackIndex, trackErrors, status } = get()
      if (status !== 'ready' || tracks.length === 0 || !Number.isInteger(index) || index < 0 || index >= tracks.length) return
      const target = tracks[index] as AudioTrack
      // The track that is already current: nothing to do (no restart, no seek, no save) — except to retry one that failed.
      if (index === trackIndex && !trackErrors.has(target.id)) return
      const wasPlaying = get().playing
      // 1. Save the OLD track first: this builds its payload synchronously from the old element and the old `trackIndex`.
      void persist(true)
      // 2. Then replace the element. A switch that is still in flight (rapid clicks) has nothing to save: `persist` skips it.
      openTrack(index, 0, wasPlaying)
    },

    addNote: (note) => {
      const el = audio
      const { bookId } = get()
      if (get().tracks.length > 0) {
        // Multi-track: a Note belongs to the CURRENT track at the CURRENT second inside it — read in this one synchronous step.
        const state = get()
        const track = state.tracks[state.trackIndex]
        if (!el || !bookId || !track || !selectCanAddNote(state)) return null
        if (!canAddAnotherNote(state.notes.length)) {
          set({ noteNotice: NOTE_LIMIT_NOTICE })
          return null
        }
        const created = createAudioBookmark({
          id: newId(),
          positionSeconds: clampSeekPosition(el.currentTime, el.duration),
          chapters: [],
          nowIso: new Date().toISOString(),
          note,
          trackId: track.id,
          trackNumber: state.trackIndex + 1,
        })
        const ordered = orderTrackNotes([...state.notes, created], state.tracks)
        set({ notes: ordered, noteNotice: null, lastAddedNote: { id: created.id, trackId: track.id } })
        saveBookmarks(bookId, ordered)
        return created.id
      }
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
      const { bookId, notes, notesUnavailable } = get()
      if (!bookId || notesUnavailable || !notes.some((n) => n.id === noteId)) return
      const next = updateAudioBookmarkNote(notes, noteId, note)
      set({ notes: next })
      saveBookmarks(bookId, next)
    },

    removeNote: (noteId) => {
      const { bookId, notes, notesUnavailable } = get()
      if (!bookId || notesUnavailable) return
      const next = notes.filter((n) => n.id !== noteId)
      if (next.length === notes.length) return
      set({ notes: next })
      saveBookmarks(bookId, next)
    },

    goToNote: (noteId) => {
      const el = audio
      if (get().tracks.length > 0) {
        // Multi-track: go to the Note's track and exact second.
        const state = get()
        const note = state.notes.find((n) => n.id === noteId)
        if (!note || state.status !== 'ready') return
        const target = trackNoteJumpTarget(note, state.tracks)
        if (!target) return
        jumpToTarget(target)
        return
      }
      if (!el) return
      const found = get().notes.find((n) => n.id === noteId)
      if (!found) return
      get().seekTo(resolveBookmarkTarget(found, get().chapterStatus === 'ok' ? get().chapters : [], el.duration))
    },

    goToPosition: (trackId, seconds) => {
      const state = get()
      if (state.status !== 'ready' || !Number.isFinite(seconds)) return
      // Single-file audiobook: one timeline, the position just moves.
      if (state.tracks.length === 0) {
        get().seekTo(seconds)
        return
      }
      const index = trackId === undefined ? -1 : state.tracks.findIndex((t) => t.id === trackId)
      if (index < 0) return
      jumpToTarget({ index, seconds: Math.max(0, seconds) })
    },

    dismissNoteNotice: () => {
      if (get().noteNotice !== null) set({ noteNotice: null })
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
        // Multi-track: "end of chapter" = the end of the current TRACK (its element duration is known once it loaded).
        if (get().tracks.length > 0) {
          const end = el && get().status === 'ready' && !get().switching ? knownDuration(el.duration) : null
          if (end === null) return
          sleepChapterEnd = end
          set({ sleep: { kind: 'chapter' }, sleepEndsAt: null })
          return
        }
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

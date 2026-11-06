import { create } from 'zustand'
import { findActivePassageIndex } from '@reading-book/book-reader-sdk'
import { useAudioPlayerStore } from './audioPlayerStore'
import {
  transcriptionApi,
  type TranscriptPassage,
  type TranscriptSearchHit,
  type TranscriptionInfo,
  type TranscriptionJob,
  type TranscriptionScope,
} from '../../../bridge'

/**
 * Renderer state of one audiobook's transcript (spec 004, US1): the summary and models, the running job, the passages read so
 * far, and the actions (start / cancel / delete / download a model). Main owns the truth; this store only mirrors it through
 * `transcription:*`. It follows one book at a time (`bind`); answers that arrive for a book the person has already left are
 * dropped. A read that fails leaves the part "unavailable" and keeps what was loaded — an unreadable list is never turned
 * into an empty one that looks like "no transcript".
 */

/** The most passages one read returns (the contract's maximum); a longer transcript shows a notice. */
export const PASSAGE_FETCH_LIMIT = 2000
/** A search needs at least this many characters (one letter would match half the transcript). */
export const SEARCH_MIN_LENGTH = 2
/** Hits asked for per search (the panel says when there may be more). */
export const SEARCH_HIT_LIMIT = 100

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'unavailable'
export type ActiveJobState = 'queued' | 'preparing' | 'running'

export interface TranscriptActionError {
  code: string
  message: string
}

export interface TranscriptStartInput {
  scope: TranscriptionScope
  language: string
  modelId: string
  replace?: boolean
}

interface TranscriptState {
  bookId: string | null
  infoStatus: LoadStatus
  info: TranscriptionInfo | null
  job: TranscriptionJob | null
  passagesStatus: LoadStatus
  passages: TranscriptPassage[]
  /** The transcript has more passages than one read returns. */
  passagesTruncated: boolean
  actionError: TranscriptActionError | null
  dialogOpen: boolean
  /** A model download in flight (progress from `transcription:modelProgress`). */
  downloading: { modelId: string; loadedBytes: number; totalBytes: number } | null
  /**
   * The passage being spoken at the player's position (id), or null. Derived from `audioPlayerStore` (current track + position)
   * with a binary search over the loaded passages — nothing polls the DOM, and the player is only ever read, never written.
   */
  activePassageId: number | null
  /** The text in the search box (kept as typed). */
  searchQuery: string
  /** `idle` = nothing searched (box empty or shorter than SEARCH_MIN_LENGTH); `unavailable` = the last search could not run. */
  searchStatus: 'idle' | 'searching' | 'ready' | 'unavailable'
  searchHits: TranscriptSearchHit[]
  /** An export is waiting for the save dialog / being written. */
  exporting: boolean
  /** The last export finished and was saved (cleared when the next one starts). */
  exportSaved: boolean

  /** Follow `bookId`: subscribe to Main's events and read its transcript. Safe to call again for the same book. */
  bind: (bookId: string, appLanguage?: string) => void
  /** Stop following (unsubscribe, forget the book). */
  unbind: () => void
  refresh: () => Promise<void>
  /** Read the next page of a long transcript (nothing when everything is already shown or a read is running). */
  loadMore: () => Promise<void>
  start: (input: TranscriptStartInput) => Promise<boolean>
  cancel: () => Promise<void>
  remove: () => Promise<boolean>
  downloadModel: (modelId: string) => Promise<boolean>
  /** Search the transcript; a late answer of an earlier query is dropped, a failed search keeps the earlier hits. */
  search: (query: string) => Promise<void>
  clearSearch: () => void
  /** Export as plain text through Main's save dialog (the renderer never sees the path). Resolves true when it was saved. */
  exportTranscript: (options?: { timestamps?: boolean }) => Promise<boolean>
  /** Play from a passage: the player goes to its track (multi-track) and exact second, keeping its play / pause state. */
  seekToPassage: (passage: Pick<TranscriptPassage, 'trackId' | 'startMs'>) => void
  openDialog: () => void
  closeDialog: () => void
  clearError: () => void
}

const ACTIVE_STATES: readonly string[] = ['queued', 'preparing', 'running']
export const isActiveJob = (job: TranscriptionJob | null): job is TranscriptionJob & { state: ActiveJobState } => !!job && ACTIVE_STATES.includes(job.state)

// One bind at a time. `token` changes on every bind / unbind, so a late answer can tell it is stale.
let token = 0
let unsubscribers: Array<() => void> = []
let appLanguageHint: string | undefined
let passagesInFlight = false
let passagesAgain = false
/** Every search / clear / bind bumps it, so a late answer of an earlier search can tell it is stale. */
let searchSeq = 0

function unsubscribeAll(): void {
  for (const off of unsubscribers) {
    try {
      off()
    } catch {
      /* already gone */
    }
  }
  unsubscribers = []
}

/**
 * The passage spoken at the player's position: the last passage of the CURRENT track that starts at or before it (binary search,
 * see `findActivePassageIndex`). Single-file audiobook: one timeline. When only the first pages of a long transcript are loaded,
 * a position beyond the last loaded passage is "unknown", not that passage.
 */
function activePassageIdFor(passages: readonly TranscriptPassage[], truncated: boolean): number | null {
  if (passages.length === 0) return null
  const player = useAudioPlayerStore.getState()
  const multiTrack = player.tracks.length > 0
  const trackId = multiTrack ? player.tracks[player.trackIndex]?.id : undefined
  if (multiTrack && trackId === undefined) return null
  const ms = Math.floor(player.positionSeconds * 1000)
  const index = findActivePassageIndex(passages, { trackId, ms }, multiTrack ? player.tracks.map((t) => t.id) : undefined)
  if (index < 0) return null
  const found = passages[index] as TranscriptPassage
  if (truncated && index === passages.length - 1 && ms >= found.endMs) return null
  return found.id
}

export const useTranscriptStore = create<TranscriptState>((set, get, api) => {
  const current = (forToken: number, bookId: string): boolean => token === forToken && get().bookId === bookId

  /** Recompute which passage is active (cheap: one binary search); only a CHANGE updates the store. */
  const refreshActive = (): void => {
    const next = activePassageIdFor(get().passages, get().passagesTruncated)
    if (next !== get().activePassageId) set({ activePassageId: next })
  }

  async function loadInfo(forToken: number, bookId: string): Promise<void> {
    try {
      const info = await transcriptionApi.getInfo(bookId, appLanguageHint)
      if (!current(forToken, bookId)) return
      set({ info, infoStatus: 'ready', job: isActiveJob(info.job) ? info.job : null })
    } catch {
      if (current(forToken, bookId)) set({ infoStatus: 'unavailable' })
    }
  }

  async function loadPassages(forToken: number, bookId: string): Promise<void> {
    // Coalesce: while a read is running, further requests become ONE more read afterwards.
    if (passagesInFlight) {
      passagesAgain = true
      return
    }
    passagesInFlight = true
    try {
      do {
        passagesAgain = false
        if (get().passagesStatus === 'idle') set({ passagesStatus: 'loading' })
        try {
          // Re-read at least as many passages as are already shown (several pages for a long transcript), so a refresh
          // during a running job never shrinks the list the person has scrolled through.
          const wanted = Math.max(PASSAGE_FETCH_LIMIT, get().passages.length)
          const passages: TranscriptPassage[] = []
          let more = false
          while (passages.length < wanted) {
            const page = await transcriptionApi.getPassages({ bookId, limit: PASSAGE_FETCH_LIMIT, offset: passages.length })
            passages.push(...page)
            more = page.length >= PASSAGE_FETCH_LIMIT
            if (!more) break
          }
          if (!current(forToken, bookId)) return
          set({ passages, passagesStatus: 'ready', passagesTruncated: more })
        } catch {
          // Keep the passages already shown; only say they could not be refreshed.
          if (current(forToken, bookId)) set({ passagesStatus: 'unavailable' })
        }
      } while (passagesAgain && current(forToken, bookId))
    } finally {
      passagesInFlight = false
    }
  }

  const onJob = (forToken: number, bookId: string) => (job: TranscriptionJob): void => {
    if (!current(forToken, bookId) || job.bookId !== bookId) return
    if (isActiveJob(job)) {
      set({ job })
      return
    }
    // done / failed / cancelled: the job is over; the transcript summary carries the outcome.
    set({ job: null })
    void loadInfo(forToken, bookId)
    void loadPassages(forToken, bookId)
  }

  return {
    bookId: null,
    infoStatus: 'idle',
    info: null,
    job: null,
    passagesStatus: 'idle',
    passages: [],
    passagesTruncated: false,
    actionError: null,
    dialogOpen: false,
    downloading: null,
    activePassageId: null,
    searchQuery: '',
    searchStatus: 'idle',
    searchHits: [],
    exporting: false,
    exportSaved: false,

    bind: (bookId, appLanguage) => {
      if (get().bookId === bookId && unsubscribers.length > 0) {
        appLanguageHint = appLanguage ?? appLanguageHint
        return
      }
      unsubscribeAll()
      token += 1
      const forToken = token
      appLanguageHint = appLanguage
      passagesInFlight = false
      passagesAgain = false
      set({
        bookId,
        infoStatus: 'loading',
        info: null,
        job: null,
        passagesStatus: 'idle',
        passages: [],
        passagesTruncated: false,
        actionError: null,
        dialogOpen: false,
        downloading: null,
        activePassageId: null,
        searchQuery: '',
        searchStatus: 'idle',
        searchHits: [],
        exporting: false,
        exportSaved: false,
      })
      searchSeq += 1
      unsubscribers = [
        // The active passage follows the player (position / track) and the loaded passages — no timer, no DOM.
        useAudioPlayerStore.subscribe((state, previous) => {
          if (state.positionSeconds !== previous.positionSeconds || state.trackIndex !== previous.trackIndex || state.tracks !== previous.tracks) refreshActive()
        }),
        api.subscribe((state, previous) => {
          if (state.passages !== previous.passages || state.passagesTruncated !== previous.passagesTruncated) refreshActive()
        }),
        transcriptionApi.onProgress(onJob(forToken, bookId)),
        transcriptionApi.onPassagesAdded((added) => {
          if (current(forToken, bookId) && added.bookId === bookId) void loadPassages(forToken, bookId)
        }),
        transcriptionApi.onModelProgress((progress) => {
          if (!current(forToken, bookId)) return
          set({ downloading: { modelId: progress.modelId, loadedBytes: progress.loadedBytes, totalBytes: progress.totalBytes } })
        }),
      ]
      void loadInfo(forToken, bookId)
      void loadPassages(forToken, bookId)
    },

    unbind: () => {
      unsubscribeAll()
      token += 1
      passagesInFlight = false
      passagesAgain = false
      set({
        bookId: null,
        infoStatus: 'idle',
        info: null,
        job: null,
        passagesStatus: 'idle',
        passages: [],
        passagesTruncated: false,
        actionError: null,
        dialogOpen: false,
        downloading: null,
        activePassageId: null,
        searchQuery: '',
        searchStatus: 'idle',
        searchHits: [],
        exporting: false,
        exportSaved: false,
      })
      searchSeq += 1
    },

    refresh: async () => {
      const bookId = get().bookId
      if (!bookId) return
      const forToken = token
      await Promise.all([loadInfo(forToken, bookId), loadPassages(forToken, bookId)])
    },

    loadMore: async () => {
      const { bookId, passagesTruncated, passages: shown } = get()
      if (!bookId || !passagesTruncated || passagesInFlight) return
      const forToken = token
      passagesInFlight = true
      try {
        const page = await transcriptionApi.getPassages({ bookId, limit: PASSAGE_FETCH_LIMIT, offset: shown.length })
        if (!current(forToken, bookId)) return
        // Page boundaries are stable (playback order), but a refresh may have added passages meanwhile: never show one twice.
        const seen = new Set(get().passages.map((p) => p.id))
        set({ passages: [...get().passages, ...page.filter((p) => !seen.has(p.id))], passagesTruncated: page.length >= PASSAGE_FETCH_LIMIT, passagesStatus: 'ready' })
      } catch {
        if (current(forToken, bookId)) set({ passagesStatus: 'unavailable' })
      } finally {
        passagesInFlight = false
      }
    },

    start: async (input) => {
      const bookId = get().bookId
      if (!bookId) return false
      const forToken = token
      set({ actionError: null })
      try {
        const result = await transcriptionApi.start({ bookId, scope: input.scope, language: input.language, modelId: input.modelId, replace: input.replace })
        if (!current(forToken, bookId)) return result.ok
        if (!result.ok) {
          set({ actionError: { code: result.errorCode, message: result.errorMessage } })
          return false
        }
        // The job's own snapshots arrive as events; read the summary now so the panel changes at once.
        await loadInfo(forToken, bookId)
        if (input.replace) void loadPassages(forToken, bookId)
        return true
      } catch (error) {
        if (current(forToken, bookId)) set({ actionError: { code: 'DECODE_FAILED', message: error instanceof Error ? error.message : String(error) } })
        return false
      }
    },

    cancel: async () => {
      const job = get().job
      if (!job) return
      try {
        await transcriptionApi.cancel(job.jobId)
      } catch {
        /* the job's final snapshot (or the next refresh) shows what happened */
      }
    },

    remove: async () => {
      const bookId = get().bookId
      if (!bookId) return false
      const forToken = token
      set({ actionError: null })
      try {
        const result = await transcriptionApi.delete(bookId)
        if (!current(forToken, bookId)) return result.ok
        if (!result.ok) {
          set({ actionError: { code: 'INVALID_ARGUMENT', message: 'The transcript could not be deleted.' } })
          return false
        }
        searchSeq += 1
        set({ passages: [], passagesTruncated: false, passagesStatus: 'ready', job: null, searchQuery: '', searchStatus: 'idle', searchHits: [], exportSaved: false })
        await loadInfo(forToken, bookId)
        return true
      } catch (error) {
        if (current(forToken, bookId)) set({ actionError: { code: 'DECODE_FAILED', message: error instanceof Error ? error.message : String(error) } })
        return false
      }
    },

    downloadModel: async (modelId) => {
      const bookId = get().bookId
      if (!bookId) return false
      const forToken = token
      set({ actionError: null, downloading: { modelId, loadedBytes: 0, totalBytes: 0 } })
      try {
        const result = await transcriptionApi.downloadModel(modelId)
        if (!current(forToken, bookId)) return result.ok
        set({ downloading: null })
        if (!result.ok) {
          set({ actionError: { code: result.errorCode, message: result.errorMessage } })
          return false
        }
        await loadInfo(forToken, bookId)
        return true
      } catch (error) {
        if (current(forToken, bookId)) set({ downloading: null, actionError: { code: 'DECODE_FAILED', message: error instanceof Error ? error.message : String(error) } })
        return false
      }
    },

    search: async (query) => {
      const bookId = get().bookId
      const text = query.trim()
      const seq = ++searchSeq
      if (!bookId) return
      if (text.length < SEARCH_MIN_LENGTH) {
        set({ searchQuery: query, searchStatus: 'idle', searchHits: [] })
        return
      }
      const forToken = token
      set({ searchQuery: query, searchStatus: 'searching' })
      try {
        const hits = await transcriptionApi.search(bookId, text, SEARCH_HIT_LIMIT)
        if (seq !== searchSeq || !current(forToken, bookId)) return
        set({ searchHits: hits, searchStatus: 'ready' })
      } catch {
        // Keep the hits already shown: a search that could not run is not "no results".
        if (seq === searchSeq && current(forToken, bookId)) set({ searchStatus: 'unavailable' })
      }
    },

    clearSearch: () => {
      searchSeq += 1
      set({ searchQuery: '', searchStatus: 'idle', searchHits: [] })
    },

    exportTranscript: async (options) => {
      const bookId = get().bookId
      if (!bookId || get().exporting) return false
      const forToken = token
      set({ exporting: true, exportSaved: false, actionError: null })
      try {
        const result = await transcriptionApi.export(bookId, options)
        if (!current(forToken, bookId)) return result.saved
        set({ exporting: false, exportSaved: result.saved })
        if (!result.saved && result.errorMessage) set({ actionError: { code: result.errorCode ?? 'EXPORT_FAILED', message: result.errorMessage } })
        return result.saved
      } catch (error) {
        if (current(forToken, bookId)) {
          set({ exporting: false, actionError: { code: 'EXPORT_FAILED', message: error instanceof Error ? error.message : String(error) } })
        }
        return false
      }
    },

    seekToPassage: (passage) => {
      // The player owns the jump (same rules as a Note: exact second, keeps play / pause, back to the origin if the track
      // cannot be played). A single-file audiobook has no track id: the position is on its one timeline.
      useAudioPlayerStore.getState().goToPosition(passage.trackId, passage.startMs / 1000)
    },

    openDialog: () => set({ dialogOpen: true, actionError: null }),
    closeDialog: () => set({ dialogOpen: false }),
    clearError: () => set({ actionError: null }),
  }
})

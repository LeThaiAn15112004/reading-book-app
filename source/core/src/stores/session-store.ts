import { createStore } from 'zustand/vanilla'
import { SdkError } from '../core/errors.js'
import type { SdkRuntime } from '../core/runtime.js'
import { ReadingSessionState, type Location } from '../domain/index.js'
import type { SessionService } from '../services/session-service.js'
import type { TimerHandle } from '../ports/platform.js'
import { reportStoreError, type LoadStatus, type ReadonlyStore } from './store-types.js'

/** Per-book typography/layout overrides — the flat fields of `ReadingSessionState`. */
export interface SessionPrefs {
  fontFamily?: string
  fontSize?: number
  fontWeight?: string
  lineHeight?: number
  textAlign?: string
  layoutMode?: string
  pageTurnMode?: string
  marginsEnabled?: boolean
  marginPreset?: string
  isLandscape?: boolean
}

export interface SessionState {
  bookId: string | null
  status: LoadStatus
  /** Resume position; `null` = start of the book. */
  location: Location | null
  locationLabel: string | null
  percent: number
  prefs: SessionPrefs
  /** Unsaved changes pending autosave. */
  dirty: boolean
  lastSavedAt: string | null

  /** Flushes the previous book (if any), then loads `bookId`'s session. */
  open(bookId: string): Promise<void>
  /** Record the reader's current position; autosaved after `autosaveDelayMs` of quiet. */
  updateLocation(location: Location, meta?: { percent?: number; label?: string }): void
  updatePrefs(patch: SessionPrefs): void
  /** Save now if dirty (app close, `beforeunload`, Electron pre-close flush). */
  flush(): Promise<boolean>
  /** Flush, then reset. */
  close(): Promise<void>
}

function clampPercent(value: number): number {
  return ReadingSessionState.clampPercent(value)
}

function normalizeLabel(label: string | undefined): string | undefined {
  return ReadingSessionState.normalizeLabel(label)
}

export function createSessionStore(rt: SdkRuntime, service: SessionService): ReadonlyStore<SessionState> {
  let timer: TimerHandle | null = null
  /** Saves run one at a time so an older snapshot can never overwrite a newer one. */
  let saving: Promise<boolean> = Promise.resolve(true)
  let warnedNoScheduler = false

  const clearTimer = () => {
    if (timer !== null) rt.scheduler?.clearTimeout(timer)
    timer = null
  }

  return createStore<SessionState>()((set, get) => {
    const scheduleSave = () => {
      clearTimer()
      if (!rt.scheduler) {
        if (!warnedNoScheduler) {
          rt.logger.warn('No scheduler available — reading session saves only on flush()/close()')
          warnedNoScheduler = true
        }
        return
      }
      timer = rt.scheduler.setTimeout(() => {
        timer = null
        void get().flush()
      }, rt.options.autosaveDelayMs)
    }

    const requireOpenBook = (operation: string): string => {
      rt.lifecycle.assertAlive(`session.${operation}`)
      const { bookId } = get()
      if (!bookId) throw new SdkError('NO_BOOK_OPEN', `session.${operation}: no book is open`)
      return bookId
    }

    const reset = () =>
      set({
        bookId: null,
        status: 'idle',
        location: null,
        locationLabel: null,
        percent: 0,
        prefs: {},
        dirty: false,
        lastSavedAt: null,
      })

    return {
      bookId: null,
      status: 'idle',
      location: null,
      locationLabel: null,
      percent: 0,
      prefs: {},
      dirty: false,
      lastSavedAt: null,

      async open(bookId) {
        rt.lifecycle.assertAlive('session.open')
        if (get().bookId) await get().close()
        set({ bookId, status: 'loading' })
        try {
          const session = await service.load(bookId)
          if (get().bookId !== bookId) return
          set({
            status: 'ready',
            location: session?.lastReadLocation ?? null,
            locationLabel: session?.lastReadLabel ?? null,
            percent: session?.percent ?? 0,
            prefs: session
              ? {
                  fontFamily: session.fontFamily,
                  fontSize: session.fontSize,
                  fontWeight: session.fontWeight,
                  lineHeight: session.lineHeight,
                  textAlign: session.textAlign,
                  layoutMode: session.layoutMode,
                  pageTurnMode: session.pageTurnMode,
                  marginsEnabled: session.marginsEnabled,
                  marginPreset: session.marginPreset,
                  isLandscape: session.isLandscape,
                }
              : {},
            dirty: false,
            lastSavedAt: session?.updatedAt ?? null,
          })
        } catch (err) {
          if (get().bookId !== bookId) return
          set({ status: 'error' })
          reportStoreError(rt, 'session', 'load', err)
        }
      },

      updateLocation(location, meta = {}) {
        requireOpenBook('updateLocation')
        const state = get()
        const percent = meta.percent === undefined ? state.percent : clampPercent(meta.percent)
        const label = meta.label === undefined ? state.locationLabel : (normalizeLabel(meta.label) ?? null)
        const unchanged =
          state.location !== null &&
          state.location.equals(location) &&
          percent === state.percent &&
          label === state.locationLabel
        if (unchanged) return
        set({ location, percent, locationLabel: label, dirty: true })
        scheduleSave()
      },

      updatePrefs(patch) {
        requireOpenBook('updatePrefs')
        const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
        if (Object.keys(clean).length === 0) return
        set((s) => ({ prefs: { ...s.prefs, ...clean }, dirty: true }))
        scheduleSave()
      },

      flush() {
        clearTimer()
        saving = saving.then(async () => {
          const state = get()
          if (!state.bookId || !state.dirty) return true
          const bookId = state.bookId
          // A session with no recorded location yet has nothing worth persisting.
          if (!state.location) {
            set({ dirty: false })
            return true
          }
          const session = new ReadingSessionState({
            bookId,
            lastReadLocation: state.location,
            percent: state.percent,
            lastReadLabel: state.locationLabel ?? undefined,
            updatedAt: rt.clock.nowIso(),
            ...state.prefs,
          })

          // Clear before awaiting: a change made during the save re-marks dirty and is kept.
          set({ dirty: false })
          try {
            await service.save(session)
            if (get().bookId === bookId) set({ lastSavedAt: session.updatedAt })
            rt.events.emit('session:saved', { bookId, updatedAt: session.updatedAt })
            return true
          } catch (err) {
            if (get().bookId === bookId) set({ dirty: true })
            reportStoreError(rt, 'session', 'save', err)
            return false
          }
        })
        return saving
      },

      async close() {
        await get().flush()
        clearTimer()
        reset()
      },
    }
  })
}

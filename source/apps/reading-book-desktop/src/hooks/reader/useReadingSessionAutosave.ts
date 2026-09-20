import { useCallback, useEffect, useRef } from 'react'
import type { CfiLocation } from '@reading-book/book-reader-sdk'
import {
  pendingFromSessionParts,
  READING_SESSION_DEBOUNCE_MS,
  READING_SESSION_MAX_WAIT_MS,
  toSaveInput,
  type PendingSessionSnapshot,
  type ReadingSessionSaveClient,
  type SessionLatestSnapshot,
  type SessionNavMeta,
  type SessionThemeFields,
} from './reading-session-autosave-types.js'

export type {
  PendingSessionSnapshot,
  ReadingSessionSaveClient,
  ReadingSessionSaveResult,
  SaveReadingSessionStateInput,
  SessionLatestSnapshot,
  SessionNavMeta,
  SessionThemeFields,
} from './reading-session-autosave-types.js'

export {
  pendingFromSessionParts,
  READING_SESSION_DEBOUNCE_MS,
  READING_SESSION_MAX_WAIT_MS,
  toSaveInput,
} from './reading-session-autosave-types.js'

const scheduleTimer = globalThis.setTimeout.bind(globalThis)
const cancelTimer = globalThis.clearTimeout.bind(globalThis)

export type UseReadingSessionAutosaveOptions = {
  bookId: string | undefined
  /** Re-read CFI + nav + theme immediately before flush / background. */
  getLatest?: () => SessionLatestSnapshot | null
  /** Injected by desktop (IPC) / mobile (MMKV/SQLite adapter). */
  client: ReadingSessionSaveClient
  /**
   * Optional app-level flush registration (desktop: quit handshake registry).
   * Return unregister on cleanup.
   */
  registerExternalFlush?: (flush: () => Promise<void>) => () => void
  /**
   * Optional lifecycle flush binding (desktop: blur/hidden; mobile: AppState).
   * Return unregister on cleanup.
   */
  bindBackgroundFlush?: (flush: () => Promise<void>) => () => void
}

/**
 * T4.2 — debounce + serialize session saves; flush on background / leave / quit.
 * Platform injects persistence client and optional lifecycle hooks.
 */
export function useReadingSessionAutosave({
  bookId,
  getLatest,
  client,
  registerExternalFlush,
  bindBackgroundFlush,
}: UseReadingSessionAutosaveOptions) {
  const pendingRef = useRef<PendingSessionSnapshot | null>(null)
  const lastSavedLocationRef = useRef<string | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstScheduleAtRef = useRef<number | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const bookIdRef = useRef(bookId)
  const getLatestRef = useRef(getLatest)
  const clientRef = useRef(client)

  bookIdRef.current = bookId
  getLatestRef.current = getLatest
  clientRef.current = client

  const clearTimers = useCallback(() => {
    if (debounceTimerRef.current != null) {
      cancelTimer(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (maxWaitTimerRef.current != null) {
      cancelTimer(maxWaitTimerRef.current)
      maxWaitTimerRef.current = null
    }
    firstScheduleAtRef.current = null
  }, [])

  const applyPending = useCallback(
    (
      location: CfiLocation | undefined,
      meta: SessionNavMeta,
      theme: SessionThemeFields,
      id: string,
    ): boolean => {
      pendingRef.current = pendingFromSessionParts(id, location, meta, theme)
      return true
    },
    [],
  )

  const writeLatest = useCallback(async (): Promise<void> => {
    // Coalesce: keep writing while a newer snapshot arrived during I/O.
    while (pendingRef.current) {
      const snapshot = pendingRef.current
      try {
        const result = await clientRef.current.saveSessionState(
          toSaveInput(snapshot),
        )
        if (result.ok) {
          lastSavedLocationRef.current = snapshot.lastReadLocation ?? null
          if (
            pendingRef.current &&
            pendingRef.current.bookId === snapshot.bookId &&
            pendingRef.current.lastReadLocation === snapshot.lastReadLocation
          ) {
            pendingRef.current = null
          }
        } else {
          // Leave pending for a later flush/retry.
          break
        }
      } catch {
        break
      }
    }
  }, [])

  const ensureWriteChain = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current
    const run = writeLatest().finally(() => {
      if (inFlightRef.current === run) inFlightRef.current = null
    })
    inFlightRef.current = run
    return run
  }, [writeLatest])

  const scheduleSave = useCallback(() => {
    if (!pendingRef.current) return

    if (debounceTimerRef.current != null) {
      cancelTimer(debounceTimerRef.current)
    }
    debounceTimerRef.current = scheduleTimer(() => {
      debounceTimerRef.current = null
      if (maxWaitTimerRef.current != null) {
        cancelTimer(maxWaitTimerRef.current)
        maxWaitTimerRef.current = null
      }
      firstScheduleAtRef.current = null
      void ensureWriteChain()
    }, READING_SESSION_DEBOUNCE_MS)

    if (firstScheduleAtRef.current == null) {
      firstScheduleAtRef.current = Date.now()
      maxWaitTimerRef.current = scheduleTimer(() => {
        maxWaitTimerRef.current = null
        if (debounceTimerRef.current != null) {
          cancelTimer(debounceTimerRef.current)
          debounceTimerRef.current = null
        }
        firstScheduleAtRef.current = null
        void ensureWriteChain()
      }, READING_SESSION_MAX_WAIT_MS)
    }
  }, [ensureWriteChain])

  /** Called on every EPUB relocated (page / scroll / jump). */
  const noteLocation = useCallback(
    (
      location: CfiLocation,
      meta: SessionNavMeta,
      theme: SessionThemeFields,
    ) => {
      const id = bookIdRef.current
      if (!id) return
      if (!applyPending(location, meta, theme, id)) return
      scheduleSave()
    },
    [applyPending, scheduleSave],
  )

  const captureLatestIntoPending = useCallback(() => {
    const id = bookIdRef.current
    if (!id) return
    const latest = getLatestRef.current?.()
    if (!latest) return
    applyPending(latest.location, latest.meta, latest.theme, id)
  }, [applyPending])

  /** Save a typography/layout change even if the reading CFI has not moved. */
  const noteSettingsChange = useCallback(() => {
    captureLatestIntoPending()
    scheduleSave()
  }, [captureLatestIntoPending, scheduleSave])

  /** Cancel timers, refresh from renderer if possible, await serialized write. */
  const flush = useCallback(async (): Promise<void> => {
    clearTimers()
    captureLatestIntoPending()
    if (!pendingRef.current && !inFlightRef.current) return
    await ensureWriteChain()
  }, [captureLatestIntoPending, clearTimers, ensureWriteChain])

  useEffect(() => {
    if (!bookId || !registerExternalFlush) return
    return registerExternalFlush(flush)
  }, [bookId, flush, registerExternalFlush])

  useEffect(() => {
    if (!bookId || !bindBackgroundFlush) return
    return bindBackgroundFlush(flush)
  }, [bookId, bindBackgroundFlush, flush])

  // Book switch / unmount → flush whatever is already pending for that book.
  // Do not re-read getLatest here: bookIdRef / renderer refs may already have moved on.
  useEffect(() => {
    lastSavedLocationRef.current = null
    return () => {
      clearTimers()
      void ensureWriteChain()
    }
  }, [bookId, clearTimers, ensureWriteChain])

  return { noteLocation, noteSettingsChange, flush }
}

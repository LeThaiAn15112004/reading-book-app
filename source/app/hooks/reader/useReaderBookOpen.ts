import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { getT } from '../../i18n'
import { beginOpening, setOpeningFile } from './firstPageSignal'
import { bookOpening, CfiLocation, Location, type Opening } from '@core'
import {
  beginBookOpening,
  isCurrentOpening,
  leaveBookOpening,
  openingSignal,
  reportContentFailed,
  reportContentReady,
  setOpeningBookDetails,
  setOpeningUsesSavedPosition,
  useReaderOpeningStore,
} from './readerOpeningStore'
import { whenNoImportSaving } from '../library/importQueueStore'
import {
  readingPrefsFromGlobal,
  readingPrefsFromSession,
  type GlobalReadingPrefs,
  type ReadingSessionPrefsFields,
  type ResolvedReadingPrefs,
} from '@core'

const DEFAULT_PREFS: ResolvedReadingPrefs = {
  fontFamily: 'serif',
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 1.65,
  textAlign: 'justify',
  margin: 'normal',
  marginEnabled: true,
  layout: 'single',
  viewMode: 'paginated',
}

export type ReaderBookOpenClient = {
  getBook: (bookId: string) => Promise<{ title?: string; coverUrl?: string; author?: string } | null>
  getSessionState: (
    bookId: string,
  ) => Promise<(ReadingSessionPrefsFields & { lastReadLocation?: string }) | null>
  openBookContent: (bookId: string) => Promise<{
    ok: boolean
    data?: ArrayBuffer | ArrayBufferView
    format?: string | null
    /** Stable failure code, e.g. `missing_file` when the book's file was moved or deleted. */
    errorCode?: string | null
    errorMessage?: string | null
    /** Spec 017 (R3): a passing failure — retried once automatically. */
    retryable?: boolean
  }>
  markAsReading: (bookId: string) => Promise<unknown>
}

export type UseReaderBookOpenOptions = {
  bookId: string | undefined
  ensureTab?: (bookId: string) => void
  updateBookTitle?: (bookId: string, title: string) => void
  setDocumentSubtitle?: (title: string) => void
  globalPrefsRef: MutableRefObject<GlobalReadingPrefs>
  client: ReaderBookOpenClient
  parseResumeLocation?: (raw: string | undefined) => Location | undefined
}

function defaultParseResumeLocation(raw: string | undefined): CfiLocation | undefined {
  if (!raw?.trim()) return undefined
  try {
    const location = Location.parse(raw)
    if (location instanceof CfiLocation) {
      return location
    }
  } catch {
    // Not Location JSON (legacy placeholder) — start from the beginning.
  }
  return undefined
}

function toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    const copy = new Uint8Array(data.byteLength)
    copy.set(new Uint8Array(data))
    return copy.buffer
  }
  const view = data as ArrayBufferView
  const copy = new Uint8Array(view.byteLength)
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  return copy.buffer
}

/**
 * T4.4 — shared hook to open a book and resume reading-session state.
 * Platform injects client API wrapper and layout listeners.
 * Annotation/bookmark/typewriter/freehand hydration was removed pending a rebuild
 * directly against `notes`/`INoteState` (see `packages/domain/models/annotation/note.ts`).
 */
export function useReaderBookOpen({
  bookId,
  ensureTab,
  updateBookTitle,
  setDocumentSubtitle,
  globalPrefsRef,
  client,
  parseResumeLocation = defaultParseResumeLocation,
}: UseReaderBookOpenOptions) {
  const [bookTitle, setBookTitle] = useState(() => getT()('common.untitled'))
  const [coverUrl, setCoverUrl] = useState<string | undefined>()
  const [author, setAuthor] = useState<string | undefined>()
  const [contentStatus, setContentStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [openErrorMessage, setOpenErrorMessage] = useState<string | null>(null)
  const [openErrorCode, setOpenErrorCode] = useState<string | null>(null)
  const [openAttempt, setOpenAttempt] = useState(0)
  const [bookBytes, setBookBytes] = useState<ArrayBuffer | null>(null)
  const [bookFormat, setBookFormat] = useState<string | null>(null)
  const [resumeLocation, setResumeLocation] = useState<Location | undefined>()
  const [sessionLoadStatus, setSessionLoadStatus] = useState<'loading' | 'ready'>(
    'loading',
  )
  const [prefs, setPrefs] = useState<ResolvedReadingPrefs>(DEFAULT_PREFS)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const prefsDirtyRef = useRef(false)
  const sessionGenerationRef = useRef(0)
  /** Spec 017: the token of this hook's current opening (answers with another token are ignored). */
  const [openingToken, setOpeningToken] = useState<string | null>(null)
  /** Spec 017: "Open from the beginning" — the next attempt ignores the saved position (kept until the reader moves). */
  const fromBeginningRef = useRef(false)

  // Reset content-related state when switching books.
  useEffect(() => {
    prefsDirtyRef.current = false
    setBookBytes(null)
    setBookFormat(null)
    setResumeLocation(undefined)
    setPrefs(readingPrefsFromGlobal(globalPrefsRef.current))
    setSessionLoadStatus('loading')
    setOpenErrorMessage(null)
    setOpenErrorCode(null)
    setCoverUrl(undefined)
    setContentStatus('idle')
  }, [bookId, globalPrefsRef])

  useEffect(() => {
    if (!bookId) return
    ensureTab?.(bookId)
  }, [bookId, ensureTab])

  useEffect(() => {
    if (!bookId) {
      setBookTitle(getT()('common.untitled'))
      setCoverUrl(undefined)
      setAuthor(undefined)
      setBookBytes(null)
      setBookFormat(null)
      setResumeLocation(undefined)
      setSessionLoadStatus('ready')
      setOpenErrorMessage(null)
      setOpenErrorCode(null)
      setContentStatus('idle')
      return
    }
    const generation = ++sessionGenerationRef.current
    let cancelled = false
    const fromBeginning = fromBeginningRef.current
    fromBeginningRef.current = false
    setContentStatus('loading')
    setOpenErrorMessage(null)
    setOpenErrorCode(null)
    setBookBytes(null)
    setBookFormat(null)
    setResumeLocation(undefined)
    setSessionLoadStatus('loading')
    setCoverUrl(undefined)

    // Spec 017 (R1): one opening per attempt; a new one (another book, a second tap, Try again) replaces the last.
    const token = beginBookOpening({ bookId })
    setOpeningToken(token)
    const signal = openingSignal()
    const alive = () => !cancelled && isCurrentOpening(token)
    // Spec 016: the gate that holds background work back starts now; the renderer marks its first page drawn.
    beginOpening(bookId)

    const fail = (errorCode: string | null, errorMessage: string | null | undefined) => {
      setBookBytes(null)
      setBookFormat(null)
      setContentStatus('error')
      setOpenErrorCode(errorCode)
      setOpenErrorMessage(errorMessage ?? getT()('reader.logic.open.failed'))
    }

    const run = async () => {
      // Spec 017 (edge case): a book whose row an import is still writing opens once that import has saved.
      await whenNoImportSaving(signal)
      if (!alive()) return

      client
        .getBook(bookId)
        .then((book) => {
          if (cancelled) return
          const title = book?.title?.trim() || getT()('common.untitled')
          setBookTitle(title)
          setCoverUrl(book?.coverUrl)
          setAuthor(book?.author?.trim() || undefined)
          updateBookTitle?.(bookId, title)
          setOpeningBookDetails(token, { title, coverUrl: book?.coverUrl ?? null })
        })
        .catch(() => {
          if (!cancelled) {
            setBookTitle(getT()('common.untitled'))
            setCoverUrl(undefined)
            setAuthor(undefined)
          }
        })

      // T4.4: wait for saved CFI before mounting reader so the first display
      // resumes directly instead of briefly opening at the beginning.
      client
        .getSessionState(bookId)
        .then((session) => {
          if (cancelled || generation !== sessionGenerationRef.current) return
          const resume = fromBeginning ? undefined : parseResumeLocation(session?.lastReadLocation)
          setResumeLocation(resume)
          setOpeningUsesSavedPosition(token, resume !== undefined)
          setPrefs(
            readingPrefsFromSession(
              session,
              readingPrefsFromGlobal(globalPrefsRef.current),
            ),
          )
        })
        .catch(() => {
          if (!cancelled && generation === sessionGenerationRef.current) {
            setResumeLocation(undefined)
            setPrefs(readingPrefsFromGlobal(globalPrefsRef.current))
          }
        })
        .finally(() => {
          if (!cancelled) setSessionLoadStatus('ready')
        })

      // T3.4: open book file content; spec 017 (R3): a passing failure is retried once before an error is shown.
      for (;;) {
        let result: Awaited<ReturnType<ReaderBookOpenClient['openBookContent']>>
        try {
          result = await client.openBookContent(bookId)
        } catch {
          // The call itself failed (IPC / bridge): treated as passing, so it gets the one retry.
          result = { ok: false, errorCode: null, retryable: true }
        }
        if (!alive()) return
        if (result.ok && result.data) {
          setOpeningFile(bookId, result.format, result.data.byteLength)
          reportContentReady(token, result.format, result.data.byteLength)
          // Normalize payload (ArrayBuffer or typed array) into a fresh buffer.
          setBookBytes(toArrayBuffer(result.data))
          setBookFormat(result.format ?? null)
          setContentStatus('ready')
          // Library Reading shelf — default status when user opens a book.
          void client.markAsReading(bookId).catch(() => {})
          return
        }
        const retry = reportContentFailed(token, result.errorCode, result.retryable === true)
        if (!retry) {
          fail(result.errorCode ?? null, result.errorMessage)
          return
        }
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, bookOpening.RETRY_DELAY_MS)
          signal?.addEventListener('abort', () => {
            clearTimeout(t)
            resolve()
          })
        })
        if (!alive()) return
      }
    }
    void run()

    return () => {
      cancelled = true
      // Leaving the Reader (or switching book) ends an opening still running: nothing of it is shown or kept (FR-002).
      leaveBookOpening()
    }
  }, [
    bookId,
    globalPrefsRef,
    openAttempt,
    updateBookTitle,
    client,
    parseResumeLocation,
  ])

  useEffect(() => {
    setDocumentSubtitle?.(bookTitle)
  }, [bookTitle, setDocumentSubtitle])

  // Spec 017: this hook's opening as the store holds it (null once another opening replaced it).
  const storeOpening = useReaderOpeningStore((st) => st.current)
  const opening: Opening | null = storeOpening && storeOpening.token === openingToken ? storeOpening : null

  const isEpubSurface =
    contentStatus === 'ready' && bookFormat === 'epub' && !!bookBytes
  const isEpubSessionLoading =
    isEpubSurface && sessionLoadStatus === 'loading'

  return {
    bookTitle,
    coverUrl,
    author,
    contentStatus,
    openErrorMessage,
    openErrorCode,
    bookBytes,
    bookFormat,
    resumeLocation,
    sessionLoadStatus,
    prefs,
    setPrefs,
    prefsRef,
    prefsDirtyRef,
    isEpubSurface,
    isEpubSessionLoading,
    /** Spec 017: the current opening (step, outcome, error, positionRestored) for the opening screen. */
    opening,
    retryOpen: () => setOpenAttempt((n) => n + 1),
    /** Spec 017: Try again without the saved position (the saved position is replaced only once the reader moves). */
    openFromBeginning: () => {
      fromBeginningRef.current = true
      setOpenAttempt((n) => n + 1)
    },
    /** Re-read the file's bytes in place (status, position and prefs stay): after an edit written into the file. */
    refreshBookBytes: async () => {
      if (!bookId) return
      try {
        const result = await client.openBookContent(bookId)
        if (result.ok && result.data) setBookBytes(toArrayBuffer(result.data))
      } catch {
        // The old bytes stay on screen.
      }
    },
  }
}

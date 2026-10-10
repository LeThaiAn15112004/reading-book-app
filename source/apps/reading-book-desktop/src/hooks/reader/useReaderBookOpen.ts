import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { CfiLocation, Location } from '@reading-book/book-reader-sdk'
import {
  readingPrefsFromGlobal,
  readingPrefsFromSession,
  type GlobalReadingPrefs,
  type ResolvedReadingPrefs,
} from '@reading-book/book-reader-sdk'

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
  getSessionState: (bookId: string) => Promise<any>
  openBookContent: (bookId: string) => Promise<{
    ok: boolean
    data?: any
    format?: string | null
    /** Stable failure code, e.g. `missing_file` when the book's file was moved or deleted. */
    errorCode?: string | null
    errorMessage?: string | null
  }>
  markAsReading: (bookId: string) => Promise<any>
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
  } catch {}
  return undefined
}

function toArrayBuffer(data: any): ArrayBuffer {
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
  const [bookTitle, setBookTitle] = useState('Untitled')
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
      setBookTitle('Untitled')
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
    setContentStatus('loading')
    setOpenErrorMessage(null)
    setOpenErrorCode(null)
    setBookBytes(null)
    setBookFormat(null)
    setResumeLocation(undefined)
    setSessionLoadStatus('loading')
    setCoverUrl(undefined)
    client
      .getBook(bookId)
      .then((book) => {
        if (cancelled) return
        const title = book?.title?.trim() || 'Untitled'
        setBookTitle(title)
        setCoverUrl(book?.coverUrl)
        setAuthor(book?.author?.trim() || undefined)
        updateBookTitle?.(bookId, title)
      })
      .catch(() => {
        if (!cancelled) {
          setBookTitle('Untitled')
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
        setResumeLocation(parseResumeLocation(session?.lastReadLocation))
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

    // T3.4: open book file content.
    client
      .openBookContent(bookId)
      .then((result) => {
        if (cancelled) return
        if (result.ok && result.data) {
          // Normalize payload (ArrayBuffer or typed array) into a fresh buffer.
          setBookBytes(toArrayBuffer(result.data))
          setBookFormat(result.format ?? null)
          setContentStatus('ready')
          // Library Reading shelf — default status when user opens a book.
          void client.markAsReading(bookId).catch(() => {})
          return
        }
        setBookBytes(null)
        setBookFormat(null)
        setContentStatus('error')
        setOpenErrorCode(result.errorCode ?? null)
        setOpenErrorMessage(
          result.errorMessage ?? 'Could not open this book file.',
        )
      })
      .catch(() => {
        if (cancelled) return
        setBookBytes(null)
        setBookFormat(null)
        setContentStatus('error')
        setOpenErrorCode(null)
        setOpenErrorMessage('Could not open this book file.')
      })

    return () => {
      cancelled = true
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
    retryOpen: () => setOpenAttempt((n) => n + 1),
  }
}

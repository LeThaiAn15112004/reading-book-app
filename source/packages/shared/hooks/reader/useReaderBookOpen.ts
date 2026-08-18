import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { CfiLocation, Location } from '@reading-book/domain'
import {
  annotationDtoToReaderFreehand,
  annotationDtoToReaderHighlight,
  annotationDtoToReaderTypewriter,
  bookmarkDtoToReaderBookmark,
  nextReaderOverlayId,
  readingPrefsFromGlobal,
  readingPrefsFromSession,
  readerTypewriterToAnnotationInput,
  serializeTypewriterLocation,
  type GlobalReadingPrefs,
  type ReaderBookmark,
  type ReaderHighlight,
  type ReaderShapeAnnotation,
  type ReaderTypewriterNote,
  type TypewriterDraft,
  type ResolvedReadingPrefs,
} from '../../models/index.js'

const DEFAULT_PREFS: ResolvedReadingPrefs = {
  fontFamily: 'serif',
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 1.65,
  textAlign: 'justify',
  margin: 'normal',
  marginEnabled: true,
  layout: 'single',
  pageMode: 'paginated',
}

export type ReaderBookOpenClient = {
  getBook: (bookId: string) => Promise<{ title?: string; coverUrl?: string } | null>
  getSessionState: (bookId: string) => Promise<any>
  listAnnotations: (options: { bookId: string; types: string[] }) => Promise<any[]>
  listBookmarks: (bookId: string) => Promise<any[]>
  openBookContent: (bookId: string) => Promise<{ ok: boolean; data?: any; format?: string | null; errorMessage?: string | null }>
  markAsReading: (bookId: string) => Promise<any>
  updateAnnotation: (options: { bookId: string; id: string; content?: string }) => Promise<any>
  saveAnnotation: (input: any) => Promise<any>
}

export type UseReaderBookOpenOptions = {
  bookId: string | undefined
  ensureTab?: (bookId: string) => void
  updateBookTitle?: (bookId: string, title: string) => void
  setDocumentSubtitle?: (title: string) => void
  globalPrefsRef: MutableRefObject<GlobalReadingPrefs>
  setHighlights: Dispatch<SetStateAction<ReaderHighlight[]>>
  setBookmarks: Dispatch<SetStateAction<ReaderBookmark[]>>
  setTypewriterNotes: Dispatch<SetStateAction<ReaderTypewriterNote[]>>
  setFreehandStrokes: Dispatch<SetStateAction<ReaderShapeAnnotation[]>>
  typewriterNotesRef: MutableRefObject<ReaderTypewriterNote[]>
  typewriterDraftRef: MutableRefObject<TypewriterDraft | null>
  typewriterContentTimersRef: MutableRefObject<Map<string, number>>
  client: ReaderBookOpenClient
  parseResumeLocation?: (raw: string | undefined) => CfiLocation | undefined
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
 * T4.4 / T5.3 / T5.5 / T5.6b / T5.11e — shared hook to open, hydrate annotations, 
 * bookmarks, and resume state for a book.
 * Platform injects client API wrapper and layout listeners.
 */
export function useReaderBookOpen({
  bookId,
  ensureTab,
  updateBookTitle,
  setDocumentSubtitle,
  globalPrefsRef,
  setHighlights,
  setBookmarks,
  setTypewriterNotes,
  setFreehandStrokes,
  typewriterNotesRef,
  typewriterDraftRef,
  typewriterContentTimersRef,
  client,
  parseResumeLocation = defaultParseResumeLocation,
}: UseReaderBookOpenOptions) {
  const [bookTitle, setBookTitle] = useState('Untitled')
  const [coverUrl, setCoverUrl] = useState<string | undefined>()
  const [contentStatus, setContentStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [openErrorMessage, setOpenErrorMessage] = useState<string | null>(null)
  const [openAttempt, setOpenAttempt] = useState(0)
  const [bookBytes, setBookBytes] = useState<ArrayBuffer | null>(null)
  const [bookFormat, setBookFormat] = useState<string | null>(null)
  const [resumeLocation, setResumeLocation] = useState<CfiLocation | undefined>()
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
      setBookBytes(null)
      setBookFormat(null)
      setResumeLocation(undefined)
      setSessionLoadStatus('ready')
      setOpenErrorMessage(null)
      setContentStatus('idle')
      return
    }
    const generation = ++sessionGenerationRef.current
    let cancelled = false
    setContentStatus('loading')
    setOpenErrorMessage(null)
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
        updateBookTitle?.(bookId, title)
      })
      .catch(() => {
        if (!cancelled) {
          setBookTitle('Untitled')
          setCoverUrl(undefined)
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

    // T5.3: hydrate persisted highlights for this book.
    client
      .listAnnotations({ bookId, types: ['highlight'] })
      .then((rows) => {
        if (cancelled || generation !== sessionGenerationRef.current) return
        const mapped = rows
          .map(annotationDtoToReaderHighlight)
          .filter((h): h is ReaderHighlight => h != null)
        setHighlights(mapped)
      })
      .catch(() => {
        if (!cancelled && generation === sessionGenerationRef.current) {
          setHighlights([])
        }
      })

    // T5.5: hydrate persisted bookmarks for this book.
    client
      .listBookmarks(bookId)
      .then((rows) => {
        if (cancelled || generation !== sessionGenerationRef.current) return
        const mapped = rows
          .map(bookmarkDtoToReaderBookmark)
          .filter((b): b is ReaderBookmark => b != null)
        setBookmarks(mapped)
      })
      .catch(() => {
        if (!cancelled && generation === sessionGenerationRef.current) {
          setBookmarks([])
        }
      })

    // T5.6b: hydrate persisted typewriter textboxes for this book.
    client
      .listAnnotations({ bookId, types: ['textbox'] })
      .then((rows) => {
        if (cancelled || generation !== sessionGenerationRef.current) return
        const mapped = rows
          .map(annotationDtoToReaderTypewriter)
          .filter((n): n is ReaderTypewriterNote => n != null)
        setTypewriterNotes(mapped)
      })
      .catch(() => {
        if (!cancelled && generation === sessionGenerationRef.current) {
          setTypewriterNotes([])
        }
      })

    // T5.11e: hydrate persisted freehand (pencil) strokes for this book.
    client
      .listAnnotations({ bookId, types: ['freehand'] })
      .then((rows) => {
        if (cancelled || generation !== sessionGenerationRef.current) return
        const mapped = rows
          .map(annotationDtoToReaderFreehand)
          .filter((s): s is ReaderShapeAnnotation => s != null)
        setFreehandStrokes(mapped)
      })
      .catch(() => {
        if (!cancelled && generation === sessionGenerationRef.current) {
          setFreehandStrokes([])
        }
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
        setOpenErrorMessage(
          result.errorMessage ?? 'Could not open this book file.',
        )
      })
      .catch(() => {
        if (cancelled) return
        setBookBytes(null)
        setBookFormat(null)
        setContentStatus('error')
        setOpenErrorMessage('Could not open this book file.')
      })

    return () => {
      cancelled = true
      // Flush pending typewriter content edits for this book before leaving.
      const timers = typewriterContentTimersRef.current
      for (const [id, timer] of timers) {
        globalThis.clearTimeout(timer)
        const note = typewriterNotesRef.current.find((n) => n.id === id)
        if (note) {
          void client
            .updateAnnotation({ bookId, id, content: note.content })
            .catch(() => {})
        }
      }
      timers.clear()
      // Persist non-empty virtual draft if the user navigates away mid-type.
      const draft = typewriterDraftRef.current
      if (draft?.content.trim()) {
        const now = new Date().toISOString()
        const positionData = draft.cfi?.trim() && draft.offsetPx
          ? serializeTypewriterLocation({
              v: 2,
              anchor: 'cfi-offset',
              cfi: draft.cfi.trim(),
              offsetPx: draft.offsetPx,
              xPct: draft.xPct,
              yPct: draft.yPct,
            })
          : serializeTypewriterLocation({
              v: 2,
              anchor: 'fake-pct',
              xPct: draft.xPct,
              yPct: draft.yPct,
            })
        const newNote = {
          id: nextReaderOverlayId('tw'),
          type: 'textbox' as const,
          chapterIndex: draft.chapterIndex,
          positionData,
          colorHex: draft.colorHex ?? '#f59e0b',
          fontSize: draft.fontSize ?? 13,
          content: draft.content.trim(),
          status: 'None' as const,
          isChecked: false,
          createdAt: now,
          updatedAt: now,
          ...(draft.cfi?.trim() ? { cfi: draft.cfi.trim(), source: 'epub' as const } : {}),
        }
        void client
          .saveAnnotation(readerTypewriterToAnnotationInput(bookId, newNote))
          .catch(() => {})
      }
      typewriterDraftRef.current = null
    }
  }, [
    bookId,
    globalPrefsRef,
    openAttempt,
    setBookmarks,
    setHighlights,
    setTypewriterNotes,
    typewriterContentTimersRef,
    typewriterDraftRef,
    typewriterNotesRef,
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
    contentStatus,
    openErrorMessage,
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

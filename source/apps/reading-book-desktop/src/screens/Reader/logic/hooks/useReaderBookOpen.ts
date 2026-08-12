import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { CfiLocation } from '@reading-book/domain'
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
} from '@reading-book/shared/models'
import { libraryApi, overlayApi } from '../../../../bridge'
import { toArrayBuffer } from '../../../../reader/renderers/epub/openEpubjs'
import type { ReadingPrefs } from '../../components'
import { parseResumeLocation } from '../book/parseResumeLocation'
import { toReadingPrefs } from '../prefs/toReadingPrefs'

const DEFAULT_PREFS: ReadingPrefs = {
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

type UseReaderBookOpenOptions = {
  bookId: string | undefined
  ensureTab: (bookId: string) => void
  updateBookTitle: (bookId: string, title: string) => void
  setDocumentSubtitle: (title: string) => void
  globalPrefsRef: MutableRefObject<GlobalReadingPrefs>
  setHighlights: Dispatch<SetStateAction<ReaderHighlight[]>>
  setBookmarks: Dispatch<SetStateAction<ReaderBookmark[]>>
  setTypewriterNotes: Dispatch<SetStateAction<ReaderTypewriterNote[]>>
  setFreehandStrokes: Dispatch<SetStateAction<ReaderShapeAnnotation[]>>
  typewriterNotesRef: MutableRefObject<ReaderTypewriterNote[]>
  typewriterDraftRef: MutableRefObject<TypewriterDraft | null>
  typewriterContentTimersRef: MutableRefObject<Map<string, number>>
}

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
  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_PREFS)
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
    setPrefs(toReadingPrefs(readingPrefsFromGlobal(globalPrefsRef.current)))
    setSessionLoadStatus('loading')
    setOpenErrorMessage(null)
    setCoverUrl(undefined)
    setContentStatus('idle')
  }, [bookId, globalPrefsRef])

  useEffect(() => {
    if (!bookId) return
    ensureTab(bookId)
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
    libraryApi
      .getBook(bookId)
      .then((book) => {
        if (cancelled) return
        const title = book?.title?.trim() || 'Untitled'
        setBookTitle(title)
        setCoverUrl(book?.coverUrl)
        updateBookTitle(bookId, title)
      })
      .catch(() => {
        if (!cancelled) {
          setBookTitle('Untitled')
          setCoverUrl(undefined)
        }
      })

    // T4.4: wait for saved CFI before mounting EPUB so the first display
    // resumes directly instead of briefly opening at the beginning.
    overlayApi
      .getSessionState(bookId)
      .then((session) => {
        if (cancelled || generation !== sessionGenerationRef.current) return
        setResumeLocation(parseResumeLocation(session?.lastReadLocation))
        setPrefs(
          toReadingPrefs(
            readingPrefsFromSession(
              session,
              readingPrefsFromGlobal(globalPrefsRef.current),
            ),
          ),
        )
      })
      .catch(() => {
        if (!cancelled && generation === sessionGenerationRef.current) {
          setResumeLocation(undefined)
          setPrefs(toReadingPrefs(readingPrefsFromGlobal(globalPrefsRef.current)))
        }
      })
      .finally(() => {
        if (!cancelled) setSessionLoadStatus('ready')
      })

    // T5.3: hydrate persisted highlights for this book.
    overlayApi
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
    overlayApi
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
    overlayApi
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
    overlayApi
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

    // T3.4: open sandboxed bytes via Main allowlist (no FS path in renderer).
    libraryApi
      .openBookContent(bookId)
      .then((result) => {
        if (cancelled) return
        if (result.ok && result.data) {
          // Normalize IPC payload (ArrayBuffer or typed array) into a fresh buffer.
          setBookBytes(toArrayBuffer(result.data))
          setBookFormat(result.format ?? null)
          setContentStatus('ready')
          // Library Reading shelf — default status when user opens a book.
          void libraryApi.markAsReading(bookId).catch(() => {})
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
        window.clearTimeout(timer)
        const note = typewriterNotesRef.current.find((n) => n.id === id)
        if (note) {
          void overlayApi
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
        void overlayApi
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
  ])

  useEffect(() => {
    setDocumentSubtitle(bookTitle)
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

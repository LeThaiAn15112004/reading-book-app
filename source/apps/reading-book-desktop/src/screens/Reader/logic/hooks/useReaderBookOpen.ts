import { useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  useReaderBookOpen as useSharedReaderBookOpen,
  type ReaderBookOpenClient,
} from '@reading-book/shared/hooks/reader'
import type {
  GlobalReadingPrefs,
  ReaderBookmark,
  ReaderHighlight,
  ReaderShapeAnnotation,
  ReaderTypewriterNote,
  TypewriterDraft,
} from '@reading-book/shared/models'
import { libraryApi, overlayApi } from '../../../../bridge'
import type { ReadingPrefs } from '../../components'
import { parseResumeLocation } from '../book/parseResumeLocation'
import { fromReadingPrefs, toReadingPrefs } from '../prefs/toReadingPrefs'

type AnnotationTypeDto = NonNullable<
  Parameters<typeof overlayApi.listAnnotations>[0]['types']
>[number]

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

/**
 * Desktop adapter hook for useReaderBookOpen.
 * Wires the shared, platform-agnostic useReaderBookOpen hook with desktop's
 * Electron IPC bridge APIs.
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
}: UseReaderBookOpenOptions) {
  // Wire desktop IPC APIs into the client interface
  const client: ReaderBookOpenClient = useMemo(
    () => ({
      getBook: (id) => libraryApi.getBook(id),
      getSessionState: (id) => overlayApi.getSessionState(id),
      listAnnotations: (query) =>
        overlayApi.listAnnotations({
          bookId: query.bookId,
          types: query.types as AnnotationTypeDto[],
        }),
      listBookmarks: (id) => overlayApi.listBookmarks(id),
      openBookContent: (id) => libraryApi.openBookContent(id),
      markAsReading: (id) => libraryApi.markAsReading(id),
      updateAnnotation: (options) => overlayApi.updateAnnotation(options),
      saveAnnotation: (input) => overlayApi.saveAnnotation(input),
    }),
    [],
  )

  const {
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
    prefsDirtyRef,
    isEpubSurface,
    isEpubSessionLoading,
    retryOpen,
  } = useSharedReaderBookOpen({
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
    parseResumeLocation,
  })

  // Map ResolvedReadingPrefs back to desktop-specific ReadingPrefs
  const mappedPrefs = useMemo(() => toReadingPrefs(prefs), [prefs])
  const mappedPrefsRef = useRef<ReadingPrefs>(mappedPrefs)
  mappedPrefsRef.current = mappedPrefs

  const setPrefsMapped = (newPrefs: ReadingPrefs | ((prev: ReadingPrefs) => ReadingPrefs)) => {
    if (typeof newPrefs === 'function') {
      setPrefs((prevResolved) => fromReadingPrefs(newPrefs(toReadingPrefs(prevResolved))))
    } else {
      setPrefs(fromReadingPrefs(newPrefs))
    }
  }

  return {
    bookTitle,
    coverUrl,
    contentStatus,
    openErrorMessage,
    bookBytes,
    bookFormat,
    resumeLocation,
    sessionLoadStatus,
    prefs: mappedPrefs,
    setPrefs: setPrefsMapped,
    prefsRef: mappedPrefsRef,
    prefsDirtyRef,
    isEpubSurface,
    isEpubSessionLoading,
    retryOpen,
  }
}

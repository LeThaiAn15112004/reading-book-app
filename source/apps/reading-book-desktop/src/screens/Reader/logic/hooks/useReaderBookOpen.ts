import { useMemo, useRef, type MutableRefObject } from 'react'
import {
  useReaderBookOpen as useSharedReaderBookOpen,
  type ReaderBookOpenClient,
} from '../../../../hooks/reader/index.js'
import type { GlobalReadingPrefs } from '@reading-book/book-reader-sdk'
import { libraryApi, overlayApi } from '../../../../bridge'
import type { ReadingPrefs } from '../../components'
import { parseResumeLocation } from '../book/parseResumeLocation'
import { fromReadingPrefs, toReadingPrefs } from '../prefs/toReadingPrefs'

type UseReaderBookOpenOptions = {
  bookId: string | undefined
  ensureTab: (bookId: string) => void
  updateBookTitle: (bookId: string, title: string) => void
  setDocumentSubtitle: (title: string) => void
  globalPrefsRef: MutableRefObject<GlobalReadingPrefs>
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
}: UseReaderBookOpenOptions) {
  // Wire desktop IPC APIs into the client interface
  const client: ReaderBookOpenClient = useMemo(
    () => ({
      getBook: (id) => libraryApi.getBook(id),
      getSessionState: (id) => overlayApi.getSessionState(id),
      openBookContent: (id) => libraryApi.openBookContent(id),
      markAsReading: (id) => libraryApi.markAsReading(id),
    }),
    [],
  )

  const {
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
    author,
    contentStatus,
    openErrorMessage,
    openErrorCode,
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

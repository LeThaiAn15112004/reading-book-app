import { Suspense, lazy, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { isAudioFormat } from '@core'
import { libraryApi } from '../bridge'
import { isMobileHost } from '../platforms/host'
import { AudioBookScreen } from './AudioBook/AudioBookScreen'
import { ReaderScreen } from './Reader/ReaderScreen'

/**
 * The Mobile Reader (spec 008, T101). A separate chunk: `isMobileHost()` is false in Electron, so `lazy` never starts
 * the import there and Desktop never loads this code (R10, checked on the `vite build` output).
 */
const MobileReaderScreen = lazy(() => import('./Reader/phone/MobileReaderScreen'))

/** A book's format never changes, so it is looked up once per id. */
const formatByBookId = new Map<string, string>()
const UNKNOWN = 'unknown'

/**
 * `/reader/:bookId` — picks the screen by the book's format: the audiobook player for audio, the
 * existing `ReaderScreen` for everything else (which is rendered exactly as before; for an unknown
 * or missing book it shows its own error state). On the Mobile host (never by width) the Mobile Reader replaces
 * `ReaderScreen`; audiobooks are not in the Mobile first release.
 */
export function ReaderRoute() {
  const { bookId } = useParams<{ bookId: string }>()
  const [, setLookedUp] = useState(0)
  const cached = bookId ? formatByBookId.get(bookId) : undefined

  useEffect(() => {
    if (!bookId || formatByBookId.has(bookId)) return
    let cancelled = false
    void libraryApi
      .getBook(bookId)
      .then((book) => formatByBookId.set(bookId, book?.format ?? UNKNOWN))
      .catch(() => formatByBookId.set(bookId, UNKNOWN))
      .finally(() => {
        if (!cancelled) setLookedUp((n) => n + 1)
      })
    return () => {
      cancelled = true
    }
  }, [bookId])

  if (isMobileHost()) {
    return (
      <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
        <MobileReaderScreen />
      </Suspense>
    )
  }
  if (!bookId) return <ReaderScreen />
  if (cached === undefined) return <div className="flex-1" aria-busy="true" />
  return isAudioFormat(cached) ? <AudioBookScreen bookId={bookId} /> : <ReaderScreen />
}

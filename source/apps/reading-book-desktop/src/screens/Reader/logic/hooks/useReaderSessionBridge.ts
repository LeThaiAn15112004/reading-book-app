import { useCallback, useEffect, type MutableRefObject, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CfiLocation } from '@reading-book/domain'
import type { EpubRendererApi } from '../../../../reader/renderers/epub'
import type { ReadingPrefs } from '../../components'
import {
  useReadingSessionAutosave,
  type SessionLatestSnapshot,
} from '../session/useReadingSessionAutosave'

type UseReaderSessionBridgeOptions = {
  bookId: string | undefined
  epubApiRef: RefObject<EpubRendererApi | null>
  prefsRef: MutableRefObject<ReadingPrefs>
  prefsDirtyRef: MutableRefObject<boolean>
  clearHighlightHandlesRef: MutableRefObject<() => void>
  prefs: ReadingPrefs
  sessionLoadStatus: 'loading' | 'ready'
}

export function useReaderSessionBridge({
  bookId,
  epubApiRef,
  prefsRef,
  prefsDirtyRef,
  clearHighlightHandlesRef,
  prefs,
  sessionLoadStatus,
}: UseReaderSessionBridgeOptions) {
  const navigate = useNavigate()

  const getLatestSessionSnapshot = useCallback((): SessionLatestSnapshot | null => {
    const api = epubApiRef.current
    const readingPrefs = prefsRef.current
    const location = api?.getCurrentLocation()
    const nav = api?.getNavState()
    return {
      location,
      meta: {
        label: nav?.label,
        percent: Math.round((nav?.progress ?? 0) * 100),
      },
      theme: prefsDirtyRef.current
        ? {
            fontSize: readingPrefs.fontSize,
            fontFamily: readingPrefs.fontFamily,
            fontWeight: String(readingPrefs.fontWeight),
            lineHeight: readingPrefs.lineHeight,
            textAlign: readingPrefs.textAlign,
            layoutMode: readingPrefs.layout,
            pageTurnMode: readingPrefs.pageMode,
            marginsEnabled: readingPrefs.marginEnabled,
            marginPreset: readingPrefs.margin,
            isLandscape: readingPrefs.layout !== 'single',
          }
        : {},
    }
  }, [epubApiRef, prefsDirtyRef, prefsRef])

  const { noteLocation, noteSettingsChange, flush: flushSession } =
    useReadingSessionAutosave({
      bookId,
      getLatest: getLatestSessionSnapshot,
    })

  const handleEpubLocationChange = useCallback(
    (location: CfiLocation) => {
      clearHighlightHandlesRef.current()
      const latest = getLatestSessionSnapshot()
      const readingPrefs = prefsRef.current
      const nav = epubApiRef.current?.getNavState()
      noteLocation(
        location,
        {
          label: latest?.meta.label ?? nav?.label,
          percent:
            latest?.meta.percent ??
            Math.round((nav?.progress ?? 0) * 100),
        },
        latest?.theme ?? {
          fontSize: readingPrefs.fontSize,
          fontFamily: readingPrefs.fontFamily,
          fontWeight: String(readingPrefs.fontWeight),
          lineHeight: readingPrefs.lineHeight,
          textAlign: readingPrefs.textAlign,
          layoutMode: readingPrefs.layout,
          pageTurnMode: readingPrefs.pageMode,
          marginsEnabled: readingPrefs.marginEnabled,
          marginPreset: readingPrefs.margin,
          isLandscape: readingPrefs.layout !== 'single',
        },
      )
    },
    [
      clearHighlightHandlesRef,
      epubApiRef,
      getLatestSessionSnapshot,
      noteLocation,
      prefsRef,
    ],
  )

  const leaveToLibrary = useCallback(async () => {
    await flushSession()
    navigate('/library')
  }, [flushSession, navigate])

  useEffect(() => {
    if (sessionLoadStatus !== 'ready' || !prefsDirtyRef.current) return
    noteSettingsChange()
  }, [noteSettingsChange, prefs, prefsDirtyRef, sessionLoadStatus])

  return {
    getLatestSessionSnapshot,
    noteLocation,
    noteSettingsChange,
    flushSession,
    handleEpubLocationChange,
    leaveToLibrary,
  }
}

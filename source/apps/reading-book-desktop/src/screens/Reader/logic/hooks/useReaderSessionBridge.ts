import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageRectLocation, txtReadingLocation, type CfiLocation } from '@reading-book/book-reader-sdk'
import type { EpubRendererApi } from '../../../../reader/renderers/epub'
import type { PdfNavState, PdfRendererApi } from '../../../../reader/renderers/pdf'
import type { TextSurfaceApi } from '../../../../reader/renderers/textSurface'
import type { ReadingPrefs } from '../../components'
import {
  useReadingSessionAutosave,
  type SessionLatestSnapshot,
} from '../session/useReadingSessionAutosave'

/** Footer label + Library progress for a PDF page (percent = pages read, 0–100). */
function pdfSessionMeta(state: PdfNavState) {
  return {
    label: `Page ${state.pageCurrent}`,
    percent: state.pageTotal > 0 ? Math.round((state.pageCurrent / state.pageTotal) * 100) : 0,
  }
}

/** Footer label + Library progress for a TXT book: share of the text scrolled (0–1). */
function txtSessionMeta(progress: number) {
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100)
  return { label: `${percent}%`, percent }
}

type UseReaderSessionBridgeOptions = {
  bookId: string | undefined
  epubApiRef: RefObject<EpubRendererApi | null>
  pdfApiRef: RefObject<PdfRendererApi | null>
  txtApiRef: RefObject<TextSurfaceApi | null>
  prefsRef: MutableRefObject<ReadingPrefs>
  prefsDirtyRef: MutableRefObject<boolean>
  prefs: ReadingPrefs
  sessionLoadStatus: 'loading' | 'ready'
}

export function useReaderSessionBridge({
  bookId,
  epubApiRef,
  pdfApiRef,
  txtApiRef,
  prefsRef,
  prefsDirtyRef,
  prefs,
  sessionLoadStatus,
}: UseReaderSessionBridgeOptions) {
  const navigate = useNavigate()

  const getLatestSessionSnapshot = useCallback((): SessionLatestSnapshot | null => {
    const api = epubApiRef.current
    const pdf = api ? null : pdfApiRef.current
    const txt = api || pdf ? null : txtApiRef.current
    const readingPrefs = prefsRef.current
    const location = api?.getCurrentLocation() ?? pdf?.getCurrentLocation() ?? txt?.getCurrentLocation()
    const nav = api?.getNavState()
    const pdfNav = pdf?.getNavState()
    return {
      location,
      meta: pdfNav
        ? pdfSessionMeta(pdfNav)
        : txt
          ? txtSessionMeta(txt.getProgress())
          : {
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
            marginsEnabled: readingPrefs.marginEnabled,
            marginPreset: readingPrefs.margin,
            isLandscape: readingPrefs.layout !== 'single',
          }
        : {},
    }
  }, [epubApiRef, pdfApiRef, prefsDirtyRef, prefsRef, txtApiRef])

  const { noteLocation, noteSettingsChange, flush: flushSession } =
    useReadingSessionAutosave({
      bookId,
      getLatest: getLatestSessionSnapshot,
    })

  const handleEpubLocationChange = useCallback(
    (location: CfiLocation) => {
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
          marginsEnabled: readingPrefs.marginEnabled,
          marginPreset: readingPrefs.margin,
          isLandscape: readingPrefs.layout !== 'single',
        },
      )
    },
    [epubApiRef, getLatestSessionSnapshot, noteLocation, prefsRef],
  )

  /**
   * PDF page changed (scroll or navigation). The autosave hook debounces, so calling it for every
   * page the reader scrolls past is fine; repeats of the same page are skipped here.
   */
  const lastPdfPageRef = useRef<number | null>(null)
  const handlePdfNavState = useCallback(
    (state: PdfNavState) => {
      if (state.pageTotal <= 0 || lastPdfPageRef.current === state.pageCurrent) return
      lastPdfPageRef.current = state.pageCurrent
      const latest = getLatestSessionSnapshot()
      noteLocation(new PageRectLocation(state.pageCurrent), pdfSessionMeta(state), latest?.theme ?? {})
    },
    [getLatestSessionSnapshot, noteLocation],
  )

  /** TXT scrolled to a new top line: the position is a text offset; the autosave debounces. */
  const handleTxtLocation = useCallback(
    (offset: number, textLength: number) => {
      const latest = getLatestSessionSnapshot()
      noteLocation(
        txtReadingLocation(offset, textLength),
        latest?.meta ?? txtSessionMeta(0),
        latest?.theme ?? {},
      )
    },
    [getLatestSessionSnapshot, noteLocation],
  )

  useEffect(() => {
    lastPdfPageRef.current = null
  }, [bookId])

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
    handlePdfNavState,
    handleTxtLocation,
    leaveToLibrary,
  }
}

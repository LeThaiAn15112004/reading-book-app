/**
 * Spec 017: what the TXT surface tells the opening store — shared by the Desktop and phone Readers (no copied logic).
 *
 * - FR-005: a saved offset past the end of the text (the file changed) opens at the clamped offset, with the
 *   "couldn't return to where you left off" note (`reportPositionDone(false)`).
 * - FR-006: `txt:open` failing ends the opening with its cause instead of a spinner.
 */
import { useEffect } from 'react'
import { TextOffsetLocation } from '@core'
import { reportPositionDone, reportPositionStarted, reportPrepareFailed } from '../../../../hooks/reader/readerOpeningStore'

export function useTxtOpeningReport(input: {
  isTxtSurface: boolean
  txtReady: boolean
  sessionReady: boolean
  txtLoadFailed: boolean
  txtErrorCode: string | null | undefined
  resumeLocation: unknown
  textLength: () => number
}): void {
  const { isTxtSurface, txtReady, sessionReady, txtLoadFailed, txtErrorCode, resumeLocation, textLength } = input
  useEffect(() => {
    if (!isTxtSurface || !txtReady || !sessionReady) return
    if (!(resumeLocation instanceof TextOffsetLocation)) return
    reportPositionStarted()
    reportPositionDone(resumeLocation.offset <= textLength())
    // Read once per opening, when text and saved position are both ready (like the initial offset itself).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTxtSurface, txtReady, sessionReady, resumeLocation])

  useEffect(() => {
    if (isTxtSurface && txtLoadFailed) reportPrepareFailed(txtErrorCode === 'missing_file' ? 'missing_file' : 'unreadable')
  }, [isTxtSurface, txtLoadFailed, txtErrorCode])
}

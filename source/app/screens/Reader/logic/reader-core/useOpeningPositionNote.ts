/**
 * Spec 017 (FR-005): once a book opened somewhere else than its saved position (it no longer fit the book, or reaching
 * it took more than 3 s), a short note says so. Shared by the Desktop and phone Readers; shown once per opening.
 */
import { useEffect } from 'react'
import type { Opening } from '@core'
import { getT } from '../../../../i18n'
import { dismissPositionLost } from '../../../../hooks/reader/readerOpeningStore'

export function useOpeningPositionNote(opening: Opening | null, setToast: (message: string | null) => void): void {
  const lost = opening?.outcome === 'opened' && opening.positionRestored === false
  useEffect(() => {
    if (!lost) return
    setToast(getT()('reader.chrome.opening.positionLost'))
    dismissPositionLost()
  }, [lost, setToast])
}

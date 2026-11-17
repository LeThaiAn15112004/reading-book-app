import { useEffect, useRef } from 'react'
import { isMobileHost } from '../../platforms/host'
import { useBackCloseStore } from './backCloseStore'

/**
 * While `open`, the phone's system Back closes this layer first (spec 014 FR-005) instead of leaving the page under it.
 * No-op on Desktop (no system Back; Escape stays each dialog's own handling).
 */
export function useBackClose(open: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open || !isMobileHost()) return
    const id = useBackCloseStore.getState().push(() => closeRef.current())
    return () => useBackCloseStore.getState().remove(id)
  }, [open])
}

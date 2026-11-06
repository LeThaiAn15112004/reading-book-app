import type { RefObject } from 'react'
import { useResizablePanel } from '../floatingPanel/useResizablePanel'
import { useBookSearchStore } from './bookSearchStore'

/**
 * Window-style resize for the floating search panel — thin adapter wiring the generic
 * `useResizablePanel` to `useBookSearchStore`'s size/position fields. See `useResizablePanel` for
 * the actual pointer-event mechanics.
 */
export function useResizableSearchPanel(panelRef: RefObject<HTMLDivElement | null>) {
  const size = useBookSearchStore((s) => s.panelSize)
  const resizing = useBookSearchStore((s) => s.panelResizing)
  const setSize = useBookSearchStore((s) => s.setPanelSize)
  const setResizing = useBookSearchStore((s) => s.setPanelResizing)
  const setPosition = useBookSearchStore((s) => s.setPanelPosition)

  return useResizablePanel({
    panelRef,
    size,
    resizing,
    getPosition: () => useBookSearchStore.getState().panelPosition,
    setPosition,
    setSize,
    setResizing,
  })
}

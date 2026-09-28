import type { RefObject } from 'react'
import { useResizablePanel } from '../floatingPanel/useResizablePanel'
import { useWordCountStore } from './wordCountStore'

/**
 * Window-style resize for the floating Word Count panel — thin adapter wiring the generic
 * `useResizablePanel` to `useWordCountStore`'s size/position fields, same pattern as
 * `useResizableSearchPanel`.
 */
export function useResizableWordCountPanel(panelRef: RefObject<HTMLDivElement | null>) {
  const size = useWordCountStore((s) => s.panelSize)
  const resizing = useWordCountStore((s) => s.panelResizing)
  const setSize = useWordCountStore((s) => s.setPanelSize)
  const setResizing = useWordCountStore((s) => s.setPanelResizing)
  const setPosition = useWordCountStore((s) => s.setPanelPosition)

  return useResizablePanel({
    panelRef,
    size,
    resizing,
    getPosition: () => useWordCountStore.getState().panelPosition,
    setPosition,
    setSize,
    setResizing,
  })
}

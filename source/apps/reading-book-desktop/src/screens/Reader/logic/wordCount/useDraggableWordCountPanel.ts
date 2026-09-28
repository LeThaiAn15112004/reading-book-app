import type { RefObject } from 'react'
import { useDraggablePanel } from '../floatingPanel/useDraggablePanel'
import { useWordCountStore } from './wordCountStore'

/**
 * Drag mechanics for the floating Word Count panel's header — thin adapter wiring the generic
 * `useDraggablePanel` to `useWordCountStore`'s position/dragging fields, same pattern as
 * `useDraggableSearchPanel`.
 */
export function useDraggableWordCountPanel(
  panelRef: RefObject<HTMLDivElement | null>,
  open: boolean,
) {
  const position = useWordCountStore((s) => s.panelPosition)
  const dragging = useWordCountStore((s) => s.panelDragging)
  const setPosition = useWordCountStore((s) => s.setPanelPosition)
  const setDragging = useWordCountStore((s) => s.setPanelDragging)

  return useDraggablePanel({
    panelRef,
    open,
    position,
    dragging,
    getPosition: () => useWordCountStore.getState().panelPosition,
    setPosition,
    setDragging,
  })
}

import type { RefObject } from 'react'
import { useDraggablePanel } from '../floatingPanel/useDraggablePanel'
import { useBookSearchStore } from './bookSearchStore'

/**
 * Drag mechanics for the floating search panel's header — thin adapter wiring the generic
 * `useDraggablePanel` to `useBookSearchStore`'s position/dragging fields. See `useDraggablePanel`
 * for the actual pointer-event mechanics.
 */
export function useDraggableSearchPanel(panelRef: RefObject<HTMLDivElement | null>, open: boolean) {
  const position = useBookSearchStore((s) => s.panelPosition)
  const dragging = useBookSearchStore((s) => s.panelDragging)
  const setPosition = useBookSearchStore((s) => s.setPanelPosition)
  const setDragging = useBookSearchStore((s) => s.setPanelDragging)

  return useDraggablePanel({
    panelRef,
    open,
    position,
    dragging,
    getPosition: () => useBookSearchStore.getState().panelPosition,
    setPosition,
    setDragging,
  })
}

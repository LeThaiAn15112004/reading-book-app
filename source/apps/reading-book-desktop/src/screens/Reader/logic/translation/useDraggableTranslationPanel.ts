import type { RefObject } from 'react'
import { useDraggablePanel } from '../floatingPanel/useDraggablePanel'
import { useTranslationStore } from './translationStore'

/**
 * Drag mechanics for the floating Translate panel's header — thin adapter wiring the generic
 * `useDraggablePanel` to `useTranslationStore`'s position/dragging fields, same pattern as
 * `useDraggableSearchPanel`/`useDraggableWordCountPanel`.
 */
export function useDraggableTranslationPanel(
  panelRef: RefObject<HTMLDivElement | null>,
  open: boolean,
) {
  const position = useTranslationStore((s) => s.panelPosition)
  const dragging = useTranslationStore((s) => s.panelDragging)
  const setPosition = useTranslationStore((s) => s.setPanelPosition)
  const setDragging = useTranslationStore((s) => s.setPanelDragging)

  return useDraggablePanel({
    panelRef,
    open,
    position,
    dragging,
    getPosition: () => useTranslationStore.getState().panelPosition,
    setPosition,
    setDragging,
  })
}

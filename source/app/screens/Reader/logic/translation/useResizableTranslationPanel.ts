import type { RefObject } from 'react'
import { useResizablePanel } from '../floatingPanel/useResizablePanel'
import { useTranslationStore } from './translationStore'

/**
 * Window-style resize for the floating Translate panel — thin adapter wiring the generic
 * `useResizablePanel` to `useTranslationStore`'s size/position fields, same pattern as
 * `useResizableSearchPanel`/`useResizableWordCountPanel`.
 */
export function useResizableTranslationPanel(panelRef: RefObject<HTMLDivElement | null>) {
  const size = useTranslationStore((s) => s.panelSize)
  const resizing = useTranslationStore((s) => s.panelResizing)
  const setSize = useTranslationStore((s) => s.setPanelSize)
  const setResizing = useTranslationStore((s) => s.setPanelResizing)
  const setPosition = useTranslationStore((s) => s.setPanelPosition)

  return useResizablePanel({
    panelRef,
    size,
    resizing,
    getPosition: () => useTranslationStore.getState().panelPosition,
    setPosition,
    setSize,
    setResizing,
  })
}

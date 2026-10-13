import { create } from 'zustand'
import type { PdfSelectionInfo } from '../../../../reader/renderers/pdf'

/** The right-click menu for a live PDF text selection, if open. */
export type PdfSelectionMenuState = {
  selection: PdfSelectionInfo
  point: { x: number; y: number }
}

type PdfSelectionMenuStore = {
  menu: PdfSelectionMenuState | null
  open: (selection: PdfSelectionInfo, x: number, y: number) => void
  close: () => void
}

/**
 * PDF counterpart of `highlightsStore`'s `selectionMenu`. Kept separate on purpose: that store is
 * CFI/epub.js-bound (marks, undo history, `pendingSelection` fed by epub.js events), while a PDF
 * selection is read synchronously on right-click and only feeds the non-markup menu actions.
 */
export const usePdfSelectionMenuStore = create<PdfSelectionMenuStore>()((set) => ({
  menu: null,
  open: (selection, x, y) => set({ menu: { selection, point: { x, y } } }),
  close: () => set({ menu: null }),
}))

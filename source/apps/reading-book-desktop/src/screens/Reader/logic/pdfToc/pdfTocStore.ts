import { create } from 'zustand'

type PdfTocStore = {
  /**
   * TOC entry the reader last clicked. Used only to break a tie between entries that share the
   * current page (see `resolveActivePageTocEntry`) so the clicked one — not its same-page sibling
   * or child — is the one highlighted.
   */
  pickedId: string | null
  pick: (id: string) => void
  reset: () => void
}

export const usePdfTocStore = create<PdfTocStore>()((set) => ({
  pickedId: null,
  pick: (id) => set({ pickedId: id }),
  reset: () => set({ pickedId: null }),
}))

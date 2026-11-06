import { create } from 'zustand'

const PREFS_STORAGE_KEY = 'readmate.pdfView.v1'

/** Pages shown side by side: 1 = single, 2 = double, 3 = triple. */
export type PdfPagesPerView = 1 | 2 | 3
/** `paged`: one spread at a time with a page-turn; `scroll`: every spread in one vertical scroll. */
export type PdfFlowMode = 'paged' | 'scroll'

type PdfViewPrefs = { pagesPerView: PdfPagesPerView; flow: PdfFlowMode }

/** Single source of the PDF view defaults (first run and Settings → Reset App Settings). */
export const DEFAULT_PDF_VIEW_PREFS: Readonly<PdfViewPrefs> = { pagesPerView: 1, flow: 'scroll' }

function loadPrefs(): PdfViewPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? 'null') as Partial<PdfViewPrefs> | null
    const n = parsed?.pagesPerView
    return {
      pagesPerView: n === 1 || n === 2 || n === 3 ? n : DEFAULT_PDF_VIEW_PREFS.pagesPerView,
      flow: parsed?.flow === 'paged' || parsed?.flow === 'scroll' ? parsed.flow : DEFAULT_PDF_VIEW_PREFS.flow,
    }
  } catch {
    return { ...DEFAULT_PDF_VIEW_PREFS }
  }
}

/** Returns false when the write failed (quota / private mode) — the choice just won't persist. */
function savePrefs(prefs: PdfViewPrefs): boolean {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

type PdfViewState = PdfViewPrefs & {
  setPagesPerView: (pagesPerView: PdfPagesPerView) => void
  setFlow: (flow: PdfFlowMode) => void
  /** Reset App Settings: back to `DEFAULT_PDF_VIEW_PREFS`; false when the write failed. */
  reset: () => boolean
}

/** How the PDF reader lays out pages (1/2/3 per view × page-turn / scroll). Remembered across books. */
export const usePdfViewStore = create<PdfViewState>()((set, get) => ({
  ...loadPrefs(),
  setPagesPerView: (pagesPerView) => {
    set({ pagesPerView })
    savePrefs({ pagesPerView, flow: get().flow })
  },
  setFlow: (flow) => {
    set({ flow })
    savePrefs({ pagesPerView: get().pagesPerView, flow })
  },
  reset: () => {
    set({ ...DEFAULT_PDF_VIEW_PREFS })
    return savePrefs({ ...DEFAULT_PDF_VIEW_PREFS })
  },
}))

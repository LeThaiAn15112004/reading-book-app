import { create } from 'zustand'
import { PDF_INK_MAX_WIDTH, PDF_INK_MIN_WIDTH, isValidHexColor } from '@reading-book/book-reader-sdk'

const PREFS_STORAGE_KEY = 'readmate.pdfInkPrefs.v1'

/** Pen settings, applied to the NEXT stroke only — a saved stroke keeps what it was drawn with. */
export type PdfInkPenPrefs = {
  colorHex: string
  /** Fraction of the page width (zoom-independent). */
  width: number
}

type PdfInkPrefs = { pen: PdfInkPenPrefs; tool: PdfInkTool }

/** Single source of the pen defaults (first run and Settings → Reset App Settings). 0.004 ≈ 2.4 pt on a 612 pt page. */
export const DEFAULT_PDF_INK_PREFS: Readonly<PdfInkPrefs> = { pen: { colorHex: '#1E88E5', width: 0.004 }, tool: 'pen' }

/** Drawing tools in the Freehand menu. Only the ones in `PDF_INK_OPERATIONAL_TOOLS` draw; the rest are listed, not built. */
export type PdfInkTool = 'pen' | 'pencil' | 'brush' | 'marker'

export const PDF_INK_OPERATIONAL_TOOLS: readonly PdfInkTool[] = ['pen']

/** Slider range for the stroke thickness (fraction of the page width) — inside the SDK's accepted range. */
export const PDF_INK_SLIDER_MIN = 0.0015
export const PDF_INK_SLIDER_MAX = 0.02
export const PDF_INK_SLIDER_STEP = 0.0005

/** A page is ~612 pt wide: thickness shown to the user in points. */
export function inkWidthToPoints(width: number): number {
  return width * 612
}

/** `#RRGGBB` from what the user typed (`#` optional, `RGB` shorthand allowed); null when it is not a colour. */
export function parseHexInput(raw: string): string | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(raw.trim())
  if (!m) return null
  const h = m[1]!
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return `#${full.toUpperCase()}`
}

function clampWidth(width: number): number {
  return Math.min(PDF_INK_MAX_WIDTH, Math.max(PDF_INK_MIN_WIDTH, width))
}

function loadPrefs(): PdfInkPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? 'null') as { pen?: Partial<PdfInkPenPrefs>; tool?: string } | null
    const colorHex = parsed?.pen?.colorHex
    const width = parsed?.pen?.width
    const tool = PDF_INK_OPERATIONAL_TOOLS.find((t) => t === parsed?.tool) ?? DEFAULT_PDF_INK_PREFS.tool
    return {
      tool,
      pen: {
        colorHex: typeof colorHex === 'string' && isValidHexColor(colorHex) ? colorHex : DEFAULT_PDF_INK_PREFS.pen.colorHex,
        width: typeof width === 'number' && Number.isFinite(width) ? clampWidth(width) : DEFAULT_PDF_INK_PREFS.pen.width,
      },
    }
  } catch {
    return { pen: { ...DEFAULT_PDF_INK_PREFS.pen }, tool: DEFAULT_PDF_INK_PREFS.tool }
  }
}

/** Returns false when the write failed (quota / private mode) — the choice just won't persist. */
function savePrefs(prefs: PdfInkPrefs): boolean {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

type PdfInkPrefsState = PdfInkPrefs & {
  setPenColor: (colorHex: string) => void
  setPenWidth: (width: number) => void
  /** Ignored for tools that are not built yet. */
  setTool: (tool: PdfInkTool) => void
  /** Reset App Settings: back to `DEFAULT_PDF_INK_PREFS`; false when the write failed. */
  reset: () => boolean
}

/** Last-used pen settings, remembered across books and restarts (localStorage, like the other app preferences). */
export const usePdfInkPrefsStore = create<PdfInkPrefsState>()((set, get) => ({
  ...loadPrefs(),
  setPenColor: (colorHex) => {
    if (!isValidHexColor(colorHex)) return
    const pen = { ...get().pen, colorHex }
    set({ pen })
    savePrefs({ pen, tool: get().tool })
  },
  setPenWidth: (width) => {
    if (!Number.isFinite(width)) return
    const pen = { ...get().pen, width: clampWidth(width) }
    set({ pen })
    savePrefs({ pen, tool: get().tool })
  },
  setTool: (tool) => {
    if (!PDF_INK_OPERATIONAL_TOOLS.includes(tool)) return
    set({ tool })
    savePrefs({ pen: get().pen, tool })
  },
  reset: () => {
    const pen = { ...DEFAULT_PDF_INK_PREFS.pen }
    const tool = DEFAULT_PDF_INK_PREFS.tool
    set({ pen, tool })
    return savePrefs({ pen, tool })
  },
}))

import { create } from 'zustand'
import {
  TYPEWRITER_ALIGNS,
  clampTypewriterSize,
  defaultTypewriterStyle,
  isTypewriterColor,
  isTypewriterFamily,
  type TypewriterAlign,
  type TypewriterTextStyle,
} from '@reading-book/book-reader-sdk'

const PREFS_STORAGE_KEY = 'readmate.pdfTypewriterPrefs.v1'

/** The look of the NEXT Typewriter note (a saved note keeps what it was created with). */
export type PdfTypewriterPrefs = { style: TypewriterTextStyle; align: TypewriterAlign }

/** Single source of the Typewriter defaults (first run and Settings → Reset App Settings). */
export const DEFAULT_PDF_TYPEWRITER_PREFS: Readonly<PdfTypewriterPrefs> = { style: defaultTypewriterStyle(), align: 'left' }

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)

/** Per-field fallback: one invalid stored value never discards the others. */
function loadPrefs(): PdfTypewriterPrefs {
  const d = DEFAULT_PDF_TYPEWRITER_PREFS
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? 'null') as { style?: Record<string, unknown>; align?: unknown } | null
    if (!raw || typeof raw !== 'object') return { style: { ...d.style }, align: d.align }
    const s = raw.style && typeof raw.style === 'object' ? raw.style : {}
    return {
      style: {
        family: isTypewriterFamily(s.family) ? s.family : d.style.family,
        size: typeof s.size === 'number' && Number.isFinite(s.size) ? clampTypewriterSize(s.size) : d.style.size,
        color: isTypewriterColor(s.color) ? s.color.toUpperCase() : d.style.color,
        bold: bool(s.bold, d.style.bold),
        italic: bool(s.italic, d.style.italic),
        underline: bool(s.underline, d.style.underline),
        strike: bool(s.strike, d.style.strike),
      },
      align: TYPEWRITER_ALIGNS.includes(raw.align as TypewriterAlign) ? (raw.align as TypewriterAlign) : d.align,
    }
  } catch {
    return { style: { ...d.style }, align: d.align }
  }
}

/** Returns false when the write failed (quota / private mode) — the choice just won't persist. */
function savePrefs(prefs: PdfTypewriterPrefs): boolean {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

type PdfTypewriterPrefsState = PdfTypewriterPrefs & {
  setStyle: (patch: Partial<TypewriterTextStyle>) => void
  setAlign: (align: TypewriterAlign) => void
  /** Reset App Settings: back to `DEFAULT_PDF_TYPEWRITER_PREFS`; false when the write failed. */
  reset: () => boolean
}

/** Last-used Typewriter look, remembered across books and restarts (localStorage, like the other app preferences). */
export const usePdfTypewriterPrefsStore = create<PdfTypewriterPrefsState>()((set, get) => ({
  ...loadPrefs(),
  setStyle: (patch) => {
    const merged = { ...get().style, ...patch }
    const style: TypewriterTextStyle = {
      family: isTypewriterFamily(merged.family) ? merged.family : get().style.family,
      size: Number.isFinite(merged.size) ? clampTypewriterSize(merged.size) : get().style.size,
      color: isTypewriterColor(merged.color) ? merged.color.toUpperCase() : get().style.color,
      bold: !!merged.bold,
      italic: !!merged.italic,
      underline: !!merged.underline,
      strike: !!merged.strike,
    }
    set({ style })
    savePrefs({ style, align: get().align })
  },
  setAlign: (align) => {
    if (!TYPEWRITER_ALIGNS.includes(align)) return
    set({ align })
    savePrefs({ style: get().style, align })
  },
  reset: () => {
    const next = { style: { ...DEFAULT_PDF_TYPEWRITER_PREFS.style }, align: DEFAULT_PDF_TYPEWRITER_PREFS.align }
    set(next)
    return savePrefs(next)
  },
}))

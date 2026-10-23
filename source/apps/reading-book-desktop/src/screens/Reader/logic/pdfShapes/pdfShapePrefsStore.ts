import { create } from 'zustand'
import { PDF_SHAPE_DEFAULT_STROKE, clampShapeStroke, isPdfShapeKind, type PdfShapeKind } from '@reading-book/book-reader-sdk'

const PREFS_STORAGE_KEY = 'readmate.pdfShapePrefs.v1'

/** The look of the NEXT shape: stroke colour / thickness / opacity (a saved shape keeps what it was drawn with). */
export type PdfShapePrefs = {
  /** Which shape the Shape tool draws. */
  kind: PdfShapeKind
  /** `#RRGGBB`. */
  colorHex: string
  /** Pen width, fraction of the page width. */
  width: number
  /** 0.05–1. */
  opacity: number
}

/** Single source of the Shape defaults (first run and Settings → Reset App Settings). */
export const DEFAULT_PDF_SHAPE_PREFS: Readonly<PdfShapePrefs> = { kind: 'rectangle', colorHex: '#E53935', width: PDF_SHAPE_DEFAULT_STROKE, opacity: 1 }

const clampOpacity = (v: number) => Math.min(1, Math.max(0.05, v))

function loadPrefs(): PdfShapePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? 'null') as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PDF_SHAPE_PREFS }
    return {
      kind: isPdfShapeKind(raw.kind) ? raw.kind : DEFAULT_PDF_SHAPE_PREFS.kind,
      colorHex: typeof raw.colorHex === 'string' && /^#[0-9a-f]{6}$/i.test(raw.colorHex.trim()) ? raw.colorHex.trim().toUpperCase() : DEFAULT_PDF_SHAPE_PREFS.colorHex,
      width: typeof raw.width === 'number' && Number.isFinite(raw.width) ? clampShapeStroke(raw.width) : DEFAULT_PDF_SHAPE_PREFS.width,
      opacity: typeof raw.opacity === 'number' && Number.isFinite(raw.opacity) ? clampOpacity(raw.opacity) : DEFAULT_PDF_SHAPE_PREFS.opacity,
    }
  } catch {
    return { ...DEFAULT_PDF_SHAPE_PREFS }
  }
}

/** Returns false when the write failed (quota / private mode) — the choice just won't persist. */
function savePrefs(prefs: PdfShapePrefs): boolean {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

type PdfShapePrefsState = PdfShapePrefs & {
  setKind: (kind: PdfShapeKind) => void
  setColor: (colorHex: string) => void
  setWidth: (width: number) => void
  setOpacity: (opacity: number) => void
  /** Reset App Settings: back to `DEFAULT_PDF_SHAPE_PREFS`; false when the write failed. */
  reset: () => boolean
}

const pick = (s: PdfShapePrefs): PdfShapePrefs => ({ kind: s.kind, colorHex: s.colorHex, width: s.width, opacity: s.opacity })

/** Last-used Shape settings, remembered across books and restarts (localStorage, like the other app preferences). */
export const usePdfShapePrefsStore = create<PdfShapePrefsState>()((set, get) => {
  const patch = (next: Partial<PdfShapePrefs>) => {
    set(next)
    savePrefs(pick(get()))
  }
  return {
    ...loadPrefs(),
    setKind: (kind) => {
      if (isPdfShapeKind(kind) && kind !== get().kind) patch({ kind })
    },
    setColor: (colorHex) => {
      // Applied as it is picked (the picker fires many times): an unchanged colour writes nothing.
      if (/^#[0-9a-f]{6}$/i.test(colorHex) && colorHex.toUpperCase() !== get().colorHex) patch({ colorHex: colorHex.toUpperCase() })
    },
    setWidth: (width) => {
      if (Number.isFinite(width)) patch({ width: clampShapeStroke(width) })
    },
    setOpacity: (opacity) => {
      if (Number.isFinite(opacity)) patch({ opacity: clampOpacity(opacity) })
    },
    reset: () => {
      set({ ...DEFAULT_PDF_SHAPE_PREFS })
      return savePrefs({ ...DEFAULT_PDF_SHAPE_PREFS })
    },
  }
})

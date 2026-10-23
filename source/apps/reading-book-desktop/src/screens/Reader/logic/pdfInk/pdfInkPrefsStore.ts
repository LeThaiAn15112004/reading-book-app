import { create } from 'zustand'
import {
  INK_PEN_PRESETS,
  INK_PEN_STYLES,
  clampInkOpacity,
  clampInkWidth,
  isInkPenStyle,
  type InkPenStyle,
} from '@reading-book/book-reader-sdk'

/** Same key as Phase 1; the old `{ pen, tool }` shape is read as the Pen's settings. */
const PREFS_STORAGE_KEY = 'readmate.pdfInkPrefs.v1'

/** One style's remembered settings. Applied to the NEXT stroke only — a saved stroke keeps what it was drawn with. */
export type PdfInkStyleSettings = {
  /** `#RRGGBB`. */
  colorHex: string
  /** Fraction of the page width (zoom-independent). */
  width: number
  /** 0–1; fixed at 1 for the Pen. */
  opacity: number
}

export type PdfInkPrefs = {
  /** The drawing style the Freehand tool uses. */
  tool: InkPenStyle
  /** Color / thickness / opacity remembered separately per style. */
  styles: Record<InkPenStyle, PdfInkStyleSettings>
}

function defaultSettings(style: InkPenStyle): PdfInkStyleSettings {
  const p = INK_PEN_PRESETS[style]
  return { colorHex: p.colorHex, width: p.width, opacity: p.opacity }
}

/** Single source of the Freehand defaults (first run and Settings → Reset App Settings). */
export const DEFAULT_PDF_INK_PREFS: Readonly<PdfInkPrefs> = {
  tool: 'pen',
  styles: { pen: defaultSettings('pen'), pencil: defaultSettings('pencil'), marker: defaultSettings('marker'), brush: defaultSettings('brush') },
}

function freshDefaults(): PdfInkPrefs {
  return { tool: 'pen', styles: { pen: defaultSettings('pen'), pencil: defaultSettings('pencil'), marker: defaultSettings('marker'), brush: defaultSettings('brush') } }
}

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

function readSettings(style: InkPenStyle, raw: unknown): PdfInkStyleSettings {
  const base = defaultSettings(style)
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  return {
    colorHex: typeof r.colorHex === 'string' && /^#[0-9a-f]{6}$/i.test(r.colorHex.trim()) ? r.colorHex.trim().toUpperCase() : base.colorHex,
    width: typeof r.width === 'number' && Number.isFinite(r.width) ? clampInkWidth(style, r.width) : base.width,
    opacity: typeof r.opacity === 'number' && Number.isFinite(r.opacity) ? clampInkOpacity(style, r.opacity) : base.opacity,
  }
}

function loadPrefs(): PdfInkPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? 'null') as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return freshDefaults()
    const styles = (parsed.styles && typeof parsed.styles === 'object' ? parsed.styles : {}) as Record<string, unknown>
    return {
      tool: isInkPenStyle(parsed.tool) ? parsed.tool : 'pen',
      styles: {
        // Phase 1 stored the Pen's colour / width under `pen`.
        pen: readSettings('pen', styles.pen ?? parsed.pen),
        pencil: readSettings('pencil', styles.pencil),
        marker: readSettings('marker', styles.marker),
        // Absent in preferences saved before the Brush existed: the Brush defaults.
        brush: readSettings('brush', styles.brush),
      },
    }
  } catch {
    return freshDefaults()
  }
}

/** Returns false when the write failed (quota / private mode) — the choice just won't persist. */
function savePrefs(prefs: PdfInkPrefs): boolean {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ tool: prefs.tool, styles: prefs.styles }))
    return true
  } catch {
    return false
  }
}

type PdfInkPrefsState = PdfInkPrefs & {
  /** Switch the Freehand drawing style (each style keeps its own settings). */
  setTool: (tool: InkPenStyle) => void
  setStyleColor: (style: InkPenStyle, colorHex: string) => void
  setStyleWidth: (style: InkPenStyle, width: number) => void
  /** Ignored for the Pen (always opaque). */
  setStyleOpacity: (style: InkPenStyle, opacity: number) => void
  /** Reset App Settings: back to `DEFAULT_PDF_INK_PREFS`; false when the write failed. */
  reset: () => boolean
}

/** Last-used Freehand settings, remembered per style across books and restarts (localStorage, like the other app preferences). */
export const usePdfInkPrefsStore = create<PdfInkPrefsState>()((set, get) => {
  const patchStyle = (style: InkPenStyle, patch: Partial<PdfInkStyleSettings>) => {
    const styles = { ...get().styles, [style]: { ...get().styles[style], ...patch } }
    set({ styles })
    savePrefs({ tool: get().tool, styles })
  }
  return {
    ...loadPrefs(),
    setTool: (tool) => {
      if (!isInkPenStyle(tool) || tool === get().tool) return
      set({ tool })
      savePrefs({ tool, styles: get().styles })
    },
    setStyleColor: (style, colorHex) => {
      if (!isInkPenStyle(style) || !/^#[0-9a-f]{6}$/i.test(colorHex)) return
      patchStyle(style, { colorHex: colorHex.toUpperCase() })
    },
    setStyleWidth: (style, width) => {
      if (!isInkPenStyle(style) || !Number.isFinite(width)) return
      patchStyle(style, { width: clampInkWidth(style, width) })
    },
    setStyleOpacity: (style, opacity) => {
      if (!isInkPenStyle(style) || !INK_PEN_PRESETS[style].opacityEditable || !Number.isFinite(opacity)) return
      patchStyle(style, { opacity: clampInkOpacity(style, opacity) })
    },
    reset: () => {
      const defaults = freshDefaults()
      set(defaults)
      return savePrefs(defaults)
    },
  }
})

/** The look of the next stroke: the active style with its remembered settings. */
export function activeInkLook(state: PdfInkPrefs): PdfInkStyleSettings & { penStyle: InkPenStyle } {
  return { penStyle: state.tool, ...state.styles[state.tool] }
}

export { INK_PEN_STYLES }

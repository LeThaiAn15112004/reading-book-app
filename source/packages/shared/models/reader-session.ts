/**
 * In-memory Reader session / overlay shapes (platform-agnostic).
 * Persistence lands in G4–G5; UI shells map these into React state.
 */

/** Primary reading interaction modes + optional annotate placement tools. */
export type AnnotateTool =
  | 'hand'
  | 'select'
  | 'highlight'
  | 'pencil'
  | 'shape'
  | 'eraser'
  | 'typewriter'
  | 'esign'
  | null

/** Freehand / shape drawing tools on the reading surface. */
export type DrawingTool = 'pencil' | 'shape' | 'eraser'

/** Stroke + color prefs for Pencil / Shape (toolbar double-click popover). */
export type DrawToolSettings = {
  strokeWidth: number
  colorHex: string
}

export const DRAW_STROKE_WIDTHS = [1, 2, 4, 6, 8] as const

export const DRAW_COLOR_SWATCHES = [
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#171717',
] as const

export const DEFAULT_DRAW_SETTINGS: DrawToolSettings = {
  strokeWidth: 2,
  colorHex: '#ef4444',
}

/** Cursor / pointer modes for the reading surface (always one active). */
/**
 * Surface interaction mode derived from the toolbar `AnnotateTool`.
 * Toolbar `activeTool` is authoritative — page gestures never mutate it.
 * Cursor shapes are CSS-driven on the EPUB surface (text / pointer / grab).
 * - hand: browse — I-beam over text (native select/copy), grab/pan on margins
 * - select: text-selection focused (I-beam); margin pan without changing toolbar
 * - highlight: selection paints a highlight mark
 * - typewriter: custom typewriter+I-beam cursor; placement — no text select
 * - annotate: crosshair placement (draw / esign) — no text select
 */
export type InteractionTool =
  | 'hand'
  | 'select'
  | 'highlight'
  | 'typewriter'
  | 'annotate'

/** Quick swatch names in SelectionTooltip (FR-06 ≤ 2 taps). */
export type HighlightColor = 'yellow' | 'green' | 'pink'

/**
 * Preset swatch → `#RRGGBB` for SQLite `color_hex` / domain Highlight (T5.2).
 * Matches SelectionTooltip dots; custom picker may use any valid hex.
 */
export const HIGHLIGHT_COLOR_HEX: Record<HighlightColor, string> = {
  yellow: '#f59e0b',
  green: '#10b981',
  pink: '#ec4899',
}

export type PageLayout = 'single' | 'dual' | 'triple'
export type PageMode = 'scroll' | 'paginated'

/** Selection geometry in viewport coords (numbers only — no DOM nodes). */
export type ViewportRect = {
  top: number
  left: number
  width: number
  height: number
}

/** One-line caret anchor for highlight range handles (T5.1). */
export type HighlightHandleAnchor = {
  top: number
  left: number
  lineHeight: number
}

/** Bounding box plus start/end line anchors for Word-like selection handles. */
export type HighlightHandleRect = ViewportRect & {
  start: HighlightHandleAnchor
  end: HighlightHandleAnchor
}

export type FakePendingSelection = {
  source: 'fake'
  chapterIndex: number
  paragraphIndex: number
  selectedText: string
  rect: HighlightHandleRect
}

export type EpubPendingSelection = {
  source: 'epub'
  /** epubjs combined range CFI */
  cfiRange: string
  locationStart: string
  locationEnd: string
  selectedText: string
  rect: HighlightHandleRect
  /** Spine index at selection time (sidebar list until T5.8 CFI jump). */
  chapterIndex: number
}

export type PendingSelection = FakePendingSelection | EpubPendingSelection

/** Same vocabulary as the `annotations` table (see domain `AnnotationType`). */
export type ReaderAnnotationType =
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'freehand'
  | 'textbox'
  | 'stamp'

export type ReaderAnnotationStatus = 'None' | 'Review' | 'Done'

export type FakeReaderHighlight = {
  source: 'fake'
  id: string
  type?: 'highlight'
  chapterIndex: number
  paragraphIndex: number
  selectedText: string
  color: HighlightColor
  colorHex: string
  note?: string
  status?: ReaderAnnotationStatus
  isChecked?: boolean
  createdAt: string
  updatedAt: string
}

export type EpubReaderHighlight = {
  source: 'epub'
  id: string
  type?: 'highlight'
  cfiRange: string
  locationStart: string
  locationEnd: string
  selectedText: string
  color: HighlightColor
  colorHex: string
  note?: string
  chapterIndex: number
  status?: ReaderAnnotationStatus
  isChecked?: boolean
  createdAt: string
  updatedAt: string
}

export type ReaderHighlight = FakeReaderHighlight | EpubReaderHighlight

export type ReaderTypewriterNote = {
  id: string
  type: 'textbox'
  chapterIndex: number
  positionData: string
  content: string
  colorHex?: string
  fontFamily?: string
  fontSize?: number
  /** Surface that created the anchor — set on hydrate / place. */
  source?: TypewriterNoteSource
  /** Denormalized EPUB CFI when anchored (T5.6d). */
  cfi?: string
  status: ReaderAnnotationStatus
  isChecked: boolean
  createdAt: string
  updatedAt: string
}

export type TypewriterNoteSource = 'fake' | 'epub' | 'pdf'

/** EPUB click placement — coords for virtual textbox before persist. */
export type TypewriterPlacePayload = {
  chapterIndex: number
  xPct: number
  yPct: number
  /** Viewport (parent) client coords. */
  clientX: number
  clientY: number
  /** Position relative to EpubRenderer host (px). */
  hostX: number
  hostY: number
  /** EPUB CFI anchor (T5.6d). */
  cfi?: string
  offsetPx?: { x: number; y: number }
}

/** In-progress virtual textbox (not yet in `annotations`). */
export type TypewriterDraft = {
  /** Stable id for this draft session (blur commit must match). */
  id: string
  chapterIndex: number
  xPct: number
  yPct: number
  content: string
  hostX: number
  hostY: number
  /** Box-level defaults (mirrored into `style_properties` on commit). */
  colorHex?: string
  fontSize?: number
  cfi?: string
  offsetPx?: { x: number; y: number }
}

/** Drag / move payload from reading surface. */
export type TypewriterMovePayload = {
  xPct: number
  yPct: number
  cfi?: string
  offsetPx?: { x: number; y: number }
}

export type ReaderShapeAnnotation = {
  id: string
  type: 'freehand'
  chapterIndex: number
  locationData: string
  colorHex?: string
  status: ReaderAnnotationStatus
  isChecked: boolean
  createdAt: string
  updatedAt: string
}

export type ReaderAnnotation =
  | ReaderHighlight
  | ReaderTypewriterNote
  | ReaderShapeAnnotation

/** Legacy selection-note shape retained for existing UI call sites. */
export type ReaderNote = {
  id: string
  chapterIndex: number
  paragraphIndex: number
  selectedText: string
  content: string
}

export type ReaderBookmark = {
  id: string
  /** Location.toString() JSON (may embed `chapterIndex` for ribbon matching). */
  locationRef: string
  chapterIndex: number
  label: string
  createdAt?: string
}

/** Legacy alias retained while Typewriter IPC is implemented. */
export type TypewriterMark = {
  id: string
  chapterIndex: number
  xPct: number
  yPct: number
  text: string
}

export type ESignStamp = {
  id: string
  chapterIndex: number
  xPct: number
  yPct: number
  label: string
}

export type ReaderSignature = {
  id: string
  signerName: string
  signatureStatus: 'valid' | 'invalid' | 'expired' | 'unknown'
  signedAt?: string
}

let seq = 0

/** Stable-enough client ids for in-memory overlays before SQLite persist. */
export function nextReaderOverlayId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

/** @deprecated Prefer `nextReaderOverlayId` — alias kept for call sites. */
export const nextId = nextReaderOverlayId

export const TOOL_LABELS: Record<Exclude<AnnotateTool, null>, string> = {
  hand: 'Hand',
  select: 'Text Select',
  highlight: 'Highlight',
  pencil: 'Pencil',
  shape: 'Shape',
  eraser: 'Eraser',
  typewriter: 'Typewriter',
  esign: 'eSign',
}

export function isDrawingTool(tool: AnnotateTool): tool is DrawingTool {
  return tool === 'pencil' || tool === 'shape' || tool === 'eraser'
}

/** Tools that use a crosshair cursor for on-page placement or drawing. */
export function isCrosshairAnnotateTool(tool: AnnotateTool): boolean {
  return (
    tool === 'typewriter' ||
    tool === 'esign' ||
    isDrawingTool(tool)
  )
}

/** Tools that suppress the text-selection context menu. */
export function blocksSelectionContextMenu(tool: AnnotateTool): boolean {
  return isCrosshairAnnotateTool(tool) || tool === 'highlight'
}

/** Normalize to lowercase `#rrggbb`, or undefined if invalid. */
export function normalizeHighlightColorHex(
  value: string,
): string | undefined {
  const trimmed = value.trim().toLowerCase()
  const short = trimmed.match(/^#([0-9a-f]{3})$/)
  if (short?.[1]) {
    const rgb = short[1]
    const r = rgb[0]
    const g = rgb[1]
    const b = rgb[2]
    return `#${r}${r}${g}${g}${b}${b}`
  }
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed
  return undefined
}

/** Map hex back to a preset name when it matches; otherwise nearest default yellow. */
export function highlightColorFromHex(colorHex: string): HighlightColor {
  const normalized = normalizeHighlightColorHex(colorHex)
  if (!normalized) return 'yellow'
  for (const key of Object.keys(HIGHLIGHT_COLOR_HEX) as HighlightColor[]) {
    if (HIGHLIGHT_COLOR_HEX[key] === normalized) return key
  }
  return 'yellow'
}

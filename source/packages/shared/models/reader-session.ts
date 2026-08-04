/**
 * In-memory Reader session / overlay shapes (platform-agnostic).
 * Persistence lands in G4–G5; UI shells map these into React state.
 */

/** Primary reading interaction modes + optional annotate placement tools. */
export type AnnotateTool =
  | 'hand'
  | 'select'
  | 'highlight'
  | 'comment'
  | 'typewriter'
  | 'esign'
  | null

/** Cursor / pointer modes for the reading surface (always one active). */
export type InteractionTool = 'hand' | 'select' | 'highlight'

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

export type FakeReaderHighlight = {
  source: 'fake'
  id: string
  chapterIndex: number
  paragraphIndex: number
  selectedText: string
  /** Preset name when chosen from quick swatches. */
  color: HighlightColor
  /** Canonical `#rrggbb` for overlay / T5.2 persist. */
  colorHex: string
  /** Inline note on the highlight (highlights.note). */
  note?: string
  createdAt: string
  updatedAt: string
}

export type EpubReaderHighlight = {
  source: 'epub'
  id: string
  cfiRange: string
  locationStart: string
  locationEnd: string
  selectedText: string
  color: HighlightColor
  colorHex: string
  /** Spine index when captured — list/jump stub until T5.8. */
  chapterIndex: number
  /** Inline note on the highlight (highlights.note). */
  note?: string
  createdAt: string
  updatedAt: string
}

export type ReaderHighlight = FakeReaderHighlight | EpubReaderHighlight

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

export type ReaderComment = {
  id: string
  chapterIndex: number
  paragraphIndex: number
  content: string
  authorName: string
  createdAt: string
}

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
  comment: 'Comment',
  typewriter: 'Typewriter',
  esign: 'eSign',
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

/**
 * The phone reader's reading surface (spec 019, FR-020 – FR-023; `specs/019-mobile-reader-redesign/contracts/
 * reading-surface.md`): ONE object answering, for the open format, everything the phone chrome needs. Built by
 * `useReadingSurface` — the only place in `screens/Reader/phone/**` that branches on the book's format.
 */
import type { HighlightStyleKind, Place, ReaderBookmark, ReaderHighlightBase, ZoomEdge } from '@core'
import type { EpubTocItem } from '../../../../components/reader/renderers/epub'

export type SurfaceFormat = 'epub' | 'pdf' | 'md' | 'txt'
export type SurfaceView = 'page' | 'scroll'
export type MarkKind = 'highlight' | 'underline' | 'strikethrough'

export interface ActiveMark {
  highlight: ReaderHighlightBase
  /** Open with the note field focused (a mark just made with "Note"). */
  focusNote: boolean
  setColor: (hex: string) => void
  setStyle: (kind: MarkKind) => void
  setNote: (note: string) => void
  remove: () => void
  close: () => void
}

export interface SurfaceSelection {
  text: string
  /** Mark the selection in one step (FR-015); clears it. */
  mark: (kind: MarkKind, colorHex: string) => void
  /** Mark it as a highlight, then open the mark's panel on its note. */
  note: (colorHex: string) => void
  close: () => void
}

export interface SurfaceBookmarks {
  list: readonly ReaderBookmark[]
  isHere: boolean
  toggle: () => void
  jump: (bookmark: ReaderBookmark) => void
  remove: (id: string) => void
}

/** Which Appearance sections take effect in this format (FR-013). */
export interface SurfaceAppearance {
  text: boolean
  view: boolean
  zoom: boolean
}

export interface SurfaceZoom {
  percent: number
  step: (direction: 1 | -1) => void
  fit: () => void
}

export interface ReadingSurface {
  format: SurfaceFormat
  view: SurfaceView
  /** EPUB / PDF only (FR-013, FR-013a); keeps the position. */
  setView?: (view: SurfaceView) => void

  place: Place
  /** `place` as the bottom bar shows it. */
  placeText: { name: string | null; detail: string }
  progress: number
  goToProgress: (fraction: number) => void
  /** Page view only; false when there is no page that way. */
  turn?: (direction: 'next' | 'prev') => boolean
  toc: readonly EpubTocItem[]
  activeTocId: string | null
  activeTocHref?: string
  goToToc: (item: EpubTocItem) => void

  /** Absent for TXT (FR-015a). */
  bookmarks?: SurfaceBookmarks

  marks: readonly ReaderHighlightBase[]
  openMark: (id: string) => void
  jumpToMark: (id: string) => void
  activeMark: ActiveMark | null

  selection: SurfaceSelection | null
  /** Drops the native / renderer selection. */
  clearSelection: () => void
  lastColorHex: string

  appearance: SurfaceAppearance
  zoom?: SurfaceZoom
  /** PDF Page view zoomed: which page edges show; null when the page fits. */
  zoomEdge?: () => ZoomEdge | null
  isMarkAt?: (x: number, y: number) => boolean
}

export const MARK_STYLES: readonly MarkKind[] = ['highlight', 'underline', 'strikethrough']

export function isMarkKind(kind: HighlightStyleKind): kind is MarkKind {
  return (MARK_STYLES as readonly string[]).includes(kind)
}

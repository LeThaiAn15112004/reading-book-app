import type { BookmarkRecord } from '../domain/annotation/bookmark.js'
import type { HighlightRecord } from '../domain/annotation/highlight.js'
import type { Location } from '../domain/index.js'

/** Anything the reader surface can paint: a highlight/underline/strikethrough/textbox or a bookmark ribbon marker. */
export type ReaderMarkup = HighlightRecord | BookmarkRecord

/**
 * The rendering engine for the currently open book, as the stores see it (epub.js / foliate on
 * desktop, a WebView bridge on mobile, nothing at all in a headless host).
 *
 * Unlike the other adapters this is attached at runtime (`sdk.attachSurface`) because the
 * engine only exists while a reader screen is mounted. Every method is optional: stores call
 * what is there and keep their state consistent either way — a host without a surface still
 * gets correct lists, persistence and undo/redo.
 */
export interface ReaderSurface {
  /** Paint (or repaint) one markup. Must be idempotent for the same `id`. */
  paintMarkup?(markup: ReaderMarkup): void
  /**
   * Remove a painted markup. Receives the snapshot that was painted: engines like epub.js key
   * marks by `(cfiRange, type)`, so a kind change must remove by the OLD kind.
   */
  unpaintMarkup?(markup: ReaderMarkup): void
  setFocusedMarkup?(id: string | null): void
  /** Brief attention pulse after jumping to a markup. */
  flashMarkup?(markup: ReaderMarkup): void
  clearSelection?(): void
  /** Navigate to a location; reject when it cannot be resolved in the document. */
  goTo?(location: Location, options?: { chapterIndex?: number }): Promise<void>
}

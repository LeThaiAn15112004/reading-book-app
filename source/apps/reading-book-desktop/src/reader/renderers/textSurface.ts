import type { Location } from '@reading-book/book-reader-sdk'

/**
 * What the Reader shell needs from a continuous-text surface (TXT, Markdown): scroll progress,
 * seeking and the reading position. Both renderers' imperative APIs satisfy it.
 */
export type TextSurfaceApi = {
  /** 0–1 share of the page scrolled. */
  getProgress: () => number
  scrollToFraction: (fraction: number) => void
  scrollByPage: (direction: 1 | -1) => void
  /** Saved with the session; undefined when the surface has no position model (Markdown today). */
  getCurrentLocation: () => Location | undefined
}

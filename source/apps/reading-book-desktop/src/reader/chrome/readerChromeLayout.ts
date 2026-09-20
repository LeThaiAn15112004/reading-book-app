import type { ReadingViewMode } from '@reading-book/book-reader-sdk'

/** Layout constants for SCR-03 reader chrome (tools bar + footer). */

/** Matches ReaderFooter `h-10` — sidebar/rail must stop above this. */
export const READER_FOOTER_HEIGHT_PX = 40

/**
 * Breathing room below the last line of text and above the footer's top
 * edge — the footer itself is `fixed inset-x-0 bottom-0`, so without this the
 * reading content and the footer would sit flush against each other.
 */
export const READER_FOOTER_CONTENT_GAP_PX = 10

/**
 * Matches ReaderTopbar `h-[4.25rem] sm:h-[4.5rem]` — defined in index.css as
 * `--reader-topbar-height`.
 */
export const READER_TOPBAR_INSET_CSS = 'var(--reader-topbar-height, 4.25rem)'

/** Top offset for sidebar / reading viewport when tools chrome is open. */
export function readerChromeTopInset(chromeHidden: boolean): string | number {
  return chromeHidden ? 0 : READER_TOPBAR_INSET_CSS
}

/**
 * Bottom offset for the reading viewport, reserved so scrolled content never
 * disappears behind the fixed footer.
 *
 * Paginated mode never needs this: content is clipped into CSS columns, it
 * never scrolls past the footer, and the whole book already renders shorter
 * by `READER_TOPBAR_INSET_CSS` via `readerChromeTopInset` — stealing more
 * height here for a footer that never occludes anything would only shrink
 * every page for no reason. Scroll mode is the one case where the reader
 * actually drags real page content up behind that fixed bar, so the inset is
 * conditional on `viewMode` (and skipped whenever the footer itself is
 * off-screen, e.g. immersive mode's bottom-edge hide, so no dead whitespace
 * is reserved for a footer that isn't there to occlude anything).
 */
export function readerChromeBottomInset(
  viewMode: ReadingViewMode,
  footerHidden: boolean,
): number {
  if (viewMode !== 'scroll' || footerHidden) return 0
  return READER_FOOTER_HEIGHT_PX + READER_FOOTER_CONTENT_GAP_PX
}

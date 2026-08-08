/** Layout constants for SCR-03 reader chrome (tools bar + footer). */

/** Matches ReaderFooter `h-10` — sidebar/rail must stop above this. */
export const READER_FOOTER_HEIGHT_PX = 40

/**
 * Matches ReaderTopbar `h-[4.25rem] sm:h-[4.5rem]` — defined in index.css as
 * `--reader-topbar-height`.
 */
export const READER_TOPBAR_INSET_CSS = 'var(--reader-topbar-height, 4.25rem)'

/** Top offset for sidebar / reading viewport when tools chrome is open. */
export function readerChromeTopInset(chromeHidden: boolean): string | number {
  return chromeHidden ? 0 : READER_TOPBAR_INSET_CSS
}

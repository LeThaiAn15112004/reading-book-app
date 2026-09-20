import type { RefObject } from 'react'
import type { EpubRendererApi } from '../renderers/epub'

/** Matches ReaderShell / SidebarEdgeRail padding transition (ms). */
export const READER_CHROME_TRANSITION_MS = 300

/**
 * How long to keep the reading surface covered after a sidebar toggle that
 * resizes the EPUB host (left/right panel open/close, immersive enter/exit).
 * Must span the padding CSS transition (`READER_CHROME_TRANSITION_MS`) *plus*
 * the epub.js resize/re-pagination that only starts once that transition
 * settles — otherwise the reader briefly paints its old (pre-resize) column
 * width inside the already-resized host, which reads as a "broken/squeezed"
 * layout to the user.
 */
export const READER_CHROME_RESIZE_SETTLE_MS = READER_CHROME_TRANSITION_MS + 250

const READER_SIDEBAR_FOCUS_ROOT =
  '[data-reader-sidebar-panel], [data-reader-right-sidebar-panel], [aria-label="Sidebar navigation"]'

const STUCK_HOVER_SELECTORS = [
  '.app-menubar button:not([data-hover-menu-trigger])',
  '[aria-label="Sidebar navigation"] button',
  '[data-reader-sidebar-panel] button',
  '[data-reader-right-sidebar-panel] button',
  'button[aria-label="Open sidebar"]',
  'button[aria-label="Close sidebar"]',
] as const

/** Drop sidebar panel / rail focus so accent rings do not stick after navigation. */
export function blurReaderSidebarFocus(): void {
  const active = document.activeElement
  if (
    active instanceof HTMLElement &&
    active.closest(READER_SIDEBAR_FOCUS_ROOT)
  ) {
    active.blur()
  }
}

/** Clear :hover / focus stuck after layout shifts under a stationary cursor. */
export function clearStuckChromeHover(): void {
  for (const selector of STUCK_HOVER_SELECTORS) {
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      el.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
      )
      el.dispatchEvent(
        new MouseEvent('mouseleave', { bubbles: true, relatedTarget: document.body }),
      )
    })
  }

  const active = document.activeElement
  if (
    active instanceof HTMLElement &&
    active.closest(`.app-menubar, ${READER_SIDEBAR_FOCUS_ROOT}`)
  ) {
    active.blur()
  }
}

/** After tools/sidebar chrome animates, refresh epubjs scroll metrics. */
export function scheduleEpubResizeAfterChromeTransition(
  epubApiRef: RefObject<EpubRendererApi | null>,
  isEpubSurface: boolean,
): () => void {
  if (!isEpubSurface) return () => {}
  const id = window.setTimeout(() => {
    epubApiRef.current?.resize()
  }, READER_CHROME_TRANSITION_MS)
  return () => window.clearTimeout(id)
}

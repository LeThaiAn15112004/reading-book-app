import type { RefObject } from 'react'
import type { EpubRendererApi } from './renderers/epub'

/** Matches ReaderShell / SidebarEdgeRail padding transition (ms). */
export const READER_CHROME_TRANSITION_MS = 300

const STUCK_HOVER_SELECTORS = [
  '.app-menubar button',
  '[aria-label="Sidebar navigation"] button',
  'button[aria-label="Open sidebar"]',
  'button[aria-label="Close sidebar"]',
] as const

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
    active.closest('.app-menubar, [aria-label="Sidebar navigation"]')
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

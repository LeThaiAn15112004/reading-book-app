/** Marker for the portaled typewriter format toolbar (outside edit box DOM). */
export const TYPEWRITER_TOOLBAR_ATTR = 'data-rb-tw-toolbar'

export function isTypewriterToolbarTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el?.closest) return false
  return Boolean(el.closest(`[${TYPEWRITER_TOOLBAR_ATTR}]`))
}

export type TypewriterToolbarPlacement = {
  top: number
  left: number
  /** Prefer below the box when there isn't room above (near tools chrome). */
  placement: 'above' | 'below'
}

const TOOLBAR_GAP_PX = 8
const TOOLBAR_EST_HEIGHT_PX = 40
const TOOLBAR_EST_WIDTH_PX = 280

function chromeBottomSafeY(): number {
  const chrome = document.getElementById('reader-tools-chrome')
  if (chrome) {
    const rect = chrome.getBoundingClientRect()
    // Hidden chrome is translated off-screen (opacity 0) — ignore it.
    if (rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
      return rect.bottom + TOOLBAR_GAP_PX
    }
  }
  return TOOLBAR_GAP_PX
}

/**
 * Map an element's rect into the top-level window viewport.
 * Nodes inside an EPUB iframe report iframe-local coordinates — add the
 * frameElement offset so `position: fixed` portals land next to the box.
 */
export function getTopLevelBoundingClientRect(el: Element): DOMRect {
  const local = el.getBoundingClientRect()
  const view = el.ownerDocument?.defaultView
  const frameEl = view?.frameElement as HTMLElement | null
  if (!frameEl) return local
  const fr = frameEl.getBoundingClientRect()
  return new DOMRect(
    local.left + fr.left,
    local.top + fr.top,
    local.width,
    local.height,
  )
}

/** Place toolbar above the box; flip below if it would sit under the chrome. */
export function computeTypewriterToolbarPlacement(
  anchor: DOMRect,
): TypewriterToolbarPlacement {
  const centerX = anchor.left + anchor.width / 2
  const left = Math.min(
    Math.max(centerX, TOOLBAR_EST_WIDTH_PX / 2 + 8),
    window.innerWidth - TOOLBAR_EST_WIDTH_PX / 2 - 8,
  )

  const safeTop = chromeBottomSafeY()
  const aboveTop = anchor.top - TOOLBAR_GAP_PX - TOOLBAR_EST_HEIGHT_PX
  if (aboveTop >= safeTop) {
    return { top: aboveTop, left, placement: 'above' }
  }

  const belowTop = Math.max(anchor.bottom + TOOLBAR_GAP_PX, safeTop)
  return {
    top: Math.min(belowTop, window.innerHeight - TOOLBAR_EST_HEIGHT_PX - 8),
    left,
    placement: 'below',
  }
}

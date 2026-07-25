/**
 * Reserve horizontal space for Electron titleBarOverlay caption buttons
 * (minimize / maximize / close) so they do not cover header actions.
 *
 * Prefer Window Controls Overlay geometry when available; otherwise fall back
 * to a Windows/Linux caption width (~46px × 3).
 */

declare global {
  interface Navigator {
    windowControlsOverlay?: WindowControlsOverlay
  }
}

interface WindowControlsOverlay extends EventTarget {
  visible: boolean
  getTitlebarAreaRect(): DOMRect
}

const WINDOWS_CAPTION_FALLBACK_PX = 148

function isMacUa(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function applyInset(px: number): void {
  document.documentElement.style.setProperty(
    '--window-controls-width',
    `${Math.max(0, Math.ceil(px))}px`,
  )
}

function measureInset(): number {
  const overlay = navigator.windowControlsOverlay
  if (overlay?.visible) {
    const { x, width } = overlay.getTitlebarAreaRect()
    const fromGeometry = window.innerWidth - x - width
    if (Number.isFinite(fromGeometry) && fromGeometry > 0) {
      return fromGeometry
    }
  }

  if (isMacUa()) return 0
  return WINDOWS_CAPTION_FALLBACK_PX
}

/** Call once at boot; keeps CSS `--window-controls-width` in sync. */
export function syncWindowControlsInset(): () => void {
  const update = () => applyInset(measureInset())
  update()

  const overlay = navigator.windowControlsOverlay
  overlay?.addEventListener('geometrychange', update)
  window.addEventListener('resize', update)

  return () => {
    overlay?.removeEventListener('geometrychange', update)
    window.removeEventListener('resize', update)
  }
}

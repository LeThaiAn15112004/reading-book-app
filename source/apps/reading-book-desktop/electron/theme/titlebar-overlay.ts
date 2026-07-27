import type { BrowserWindow } from 'electron'

/** Match `src/styles/theme.css` --lib-titlebar-* (Night / Sepia / Paper). */
export type ChromeThemeId = 'night' | 'sepia' | 'paper'

export const TITLE_BAR_OVERLAY_HEIGHT = 36

const OVERLAY: Record<
  ChromeThemeId,
  { color: string; symbolColor: string }
> = {
  night: { color: '#0f172a', symbolColor: '#e2e8f0' },
  sepia: { color: '#16120e', symbolColor: '#e1cfb3' },
  paper: { color: '#f8fafc', symbolColor: '#0f172a' },
}

export function normalizeChromeThemeId(theme: unknown): ChromeThemeId {
  if (theme === 'sepia') return 'sepia'
  if (theme === 'paper' || theme === 'day') return 'paper'
  return 'night'
}

export function titleBarOverlayOptions(theme: ChromeThemeId) {
  const { color, symbolColor } = OVERLAY[theme]
  return {
    color,
    symbolColor,
    height: TITLE_BAR_OVERLAY_HEIGHT,
  }
}

/** Update native caption buttons + window chrome background (Windows/Linux). */
export function applyChromeThemeToWindow(
  win: BrowserWindow,
  theme: unknown,
): void {
  const id = normalizeChromeThemeId(theme)
  const overlay = titleBarOverlayOptions(id)
  win.setBackgroundColor(overlay.color)
  if (process.platform === 'darwin') return
  try {
    win.setTitleBarOverlay(overlay)
  } catch {
    // Overlay API unavailable (e.g. some Linux builds).
  }
}

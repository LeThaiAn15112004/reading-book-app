/**
 * Platform adapter `window`, Mobile WebView (spec 009 T045). There is no caption-button inset on a phone. The status and
 * navigation bar colours follow the page (`window-system-bars.ts`); the Mobile bridge starts that follow-up because it
 * owns the host client, and a theme change asks it to read the page again (`app.setChromeTheme`).
 */
import { api } from './api'

export function startWindowSync(): () => void {
  return () => {}
}

export async function setWindowTheme(themeId: string): Promise<void> {
  await api.setChromeTheme(themeId).catch(() => {
    // Host not ready yet.
  })
}

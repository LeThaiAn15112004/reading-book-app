/** Typed wrappers for app:* IPC via api. */

import { api } from '../platforms/api'
export const appApi = {
  ping: () => api.ping(),
  getAppInfo: () => api.getAppInfo(),
  getGoogleOAuthConfig: () => api.getGoogleOAuthConfig(),
  setChromeTheme: (theme: string) => api.setChromeTheme(theme),
  /**
   * Spec 012: App Language preference → Main. Never throws or rejects: Mobile has no Main (NOT_AVAILABLE_ON_PLATFORM)
   * and the renderer's own translation does not depend on the answer.
   */
  setUiLanguage: async (preference: Parameters<typeof api.setUiLanguage>[0]) => {
    try {
      return await api.setUiLanguage(preference)
    } catch {
      return null
    }
  },
  getFullscreen: () => api.getFullscreen(),
  setFullscreen: (value: boolean) => api.setFullscreen(value),
  toggleFullscreen: () => api.toggleFullscreen(),
  onFullscreenChanged: (handler: (fullscreen: boolean) => void) =>
    api.onFullscreenChanged(handler),
  /** Main asks renderer to flush reading session before close (T4.2). */
  onRequestFlushSession: (handler: () => void | Promise<void>) =>
    api.onRequestFlushSession(handler),
  /** Snapshot tool: crop `region` (viewport CSS px) and copy it to the clipboard. */
  captureSnapshot: (region: Parameters<typeof api.captureSnapshot>[0]) =>
    api.captureSnapshot(region),
  /** Open an http(s) / mailto link from a document in the OS default handler (validated in Main). */
  openExternalLink: (url: string) => api.openExternalLink(url),
}

export type SnapshotRegion = Parameters<typeof api.captureSnapshot>[0]

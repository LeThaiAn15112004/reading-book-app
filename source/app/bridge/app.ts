/** Typed wrappers for app:* IPC via api. */

import { api } from '../platforms/api'
export const appApi = {
  ping: () => api.ping(),
  getAppInfo: () => api.getAppInfo(),
  getGoogleOAuthConfig: () => api.getGoogleOAuthConfig(),
  setChromeTheme: (theme: string) => api.setChromeTheme(theme),
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

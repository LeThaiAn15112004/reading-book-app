/** Typed wrappers for app:* IPC via window.api. */

export const appApi = {
  ping: () => window.api.ping(),
  getAppInfo: () => window.api.getAppInfo(),
  getGoogleOAuthConfig: () => window.api.getGoogleOAuthConfig(),
  setChromeTheme: (theme: string) => window.api.setChromeTheme(theme),
  getFullscreen: () => window.api.getFullscreen(),
  setFullscreen: (value: boolean) => window.api.setFullscreen(value),
  toggleFullscreen: () => window.api.toggleFullscreen(),
  onFullscreenChanged: (handler: (fullscreen: boolean) => void) =>
    window.api.onFullscreenChanged(handler),
  /** Main asks renderer to flush reading session before close (T4.2). */
  onRequestFlushSession: (handler: () => void | Promise<void>) =>
    window.api.onRequestFlushSession(handler),
}

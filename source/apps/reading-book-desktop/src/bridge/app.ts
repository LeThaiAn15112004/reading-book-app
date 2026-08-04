/** Typed wrappers for app:* IPC via window.api. */

export const appApi = {
  ping: () => window.api.ping(),
  getAppInfo: () => window.api.getAppInfo(),
  setChromeTheme: (theme: string) => window.api.setChromeTheme(theme),
  /** Main asks renderer to flush reading session before close (T4.2). */
  onRequestFlushSession: (handler: () => void | Promise<void>) =>
    window.api.onRequestFlushSession(handler),
}

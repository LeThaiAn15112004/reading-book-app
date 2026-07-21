/** Typed wrappers for app:* IPC via window.api. */

export const appApi = {
  ping: () => window.api.ping(),
  getAppInfo: () => window.api.getAppInfo(),
}

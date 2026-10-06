/** Typed wrappers for background:* IPC via window.api. */

export type BackgroundPrefs = Awaited<ReturnType<typeof window.api.background.getPrefs>>
export type BackgroundPrefsResult = Awaited<ReturnType<typeof window.api.background.setPrefs>>

export const backgroundApi = {
  getPrefs: () => window.api.background.getPrefs(),
  setPrefs: (patch: Partial<BackgroundPrefs>) => window.api.background.setPrefs(patch),
  resetPrefs: () => window.api.background.resetPrefs(),
  quit: () => window.api.background.quit(),
}

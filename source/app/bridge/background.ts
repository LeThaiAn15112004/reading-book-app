/** Typed wrappers for background:* IPC via window.api. */

export type BackgroundPrefs = Awaited<ReturnType<typeof window.api.background.getPrefs>>
export type BackgroundPrefsResult = Awaited<ReturnType<typeof window.api.background.setPrefs>>
export type StartAtLogin = Awaited<ReturnType<typeof window.api.background.getStartAtLogin>>

export const backgroundApi = {
  getPrefs: () => window.api.background.getPrefs(),
  setPrefs: (patch: Partial<BackgroundPrefs>) => window.api.background.setPrefs(patch),
  resetPrefs: () => window.api.background.resetPrefs(),
  getStartAtLogin: () => window.api.background.getStartAtLogin(),
  setStartAtLogin: (enabled: boolean) => window.api.background.setStartAtLogin(enabled),
  quit: () => window.api.background.quit(),
}

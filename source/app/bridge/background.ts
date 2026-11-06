/** Typed wrappers for background:* IPC via api. */

import { api } from '../platforms/api'
export type BackgroundPrefs = Awaited<ReturnType<typeof api.background.getPrefs>>
export type BackgroundPrefsResult = Awaited<ReturnType<typeof api.background.setPrefs>>
export type StartAtLogin = Awaited<ReturnType<typeof api.background.getStartAtLogin>>

export const backgroundApi = {
  getPrefs: () => api.background.getPrefs(),
  setPrefs: (patch: Partial<BackgroundPrefs>) => api.background.setPrefs(patch),
  resetPrefs: () => api.background.resetPrefs(),
  getStartAtLogin: () => api.background.getStartAtLogin(),
  setStartAtLogin: (enabled: boolean) => api.background.setStartAtLogin(enabled),
  quit: () => api.background.quit(),
}

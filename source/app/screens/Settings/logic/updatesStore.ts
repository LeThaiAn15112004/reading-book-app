import { create } from 'zustand'
import { appApi, updatesApi, type UpdateCheckResult } from '../../../bridge'

export type UpdateCheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; result: UpdateCheckResult }
  /** The IPC call itself threw (Main unreachable, handler error…). */
  | { kind: 'error' }

type UpdatesState = {
  /** `app.getVersion()` via `app:getAppInfo`; null until loaded, `undefined` if it failed. */
  version: string | null | undefined
  /** `getAppInfo().platform` (Desktop: `process.platform`; phone: 'android' / 'ios'), same null / undefined convention. */
  platform: string | null | undefined
  check: UpdateCheckState
  loadVersion: () => Promise<void>
  checkForUpdates: () => Promise<void>
}

/** Settings → Advanced → Updates and About (spec 014 FR-019). Version and update status always come from the host. */
export const useUpdatesStore = create<UpdatesState>()((set, get) => ({
  version: null,
  platform: null,
  check: { kind: 'idle' },

  loadVersion: async () => {
    try {
      const info = await appApi.getAppInfo()
      set({ version: info.version, platform: info.platform })
    } catch {
      set({ version: undefined, platform: undefined })
    }
  },

  checkForUpdates: async () => {
    if (get().check.kind === 'checking') return
    set({ check: { kind: 'checking' } })
    try {
      const result = await updatesApi.check()
      set({ check: { kind: 'done', result }, version: result.currentVersion })
    } catch {
      set({ check: { kind: 'error' } })
    }
  },
}))

import { create } from 'zustand'
import { backgroundApi, type BackgroundPrefs, type StartAtLogin } from '../../../bridge/background'

type BackgroundState = {
  /** Main's current switches; null until the first load answers. */
  prefs: BackgroundPrefs | null
  loadFailed: boolean
  /** A switch change is being saved by Main — switches are disabled meanwhile. */
  saving: boolean
  /** The last change couldn't be saved; the switches show Main's unchanged value. */
  saveFailed: boolean
  quitting: boolean
  /** OS login item (Start at Login); null until loaded. */
  startAtLogin: StartAtLogin | null
  savingStartAtLogin: boolean
  /** The OS refused the change; the switch shows what the OS reports. */
  startAtLoginFailed: boolean
  load: () => Promise<void>
  setShowTray: (showTray: boolean) => Promise<void>
  setRunInBackground: (runInBackground: boolean) => Promise<void>
  setStartAtLogin: (enabled: boolean) => Promise<void>
  /** Read the OS state again (Store build: the user may have changed it in Windows Settings meanwhile). */
  refreshStartAtLogin: () => Promise<void>
  /** Store build: open Windows Settings → Startup (where a task the user turned off is turned back on). */
  openStartupSettings: () => Promise<void>
  /** Quit for real (same as the tray's "Quit Readmate"). */
  quit: () => Promise<void>
  /** Settings → Advanced → Reset App Settings: Main writes its own defaults. */
  reset: () => Promise<boolean>
}

/**
 * Spec 010: whether the app itself may switch Start at Login. The direct build has no `state` (always yes); the Store
 * build's startup task can only be switched from `enabled` / `disabled` — the other states belong to the user
 * (Windows Settings → Startup), a policy, or Windows.
 */
export function canChangeStartAtLogin(startAtLogin: StartAtLogin | null): boolean {
  if (!startAtLogin?.supported) return false
  const state = startAtLogin.state
  return state === undefined || state === 'enabled' || state === 'disabled'
}

/**
 * Settings → Background & System Tray. Unlike the other app preferences these live in Main
 * (`{userData}/background-prefs.json`): the tray and the window's close button are handled there,
 * also before the renderer has loaded. The store only mirrors Main's answer.
 */
export const useBackgroundStore = create<BackgroundState>()((set, get) => {
  async function save(patch: Partial<BackgroundPrefs>): Promise<void> {
    const previous = get().prefs
    if (!previous || get().saving) return
    // Optimistic, normalized like Main does: no background mode without the tray.
    const optimistic = { ...previous, ...patch }
    if (!optimistic.showTray) optimistic.runInBackground = false
    set({ prefs: optimistic, saving: true, saveFailed: false })
    try {
      const result = await backgroundApi.setPrefs(patch)
      set({ prefs: result.prefs, saving: false, saveFailed: !result.ok })
    } catch {
      set({ prefs: previous, saving: false, saveFailed: true })
    }
  }

  return {
    prefs: null,
    loadFailed: false,
    saving: false,
    saveFailed: false,
    quitting: false,
    startAtLogin: null,
    savingStartAtLogin: false,
    startAtLoginFailed: false,

    load: async () => {
      try {
        const [prefs, startAtLogin] = await Promise.all([
          backgroundApi.getPrefs(),
          backgroundApi.getStartAtLogin(),
        ])
        set({ prefs, startAtLogin, loadFailed: false })
      } catch {
        set({ loadFailed: true })
      }
    },

    setShowTray: (showTray) => save({ showTray }),
    setRunInBackground: (runInBackground) => save({ runInBackground }),

    setStartAtLogin: async (enabled) => {
      const previous = get().startAtLogin
      if (!canChangeStartAtLogin(previous) || !previous || get().savingStartAtLogin) return
      set({ startAtLogin: { ...previous, enabled }, savingStartAtLogin: true, startAtLoginFailed: false })
      try {
        const actual = await backgroundApi.setStartAtLogin(enabled)
        set({ startAtLogin: actual, startAtLoginFailed: actual.enabled !== enabled })
      } catch {
        set({ startAtLogin: previous, startAtLoginFailed: true })
      } finally {
        set({ savingStartAtLogin: false })
      }
    },

    refreshStartAtLogin: async () => {
      if (get().savingStartAtLogin) return
      try {
        set({ startAtLogin: await backgroundApi.getStartAtLogin() })
      } catch {
        // keep what is shown; the next load / change reports a failure
      }
    },

    openStartupSettings: async () => {
      try {
        await backgroundApi.openStartupSettings()
      } catch {
        // nothing to undo; the card keeps showing the current state
      }
    },

    quit: async () => {
      if (get().quitting) return
      set({ quitting: true })
      try {
        await backgroundApi.quit()
      } catch {
        set({ quitting: false })
      }
    },

    reset: async () => {
      try {
        const result = await backgroundApi.resetPrefs()
        // Main also turned Start at Login off — read back what the OS now reports.
        const startAtLogin = await backgroundApi.getStartAtLogin()
        set({ prefs: result.prefs, startAtLogin, saveFailed: false, loadFailed: false, startAtLoginFailed: false })
        return result.ok && !startAtLogin.enabled
      } catch {
        return false
      }
    },
  }
})

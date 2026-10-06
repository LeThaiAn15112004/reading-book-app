import { create } from 'zustand'
import { backgroundApi, type BackgroundPrefs } from '../../../bridge/background'

type BackgroundState = {
  /** Main's current switches; null until the first load answers. */
  prefs: BackgroundPrefs | null
  loadFailed: boolean
  /** A switch change is being saved by Main — switches are disabled meanwhile. */
  saving: boolean
  /** The last change couldn't be saved; the switches show Main's unchanged value. */
  saveFailed: boolean
  quitting: boolean
  load: () => Promise<void>
  setShowTray: (showTray: boolean) => Promise<void>
  setRunInBackground: (runInBackground: boolean) => Promise<void>
  /** Quit for real (same as the tray's "Quit Readmate"). */
  quit: () => Promise<void>
  /** Settings → Advanced → Reset App Settings: Main writes its own defaults. */
  reset: () => Promise<boolean>
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

    load: async () => {
      try {
        set({ prefs: await backgroundApi.getPrefs(), loadFailed: false })
      } catch {
        set({ loadFailed: true })
      }
    },

    setShowTray: (showTray) => save({ showTray }),
    setRunInBackground: (runInBackground) => save({ runInBackground }),

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
        set({ prefs: result.prefs, saveFailed: false, loadFailed: false })
        return result.ok
      } catch {
        return false
      }
    },
  }
})

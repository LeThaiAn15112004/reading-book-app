import { create } from 'zustand'
import { miniPlayerApi } from '../../../bridge'

/**
 * Spec 018 (FR-025): Settings' mirror of Main's "open the floating player by itself" switch. Main owns the value
 * (`mini-player-prefs.json`, it decides while the window is hidden); this store only loads and changes it over IPC.
 */
type MiniPlayerPrefsState = {
  autoOpen: boolean | null
  saving: boolean
  failed: boolean
  load: () => Promise<void>
  setAutoOpen: (autoOpen: boolean) => Promise<void>
}

export const useMiniPlayerPrefsStore = create<MiniPlayerPrefsState>((set) => ({
  autoOpen: null,
  saving: false,
  failed: false,
  load: async () => {
    try {
      const prefs = await miniPlayerApi.getPrefs()
      set({ autoOpen: prefs.autoOpen, failed: false })
    } catch {
      set({ failed: true })
    }
  },
  setAutoOpen: async (autoOpen) => {
    set({ saving: true, failed: false })
    try {
      const prefs = await miniPlayerApi.setPrefs({ autoOpen })
      set({ autoOpen: prefs.autoOpen, saving: false, failed: prefs.autoOpen !== autoOpen })
    } catch {
      set({ saving: false, failed: true })
    }
  },
}))

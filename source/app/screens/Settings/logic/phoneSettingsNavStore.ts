import { create } from 'zustand'
import type { SettingsSectionId } from './settingsNavStore'

/**
 * Phone "More" screen navigation state (spec 014, data-model.md). Mobile-only store — reason (spec 008
 * `contracts/phone-ui.md`): the phone shows the section list and a section as two pages, so it needs the list's scroll
 * position and the section page kept for its exit slide; Desktop shows both at once and never uses this store.
 */
type PhoneSettingsNavState = {
  /** Scroll position of the section list, restored when the list is shown again (FR-006). */
  listScrollTop: number
  /** True when the open section page was pushed from the list in this session, so Back can pop it (research R1). */
  openedFromList: boolean
  /** The section page kept on screen for its exit slide (FR-016); null when nothing is leaving. */
  leaving: { section: SettingsSectionId; token: number } | null
  saveListScroll: (top: number) => void
  resetListScroll: () => void
  setOpenedFromList: (value: boolean) => void
  startLeaving: (section: SettingsSectionId) => void
  clearLeaving: () => void
}

/** Exit slide length (phone.css `phone-settings-out`). */
export const PHONE_SETTINGS_EXIT_MS = 200

let nextToken = 0

export const usePhoneSettingsNavStore = create<PhoneSettingsNavState>()((set, get) => ({
  listScrollTop: 0,
  openedFromList: false,
  leaving: null,
  saveListScroll: (top) => set({ listScrollTop: top }),
  resetListScroll: () => set({ listScrollTop: 0 }),
  setOpenedFromList: (value) => set({ openedFromList: value }),
  startLeaving: (section) => {
    const token = ++nextToken
    set({ leaving: { section, token } })
    // Never wait for `animationend`: a timer of the animation's length clears it, and only if no newer navigation
    // replaced it in between (FR-016: the last action wins).
    setTimeout(() => {
      if (get().leaving?.token === token) set({ leaving: null })
    }, PHONE_SETTINGS_EXIT_MS)
  },
  clearLeaving: () => {
    if (get().leaving) set({ leaving: null })
  },
}))

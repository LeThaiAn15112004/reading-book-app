import { create } from 'zustand'
import {
  DEFAULT_LISTENING_PREFS,
  LISTENING_PREFS_STORAGE_KEY,
  normalizeListeningPrefs,
  type ListeningPrefs,
} from '@core'

/**
 * Spec 018 (FR-015, FR-028, FR-029): the listener's audiobook preferences on this computer — skip lengths, rewind on
 * resume, mute. A renderer preference (CLAUDE.md "App preferences"), reset by Settings → Advanced → Reset App Settings.
 */
type ListeningPrefsState = ListeningPrefs & {
  set: (patch: Partial<ListeningPrefs>) => boolean
  /** Defaults back (Reset App Settings); false when they could not be saved. */
  reset: () => boolean
}

function read(): ListeningPrefs {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(LISTENING_PREFS_STORAGE_KEY)
    return normalizeListeningPrefs(raw ? JSON.parse(raw) : undefined)
  } catch {
    return { ...DEFAULT_LISTENING_PREFS }
  }
}

function write(prefs: ListeningPrefs): boolean {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LISTENING_PREFS_STORAGE_KEY, JSON.stringify(prefs))
    return true
  } catch {
    return false // kept for the session
  }
}

function only(state: ListeningPrefsState): ListeningPrefs {
  const { skipBackSeconds, skipForwardSeconds, autoRewind, muted, volumeBeforeMute } = state
  return { skipBackSeconds, skipForwardSeconds, autoRewind, muted, volumeBeforeMute }
}

export const useListeningPrefsStore = create<ListeningPrefsState>((set, get) => ({
  ...read(),
  set: (patch) => {
    const next = normalizeListeningPrefs({ ...only(get()), ...patch })
    set(next)
    return write(next)
  },
  reset: () => {
    set({ ...DEFAULT_LISTENING_PREFS })
    return write({ ...DEFAULT_LISTENING_PREFS })
  },
}))

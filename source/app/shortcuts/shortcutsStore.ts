import { create } from 'zustand'
import { SHORTCUTS, getShortcut, type ShortcutId, type ShortcutKeys } from './shortcutDefinitions'
import { findShortcutConflict, type ShortcutKeyMap } from './shortcutConflicts'
import { normalizeShortcutKeys, shortcutKeysId, validateShortcutKeys } from './shortcutKeys'

export const SHORTCUTS_STORAGE_KEY = 'readmate.keyboardShortcuts.v1'

/** Only the shortcuts the user changed; everything else uses its `defaultKeys`. */
export type ShortcutOverrides = Partial<Record<ShortcutId, ShortcutKeys>>

/** Effective keys of every shortcut (override, else default). */
export function effectiveShortcutKeys(overrides: ShortcutOverrides): ShortcutKeyMap {
  const result = {} as Record<ShortcutId, ShortcutKeys>
  for (const s of SHORTCUTS) result[s.id] = overrides[s.id] ?? s.defaultKeys
  return result
}

/**
 * Stored overrides, keeping only the ones that are still valid and conflict-free — a hand-edited
 * or outdated value never leaves two actions firing on the same key.
 */
function loadOverrides(): ShortcutOverrides {
  try {
    const raw = localStorage.getItem(SHORTCUTS_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return {}
    const stored = parsed as Record<string, unknown>
    const overrides: ShortcutOverrides = {}
    for (const s of SHORTCUTS) {
      if (s.locked) continue
      const value = stored[s.id]
      if (!Array.isArray(value) || !value.every((k) => typeof k === 'string')) continue
      const keys = normalizeShortcutKeys(value)
      if (validateShortcutKeys(keys, undefined, { allowBare: s.allowBare })) continue
      if (findShortcutConflict(s.id, keys, effectiveShortcutKeys(overrides))) continue
      overrides[s.id] = keys
    }
    return overrides
  } catch {
    return {}
  }
}

function saveOverrides(overrides: ShortcutOverrides): boolean {
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(SHORTCUTS_STORAGE_KEY)
    else localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(overrides))
    return true
  } catch {
    return false
  }
}

export type AssignResult =
  | { ok: true }
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'conflict'; conflictWith: ShortcutId }

type ShortcutsState = {
  overrides: ShortcutOverrides
  /** Row waiting for a key press; `ShortcutsBridge` pauses all shortcuts meanwhile. */
  recordingId: ShortcutId | null
  setRecording: (id: ShortcutId | null) => void
  /**
   * Validate `keys` and assign them to `id`. Nothing changes (and nothing is saved) unless the
   * result is ok — a conflict never overwrites or swaps the other action's keys.
   */
  tryAssign: (id: ShortcutId, keys: ShortcutKeys) => AssignResult
  resetOne: (id: ShortcutId) => void
  /** Reset to Defaults on the page, and Reset App Settings. False when the write failed. */
  reset: () => boolean
}

/** Settings → Keyboard Shortcuts: the user's key overrides, persisted in localStorage. */
export const useShortcutsStore = create<ShortcutsState>()((set, get) => ({
  overrides: loadOverrides(),
  recordingId: null,
  setRecording: (recordingId) => set({ recordingId }),
  tryAssign: (id, keys) => {
    const definition = getShortcut(id)
    if (definition.locked) {
      return { ok: false, reason: 'invalid', message: 'This shortcut is fixed and can’t be changed.' }
    }
    const normalized = normalizeShortcutKeys(keys)
    const message = validateShortcutKeys(normalized, undefined, { allowBare: definition.allowBare })
    if (message) return { ok: false, reason: 'invalid', message }
    const { overrides } = get()
    const conflictWith = findShortcutConflict(id, normalized, effectiveShortcutKeys(overrides))
    if (conflictWith) return { ok: false, reason: 'conflict', conflictWith }
    const next = { ...overrides }
    if (shortcutKeysId(definition.defaultKeys) === shortcutKeysId(normalized)) delete next[id]
    else next[id] = normalized
    set({ overrides: next })
    saveOverrides(next)
    return { ok: true }
  },
  resetOne: (id) => {
    const next = { ...get().overrides }
    delete next[id]
    set({ overrides: next })
    saveOverrides(next)
  },
  reset: () => {
    set({ overrides: {}, recordingId: null })
    return saveOverrides({})
  },
}))

import { readJsonPrefsFile, writeJsonPrefsFile } from '../prefs/json-prefs-file'
import { normalizeMiniPlayerPrefs, type StoredMiniPlayerPrefs } from './mini-player-rules'

/**
 * Spec 018 (data-model "Floating window preferences"): `{userData}/mini-player-prefs.json` — the floating window's last
 * position and whether it opens by itself. Main-owned because Main decides while the renderer may be hidden.
 */
export const MINI_PLAYER_PREFS_FILE = 'mini-player-prefs.json'

let cached: StoredMiniPlayerPrefs | null = null

export function loadMiniPlayerPrefs(): StoredMiniPlayerPrefs {
  if (!cached) cached = normalizeMiniPlayerPrefs(readJsonPrefsFile(MINI_PLAYER_PREFS_FILE))
  return { ...cached }
}

/** Persist first, then keep: on a write error nothing changes and the error reaches the caller. */
export function saveMiniPlayerPrefs(patch: Partial<StoredMiniPlayerPrefs>): StoredMiniPlayerPrefs {
  const next = normalizeMiniPlayerPrefs({ ...loadMiniPlayerPrefs(), ...patch })
  writeJsonPrefsFile(MINI_PLAYER_PREFS_FILE, next)
  cached = next
  return { ...next }
}

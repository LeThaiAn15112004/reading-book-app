import type { BackgroundPrefsDto } from '../ipc/api-types'
import { readJsonPrefsFile, writeJsonPrefsFile } from '../prefs/json-prefs-file'

/**
 * Settings → Background & System Tray. Owned by Main (unlike the renderer's localStorage prefs)
 * because the tray is created and the window's close button is handled before / without the
 * renderer: `{userData}/background-prefs.json`.
 */

/** Single source of the defaults (first run, corrupt file, Settings → Reset App Settings). */
export const DEFAULT_BACKGROUND_PREFS: Readonly<BackgroundPrefsDto> = {
  showTray: true,
  runInBackground: false,
}

const FILE = 'background-prefs.json'

/**
 * Validate any stored / incoming value. Running in the background needs the tray: without it a
 * hidden window could not be reopened, so `runInBackground` is forced off when the tray is off.
 */
export function normalizeBackgroundPrefs(raw: unknown): BackgroundPrefsDto {
  const value = typeof raw === 'object' && raw !== null ? (raw as Partial<Record<keyof BackgroundPrefsDto, unknown>>) : {}
  const showTray = typeof value.showTray === 'boolean' ? value.showTray : DEFAULT_BACKGROUND_PREFS.showTray
  const runInBackground =
    typeof value.runInBackground === 'boolean' ? value.runInBackground : DEFAULT_BACKGROUND_PREFS.runInBackground
  return { showTray, runInBackground: showTray && runInBackground }
}

export function loadBackgroundPrefs(): BackgroundPrefsDto {
  return normalizeBackgroundPrefs(readJsonPrefsFile(FILE))
}

/** Atomic write. Throws when the file can't be written. */
export function saveBackgroundPrefs(prefs: BackgroundPrefsDto): void {
  writeJsonPrefsFile(FILE, prefs)
}

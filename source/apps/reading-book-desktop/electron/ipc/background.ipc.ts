import { ipcMain } from 'electron'
import {
  getBackgroundPrefs,
  quitApp,
  resetBackgroundPrefs,
  updateBackgroundPrefs,
} from '../background/background-mode'
import { getStartAtLogin, setStartAtLogin } from '../background/login-item'
import type { BackgroundPrefsDto, BackgroundPrefsResult, OkResult, StartAtLoginDto } from './api-types'
import { BackgroundChannels } from './channels'

/** Only the two known boolean switches are accepted from the renderer. */
function patchFrom(input: unknown): Partial<BackgroundPrefsDto> {
  if (typeof input !== 'object' || input === null) return {}
  const raw = input as Record<string, unknown>
  const patch: Partial<BackgroundPrefsDto> = {}
  if (typeof raw.showTray === 'boolean') patch.showTray = raw.showTray
  if (typeof raw.runInBackground === 'boolean') patch.runInBackground = raw.runInBackground
  return patch
}

function persist(apply: () => BackgroundPrefsDto): BackgroundPrefsResult {
  try {
    return { ok: true, prefs: apply() }
  } catch (err) {
    console.error('Background prefs could not be saved:', err)
    return { ok: false, prefs: getBackgroundPrefs() }
  }
}

/** Handlers for background:* — Settings → Background & System Tray. */
export function registerBackgroundIpc(): void {
  for (const channel of Object.values(BackgroundChannels)) ipcMain.removeHandler(channel)

  ipcMain.handle(BackgroundChannels.getPrefs, (): BackgroundPrefsDto => getBackgroundPrefs())
  ipcMain.handle(
    BackgroundChannels.setPrefs,
    (_event, patch: unknown): BackgroundPrefsResult =>
      persist(() => updateBackgroundPrefs(patchFrom(patch))),
  )
  ipcMain.handle(BackgroundChannels.resetPrefs, (): BackgroundPrefsResult => {
    // Start at Login defaults to off; it lives in the OS login items, not in the prefs file.
    try {
      setStartAtLogin(false)
    } catch (err) {
      console.error('Start at Login could not be turned off:', err)
    }
    return persist(() => resetBackgroundPrefs())
  })
  ipcMain.handle(BackgroundChannels.getStartAtLogin, (): StartAtLoginDto => getStartAtLogin())
  ipcMain.handle(BackgroundChannels.setStartAtLogin, (_event, enabled: unknown): StartAtLoginDto => {
    if (typeof enabled !== 'boolean') return getStartAtLogin()
    try {
      return setStartAtLogin(enabled)
    } catch (err) {
      console.error('Start at Login could not be changed:', err)
      return getStartAtLogin()
    }
  })
  ipcMain.handle(BackgroundChannels.quit, (): OkResult => {
    // Reply first; quitting tears down the renderer this call came from.
    setImmediate(quitApp)
    return { ok: true }
  })
}

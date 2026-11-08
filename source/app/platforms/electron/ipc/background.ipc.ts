import { ipcMain, shell } from 'electron'
import {
  getBackgroundPrefs,
  quitApp,
  resetBackgroundPrefs,
  updateBackgroundPrefs,
} from '../background/background-mode'
import { changeStartAtLogin, readStartAtLogin } from '../background/login-item'
import { isStoreBuild } from '../store/store-runtime'
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
  ipcMain.handle(BackgroundChannels.resetPrefs, async (): Promise<BackgroundPrefsResult> => {
    // Start at Login defaults to off; it lives in the OS login items (Store build: the startup task), not in the prefs
    // file. A task turned off by the user or a policy is left as Windows has it.
    try {
      await changeStartAtLogin(false)
    } catch (err) {
      console.error('Start at Login could not be turned off:', err)
    }
    return persist(() => resetBackgroundPrefs())
  })
  ipcMain.handle(BackgroundChannels.getStartAtLogin, (): Promise<StartAtLoginDto> => readStartAtLogin())
  ipcMain.handle(BackgroundChannels.setStartAtLogin, async (_event, enabled: unknown): Promise<StartAtLoginDto> => {
    if (typeof enabled !== 'boolean') return readStartAtLogin()
    try {
      return await changeStartAtLogin(enabled)
    } catch (err) {
      console.error('Start at Login could not be changed:', err)
      return readStartAtLogin()
    }
  })
  // Spec 010 T033: the Store build's Start at Login can be turned off by the user in Windows Settings → Startup, where
  // only they can turn it back on. Fixed URI, nothing from the renderer.
  ipcMain.handle(BackgroundChannels.openStartupSettings, async (): Promise<OkResult> => {
    if (!isStoreBuild()) return { ok: false }
    try {
      await shell.openExternal('ms-settings:startupapps')
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })
  ipcMain.handle(BackgroundChannels.quit, (): OkResult => {
    // Reply first; quitting tears down the renderer this call came from.
    setImmediate(quitApp)
    return { ok: true }
  })
}
